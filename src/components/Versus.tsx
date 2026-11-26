'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TICK_MS, type Action } from '@/lib/game';
import { GameRenderer, presentation } from '@/lib/game-renderer';
import { catchUp, GuestSession, HostSession, parseMessage, showsProgress, type NetMessage } from '@/lib/netplay';
import { track } from '@/lib/analytics';
import { connectPeer, createInvite, findMatch, joinInvite, PeerUnreachable, type Matched, type Role, type Route } from '@/lib/versus-client';
import { INVITE_PATTERN, inviteUrl } from '@/lib/versus-invite';
import { createMatch, pendingGarbage, type Side, type VersusMatch } from '@/lib/versus';
import { useGameControls } from './useGameControls';
import { ControlModeToggle, useControlMode, usePlayViewport } from './ControlMode';

type Phase = 'idle' | 'searching' | 'inviting' | 'connecting' | 'countdown' | 'playing' | 'done' | 'error';
// How the opponent was found: a random stranger or a friend with an invite link.
type Kind = 'random' | 'invite';
// Both players must ask for another game; `gone` means the opponent left.
type Rematch = { mine: boolean; theirs: boolean; gone: boolean };
const NO_REMATCH: Rematch = { mine: false, theirs: false, gone: false };
type Status = { view: VersusMatch; rtt: number; stalled: boolean };
// Why a match never started or ended early; sent to analytics without identity.
type FailReason = 'matchmaking' | 'signaling' | 'peer_unreachable' | 'opponent_left' | 'disconnected' | 'timeout';
const COUNTDOWN_MS = 3000;
const PING_MS = 1000;
const SILENCE_MS = 10_000;
const number = (value: number) => value.toLocaleString('ko-KR');
const roleOf = (side: Side) => side === 0 ? 'host' : 'guest';
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] || 1;
function Blob({ color, tiny = false }: { color: number; tiny?: boolean }) {
  return <span className={`blob color-${color}${tiny ? ' tiny' : ''}`}><i /><i /></span>;
}
// One big icon per full row (6) of incoming nuisance Puyos, then small ones.
function GarbageMeter({ count, label }: { count: number; label: string }) {
  const rows = Math.floor(count / 6), singles = count % 6;
  return <div className={`garbage-meter${count ? ' active' : ''}`} aria-label={`${label} 방해뿌요 ${count}개 대기`}>
    {count ? <>{Array.from({ length: Math.min(rows, 5) }, (_, i) => <i key={`r${i}`} className="row" />)}{Array.from({ length: singles }, (_, i) => <i key={`s${i}`} />)}<b>{count}</b></> : <span>대기 중인 방해뿌요 없음</span>}
  </div>;
}

export default function Versus() {
  const mine = useRef<HTMLCanvasElement>(null);
  const theirs = useRef<HTMLCanvasElement>(null);
  const card = useRef<HTMLElement>(null);
  const [controlMode, setControlMode] = useControlMode();
  const renderers = useRef<[GameRenderer, GameRenderer] | null>(null);
  const session = useRef<HostSession | GuestSession | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const abort = useRef<AbortController | null>(null);
  const role = useRef<Role | null>(null);
  const send = useRef<(message: NetMessage) => void>(() => {});
  const startAt = useRef(0);
  const lastHeard = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const rematchRef = useRef<Rematch>(NO_REMATCH);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [kind, setKind] = useState<Kind>('random');
  const [route, setRoute] = useState<Route>('direct');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [status, setStatus] = useState<Status>(() => ({ view: createMatch(2026), rtt: 0, stalled: false }));
  const [rematch, setRematchState] = useState<Rematch>(NO_REMATCH);
  const [invite, setInvite] = useState<{ code: string; url: string } | null>(null);
  const [incoming, setIncoming] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const setPhase = (next: Phase) => { phaseRef.current = next; setPhaseState(next); };
  const setRematch = (next: Rematch) => { rematchRef.current = next; setRematchState(next); };
  const side: Side = role.current === 'guest' ? 1 : 0;
  const other = (1 - side) as Side;

  const teardown = useCallback((notify: boolean) => {
    abort.current?.abort(); abort.current = null;
    if (notify && channel.current?.readyState === 'open') channel.current.send(JSON.stringify({ t: 'leave' } satisfies NetMessage));
    channel.current?.close(); peer.current?.close();
    channel.current = null; peer.current = null;
  }, []);
  const fail = useCallback((message: string, reason: FailReason) => {
    track('versus_error', { reason, phase: phaseRef.current, role: role.current ?? 'none' });
    teardown(false); setError(message); setPhase('error');
  }, [teardown]);

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderers.current = [new GameRenderer(reduced), new GameRenderer(reduced)];
    const code = new URLSearchParams(location.search).get('invite')?.toUpperCase() ?? '';
    if (INVITE_PATTERN.test(code)) setIncoming(code);
    setCanShare(typeof navigator.share === 'function');
    const leave = () => teardown(true);
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); teardown(true); };
  }, [teardown]);

  const beginCountdown = useCallback(() => {
    startAt.current = performance.now() + COUNTDOWN_MS;
    renderers.current?.forEach(renderer => renderer.reset());
    setCountdown(3); setPhase('countdown');
  }, []);

  // Every game on a connection, first or rematch, starts here with the host's seed.
  const begin = useCallback((seed: number) => {
    const current = role.current === 'host' ? new HostSession(seed, send.current) : new GuestSession(seed, send.current);
    session.current = current;
    lastHeard.current = performance.now();
    setStatus({ view: current.view, rtt: 0, stalled: false });
    setRematch(NO_REMATCH);
    beginCountdown();
  }, [beginCountdown]);
  const hostStart = useCallback((seed: number) => {
    send.current({ t: 'start', countdown: COUNTDOWN_MS, seed });
    begin(seed);
  }, [begin]);
  const maybeRematch = useCallback(() => {
    const wanted = rematchRef.current;
    if (role.current !== 'host' || !wanted.mine || !wanted.theirs || wanted.gone || phaseRef.current !== 'done') return;
    track('versus_rematch');
    hostStart(randomSeed());
  }, [hostStart]);

  async function play(nextKind: Kind, firstPhase: Phase, matching: (signal: AbortSignal) => Promise<Matched>) {
    teardown(false);
    const controller = new AbortController(); abort.current = controller;
    setError(''); setInvite(null); setCopied(false); setKind(nextKind); setPhase(firstPhase);
    session.current = null; role.current = null; setRematch(NO_REMATCH);
    let stage: FailReason = 'matchmaking';
    try {
      const matched = await matching(controller.signal);
      stage = 'signaling'; role.current = matched.role; setPhase('connecting');
      const connection = await connectPeer(matched, controller.signal);
      peer.current = connection.peer; channel.current = connection.channel;
      send.current = message => { if (connection.channel.readyState === 'open') connection.channel.send(JSON.stringify(message)); };
      setRoute(connection.route);
      track('versus_start', { role: matched.role, mode: nextKind, route: connection.route });
      lastHeard.current = performance.now();
      const mySide = matched.role === 'host' ? 0 : 1;
      connection.channel.addEventListener('message', event => {
        const message = parseMessage(event.data);
        if (!message) return;
        if (showsProgress(mySide, message)) lastHeard.current = performance.now();
        if (message.t === 'start') { if (mySide === 1) begin(message.seed); }
        else if (message.t === 'rematch') { setRematch({ ...rematchRef.current, theirs: true }); maybeRematch(); }
        else if (message.t === 'leave') {
          if (phaseRef.current === 'done') setRematch({ ...rematchRef.current, gone: true });
          else if (phaseRef.current !== 'idle') fail('상대가 대전을 떠났어요.', 'opponent_left');
        }
        else session.current?.receive(message, performance.now());
      });
      connection.channel.addEventListener('close', () => {
        if (channel.current !== connection.channel) return; // we left or reconnected ourselves
        if (['countdown', 'playing'].includes(phaseRef.current) && !session.current?.view.ended) fail('상대와 연결이 끊겼어요.', 'disconnected');
        else setRematch({ ...rematchRef.current, gone: true });
      });
      if (mySide === 0) hostStart(matched.seed);
    } catch (caught) {
      if (controller.signal.aborted) return;
      fail(caught instanceof Error ? caught.message : '대전을 시작하지 못했어요.', caught instanceof PeerUnreachable ? 'peer_unreachable' : stage);
    }
  }
  function search() { track('versus_search'); void play('random', 'searching', findMatch); }
  function inviteFriend() {
    void play('invite', 'inviting', async signal => {
      const { code, ready } = await createInvite(signal);
      setInvite({ code, url: inviteUrl(location.origin, code) });
      track('versus_invite', { action: 'create' });
      return ready;
    });
  }
  function clearIncoming() { setIncoming(null); history.replaceState(null, '', '/versus'); }
  function joinFriend() {
    if (!incoming) return;
    const code = incoming; clearIncoming();
    track('versus_invite', { action: 'join' });
    void play('invite', 'connecting', signal => joinInvite(code, signal));
  }
  async function copyInvite() {
    if (!invite) return;
    try { await navigator.clipboard.writeText(invite.url); setCopied(true); track('versus_invite', { action: 'copy' }); }
    catch { setCopied(false); }
  }
  async function shareInvite() {
    if (!invite) return;
    try {
      await navigator.share({ title: 'PUYO ROOM 1:1 대전', text: `뿌요 1:1 대전 하자! 초대 코드 ${invite.code}`, url: invite.url });
      track('versus_invite', { action: 'share' });
    } catch { /* the share sheet was dismissed */ }
  }
  function askRematch() {
    setRematch({ ...rematchRef.current, mine: true });
    send.current({ t: 'rematch' });
    maybeRematch();
  }
  function cancel() { teardown(false); setPhase('idle'); }
  function leave() { teardown(true); setPhase('idle'); }

  const input = useCallback((action: Action) => phaseRef.current === 'playing' && !!session.current?.input(action), []);
  const { press, boardPointer } = useGameControls(input, phase === 'playing', controlMode === 'gesture');

  const running = phase === 'countdown' || phase === 'playing';
  usePlayViewport(card, running);
  useEffect(() => {
    if (!running) return;
    let frame = 0, accumulator = 0, last = 0, lastPing = 0, lastTick = -1;
    let lastView: VersusMatch | null = null;
    const animate = (now: number) => {
      const current = session.current, painters = renderers.current;
      if (!current || !painters) return;
      if (phaseRef.current === 'countdown') {
        const left = startAt.current - now;
        if (left > 0) setCountdown(Math.ceil(left / 1000));
        else { setPhase('playing'); last = startAt.current; }
      }
      if (phaseRef.current === 'playing') {
        accumulator = catchUp(accumulator + now - (last || now)); last = now;
        while (accumulator >= TICK_MS && !current.view.ended) { accumulator -= TICK_MS; current.step(); }
        if (now - lastPing > PING_MS) { lastPing = now; current.ping(now); }
        // The host hears guest pings every second; the guest hears host frames
        // every few ticks. Silence means the peer left or its page is paused.
        if (!current.view.ended && now - lastHeard.current > SILENCE_MS) { fail('상대의 응답이 없어 대전을 종료했어요.', 'timeout'); return; }
      }
      const view = current.view;
      const boards = [mine.current, theirs.current];
      for (const [index, target] of [current.side, 1 - current.side].entries()) {
        const context = boards[index]?.getContext('2d');
        if (!context) continue;
        painters[target].sync(view.games[target], now);
        painters[target].draw(context, view.games[target], now);
      }
      // A guest confirmation can replace the view without changing its tick.
      if (view.tick !== lastTick || view !== lastView) {
        lastTick = view.tick; lastView = view;
        setStatus({ view, rtt: current.rtt, stalled: current instanceof GuestSession && current.stalled });
      }
      if (view.ended && painters.every(painter => painter.remaining(now) === 0)) {
        const own = view.games[current.side];
        track('versus_end', { outcome: view.winner === null ? 'draw' : view.winner === current.side ? 'win' : 'loss', role: roleOf(current.side),
          max_chain: own.maxChain, score: own.score, duration: Math.round(view.tick * TICK_MS / 1000), rtt_ms: Math.round(current.rtt) });
        setPhase('done'); return;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [running, fail]);

  useEffect(() => {
    if (phase !== 'idle' && phase !== 'error') return;
    const painters = renderers.current;
    [mine.current, theirs.current].forEach((board, index) => {
      const context = board?.getContext('2d');
      if (context && painters) painters[index].draw(context, status.view.games[index], performance.now());
    });
  }, [phase, status]);

  const view = status.view;
  const me = presentation(view.games[side]), them = presentation(view.games[other]);
  const outcome = view.winner === null ? '무승부' : view.winner === side ? '승리!' : '패배';
  const busy = phase === 'searching' || phase === 'connecting';
  return <div className="site-shell versus-shell">
    <header className="header"><a className="logo" href="/" aria-label="PUYO ROOM 홈"><span className="logo-mark"><Blob color={2} tiny /></span>puyo<span>room</span><span className="logo-dot">✦</span></a>
      <nav><a href="/">솔로 플레이</a></nav>
      <a className="button account" href="/">← 솔로 모드</a>
    </header>
    <main>
      <section ref={card} className="game-card versus-card" data-play={running ? 'on' : undefined} data-controls={controlMode} aria-label="1:1 온라인 대전">
        <div className="card-heading"><div><span className="player-chip">VS</span><span className="live-dot" /> ONLINE 1:1</div><div className="heading-tools"><span className="mode-badge">친선전</span><ControlModeToggle mode={controlMode} onChange={setControlMode} disabled={running} /></div></div>
        <div className="versus-layout" {...boardPointer}>
          <div className="versus-main">
            <GarbageMeter count={pendingGarbage(view, side)} label="내" />
            <div className="board-slot"><div className="board-unit"><div className="playfield"><canvas ref={mine} width={288} height={576} data-phase={phase} aria-label="내 게임판. 방향키로 이동 및 회전, 스페이스로 바로 놓기. 터치에서는 밀어서 이동, 탭해서 회전, 아래로 튕겨서 바로 놓기." />
              {phase !== 'playing' && <div className="board-overlay" role="status">
                {phase === 'idle' && (incoming
                  ? <><div className="overlay-blobs"><Blob color={1}/><Blob color={2}/></div><span className="overlay-eyebrow">FRIEND INVITE</span><h2>친구의 초대</h2><p>초대 코드 <b className="invite-inline">{incoming}</b><br/>참가하면 바로 대전이 시작돼요.</p><button className="button primary start" onClick={joinFriend}>참가하기 <span>▶</span></button><button className="text-button overlay-link" onClick={clearIncoming}>모르는 상대와 하기</button></>
                  : <><div className="overlay-blobs"><Blob color={1}/><Blob color={2}/></div><span className="overlay-eyebrow">ONLINE BATTLE</span><h2>1:1 대전</h2><p>연쇄로 방해뿌요를 보내<br/>상대를 먼저 쌓이게 하세요.</p><button className="button primary start" onClick={search}>상대 찾기 <span>▶</span></button><button className="button start" onClick={inviteFriend}>친구 초대 <span>✉</span></button><small>친선전 · 기록은 저장되지 않아요</small>{controlMode === 'gesture' && <small className="gesture-hint">보드를 밀어 이동 · 탭 회전 · 아래로 튕겨 바로 놓기</small>}</>)}
                {phase === 'inviting' && <><span className="overlay-eyebrow">INVITE A FRIEND</span><h2>친구 기다리는 중</h2>{invite
                  ? <><strong className="invite-code" aria-label={`초대 코드 ${invite.code.split('').join(' ')}`}>{invite.code}</strong><div className="overlay-actions">{canShare && <button className="button primary" onClick={shareInvite}>공유하기</button>}<button className={`button${canShare ? '' : ' primary'}`} onClick={copyInvite}>{copied ? '복사됨 ✓' : '링크 복사'}</button></div><small>친구가 링크로 들어오면 바로 시작해요.<br/>링크는 10분 동안 쓸 수 있어요.</small></>
                  : <div className="versus-spinner" aria-hidden="true"><Blob color={3} tiny/><Blob color={4} tiny/></div>}<button className="button start" onClick={cancel}>취소</button></>}
                {busy && <><span className="overlay-eyebrow">{phase === 'searching' ? 'SEARCHING' : 'CONNECTING'}</span><h2>{phase === 'searching' ? '상대를 찾는 중…' : '연결하는 중…'}</h2><p>{phase === 'searching' ? '다른 플레이어가 들어오면 바로 시작해요.' : kind === 'invite' ? <>친구 기기와 연결하고 있어요.<br/>친구가 초대 화면을 닫았다면 다시 열어 달라고 해 주세요.</> : '상대 기기와 직접 연결하고 있어요.'}</p><div className="versus-spinner" aria-hidden="true"><Blob color={3} tiny/><Blob color={4} tiny/></div><button className="button start" onClick={cancel}>취소</button></>}
                {phase === 'countdown' && <><span className="overlay-eyebrow">GET READY</span><strong className="countdown">{countdown}</strong></>}
                {phase === 'done' && <><span className="overlay-eyebrow">MATCH OVER</span><h2>{outcome}</h2><p>최대 {view.games[side].maxChain}연쇄 · 점수 {number(view.games[side].score)}</p>
                  {rematch.gone
                    ? <small className="rematch-note">{kind === 'invite' ? '친구' : '상대'}가 나갔어요.</small>
                    : <><button className="button primary start" onClick={askRematch} disabled={rematch.mine}>{rematch.mine ? <>{kind === 'invite' ? '친구' : '상대'} 기다리는 중…</> : <>한 판 더 <span>↻</span></>}</button>{rematch.theirs && !rematch.mine && <small className="rematch-note">{kind === 'invite' ? '친구' : '상대'}가 한 판 더 하고 싶어 해요!</small>}</>}
                  <button className="button start" onClick={kind === 'invite' ? inviteFriend : search}>{kind === 'invite' ? '새 친구 초대' : '새 상대 찾기'}</button><button className="text-button overlay-link" onClick={leave}>나가기</button></>}
                {phase === 'error' && <><span className="overlay-eyebrow">DISCONNECTED</span><h2>대전 종료</h2><p>{error}</p><button className="button primary start" onClick={search}>상대 찾기 <span>↻</span></button><button className="button start" onClick={inviteFriend}>친구 초대 <span>✉</span></button></>}
              </div>}
            </div><div className="player-banner"><span>YOU</span><strong>{number(me.score)}</strong><span className="player-star" aria-hidden="true">{me.chain > 0 ? `${me.chain} CHAIN` : '★'}</span></div></div></div>
          </div>
          <aside className="versus-side">
            <div className="opponent-label"><span>OPPONENT</span><strong>{number(them.score)}</strong></div>
            <GarbageMeter count={pendingGarbage(view, other)} label="상대" />
            <div className="playfield opponent"><canvas ref={theirs} width={288} height={576} aria-label="상대 게임판" /></div>
            <div className="net-status" aria-live="polite">{status.stalled ? <b>상대 응답 대기 중…</b> : phase === 'playing' ? <>지연 {Math.round(status.rtt)}ms</> : null}</div>
          </aside>
        </div>
        <div className="touch-controls" aria-label="게임 조작"><div className="pad move-pad"><button {...press('left')} aria-label="왼쪽 이동">←</button><button {...press('down')} aria-label="아래로 이동">↓</button><button {...press('right')} aria-label="오른쪽 이동">→</button></div><div className="pad action-pad"><button {...press('drop')} className="drop" aria-label="바로 놓기">바로<br/>놓기</button><button {...press('rotate')} className="rotate" aria-label="회전">↻</button></div></div>
        <div className="game-footer"><span className="touch-hint">보드를 밀어 이동 · 탭 회전 · 아래로 튕겨 바로 놓기</span><span className="key-hint"><kbd>←</kbd><kbd>→</kbd> 이동 <kbd>↑</kbd> 회전 <kbd>↓</kbd> 빠르게 <kbd>SPACE</kbd> 바로 놓기</span><span className="connection-dot">{route === 'relay' ? 'P2P 중계 연결' : 'P2P 직접 연결'}</span></div>
      </section>
    </main>
  </div>;
}

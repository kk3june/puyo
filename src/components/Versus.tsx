'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TICK_MS, type Action } from '@/lib/game';
import { GameRenderer, presentation } from '@/lib/game-renderer';
import { GuestSession, HostSession, parseMessage, type NetMessage } from '@/lib/netplay';
import { connectPeer, findMatch } from '@/lib/versus-client';
import { createMatch, pendingGarbage, type Side, type VersusMatch } from '@/lib/versus';
import { useGameControls } from './useGameControls';

type Phase = 'idle' | 'searching' | 'connecting' | 'countdown' | 'playing' | 'done' | 'error';
type Status = { view: VersusMatch; rtt: number; stalled: boolean };
const COUNTDOWN_MS = 3000;
const PING_MS = 1000;
const SILENCE_MS = 10_000;
const number = (value: number) => value.toLocaleString('ko-KR');
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
  const renderers = useRef<[GameRenderer, GameRenderer] | null>(null);
  const session = useRef<HostSession | GuestSession | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const abort = useRef<AbortController | null>(null);
  const startAt = useRef(0);
  const lastHeard = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [status, setStatus] = useState<Status>(() => ({ view: createMatch(2026), rtt: 0, stalled: false }));
  const setPhase = (next: Phase) => { phaseRef.current = next; setPhaseState(next); };
  const side: Side = session.current?.side ?? 0;
  const other = (1 - side) as Side;

  const teardown = useCallback((notify: boolean) => {
    abort.current?.abort(); abort.current = null;
    if (notify && channel.current?.readyState === 'open') channel.current.send(JSON.stringify({ t: 'leave' } satisfies NetMessage));
    channel.current?.close(); peer.current?.close();
    channel.current = null; peer.current = null;
  }, []);
  const fail = useCallback((message: string) => { teardown(false); setError(message); setPhase('error'); }, [teardown]);

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderers.current = [new GameRenderer(reduced), new GameRenderer(reduced)];
    const leave = () => teardown(true);
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); teardown(true); };
  }, [teardown]);

  const beginCountdown = useCallback(() => {
    startAt.current = performance.now() + COUNTDOWN_MS;
    renderers.current?.forEach(renderer => renderer.reset());
    setCountdown(3); setPhase('countdown');
  }, []);

  async function search() {
    teardown(false);
    const controller = new AbortController(); abort.current = controller;
    setError(''); setPhase('searching');
    try {
      const matched = await findMatch(controller.signal);
      setPhase('connecting');
      const connection = await connectPeer(matched, controller.signal);
      peer.current = connection.peer; channel.current = connection.channel;
      const send = (message: NetMessage) => { if (connection.channel.readyState === 'open') connection.channel.send(JSON.stringify(message)); };
      const current = matched.role === 'host' ? new HostSession(matched.seed, send) : new GuestSession(matched.seed, send);
      session.current = current;
      lastHeard.current = performance.now();
      setStatus({ view: current.view, rtt: 0, stalled: false });
      connection.channel.addEventListener('message', event => {
        const message = parseMessage(event.data);
        if (!message) return;
        lastHeard.current = performance.now();
        if (message.t === 'start') { if (current.side === 1) beginCountdown(); }
        else if (message.t === 'leave') { if (!['done', 'idle'].includes(phaseRef.current)) fail('상대가 대전을 떠났어요.'); }
        else current.receive(message, performance.now());
      });
      connection.channel.addEventListener('close', () => {
        if (['countdown', 'playing'].includes(phaseRef.current) && !current.view.ended) fail('상대와 연결이 끊겼어요.');
      });
      if (current.side === 0) { send({ t: 'start', countdown: COUNTDOWN_MS }); beginCountdown(); }
    } catch (caught) {
      if (controller.signal.aborted) return;
      fail(caught instanceof Error ? caught.message : '대전을 시작하지 못했어요.');
    }
  }
  function cancel() { teardown(false); setPhase('idle'); }

  const input = useCallback((action: Action) => phaseRef.current === 'playing' && !!session.current?.input(action), []);
  const { press, boardPointer } = useGameControls(input, phase === 'playing');

  const running = phase === 'countdown' || phase === 'playing';
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
        accumulator += now - (last || now); last = now;
        while (accumulator >= TICK_MS && !current.view.ended) { accumulator -= TICK_MS; current.step(); }
        if (now - lastPing > PING_MS) { lastPing = now; current.ping(now); }
        // Pings flow both ways every second, so silence means the peer is gone.
        if (!current.view.ended && now - lastHeard.current > SILENCE_MS) { fail('상대의 응답이 없어 대전을 종료했어요.'); return; }
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
      <section className="game-card versus-card" aria-label="1:1 온라인 대전">
        <div className="card-heading"><div><span className="player-chip">VS</span><span className="live-dot" /> ONLINE 1:1</div><span className="mode-badge">친선전</span></div>
        <div className="versus-layout">
          <div className="versus-main">
            <GarbageMeter count={pendingGarbage(view, side)} label="내" />
            <div className="board-unit"><div className="playfield"><canvas ref={mine} width={288} height={576} data-phase={phase} aria-label="내 게임판. 방향키로 이동 및 회전, 스페이스로 바로 놓기. 터치에서는 밀어서 이동, 탭해서 회전, 아래로 튕겨서 바로 놓기." {...boardPointer} />
              {phase !== 'playing' && <div className="board-overlay" role="status">
                {phase === 'idle' && <><div className="overlay-blobs"><Blob color={1}/><Blob color={2}/></div><span className="overlay-eyebrow">ONLINE BATTLE</span><h2>1:1 대전</h2><p>연쇄로 방해뿌요를 보내<br/>상대를 먼저 쌓이게 하세요.</p><button className="button primary start" onClick={search}>상대 찾기 <span>▶</span></button><small>친선전 · 기록은 저장되지 않아요</small></>}
                {busy && <><span className="overlay-eyebrow">{phase === 'searching' ? 'SEARCHING' : 'CONNECTING'}</span><h2>{phase === 'searching' ? '상대를 찾는 중…' : '연결하는 중…'}</h2><p>{phase === 'searching' ? '다른 플레이어가 들어오면 바로 시작해요.' : '상대 기기와 직접 연결하고 있어요.'}</p><div className="versus-spinner" aria-hidden="true"><Blob color={3} tiny/><Blob color={4} tiny/></div><button className="button start" onClick={cancel}>취소</button></>}
                {phase === 'countdown' && <><span className="overlay-eyebrow">GET READY</span><strong className="countdown">{countdown}</strong></>}
                {phase === 'done' && <><span className="overlay-eyebrow">MATCH OVER</span><h2>{outcome}</h2><p>최대 {view.games[side].maxChain}연쇄 · 점수 {number(view.games[side].score)}</p><button className="button primary start" onClick={search}>새 상대 찾기 <span>↻</span></button></>}
                {phase === 'error' && <><span className="overlay-eyebrow">DISCONNECTED</span><h2>대전 종료</h2><p>{error}</p><button className="button primary start" onClick={search}>다시 찾기 <span>↻</span></button></>}
              </div>}
            </div><div className="player-banner"><span>YOU</span><strong>{number(me.score)}</strong><span className="player-star" aria-hidden="true">{me.chain > 0 ? `${me.chain} CHAIN` : '★'}</span></div></div>
          </div>
          <aside className="versus-side">
            <div className="opponent-label"><span>OPPONENT</span><strong>{number(them.score)}</strong></div>
            <GarbageMeter count={pendingGarbage(view, other)} label="상대" />
            <div className="playfield opponent"><canvas ref={theirs} width={288} height={576} aria-label="상대 게임판" /></div>
            <div className="net-status" aria-live="polite">{status.stalled ? <b>상대 응답 대기 중…</b> : phase === 'playing' ? <>지연 {Math.round(status.rtt)}ms</> : null}</div>
          </aside>
        </div>
        <div className="touch-controls" aria-label="게임 조작"><div className="pad move-pad"><button {...press('left')} aria-label="왼쪽 이동">←</button><button {...press('down')} aria-label="아래로 이동">↓</button><button {...press('right')} aria-label="오른쪽 이동">→</button></div><div className="pad action-pad"><button {...press('drop')} className="drop" aria-label="바로 놓기">바로<br/>놓기</button><button {...press('rotate')} className="rotate" aria-label="회전">↻</button></div></div>
        <div className="game-footer"><span className="touch-hint">보드를 밀어 이동 · 탭 회전 · 아래로 튕겨 바로 놓기</span><span className="key-hint"><kbd>←</kbd><kbd>→</kbd> 이동 <kbd>↑</kbd> 회전 <kbd>↓</kbd> 빠르게 <kbd>SPACE</kbd> 바로 놓기</span><span className="connection-dot">P2P 직접 연결</span></div>
      </section>
    </main>
  </div>;
}

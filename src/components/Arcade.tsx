'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { advance, createGame, MAX_TICKS, RULESET, TICK_MS, type Action, type Game, type Move } from '@/lib/game';
import { GameRenderer, presentation, sampleResolution } from '@/lib/game-renderer';
import { track } from '@/lib/analytics';
import { ArcadeEmblem, Crown } from './ArcadeEmblem';

type Result = { token: string | null; ticks: number; moves: Move[]; score: number; maxChain: number; saved?: boolean };
type Entry = { rank: number; name: string; score: number; max_chain: number };
type Board = { configured: boolean; entries: Entry[]; me: Entry | null; error?: string };
const STORAGE = 'puyo-pending-v1';
const BEST_STORAGE = `puyo-best-${RULESET}`;
const number = (value: number) => value.toLocaleString('ko-KR');
function Blob({ color, tiny = false }: { color: number; tiny?: boolean }) {
  return <span className={`blob color-${color}${tiny ? ' tiny' : ''}`}><i /><i /></span>;
}
export default function Arcade() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<GameRenderer | null>(null);
  const engine = useRef<Game | null>(null);
  const inputs = useRef<Action[]>([]);
  const moves = useRef<Move[]>([]);
  const ticket = useRef<string | null>(null);
  const starting = useRef(false);
  const [phase, setPhase] = useState<'idle' | 'playing' | 'done'>('idle');
  const [snapshot, setSnapshot] = useState<Game>(() => createGame(2026));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [ranked, setRanked] = useState(false);
  const [notice, setNotice] = useState('');
  const [period, setPeriod] = useState<'all' | 'week'>('all');
  const [leaderboard, setLeaderboard] = useState<Board>({ configured:false, entries:[], me:null });
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [best, setBest] = useState(0);
  const fetchBoard = useCallback(async () => {
    setLoadingBoard(true);
    try {
      const response = await fetch(`/api/leaderboard?period=${period}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setLeaderboard(data);
    } catch { setLeaderboard({ configured:false, entries:[], me:null, error:'랭킹을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' }); }
    finally { setLoadingBoard(false); }
  }, [period]);
  useEffect(() => { void fetchBoard(); }, [fetchBoard]);
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(data => { setUser(data.user); setAuthReady(data.configured); setRanked(data.ranking); }).catch(() => setNotice('로그인 상태를 확인하지 못했어요. 새로고침해 주세요.')).finally(() => setAuthLoaded(true));
    try {
      setBest(Number(localStorage.getItem(BEST_STORAGE)) || 0);
      const stored = sessionStorage.getItem(STORAGE);
      if (stored) { const pending = JSON.parse(stored); if (typeof pending.score === 'number' && Array.isArray(pending.moves)) { setResult(pending); setPhase('done'); setSnapshot(prev => ({...prev, score:pending.score, maxChain:pending.maxChain, tick:pending.ticks, ended:true})); } }
    } catch { sessionStorage.removeItem(STORAGE); }
    const params = new URLSearchParams(location.search);
    if (params.has('auth_error')) setNotice('카카오 로그인에 실패했어요. 설정을 확인하거나 다시 시도해 주세요.');
    if (params.get('login') === 'success') { setNotice('로그인했어요! 완료한 게임의 기록을 등록할 수 있습니다.'); track('login', { method: 'kakao' }); }
    if (params.has('auth_error') || params.has('login')) history.replaceState({}, '', '/');
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    renderer.current = new GameRenderer(media.matches);
    const change = () => renderer.current?.setReducedMotion(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (phase === 'playing') return;
    const context = canvas.current?.getContext('2d');
    if (context && renderer.current) renderer.current.draw(context, snapshot, performance.now());
  }, [snapshot, phase]);
  const input = useCallback((action: Action) => {
    if (engine.current && !engine.current.ended && !engine.current.motion && inputs.current.length < 3) inputs.current.push(action);
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (phase !== 'playing' || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) return;
      const keys: Record<string, Action> = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'rotate', ArrowDown:'down', ' ':'drop', x:'rotate', X:'rotate' };
      if (keys[event.key]) { event.preventDefault(); if (!event.repeat || !['drop','rotate'].includes(keys[event.key])) input(keys[event.key]); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, input]);
  useEffect(() => {
    if (phase !== 'playing') return;
    let last = performance.now(), accumulator = 0;
    let frame = 0, recorded = false;
    const context = canvas.current?.getContext('2d');
    const animate = (now: number) => {
      const game = engine.current;
      const painter = renderer.current;
      if (!game || !painter || !context) return;
      accumulator += now - last; last = now;
      const previousTick = game.tick;
      // Catch up elapsed ticks after backgrounding; the clock never pauses.
      while (accumulator >= TICK_MS && !game.ended) {
        accumulator -= TICK_MS;
        if (game.motion) inputs.current = [];
        const action = game.motion ? undefined : inputs.current.shift();
        if (action) moves.current.push({ tick: game.tick + 1, action });
        advance(game, action);
      }
      painter.sync(game, now);
      painter.draw(context, game, now);
      if (previousTick !== game.tick) setSnapshot({ ...game });
      if (game.ended && !recorded) {
        recorded = true;
        const final: Result = { token: ticket.current, moves: [...moves.current], ticks:game.tick, score:game.score, maxChain:game.maxChain };
        setResult(final);
        try { sessionStorage.setItem(STORAGE, JSON.stringify(final)); const high = Math.max(Number(localStorage.getItem(BEST_STORAGE)) || 0, game.score); localStorage.setItem(BEST_STORAGE,String(high)); setBest(high); } catch { setNotice('브라우저 저장 공간을 사용할 수 없어 로그인 이동 시 기록이 사라질 수 있어요.'); }
        track('game_end', { score:game.score, max_chain:game.maxChain, duration:game.tick*TICK_MS/1000, mode:'sprint' });
      }
      // Let the final burst finish before covering the board with the result card.
      if (game.ended && painter.remaining(now) === 0) { setPhase('done'); return; }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [phase]);
  async function start() {
    if (starting.current || phase === 'playing') return;
    starting.current = true; setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/game/start', { method:'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '게임을 시작하지 못했어요.');
      engine.current = createGame(data.seed); moves.current = []; inputs.current = []; ticket.current = data.token;
      renderer.current?.reset();
      sessionStorage.removeItem(STORAGE); setResult(null); setSnapshot({ ...engine.current }); setRanked(data.ranked); setPhase('playing');
      (document.activeElement as HTMLElement | null)?.blur();
      if (matchMedia('(max-width: 560px)').matches) document.querySelector('.game-card')?.scrollIntoView({block:'start',behavior:'smooth'});
      track('game_start', { mode:'sprint', ranked:data.ranked });
    } catch (error) { setNotice(error instanceof Error ? error.message : '네트워크를 확인해 주세요.'); }
    finally { starting.current = false; setBusy(false); }
  }
  async function submit() {
    if (!result?.token || busy) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/scores', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token:result.token,ticks:result.ticks,moves:result.moves}) });
      const data = await response.json();
      if (!response.ok && response.status !== 409) throw new Error(data.error);
      const saved = {...result,saved:true}; setResult(saved); sessionStorage.setItem(STORAGE,JSON.stringify(saved));
      setNotice(response.status === 409 ? '이미 등록된 기록입니다.' : '기록을 등록했어요. 내 순위를 확인해 보세요!');
      if (response.ok) track('score_submit', { score:data.score, max_chain:data.maxChain });
      await fetchBoard();
    } catch(error) { setNotice(error instanceof Error ? error.message : '기록을 저장하지 못했어요. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  const remaining = Math.max(0, Math.ceil((MAX_TICKS - snapshot.tick)*TICK_MS/1000));
  const visible = phase === 'done' ? {score:snapshot.score,chain:snapshot.lastChain} : presentation(snapshot);
  const loginButton = (label = '카카오로 로그인') => <form action="/auth/login" method="post" onSubmit={() => track('login_click', { method:'kakao' })}><button className="button kakao" disabled={!authReady || !authLoaded || phase === 'playing'}><span className="chat-icon" />{label}</button></form>;
  return <div className="site-shell">
    <header className="header"><a className="logo" href="/" aria-label="PUYO ROOM 홈"><span className="logo-mark"><Blob color={2} tiny /></span>puyo<span>room</span><span className="logo-dot">✦</span></a>
      <nav><a href="#how-to">플레이 방법</a><a href="#ranking">랭킹보드</a></nav>
      {user ? <form action="/auth/logout" method="post"><button className="button account" disabled={phase==='playing'}>{user.name} <span>로그아웃</span></button></form> : loginButton()}
    </header>
    <main>
      <section className="intro"><div><div className="eyebrow"><span /> READY. SET. CHAIN!</div><h1>한 번 더,<br className="mobile-break" /> <em>한 연쇄 더!</em></h1><p>나만의 연쇄로, 하이스코어의 주인공이 되어 봐요.</p></div><ArcadeEmblem/><div className="intro-art" aria-hidden="true"><Blob color={4}/><Blob color={1}/><Blob color={2}/><span>LET’S POP!</span></div></section>
      {notice && <div className="notice" role="status">{notice}<button aria-label="안내 닫기" onClick={() => setNotice('')}>×</button></div>}
      <div className="arcade-layout">
        <section className="game-card" aria-label="3분 퍼즐 게임">
          <div className="card-heading"><div><span className="player-chip">1P</span><span className="live-dot" /> SOLO ARCADE</div><span className="mode-badge">3분 스프린트</span></div>
          <div className="game-layout"><aside className="game-stats"><div className="stat score-panel"><span>TOTAL SCORE</span><strong className="score" aria-label="현재 점수">{number(visible.score)}</strong><span className="score-caption">MAKE IT A HIGH SCORE</span></div><div className="stat"><span>BEST CHAIN</span><strong>{snapshot.maxChain}<small> 연쇄</small></strong></div><div className="stat next"><span>NEXT PUYO</span><div><Blob color={snapshot.next[1]} tiny/><Blob color={snapshot.next[0]} tiny/></div></div><div className="room-note"><div className="player-mascot" aria-hidden="true"><span className="mascot-spark">✦</span><Blob color={3}/><b>1P</b></div><strong>YOUR NEXT<br/>GREAT CHAIN.</strong><span className="mascot-caption">다음 연쇄는 더 크게!</span></div></aside>
            <div className="board-unit"><div className="playfield"><canvas ref={canvas} width={288} height={576} data-motion={phase !== 'playing' ? phase : snapshot.motion ? sampleResolution(snapshot.motion, (snapshot.tick-snapshot.motion.startTick)*TICK_MS)?.step.kind ?? 'falling' : 'falling'} aria-label="6열 12행 게임판. 방향키로 이동 및 회전, 스페이스로 바로 놓기." />
              {phase !== 'playing' && <div className="board-overlay">
                {phase === 'idle' ? <><div className="overlay-blobs"><Blob color={1}/><Blob color={4}/></div><span className="overlay-eyebrow">ARE YOU READY?</span><h2>지금, 플레이!</h2><p>네 개를 연결하고<br/>나만의 연쇄를 만들어 보세요.</p><button className="button primary start" onClick={start} disabled={busy}>{busy?'준비 중…':'게임 시작'} <span>▶</span></button><small>FREE PLAY · 로그인 없이 바로 시작</small></> : <><Crown className="result-crown"/><span className="overlay-eyebrow">NICE PLAY!</span><h2>이번 기록</h2><strong className="result-score">{number(result?.score ?? snapshot.score)}</strong><p>최대 {result?.maxChain ?? snapshot.maxChain}연쇄 · 수고했어요!</p>{result?.saved ? <div className="saved">✓ 랭킹 등록 완료</div> : result?.token ? user ? <button className="button kakao" disabled={busy} onClick={submit}>{busy?'검증 중…':'랭킹에 기록 남기기'}</button> : loginButton('로그인하고 기록 남기기') : <small>연습 기록이에요. 랭킹 연결 후 등록할 수 있어요.</small>}<button className="button primary start" onClick={start} disabled={busy}>{busy?'잠시만요…':'한 번 더 플레이'} <span>↻</span></button></>}
              </div>}
            </div><div className="player-banner"><span>PLAYER 01</span><strong>{user?.name ?? '도전자, 당신!'}</strong><span className="player-star" aria-hidden="true">★</span></div></div>
            <aside className="game-side"><div className={`timer ${remaining<=30?'urgent':''}`}><span>TIME LEFT</span><strong>{String(Math.floor(remaining/60)).padStart(2,'0')}<b>:</b>{String(remaining%60).padStart(2,'0')}</strong><div className="time-track"><i style={{width:`${remaining/180*100}%`}} /></div></div><div className="chain-callout" aria-live="polite">{visible.chain>0 ? <><strong>{visible.chain}</strong><span>CHAIN!</span></> : <><span className="sparkle">✳</span><span>LET’S<br/>CONNECT</span></>}</div><div className="personal-best"><span>이 기기 최고 기록</span><strong>{number(best)}</strong></div></aside>
          </div>
          <div className="touch-controls" aria-label="게임 조작"><button disabled={phase!=='playing'} onClick={() => input('left')} aria-label="왼쪽 이동">←</button><button disabled={phase!=='playing'} onClick={() => input('right')} aria-label="오른쪽 이동">→</button><button disabled={phase!=='playing'} onClick={() => input('rotate')} aria-label="회전">↻</button><button disabled={phase!=='playing'} onClick={() => input('down')} aria-label="아래로 이동">↓</button><button disabled={phase!=='playing'} onClick={() => input('drop')} className="drop">바로 놓기 ↓</button></div>
          <div className="game-footer"><span><kbd>←</kbd><kbd>→</kbd> 이동 <kbd>↑</kbd> 회전 <kbd>↓</kbd> 빠르게 <kbd>SPACE</kbd> 바로 놓기</span><span className="connection-dot">{ranked?'랭킹 도전 가능':'연습 모드'}</span></div>
        </section>
        <aside className="ranking-card" id="ranking"><div className="ranking-title"><div><span className="eyebrow">HALL OF FAME</span><h2>하이스코어 랭킹</h2></div><Crown className="trophy"/></div><div className="ranking-banner"><span>CHASE THE CROWN</span><span aria-hidden="true">✦ ✦ ✦</span></div><div className="tabs" role="group" aria-label="랭킹 기간"><button aria-pressed={period==='all'} className={period==='all'?'selected':''} onClick={() => {setPeriod('all');track('leaderboard_view',{period:'all'});}}>전체 랭킹</button><button aria-pressed={period==='week'} className={period==='week'?'selected':''} onClick={() => {setPeriod('week');track('leaderboard_view',{period:'week'});}}>이번 주</button></div><div className="ranking-columns"><span>순위 / 플레이어</span><span>최고 점수</span></div>
          <div className="ranking-list">{loadingBoard ? <div className="empty-board">기록을 불러오는 중…</div> : leaderboard.entries.length ? leaderboard.entries.map(entry => <div className={`ranking-row rank-${entry.rank}`} key={entry.rank}><span className="rank-number">{String(entry.rank).padStart(2,'0')}</span><span className="player-avatar"><Blob color={(entry.rank%4)+1} tiny /></span><div><strong>{entry.name}</strong><small>최대 {entry.max_chain}연쇄</small></div><b>{number(entry.score)}</b></div>) : <div className="empty-board"><div className="podium" aria-hidden="true"><div><Blob color={2}/><span>2</span></div><div><Crown/><Blob color={4}/><span>1</span></div><div><Blob color={1}/><span>3</span></div></div><strong>{leaderboard.error?'잠시 연결이 끊겼어요':leaderboard.configured?'첫 번째 주인공을 기다려요':'곧, 기록으로 만나요'}</strong><p>{leaderboard.error || (leaderboard.configured?'첫 기록을 남기고 랭킹에 이름을 올려 보세요.':'랭킹 서비스 연결 전이에요. 게임은 지금 바로 즐길 수 있어요.')}</p>{leaderboard.error && <button className="text-button" onClick={fetchBoard}>다시 불러오기</button>}</div>}</div>
          <div className="my-rank">{user ? <><span>내 최고 순위</span><strong>{leaderboard.me?`${leaderboard.me.rank}위 · ${number(leaderboard.me.score)}점`:'첫 기록에 도전해 보세요'}</strong></> : <><span className="lock-icon">♧</span><div><strong>내 기록도 여기에.</strong><p>카카오 로그인으로 순위를 남겨 보세요.</p></div></>}</div><p className="ranking-note">{period==='week'?'매주 월요일 00:00 (한국 시간)부터 집계':'플레이어별 최고 기록 · 동점은 먼저 달성한 순서'}</p>
        </aside>
      </div>
      <section className="how-to" id="how-to"><div className="how-to-title"><span className="eyebrow">SIMPLE RULES, ENDLESS FUN</span><h2>딱 세 가지만 기억해요.</h2></div><article><span className="step">01</span><div><h3>같은 색 4개 연결</h3><p>상하좌우로 네 개 이상 모이면 팡!</p></div><div className="mini-blobs"><Blob color={1} tiny/><Blob color={1} tiny/></div></article><article><span className="step">02</span><div><h3>연쇄로 더 높은 점수</h3><p>떨어진 뿌요가 연결되면 연쇄 성공.</p></div><span className="rule-symbol">✳</span></article><article><span className="step">03</span><div><h3>꼭대기까지 쌓이지 않게</h3><p>3분 동안 차곡차곡, 최고 기록 도전.</p></div><span className="rule-symbol arrow">↑</span></article></section>
    </main><footer className="footer"><span>puyo room <span>작은 쉼표, 즐거운 연결.</span></span><div><a href="/privacy">개인정보 안내</a><span>MADE FOR YOUR PLAYTIME.</span></div></footer>
  </div>;
}

// The browser and score-verification endpoint run this exact deterministic engine.
import { scoreClear, MAX_DROP_BONUS } from './scoring';
export const WIDTH = 6;
export const HEIGHT = 12;
export const TICK_MS = 50;
export const MAX_TICKS = 180_000 / TICK_MS;
export const RULESET = 'sprint-v3';
export const GARBAGE = 5 as const;
export type Ruleset = 'sprint-v1' | 'sprint-v2' | 'sprint-v3' | 'battle-v1';
export const BATTLE_RULESET = 'battle-v1';
// Versus has no clock; this cap only guarantees a finished replay (a draw).
export const BATTLE_MAX_TICKS = 600_000 / TICK_MS;
export type Color = 1 | 2 | 3 | 4;
export type Garbage = typeof GARBAGE;
export type FilledCell = Color | Garbage;
export type Cell = 0 | FilledCell;
export type Action = 'left' | 'right' | 'rotate' | 'down' | 'drop';
export type Move = { tick: number; action: Action };
export type Piece = { x: number; y: number; rotation: number; colors: [Color, Color] };
export type MotionBlob = { x: number; fromY: number; toY: number; color: FilledCell };
export type MotionStep = {
  kind: 'drop' | 'land' | 'fall' | 'clear'; ticks: number; board: Cell[][];
  blobs: MotionBlob[]; chain?: number; score?: number;
};
export type Resolution = { id: number; startTick: number; steps: MotionStep[]; ticks: number };
export type Game = {
  board: Cell[][]; active: Piece; next: [Color, Color]; rng: number;
  tick: number; gravity: number; score: number; maxChain: number;
  lastChain: number; cleared: number; pieces: number; ended: boolean;
  rules: Ruleset; motion: Resolution | null;
  pieceDropBonus: number; garbageRng: number;
};
export type LockResult = { chain: number; score: number; allClear: boolean };
// Battle mode decides how many nuisance Puyos fall after each lock.
export type LockHook = (result: LockResult) => number;
const OFFSETS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const ACTIONS = new Set(['left', 'right', 'rotate', 'down', 'drop']);
function color(game: { rng: number }): Color {
  let x = game.rng | 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  game.rng = x >>> 0;
  return ((game.rng % 4) + 1) as Color;
}
function pair(game: { rng: number }): [Color, Color] { return [color(game), color(game)]; }
export function cells(piece: Piece): [number, number, Color][] {
  const [dx, dy] = OFFSETS[piece.rotation];
  return [[piece.x, piece.y, piece.colors[0]], [piece.x + dx, piece.y + dy, piece.colors[1]]];
}
function fits(game: Game, piece: Piece) {
  return cells(piece).every(([x, y]) => x >= 0 && x < WIDTH && y >= -1 && y < HEIGHT && (y < 0 || game.board[y][x] === 0));
}
export function createGame(seed: number, rules: Ruleset = RULESET): Game {
  const random = { rng: (seed >>> 0) || 1 };
  const colors = pair(random), next = pair(random);
  return { board: Array.from({ length: HEIGHT }, () => Array<Cell>(WIDTH).fill(0)),
    active: { x: 2, y: 0, rotation: 0, colors }, next, rng: random.rng,
    tick: 0, gravity: 0, score: 0, maxChain: 0, lastChain: 0, cleared: 0, pieces: 0, ended: false, rules, motion: null, pieceDropBonus: 0, garbageRng: nextRandom(random.rng ^ 0x9e3779b9) };
}
const copyBoard = (board: Cell[][]) => board.map(row => [...row]);
export function settle(board: Cell[][], steps?: MotionStep[]) {
  const before = steps ? copyBoard(board) : null;
  const falling: MotionBlob[] = [];
  for (let x = 0; x < WIDTH; x++) {
    let target = HEIGHT - 1;
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const color = board[y][x];
      if (!color) continue;
      if (target !== y) {
        falling.push({x, fromY:y, toY:target, color});
        board[target][x] = color; board[y][x] = 0;
      }
      target--;
    }
  }
  if (steps && before && falling.length) {
    const distance = Math.max(...falling.map(b => b.toY - b.fromY));
    steps.push({kind:'fall', ticks:Math.min(10, 3 + Math.ceil(Math.sqrt(distance) * 2)), board:before, blobs:falling});
    steps.push({kind:'land', ticks:3, board:copyBoard(board), blobs:falling});
  }
}
export function resolveBoard(board: Cell[][], steps?: MotionStep[]) {
  let chain = 0, score = 0, cleared = 0;
  settle(board, steps);
  while (true) {
    const visited = new Set<number>(), coloredRemoved: [number, number][] = [], colorsCleared = new Set<Color>();
    const groupSizes: number[] = [];
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const c = board[y][x], key = y * WIDTH + x;
      if (!c || c === GARBAGE || visited.has(key)) continue;
      const group: [number, number][] = [[x, y]];
      visited.add(key);
      for (let i = 0; i < group.length; i++) {
        const [gx, gy] = group[i];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = gx + dx, ny = gy + dy, nk = ny * WIDTH + nx;
          if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && !visited.has(nk) && board[ny][nx] === c) {
            visited.add(nk); group.push([nx, ny]);
          }
        }
      }
      if (group.length >= 4) {
        coloredRemoved.push(...group); colorsCleared.add(c);
        groupSizes.push(group.length);
      }
    }
    if (!coloredRemoved.length) break;
    chain++;
    const { points } = scoreClear(chain, groupSizes, colorsCleared.size);
    score += points;
    cleared += coloredRemoved.length;
    const removedKeys = new Set(coloredRemoved.map(([x, y]) => y * WIDTH + x));
    for (const [x, y] of coloredRemoved) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && board[ny][nx] === GARBAGE) {
          removedKeys.add(ny * WIDTH + nx);
        }
      }
    }
    const removed = [...removedKeys].map(key => [key % WIDTH, Math.floor(key / WIDTH)] as [number, number]);
    steps?.push({kind:'clear', ticks:8, board:copyBoard(board), chain, score:points,
      blobs:removed.map(([x,y]) => ({x, fromY:y, toY:y, color:board[y][x] as FilledCell}))});
    removed.forEach(([x, y]) => { board[y][x] = 0; });
    settle(board, steps);
  }
  return { chain, score, cleared };
}

function nextRandom(rng: number) {
  let value = rng | 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return value >>> 0;
}

/** Places at most five rows of nuisance Puyos and returns the advanced RNG. */
export function placeGarbage(board: Cell[][], requested: number, rng: number, steps?: MotionStep[]) {
  if (!Number.isInteger(requested) || requested < 0) throw new Error('Invalid garbage count');
  const count = Math.min(30, requested);
  if (count === 0) return { placed: 0, overflow: false, rng: rng >>> 0 };
  settle(board);
  const before = steps ? copyBoard(board) : null;
  const columns = Array.from({length: WIDTH}, (_, index) => index);
  let next = (rng >>> 0) || 1;
  for (let index = columns.length - 1; index > 0; index--) {
    next = nextRandom(next);
    const other = next % (index + 1);
    [columns[index], columns[other]] = [columns[other], columns[index]];
  }
  const fullRows = Math.floor(count / WIDTH), extra = count % WIDTH;
  const amounts = Array(WIDTH).fill(fullRows) as number[];
  for (let index = 0; index < extra; index++) amounts[columns[index]]++;

  const blobs: MotionBlob[] = [];
  let placed = 0, overflow = false;
  for (let x = 0; x < WIDTH; x++) {
    const emptyRows: number[] = [];
    for (let y = HEIGHT - 1; y >= 0; y--) if (board[y][x] === 0) emptyRows.push(y);
    if (amounts[x] > emptyRows.length) overflow = true;
    const amount = Math.min(amounts[x], emptyRows.length);
    for (let index = 0; index < amount; index++) {
      const y = emptyRows[index];
      board[y][x] = GARBAGE;
      blobs.push({x, fromY: index - amount, toY: y, color: GARBAGE});
      placed++;
    }
  }
  if (steps && before && blobs.length) {
    const distance = Math.max(...blobs.map(blob => blob.toY - blob.fromY));
    steps.push({kind:'fall', ticks:Math.min(12, 4 + Math.ceil(Math.sqrt(distance) * 2)), board:before, blobs});
    steps.push({kind:'land', ticks:3, board:copyBoard(board), blobs});
  }
  return { placed, overflow, rng: next };
}
function lock(game: Game, dropFrom?: Piece, onLock?: LockHook) {
  const occupied = cells(game.active);
  if (occupied.some(([, y]) => y < 0)) { game.ended = true; return; }
  const steps: MotionStep[] | undefined = game.rules !== 'sprint-v1' ? [] : undefined;
  const landed = occupied.map(([x,y,color]) => ({x,fromY:y,toY:y,color}));
  if (dropFrom && steps && game.active.y !== dropFrom.y) {
    steps.push({kind:'drop', ticks:3, board:copyBoard(game.board), blobs:landed.map((b,i)=>({...b,fromY:cells(dropFrom)[i][1]}))});
  }
  occupied.forEach(([x, y, c]) => { game.board[y][x] = c; });
  steps?.push({kind:'land', ticks:3, board:copyBoard(game.board), blobs:landed});
  const result = resolveBoard(game.board, steps);
  game.score += result.score;
  game.maxChain = Math.max(game.maxChain, result.chain);
  game.lastChain = result.chain;
  game.cleared += result.cleared;
  game.pieces++;
  const garbage = onLock?.({ chain: result.chain, score: result.score, allClear: result.chain > 0 && game.board.every(row => row.every(cell => !cell)) }) ?? 0;
  if (garbage > 0) game.garbageRng = placeGarbage(game.board, garbage, game.garbageRng, steps).rng;
  if (steps) game.motion = {id:game.pieces, startTick:game.tick, steps, ticks:steps.reduce((sum,step)=>sum+step.ticks,0)};
  game.active = { x: 2, y: 0, rotation: 0, colors: game.next };
  game.next = pair(game);
  game.gravity = 0;
  game.pieceDropBonus = 0;
  if (!fits(game, game.active)) game.ended = true;
}
// Mutates a game once per fixed 50ms tick; max one input per tick.
export function advance(game: Game, action?: Action, onLock?: LockHook) {
  if (game.ended) return game;
  game.tick++;
  const limit = game.rules === BATTLE_RULESET ? BATTLE_MAX_TICKS : MAX_TICKS;
  if (game.motion) {
    if (game.tick - game.motion.startTick < game.motion.ticks) {
      if (game.tick >= limit) game.ended = true;
      return game;
    }
    game.motion = null;
  }
  if (action === 'left' || action === 'right') {
    const moved = { ...game.active, x: game.active.x + (action === 'left' ? -1 : 1) };
    if (fits(game, moved)) game.active = moved;
  } else if (action === 'rotate') {
    for (const kick of [0, -1, 1]) {
      const rotated = { ...game.active, x: game.active.x + kick, rotation: (game.active.rotation + 1) % 4 };
      if (fits(game, rotated)) { game.active = rotated; break; }
    }
  } else if (action === 'drop') {
    const from = {...game.active};
    while (fits(game, { ...game.active, y: game.active.y + 1 })) game.active.y++;
    lock(game, from, onLock);
  } else if (action === 'down') {
    if (fits(game, { ...game.active, y: game.active.y + 1 })) {
      game.active.y++;
      if (game.rules === 'sprint-v3' && game.pieceDropBonus < MAX_DROP_BONUS) {
        game.score++; game.pieceDropBonus++;
      }
    }
    else lock(game, undefined, onLock);
  }
  if (!game.ended && action !== 'drop' && !game.motion) {
    game.gravity++;
    const interval = Math.max(4, 14 - Math.floor(game.tick / 600));
    if (game.gravity >= interval) {
      game.gravity = 0;
      if (fits(game, { ...game.active, y: game.active.y + 1 })) game.active.y++;
      else lock(game, undefined, onLock);
    }
  }
  if (game.tick >= limit) game.ended = true;
  return game;
}
export function ghost(game: Game): Piece {
  const piece = { ...game.active };
  while (fits(game, { ...piece, y: piece.y + 1 })) piece.y++;
  return piece;
}
export function replay(seed: number, moves: unknown, ticks: unknown, rules: Ruleset = RULESET): Game {
  if (!Number.isInteger(ticks) || (ticks as number) < 1 || (ticks as number) > MAX_TICKS || !Array.isArray(moves) || moves.length > MAX_TICKS) throw new Error('잘못된 게임 기록입니다.');
  let previous = 0;
  for (const move of moves) {
    if (!move || !Number.isInteger(move.tick) || move.tick <= previous || move.tick > (ticks as number) || !ACTIONS.has(move.action)) throw new Error('잘못된 조작 기록입니다.');
    previous = move.tick;
  }
  const game = createGame(seed, rules);
  let index = 0;
  while (game.tick < (ticks as number) && !game.ended) {
    const move = moves[index];
    advance(game, move?.tick === game.tick + 1 ? moves[index++].action : undefined);
  }
  if (!game.ended || game.tick !== ticks || index !== moves.length) throw new Error('완료된 게임만 등록할 수 있습니다.');
  return game;
}

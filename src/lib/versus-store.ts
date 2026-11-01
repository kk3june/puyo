import 'server-only';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { database } from './supabase/server';

export type Role = 'host' | 'guest';
export type QueueEntry = { id: string; status: 'waiting' | 'matched'; matchId: string | null; role: Role | null; seed: number | null };
export type Signal = { id: number; payload: unknown };
export interface VersusStore {
  enqueue(player: string, seed: number): Promise<QueueEntry>;
  poll(id: string, player: string): Promise<QueueEntry | null>;
  cancel(id: string, player: string): Promise<void>;
  postSignal(matchId: string, player: string, payload: unknown): Promise<void>;
  readSignals(matchId: string, player: string, after: number): Promise<Signal[]>;
}
export class VersusError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const supabaseConfigured = () => !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await database().rpc(name, args);
  if (error) {
    if (error.code === '42501') throw new VersusError('대전 참가자가 아닙니다.', 403);
    if (error.code === '54000') throw new VersusError('연결 요청이 너무 많습니다.', 429);
    throw new VersusError('매칭 서버에 연결하지 못했어요.', 502);
  }
  return data as T;
}

const supabaseStore: VersusStore = {
  enqueue: (player, seed) => rpc('versus_enqueue', { p_player: player, p_seed: seed }),
  poll: (id, player) => rpc('versus_poll', { p_id: id, p_player: player }),
  cancel: (id, player) => rpc('versus_cancel', { p_id: id, p_player: player }),
  postSignal: (matchId, player, payload) => rpc('versus_post_signal', { p_match: matchId, p_player: player, p_payload: payload }),
  readSignals: (matchId, player, after) => rpc('versus_read_signals', { p_match: matchId, p_player: player, p_after: after }),
};

// Single-process fallback for local development without Supabase. It mirrors
// the SQL functions in supabase/migrations/202611020001_versus_matchmaking.sql.
type MemoryRow = { id: string; player: string; created: number; seen: number; matchId: string | null; role: Role | null; seed: number | null };
type MemoryState = { queue: MemoryRow[]; signals: { id: number; matchId: string; sender: Role; payload: unknown; created: number }[]; nextSignal: number };
const memory: MemoryState = ((globalThis as { __puyoVersus?: MemoryState }).__puyoVersus ??= { queue: [], signals: [], nextSignal: 1 });
const entry = (row: MemoryRow): QueueEntry => ({ id: row.id, status: row.matchId ? 'matched' : 'waiting', matchId: row.matchId, role: row.role, seed: row.seed });
function memberRole(matchId: string, player: string) {
  const role = memory.queue.find(row => row.matchId === matchId && row.player === player)?.role;
  if (!role) throw new VersusError('대전 참가자가 아닙니다.', 403);
  return role;
}
const memoryStore: VersusStore = {
  async enqueue(player, seed) {
    const now = Date.now();
    memory.queue = memory.queue.filter(row => row.seen >= now - 600_000 && !(row.player === player && !row.matchId));
    memory.signals = memory.signals.filter(signal => signal.created >= now - 600_000);
    const other = memory.queue.find(row => !row.matchId && row.player !== player && row.seen > now - 8_000);
    const mine: MemoryRow = { id: randomUUID(), player, created: now, seen: now, matchId: null, role: null, seed: null };
    if (other) {
      const matchId = randomUUID();
      Object.assign(other, { matchId, role: 'host', seed });
      Object.assign(mine, { matchId, role: 'guest', seed });
    }
    memory.queue.push(mine);
    return entry(mine);
  },
  async poll(id, player) {
    const row = memory.queue.find(candidate => candidate.id === id && candidate.player === player);
    if (!row) return null;
    row.seen = Date.now();
    return entry(row);
  },
  async cancel(id, player) {
    memory.queue = memory.queue.filter(row => !(row.id === id && row.player === player && !row.matchId));
  },
  async postSignal(matchId, player, payload) {
    const sender = memberRole(matchId, player);
    if (memory.signals.filter(signal => signal.matchId === matchId && signal.sender === sender).length >= 20) throw new VersusError('연결 요청이 너무 많습니다.', 429);
    memory.signals.push({ id: memory.nextSignal++, matchId, sender, payload, created: Date.now() });
  },
  async readSignals(matchId, player, after) {
    const role = memberRole(matchId, player);
    return memory.signals.filter(signal => signal.matchId === matchId && signal.sender !== role && signal.id > after).map(({ id, payload }) => ({ id, payload }));
  },
};

/** Supabase in production; an in-memory store only where one process serves everything. */
export function versusStore(): VersusStore {
  if (supabaseConfigured()) return supabaseStore;
  if (process.env.VERCEL) throw new VersusError('대전 매칭 서버가 아직 연결되지 않았어요.', 503);
  return memoryStore;
}

/** The same anonymous browser id the solo game uses; set on first visit. */
export async function versusPlayer() {
  const jar = await cookies();
  let player = jar.get('puyo_guest')?.value;
  if (!player) {
    player = randomUUID();
    jar.set('puyo_guest', player, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 86400 * 7 });
  }
  return player;
}

export function versusFailure(error: unknown) {
  const known = error instanceof VersusError;
  return Response.json({ error: known ? error.message : '요청을 처리하지 못했어요.' }, { status: known ? error.status : 400, headers: { 'Cache-Control': 'no-store' } });
}

// Host-authoritative netplay over ordered, reliable channels, one per guest.
//
// The host runs the real match (seat 0 = host, seats 1-5 = guests) and
// streams every applied input to every guest. Each guest replays that stream
// into a confirmed copy and predicts its own unconfirmed inputs on top, so its
// controls feel immediate. Other players only reach a guest's board through
// garbage, which the next host frame corrects.
import { TICK_MS, type Action } from './game';
import type { Team } from './battle';
import { advanceMatch, cloneMatch, createMatch, emptySlot, focusOn, isAim, ONE_ON_ONE, validInput, validTeams, type AimAction, type Side, type VersusAction, type VersusInput, type VersusMatch } from './versus';

export type NetMessage =
  // The host starts every game, first and rematch, with the seed all boards
  // use. Multiplayer starts also tell each guest its seat and the teams.
  | { t: 'start'; countdown: number; seed: number; side?: Side; teams?: Team[] }
  | { t: 'rematch' }
  | { t: 'input'; seq: number; tick: number; action: VersusAction }
  // acks[seat] is the last input sequence the host took from that guest.
  | { t: 'frame'; tick: number; acks: number[]; inputs: VersusInput[] }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number }
  | { t: 'leave' };
export type Send = (message: NetMessage) => void;
/** Host side: no `to` broadcasts to every guest. */
export type HostSend = (message: NetMessage, to?: Side) => void;

export const HEARTBEAT_TICKS = 4;
export const MAX_AHEAD_TICKS = 40;
// After the page was hidden (rAF paused) the match resumes instead of
// simulating the missed time in one burst: a returning host would otherwise
// auto-drop its own pieces, and a returning guest would run ahead of the host.
export const MAX_CATCH_UP_TICKS = 5;
const MAX_QUEUE = 3;
// A guest sends at most one input per tick and runs at most MAX_AHEAD_TICKS
// past the last host frame, so a legitimate backlog always fits.
const MAX_REMOTE_QUEUE = MAX_AHEAD_TICKS;
const MOVES = new Set(['left', 'right', 'rotate', 'down', 'drop']);
const count = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;

/** Elapsed time still to simulate, capped so a paused page resumes in place. */
export function catchUp(accumulator: number) {
  return Math.min(accumulator, MAX_CATCH_UP_TICKS * TICK_MS);
}

/** Whether a message proves the match is still progressing on the other side. */
export function showsProgress(side: Side, message: NetMessage) {
  // A hidden host tab still answers pings but stops sending frames.
  return side === 0 || message.t === 'frame' || message.t === 'start';
}

export function parseMessage(raw: unknown): NetMessage | null {
  if (typeof raw !== 'string' || raw.length > 64_000) return null;
  try {
    const message = JSON.parse(raw) as NetMessage;
    switch (message?.t) {
      case 'start': {
        const seat = message.side === undefined && message.teams === undefined ||
          validTeams(message.teams) && Number.isInteger(message.side) && message.side! >= 1 && message.side! < message.teams.length;
        return seat && Number.isFinite(message.countdown) && Number.isInteger(message.seed) && message.seed >= 1 && message.seed <= 0xffffffff ? message : null;
      }
      case 'rematch': return message;
      case 'input': return Number.isInteger(message.seq) && Number.isInteger(message.tick) && typeof message.action === 'string' && (MOVES.has(message.action) || isAim(message.action)) ? message : null;
      case 'frame': return Number.isInteger(message.tick) && Array.isArray(message.acks) && message.acks.length <= 6 && message.acks.every(count) && Array.isArray(message.inputs) && message.inputs.every(validInput) ? message : null;
      case 'ping': case 'pong': return Number.isFinite(message.at) ? message : null;
      case 'leave': return message;
      default: return null;
    }
  } catch { return null; }
}

// Same queueing rules as the solo arcade: no input during animations, a hard
// drop replaces queued soft drops, and at most three actions wait.
function enqueue(queue: Action[], action: Action, match: VersusMatch, side: Side) {
  if (match.ended || match.games[side].motion) return false;
  if (action === 'drop') for (let i = queue.length - 1; i >= 0; i--) if (queue[i] === 'down') queue.splice(i, 1);
  if (queue.length >= MAX_QUEUE) return false;
  queue.push(action);
  return true;
}

/** An aim change for a living player; it takes the player's next tick, even mid-animation. */
function aimAction(match: VersusMatch, side: Side, target: Side | null): AimAction | null {
  if (match.ended || match.out[side] !== null) return null;
  if (target === null) return 'cycle';
  const valid = target !== side && target >= 0 && target < match.games.length && match.out[target] === null &&
    match.battle.players[target].team !== match.battle.players[side].team;
  return valid ? focusOn(target) : null;
}

export class HostSession {
  readonly side = 0;
  readonly match: VersusMatch;
  readonly log: VersusInput[] = [];
  private readonly rtts: number[];
  private local: Action[] = [];
  private aiming: AimAction | null = null;
  private readonly remote: { tick: number; action: VersusAction }[][];
  private readonly acks: number[];
  private outbox: VersusInput[] = [];
  private lastFrame = 0;
  constructor(seed: number, private readonly send: HostSend, teams: readonly Team[] = ONE_ON_ONE) {
    this.match = createMatch(seed, teams);
    this.remote = teams.map(() => []);
    this.acks = teams.map(() => 0);
    this.rtts = teams.map(() => 0);
  }
  get view() { return this.match; }
  /** The slowest guest's round trip, in ms. */
  get rtt() { return Math.max(...this.rtts); }
  rttOf(side: Side) { return this.rtts[side] ?? 0; }
  ping(now: number) { this.send({ t: 'ping', at: now }); }

  input(action: Action) { return enqueue(this.local, action, this.match, 0); }
  /** Focus attacks on a seat, or null to cycle through opponents. */
  aim(target: Side | null) {
    const action = aimAction(this.match, 0, target);
    if (action) this.aiming = action;
    return !!action;
  }

  receive(message: NetMessage, now = 0, from: Side = 1) {
    if (!Number.isInteger(from) || from < 1 || from >= this.match.games.length) return;
    if (message.t === 'ping') { this.send({ t: 'pong', at: message.at }, from); return; }
    if (message.t === 'pong') { this.rtts[from] = Math.max(0, now - message.at); return; }
    if (message.t !== 'input' || message.seq <= this.acks[from]) return;
    this.acks[from] = message.seq;
    if (this.remote[from].length < MAX_REMOTE_QUEUE) this.remote[from].push({ tick: message.tick, action: message.action });
  }

  step() {
    const match = this.match;
    if (match.ended) return;
    const tick = match.tick + 1;
    const slot = emptySlot(match);
    if (match.games[0].motion) this.local = [];
    slot[0] = this.aiming ?? (match.games[0].motion ? undefined : this.local.shift());
    this.aiming = null;
    // A late guest input is applied on the first tick the host can still use.
    for (let side = 1; side < slot.length; side++) {
      const queue = this.remote[side];
      if (queue[0] && queue[0].tick <= tick) slot[side] = queue.shift()!.action;
    }
    slot.forEach((action, side) => { if (action) this.outbox.push({ tick, side, action }); });
    advanceMatch(match, slot);
    if (this.outbox.length || match.ended || tick - this.lastFrame >= HEARTBEAT_TICKS) {
      this.log.push(...this.outbox);
      this.send({ t: 'frame', tick, acks: [...this.acks], inputs: this.outbox });
      this.outbox = []; this.lastFrame = tick;
    }
  }
}

export class GuestSession {
  rtt = 0;
  confirmed: VersusMatch;
  view: VersusMatch;
  private queue: Action[] = [];
  private aiming: AimAction | null = null;
  private pending: { seq: number; tick: number; action: VersusAction }[] = [];
  private seq = 0;
  constructor(seed: number, private readonly send: Send, readonly side: Side = 1, teams: readonly Team[] = ONE_ON_ONE) {
    if (!Number.isInteger(side) || side < 1 || side >= teams.length) throw new Error('Invalid guest seat');
    this.confirmed = createMatch(seed, teams);
    this.view = cloneMatch(this.confirmed);
  }
  /** The guest has run too far past the last host frame and is waiting. */
  get stalled() { return this.view.tick - this.confirmed.tick >= MAX_AHEAD_TICKS; }
  ping(now: number) { this.send({ t: 'ping', at: now }); }

  input(action: Action) { return enqueue(this.queue, action, this.view, this.side); }
  aim(target: Side | null) {
    const action = aimAction(this.view, this.side, target);
    if (action) this.aiming = action;
    return !!action;
  }

  receive(message: NetMessage, now = 0) {
    if (message.t === 'ping') { this.send({ t: 'pong', at: message.at }); return; }
    if (message.t === 'pong') { this.rtt = Math.max(0, now - message.at); return; }
    if (message.t !== 'frame' || message.tick <= this.confirmed.tick) return;
    const byTick = new Map<number, VersusInput[]>();
    for (const input of message.inputs) byTick.set(input.tick, [...(byTick.get(input.tick) ?? []), input]);
    while (this.confirmed.tick < message.tick && !this.confirmed.ended) {
      const slot = emptySlot(this.confirmed);
      for (const input of byTick.get(this.confirmed.tick + 1) ?? []) if (input.side < slot.length) slot[input.side] = input.action;
      advanceMatch(this.confirmed, slot);
    }
    const ack = message.acks[this.side] ?? 0;
    this.pending = this.pending.filter(input => input.seq > ack);
    this.rebuild(Math.max(this.view.tick, this.confirmed.tick));
  }

  private rebuild(target: number) {
    const view = cloneMatch(this.confirmed);
    if (!view.ended) {
      const pending = [...this.pending];
      while (view.tick < target && !view.ended) {
        const slot = emptySlot(view);
        if (pending[0] && pending[0].tick <= view.tick + 1) slot[this.side] = pending.shift()!.action;
        advanceMatch(view, slot);
      }
    }
    this.view = view;
  }

  step() {
    if (this.view.ended || this.stalled) return;
    const own = this.view.games[this.side];
    if (own.motion) this.queue = [];
    const action = this.aiming ?? (own.motion ? undefined : this.queue.shift());
    this.aiming = null;
    const tick = this.view.tick + 1;
    if (action) {
      this.seq++;
      this.pending.push({ seq: this.seq, tick, action });
      this.send({ t: 'input', seq: this.seq, tick, action });
    }
    const slot = emptySlot(this.view);
    slot[this.side] = action;
    advanceMatch(this.view, slot);
    // Only the host decides a winner; never show a predicted result.
    if (this.view.ended && !this.confirmed.ended) this.rebuild(this.view.tick - 1);
  }
}

// Host-authoritative netplay over any ordered, reliable channel.
//
// The host runs the real match (side 0 = host, side 1 = guest) and streams
// every applied input. The guest replays that stream into a confirmed copy and
// predicts its own unconfirmed inputs on top, so its controls feel immediate.
// Opponent inputs only reach the guest board through garbage, which the next
// host frame corrects.
import { TICK_MS, type Action } from './game';
import { advanceMatch, cloneMatch, createMatch, validInput, type VersusInput, type VersusMatch } from './versus';

export type NetMessage =
  // The host starts every game, first and rematch, with the seed both boards use.
  | { t: 'start'; countdown: number; seed: number }
  | { t: 'rematch' }
  | { t: 'input'; seq: number; tick: number; action: Action }
  | { t: 'frame'; tick: number; ack: number; inputs: VersusInput[] }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number }
  | { t: 'leave' };
export type Send = (message: NetMessage) => void;

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
const ACTIONS = new Set(['left', 'right', 'rotate', 'down', 'drop']);

/** Elapsed time still to simulate, capped so a paused page resumes in place. */
export function catchUp(accumulator: number) {
  return Math.min(accumulator, MAX_CATCH_UP_TICKS * TICK_MS);
}

/** Whether a message proves the match is still progressing on the other side. */
export function showsProgress(side: 0 | 1, message: NetMessage) {
  // A hidden host tab still answers pings but stops sending frames.
  return side === 0 || message.t === 'frame' || message.t === 'start';
}

export function parseMessage(raw: unknown): NetMessage | null {
  if (typeof raw !== 'string' || raw.length > 64_000) return null;
  try {
    const message = JSON.parse(raw) as NetMessage;
    switch (message?.t) {
      case 'start': return Number.isFinite(message.countdown) && Number.isInteger(message.seed) && message.seed >= 1 && message.seed <= 0xffffffff ? message : null;
      case 'rematch': return message;
      case 'input': return Number.isInteger(message.seq) && Number.isInteger(message.tick) && ACTIONS.has(message.action) ? message : null;
      case 'frame': return Number.isInteger(message.tick) && Number.isInteger(message.ack) && Array.isArray(message.inputs) && message.inputs.every(validInput) ? message : null;
      case 'ping': case 'pong': return Number.isFinite(message.at) ? message : null;
      case 'leave': return message;
      default: return null;
    }
  } catch { return null; }
}

// Same queueing rules as the solo arcade: no input during animations, a hard
// drop replaces queued soft drops, and at most three actions wait.
function enqueue(queue: Action[], action: Action, match: VersusMatch, side: 0 | 1) {
  if (match.ended || match.games[side].motion) return false;
  if (action === 'drop') for (let i = queue.length - 1; i >= 0; i--) if (queue[i] === 'down') queue.splice(i, 1);
  if (queue.length >= MAX_QUEUE) return false;
  queue.push(action);
  return true;
}

abstract class Session {
  rtt = 0;
  constructor(protected readonly send: Send) {}
  ping(now: number) { this.send({ t: 'ping', at: now }); }
  protected handlePing(message: NetMessage, now: number) {
    if (message.t === 'ping') { this.send({ t: 'pong', at: message.at }); return true; }
    if (message.t === 'pong') { this.rtt = Math.max(0, now - message.at); return true; }
    return false;
  }
}

export class HostSession extends Session {
  readonly side = 0 as const;
  readonly match: VersusMatch;
  readonly log: VersusInput[] = [];
  private local: Action[] = [];
  private remote: { tick: number; action: Action }[] = [];
  private outbox: VersusInput[] = [];
  private ack = 0;
  private lastFrame = 0;
  constructor(seed: number, send: Send) { super(send); this.match = createMatch(seed); }
  get view() { return this.match; }

  input(action: Action) { return enqueue(this.local, action, this.match, 0); }

  receive(message: NetMessage, now = 0) {
    if (this.handlePing(message, now) || message.t !== 'input' || message.seq <= this.ack) return;
    this.ack = message.seq;
    if (this.remote.length < MAX_REMOTE_QUEUE) this.remote.push({ tick: message.tick, action: message.action });
  }

  step() {
    const match = this.match;
    if (match.ended) return;
    const tick = match.tick + 1;
    if (match.games[0].motion) this.local = [];
    const mine = match.games[0].motion ? undefined : this.local.shift();
    // A late guest input is applied on the first tick the host can still use.
    const theirs = this.remote[0] && this.remote[0].tick <= tick ? this.remote.shift()!.action : undefined;
    if (mine) this.outbox.push({ tick, side: 0, action: mine });
    if (theirs) this.outbox.push({ tick, side: 1, action: theirs });
    advanceMatch(match, [mine, theirs]);
    if (this.outbox.length || match.ended || tick - this.lastFrame >= HEARTBEAT_TICKS) {
      this.log.push(...this.outbox);
      this.send({ t: 'frame', tick, ack: this.ack, inputs: this.outbox });
      this.outbox = []; this.lastFrame = tick;
    }
  }
}

export class GuestSession extends Session {
  readonly side = 1 as const;
  confirmed: VersusMatch;
  view: VersusMatch;
  private queue: Action[] = [];
  private pending: { seq: number; tick: number; action: Action }[] = [];
  private seq = 0;
  constructor(seed: number, send: Send) {
    super(send);
    this.confirmed = createMatch(seed);
    this.view = cloneMatch(this.confirmed);
  }
  /** The guest has run too far past the last host frame and is waiting. */
  get stalled() { return this.view.tick - this.confirmed.tick >= MAX_AHEAD_TICKS; }

  input(action: Action) { return enqueue(this.queue, action, this.view, 1); }

  receive(message: NetMessage, now = 0) {
    if (this.handlePing(message, now) || message.t !== 'frame' || message.tick <= this.confirmed.tick) return;
    const byTick = new Map<number, VersusInput[]>();
    for (const input of message.inputs) byTick.set(input.tick, [...(byTick.get(input.tick) ?? []), input]);
    while (this.confirmed.tick < message.tick && !this.confirmed.ended) {
      const slot: [Action | undefined, Action | undefined] = [undefined, undefined];
      for (const input of byTick.get(this.confirmed.tick + 1) ?? []) slot[input.side] = input.action;
      advanceMatch(this.confirmed, slot);
    }
    this.pending = this.pending.filter(input => input.seq > message.ack);
    this.rebuild(Math.max(this.view.tick, this.confirmed.tick));
  }

  private rebuild(target: number) {
    const view = cloneMatch(this.confirmed);
    if (!view.ended) {
      const pending = [...this.pending];
      while (view.tick < target && !view.ended) {
        const next = pending[0] && pending[0].tick <= view.tick + 1 ? pending.shift()!.action : undefined;
        advanceMatch(view, [undefined, next]);
      }
    }
    this.view = view;
  }

  step() {
    if (this.view.ended || this.stalled) return;
    if (this.view.games[1].motion) this.queue = [];
    const action = this.view.games[1].motion ? undefined : this.queue.shift();
    const tick = this.view.tick + 1;
    if (action) {
      this.seq++;
      this.pending.push({ seq: this.seq, tick, action });
      this.send({ t: 'input', seq: this.seq, tick, action });
    }
    advanceMatch(this.view, [undefined, action]);
    // Only the host decides a winner; never show a predicted result.
    if (this.view.ended && !this.confirmed.ended) this.rebuild(this.view.tick - 1);
  }
}

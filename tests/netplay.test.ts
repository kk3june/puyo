import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action } from '../src/lib/game';
import { GuestSession, HostSession, MAX_AHEAD_TICKS, parseMessage, type NetMessage } from '../src/lib/netplay';
import { replayMatch } from '../src/lib/versus';

// Delivers each JSON-encoded message `latency` ticks after it was sent.
function link(latency: number) {
  let now = 0;
  const flights: { at: number; to: 'host' | 'guest'; raw: string }[] = [];
  const host = new HostSession(42, message => flights.push({ at: now + latency, to: 'guest', raw: JSON.stringify(message) }));
  const guest = new GuestSession(42, message => flights.push({ at: now + latency, to: 'host', raw: JSON.stringify(message) }));
  const deliver = () => {
    for (const flight of flights.filter(flight => flight.at <= now)) {
      flights.splice(flights.indexOf(flight), 1);
      const message = parseMessage(flight.raw)!;
      if (flight.to === 'host') host.receive(message, now); else guest.receive(message, now);
    }
  };
  const tick = (hostStep = true, guestStep = true) => { now++; deliver(); if (hostStep) host.step(); if (guestStep) guest.step(); };
  const flush = () => { for (let i = 0; i < latency * 2 + 2; i++) { now++; deliver(); } };
  return { host, guest, tick, flush };
}

test('guest and host agree on every board after a laggy random match', () => {
  const { host, guest, tick, flush } = link(3);
  const actions: Action[] = ['left', 'right', 'rotate', 'down', 'drop'];
  let rng = 7;
  const random = () => { rng = (rng * 1103515245 + 12345) >>> 0; return rng / 2 ** 32; };
  for (let i = 0; i < 4000 && !host.match.ended; i++) {
    if (random() < 0.2) host.input(actions[Math.floor(random() * 5)]);
    if (random() < 0.2) guest.input(actions[Math.floor(random() * 5)]);
    tick();
  }
  for (let i = 0; i < 400 && !host.match.ended; i++) tick(true, false);
  flush();
  assert.equal(host.match.ended, true);
  assert.deepEqual(guest.confirmed, host.match);
  assert.deepEqual(guest.view, host.match, 'the guest shows the host result once confirmed');
  assert.deepEqual(replayMatch(42, host.log, host.match.tick), host.match, 'the host log is a verifiable replay');
  assert.ok(host.log.some(input => input.side === 1), 'guest inputs reached the host');
});

test('the guest sees its own move before the host confirms it', () => {
  const { guest, tick } = link(5);
  tick();
  const before = guest.view.games[1].active.x;
  guest.input('left');
  tick();
  assert.equal(guest.view.games[1].active.x, before - 1);
  assert.equal(guest.confirmed.games[1].active.x, before, 'not confirmed yet');
});

test('a late guest input is still applied by the host', () => {
  const { host, guest, tick, flush } = link(4);
  tick();
  const start = host.match.games[1].active.x;
  guest.input('right');
  for (let i = 0; i < 12; i++) tick();
  flush();
  assert.equal(host.match.games[1].active.x, start + 1);
  assert.equal(guest.confirmed.games[1].active.x, start + 1);
  assert.equal(guest.view.games[1].active.x, start + 1, 'prediction and confirmation converge');
});

test('the guest stalls instead of drifting when host frames stop', () => {
  const { guest, tick } = link(1);
  for (let i = 0; i < MAX_AHEAD_TICKS + 20; i++) tick(false, true);
  assert.equal(guest.stalled, true);
  assert.equal(guest.view.tick, MAX_AHEAD_TICKS);
});

test('the guest never shows a predicted win or loss', () => {
  const { guest, tick } = link(50);
  for (let y = 1; y < 12; y++) guest.view.games[1].board[y][2] = 5;
  tick();
  guest.input('drop');
  tick(); tick();
  assert.equal(guest.view.ended, false);
});

test('malformed messages are rejected', () => {
  const samples: unknown[] = ['{', JSON.stringify({ t: 'input', seq: 1, tick: 1, action: 'jump' }), JSON.stringify({ t: 'frame', tick: 1, ack: 0, inputs: [{ tick: 1, side: 3, action: 'left' }] }), 42, JSON.stringify({ t: 'nope' })];
  for (const sample of samples) assert.equal(parseMessage(sample), null);
  const ok: NetMessage = { t: 'frame', tick: 3, ack: 1, inputs: [{ tick: 2, side: 1, action: 'drop' }] };
  assert.deepEqual(parseMessage(JSON.stringify(ok)), ok);
});

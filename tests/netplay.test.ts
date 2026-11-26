import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action } from '../src/lib/game';
import { TICK_MS } from '../src/lib/game';
import { catchUp, GuestSession, HostSession, MAX_AHEAD_TICKS, MAX_CATCH_UP_TICKS, parseMessage, showsProgress, type NetMessage } from '../src/lib/netplay';
import { replayMatch, targetOf } from '../src/lib/versus';

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
  const samples: unknown[] = ['{', JSON.stringify({ t: 'input', seq: 1, tick: 1, action: 'jump' }), JSON.stringify({ t: 'frame', tick: 1, ack: 0, inputs: [{ tick: 1, side: 3, action: 'left' }] }), 42, JSON.stringify({ t: 'nope' }), JSON.stringify({ t: 'start', countdown: 3000 }), JSON.stringify({ t: 'start', countdown: 3000, seed: 0 }), JSON.stringify({ t: 'start', countdown: 3000, seed: 2 ** 32 })];
  for (const sample of samples) assert.equal(parseMessage(sample), null);
  const ok: NetMessage = { t: 'frame', tick: 3, acks: [0, 1], inputs: [{ tick: 2, side: 1, action: 'drop' }] };
  assert.deepEqual(parseMessage(JSON.stringify(ok)), ok);
  for (const good of [{ t: 'start', countdown: 3000, seed: 7 }, { t: 'rematch' }] as NetMessage[]) assert.deepEqual(parseMessage(JSON.stringify(good)), good);
});

test('a guest backlog built while the host was paused is applied, not dropped', () => {
  const toHost: NetMessage[] = [];
  const guest = new GuestSession(42, message => toHost.push(message));
  const host = new HostSession(42, () => {});
  const moves: Action[] = ['left', 'right'];
  for (let i = 0; i < MAX_AHEAD_TICKS; i++) { guest.input(moves[i % 2]); guest.step(); }
  const sent = toHost.filter(message => message.t === 'input').length;
  assert.ok(sent > 8, `the guest queued ${sent} inputs ahead of the host`);
  for (const message of toHost) host.receive(message);
  for (let i = 0; i < MAX_AHEAD_TICKS; i++) host.step();
  assert.equal(host.log.filter(input => input.side === 1).length, sent);
});

test('a page resuming after being hidden does not replay the missed time', () => {
  assert.equal(catchUp(30), 30);
  assert.equal(catchUp(60_000), MAX_CATCH_UP_TICKS * TICK_MS);
});

test('a guest only counts host frames as proof the match is alive', () => {
  assert.equal(showsProgress(1, { t: 'pong', at: 1 }), false, 'a hidden host tab still answers pings');
  assert.equal(showsProgress(1, { t: 'frame', tick: 4, acks: [0, 0], inputs: [] }), true);
  assert.equal(showsProgress(0, { t: 'ping', at: 1 }), true);
});

// One host and several guests, each link with its own latency in ticks.
function table(teams: number[], latencies: number[]) {
  let now = 0;
  const flights: { at: number; to: number; from: number; raw: string }[] = [];
  const host = new HostSession(42, (message, to) => {
    for (let side = 1; side < teams.length; side++) if (to === undefined || to === side) flights.push({ at: now + latencies[side], to: side, from: 0, raw: JSON.stringify(message) });
  }, teams);
  const guests = teams.slice(1).map((_, index) => {
    const side = index + 1;
    return new GuestSession(42, message => flights.push({ at: now + latencies[side], to: 0, from: side, raw: JSON.stringify(message) }), side, teams);
  });
  const deliver = () => {
    for (const flight of flights.filter(flight => flight.at <= now)) {
      flights.splice(flights.indexOf(flight), 1);
      const message = parseMessage(flight.raw)!;
      if (flight.to === 0) host.receive(message, now, flight.from); else guests[flight.to - 1].receive(message, now);
    }
  };
  const tick = () => { now++; deliver(); host.step(); for (const guest of guests) guest.step(); };
  const flush = () => { for (let i = 0; i < Math.max(...latencies) * 2 + 2; i++) { now++; deliver(); } };
  return { host, guests, tick, flush };
}

test('three players with different lags, moving and re-aiming, all agree with the host', () => {
  const teams = [0, 1, 2];
  const { host, guests, tick, flush } = table(teams, [0, 2, 5]);
  const moves: Action[] = ['left', 'right', 'rotate', 'down', 'drop'];
  let rng = 11;
  const random = () => { rng = (rng * 1103515245 + 12345) >>> 0; return rng / 2 ** 32; };
  const players = [host, ...guests];
  for (let i = 0; i < 6000 && !host.match.ended; i++) {
    for (const player of players) {
      const roll = random();
      if (roll < 0.03) player.aim(random() < 0.3 ? null : Math.floor(random() * 3));
      else if (roll < 0.25) player.input(moves[Math.floor(random() * 5)]);
    }
    tick();
  }
  for (let i = 0; i < 2000 && !host.match.ended; i++) { host.step(); flush(); }
  flush();
  assert.equal(host.match.ended, true);
  for (const guest of guests) {
    assert.deepEqual(guest.confirmed, host.match);
    assert.deepEqual(guest.view, host.match);
  }
  assert.deepEqual(replayMatch(42, host.log, host.match.tick, teams), host.match);
  for (const side of [1, 2]) assert.ok(host.log.some(input => input.side === side), `seat ${side} inputs reached the host`);
  assert.ok(host.log.some(input => input.action.startsWith('focus')), 'aim changes were played');
});

test('a guest sees its own aim change at once and invalid aims are refused', () => {
  const { guests, tick } = table([0, 1, 2], [0, 6, 6]);
  const [guest] = guests;
  assert.equal(guest.aim(2), true);
  tick();
  assert.equal(targetOf(guest.view, 1), 2);
  assert.equal(guest.aim(1), false, 'self');
  const teamGame = table([0, 1, 0, 1], [0, 1, 1, 1]);
  assert.equal(teamGame.guests[1].aim(0), false, 'teammate');
  assert.equal(teamGame.guests[1].aim(1), true);
});

test('pongs go back only to the guest that pinged, and rtt is per seat', () => {
  const sent: { message: NetMessage; to?: number }[] = [];
  const host = new HostSession(1, (message, to) => sent.push({ message, to }), [0, 1, 2]);
  host.receive({ t: 'ping', at: 5 }, 0, 2);
  assert.deepEqual(sent, [{ message: { t: 'pong', at: 5 }, to: 2 }]);
  host.receive({ t: 'pong', at: 100 }, 180, 1);
  host.receive({ t: 'pong', at: 100 }, 130, 2);
  assert.deepEqual([host.rttOf(1), host.rttOf(2), host.rtt], [80, 30, 80]);
  host.receive({ t: 'input', seq: 1, tick: 1, action: 'left' }, 0, 7);
  host.step();
  assert.equal(host.log.length, 0, 'input from a seat that does not exist is ignored');
});

test('multiplayer start messages carry a valid seat and teams', () => {
  const good: NetMessage = { t: 'start', countdown: 3000, seed: 9, side: 2, teams: [0, 1, 2] };
  assert.deepEqual(parseMessage(JSON.stringify(good)), good);
  for (const bad of [{ side: 0, teams: [0, 1] }, { side: 2, teams: [0, 1] }, { side: 1, teams: [0, 0] }, { side: 1 }, { teams: [0, 1] }])
    assert.equal(parseMessage(JSON.stringify({ t: 'start', countdown: 3000, seed: 9, ...bad })), null);
  assert.ok(parseMessage(JSON.stringify({ t: 'input', seq: 1, tick: 1, action: 'focus3' })));
  assert.equal(parseMessage(JSON.stringify({ t: 'input', seq: 1, tick: 1, action: 'focus6' })), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_CLEAR_BONUS_POINTS,
  applyAttack,
  convertAttackScore,
  createBattle,
  eliminatePlayer,
  nextTarget,
  setTargeting,
  takeGarbageDrop,
  targetPointsAt,
} from '../src/lib/battle';

const twoVersusTwo = () => createBattle([
  { id: 'a1', team: 0 },
  { id: 'a2', team: 0 },
  { id: 'b1', team: 1 },
  { id: 'b2', team: 1 },
]);

test('attack conversion carries a fraction of one garbage puyo', () => {
  const first = convertAttackScore(40, 70);
  assert.equal(first.garbage, 0);
  assert.ok(Math.abs(first.remainder - 4 / 7) < Number.EPSILON * 4);
  const second = convertAttackScore(320, 70, first.remainder);
  assert.equal(second.garbage, 5);
  assert.ok(Math.abs(second.remainder - 1 / 7) < Number.EPSILON * 4);
});

test('fractional carry stays normalized when margin changes the rate', () => {
  const first = convertAttackScore(40, 70);
  const second = convertAttackScore(0, 52, first.remainder);
  assert.equal(second.garbage, 0);
  assert.ok(Math.abs(second.remainder - 4 / 7) < Number.EPSILON * 4);
});

test('default margin follows the Tsu reduction sequence', () => {
  const cases = [
    [0, 70], [95.999, 70], [96, 52], [112, 35], [128, 26], [144, 17],
    [160, 13], [176, 8], [192, 6], [208, 4], [224, 3], [240, 2], [256, 1],
  ] as const;
  for (const [seconds, expected] of cases) assert.equal(targetPointsAt(seconds), expected);
});

test('2v2 cycling sends each attack whole to the next enemy, never a teammate', () => {
  const battle = twoVersusTwo();
  const result = applyAttack(battle, 'a1', 700, 0);
  assert.deepEqual(result, {
    attackerId: 'a1', score: 700, targetPoints: 70, generated: 10,
    offset: 0, sent: 10, recipients: ['b1'],
  });
  assert.deepEqual(applyAttack(battle, 'a1', 700, 0).recipients, ['b2']);
  assert.deepEqual(applyAttack(battle, 'a1', 700, 0).recipients, ['b1']);
  assert.deepEqual(battle.players.map(p => [p.id, p.pendingGarbage]), [
    ['a1', 0], ['a2', 0], ['b1', 20], ['b2', 10],
  ]);
});

test('offset only cancels the attackers own queue before sending the surplus', () => {
  const battle = twoVersusTwo();
  battle.players.find(p => p.id === 'a1')!.pendingGarbage = 6;
  battle.players.find(p => p.id === 'a2')!.pendingGarbage = 20;
  const result = applyAttack(battle, 'a1', 700, 0);
  assert.equal(result.offset, 6);
  assert.equal(result.sent, 4);
  assert.deepEqual(battle.players.map(p => [p.id, p.pendingGarbage]), [
    ['a1', 0], ['a2', 20], ['b1', 4], ['b2', 0],
  ]);
});

test('a fully offset attack sends nothing and does not advance the cycle', () => {
  const battle = twoVersusTwo();
  battle.players[0].pendingGarbage = 10;
  assert.deepEqual(applyAttack(battle, 'a1', 700, 0).recipients, []);
  assert.equal(nextTarget(battle, 'a1'), 2);
});

const freeForAll = (count: number) => createBattle(Array.from({ length: count }, (_, seat) => ({ id: `p${seat}`, team: seat })));

test('free-for-all cycling starts after the attacker and wraps around the table', () => {
  const battle = freeForAll(4);
  const order = [0, 1, 2, 3, 4].map(() => applyAttack(battle, 'p2', 700, 0).recipients[0]);
  assert.deepEqual(order, ['p3', 'p0', 'p1', 'p3', 'p0']);
});

test('focus sends every attack to one opponent until switched back to cycling', () => {
  const battle = freeForAll(6);
  assert.equal(setTargeting(battle, 'p0', 'p4'), true);
  assert.equal(nextTarget(battle, 'p0'), 4);
  for (let i = 0; i < 3; i++) assert.deepEqual(applyAttack(battle, 'p0', 700, 0).recipients, ['p4']);
  assert.equal(battle.players[4].pendingGarbage, 30);
  setTargeting(battle, 'p0', null);
  assert.deepEqual(applyAttack(battle, 'p0', 700, 0).recipients, ['p1']);
});

test('focus on an eliminated player falls back to cycling', () => {
  const battle = freeForAll(3);
  setTargeting(battle, 'p0', 'p1');
  assert.equal(eliminatePlayer(battle, 'p1'), null);
  assert.deepEqual(battle.players[0].targeting, { mode: 'cycle' });
  assert.deepEqual(applyAttack(battle, 'p0', 700, 0).recipients, ['p2']);
  assert.equal(setTargeting(battle, 'p0', 'p1'), false, 'cannot focus an eliminated player');
});

test('players can only focus living opponents', () => {
  const battle = twoVersusTwo();
  assert.equal(setTargeting(battle, 'a1', 'a2'), false, 'teammate');
  assert.equal(setTargeting(battle, 'a1', 'a1'), false, 'self');
  assert.equal(setTargeting(battle, 'a1', 'zz'), false, 'unknown');
  assert.equal(setTargeting(battle, 'a1', 'b2'), true);
  eliminatePlayer(battle, 'a1');
  assert.equal(setTargeting(battle, 'a1', 'b1'), false, 'eliminated players cannot aim');
});

test('three teams of two: attacks cycle over both enemy teams; the last team standing wins', () => {
  const battle = createBattle([
    { id: 'a1', team: 0 }, { id: 'a2', team: 0 }, { id: 'b1', team: 1 },
    { id: 'b2', team: 1 }, { id: 'c1', team: 2 }, { id: 'c2', team: 2 },
  ]);
  assert.deepEqual([0, 1, 2, 3, 4].map(() => applyAttack(battle, 'a2', 700, 0).recipients[0]), ['b1', 'b2', 'c1', 'c2', 'b1']);
  eliminatePlayer(battle, 'c1');
  assert.equal(eliminatePlayer(battle, 'c2'), null);
  assert.equal(eliminatePlayer(battle, 'b1'), null);
  assert.equal(eliminatePlayer(battle, 'b2'), 0);
});

test('battles need 2-6 players on at least two teams', () => {
  assert.throws(() => freeForAll(7));
  assert.throws(() => createBattle([{ id: 'a', team: 0 }, { id: 'b', team: 0 }]));
  assert.throws(() => createBattle([{ id: 'a', team: 0 }, { id: 'b', team: 9 }]));
});

test('all clear bonus is reserved for the next attack', () => {
  const battle = twoVersusTwo();
  const allClear = applyAttack(battle, 'a1', 40, 0, true);
  assert.equal(allClear.generated, 0);
  assert.equal(battle.players[0].allClearPending, true);
  const next = applyAttack(battle, 'a1', 40, 0);
  assert.equal(next.score, 40 + ALL_CLEAR_BONUS_POINTS);
  assert.equal(next.generated, 31); // 40/70 carried + (2100+40)/70
  assert.equal(battle.players[0].allClearPending, false);
});

test('eliminated opponents stop receiving attacks and both eliminations end the round', () => {
  const battle = twoVersusTwo();
  assert.equal(eliminatePlayer(battle, 'b1'), null);
  assert.deepEqual(applyAttack(battle, 'a1', 700, 0).recipients, ['b2']);
  assert.equal(eliminatePlayer(battle, 'b2'), 0);
});

test('at most thirty queued garbage puyos are committed per drop', () => {
  const battle = twoVersusTwo();
  battle.players[2].pendingGarbage = 65;
  assert.equal(takeGarbageDrop(battle, 'b1'), 30);
  assert.equal(takeGarbageDrop(battle, 'b1'), 30);
  assert.equal(takeGarbageDrop(battle, 'b1'), 5);
  assert.equal(takeGarbageDrop(battle, 'b1'), 0);
});

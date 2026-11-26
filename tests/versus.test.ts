import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GARBAGE, type Action, type Cell } from '../src/lib/game';
import { advanceMatch, aimedAt, createMatch, emptySlot, focusing, pendingGarbage, replayMatch, targetOf, type Side, type Slot, type VersusAction, type VersusInput, type VersusMatch } from '../src/lib/versus';

// Five 1s pop, then the 2 above them falls onto three 2s: a 2-chain worth
// 100 + 320 = 420 points, exactly 6 nuisance Puyos at the base rate of 70.
function primeTwoChain(match: VersusMatch, side: Side) {
  const game = match.games[side];
  const board = game.board;
  board[11][0] = 1; board[10][0] = 1; board[9][0] = 1; board[8][0] = 2;
  board[11][1] = 2; board[11][2] = 2; board[11][3] = 2;
  game.active = { x: 1, y: 0, rotation: 0, colors: [1, 1] };
}
const garbageCount = (board: Cell[][]) => board.flat().filter(cell => cell === GARBAGE).length;
function settle(match: VersusMatch) {
  for (let i = 0; i < 80 && match.games.some(game => game.motion); i++) advanceMatch(match, emptySlot(match));
}
const topOut = (match: VersusMatch, side: Side) => { for (let y = 1; y < 12; y++) match.games[side].board[y][2] = GARBAGE; };
const only = (match: VersusMatch, side: Side, action: VersusAction): Slot => { const slot = emptySlot(match); slot[side] = action; return slot; };

test('a chain sends nuisance Puyos that fall when the opponent places without chaining', () => {
  const match = createMatch(7);
  primeTwoChain(match, 0);
  advanceMatch(match, ['drop', undefined]);
  assert.equal(match.games[0].lastChain, 2);
  assert.equal(pendingGarbage(match, 1), 6);
  advanceMatch(match, [undefined, 'drop']);
  assert.equal(pendingGarbage(match, 1), 0);
  assert.equal(garbageCount(match.games[1].board), 6);
  assert.ok(match.games[1].motion?.steps.some(step => step.blobs.some(blob => blob.color === GARBAGE)), 'the drop is animated');
});

test('a counter chain offsets the queue before anything is sent back', () => {
  const match = createMatch(7);
  primeTwoChain(match, 0);
  primeTwoChain(match, 1);
  advanceMatch(match, ['drop', undefined]);
  assert.equal(pendingGarbage(match, 1), 6);
  advanceMatch(match, [undefined, 'drop']);
  assert.equal(pendingGarbage(match, 1), 0);
  assert.equal(pendingGarbage(match, 0), 0);
  assert.equal(garbageCount(match.games[1].board), 0);
});

test('topping out loses and finishes both boards', () => {
  const match = createMatch(7);
  for (let y = 1; y < 12; y++) match.games[1].board[y][2] = GARBAGE;
  advanceMatch(match, [undefined, 'drop']);
  assert.equal(match.ended, true);
  assert.equal(match.winner, 0);
  assert.equal(match.games[0].ended, true);
  advanceMatch(match, ['left', 'left']);
  assert.equal(match.tick, 1, 'a finished match no longer advances');
});

test('both players topping out on the same tick is a draw', () => {
  const match = createMatch(7);
  for (const side of [0, 1] as const) for (let y = 1; y < 12; y++) match.games[side].board[y][2] = GARBAGE;
  advanceMatch(match, ['drop', 'drop']);
  assert.equal(match.ended, true);
  assert.equal(match.winner, null);
});

test('a replayed input log reproduces the live match exactly', () => {
  const actions: Action[] = ['left', 'right', 'rotate', 'down', 'drop'];
  let rng = 12345;
  const random = () => { rng = (rng * 1103515245 + 12345) >>> 0; return rng / 2 ** 32; };
  const live = createMatch(99);
  const inputs: VersusInput[] = [];
  while (!live.ended && live.tick < 6000) {
    const pick = (side: Side) => {
      if (random() > 0.25) return undefined;
      const action = actions[Math.floor(random() * actions.length)];
      inputs.push({ tick: live.tick + 1, side, action });
      return action;
    };
    advanceMatch(live, [pick(0), pick(1)]);
  }
  settle(live);
  const replayed = replayMatch(99, inputs, live.tick);
  assert.deepEqual(replayed, live);
  assert.ok(live.games.some(game => game.pieces > 10), 'the random match actually played pieces');
});

test('replay rejects malformed or duplicated inputs', () => {
  assert.throws(() => replayMatch(1, [{ tick: 1, side: 2, action: 'left' }], 5));
  assert.throws(() => replayMatch(1, [{ tick: 2, side: 0, action: 'left' }, { tick: 2, side: 0, action: 'right' }], 5));
  assert.throws(() => replayMatch(1, [{ tick: 9, side: 0, action: 'left' }], 5));
  assert.throws(() => replayMatch(1, [{ tick: 1, side: 0, action: 'jump' }], 5));
});

test('free-for-all: an attack goes whole to one opponent, then the next', () => {
  const match = createMatch(7, [0, 1, 2]);
  primeTwoChain(match, 0);
  advanceMatch(match, only(match, 0, 'drop'));
  assert.deepEqual([1, 2].map(side => pendingGarbage(match, side)), [6, 0]);
  assert.equal(targetOf(match, 0), 2, 'the next attack goes to the following seat');
});

test('an aim input refocuses attacks on the same tick, even mid-animation', () => {
  const match = createMatch(7, [0, 1, 2]);
  primeTwoChain(match, 0);
  advanceMatch(match, only(match, 0, 'focus2'));
  assert.equal(focusing(match, 0), true);
  assert.deepEqual(aimedAt(match, 2), [0, 1], 'seat 1 cycles to seat 2 next as well');
  advanceMatch(match, only(match, 0, 'drop'));
  assert.equal(pendingGarbage(match, 2), 6);
  assert.ok(match.games[0].motion, 'the chain is still animating');
  advanceMatch(match, only(match, 0, 'cycle'));
  assert.equal(focusing(match, 0), false);
  advanceMatch(match, only(match, 0, 'focus0'));
  assert.equal(focusing(match, 0), false, 'a player cannot aim at themselves');
});

test('free-for-all: eliminated players drop out and the last one standing wins', () => {
  const match = createMatch(7, [0, 1, 2]);
  topOut(match, 1);
  advanceMatch(match, only(match, 1, 'drop'));
  assert.deepEqual(match.out, [null, 1, null]);
  assert.equal(match.ended, false);
  assert.equal(match.games[1].ended, true);
  topOut(match, 0);
  advanceMatch(match, only(match, 0, 'drop'));
  assert.equal(match.ended, true);
  assert.equal(match.winner, 2);
  assert.deepEqual(match.out, [2, 1, null]);
});

test('teams: a team survives while any member is alive', () => {
  const match = createMatch(7, [0, 1, 0, 1]);
  topOut(match, 0);
  advanceMatch(match, only(match, 0, 'drop'));
  assert.equal(match.ended, false);
  topOut(match, 1); topOut(match, 3);
  const slot = emptySlot(match); slot[1] = 'drop'; slot[3] = 'drop';
  advanceMatch(match, slot);
  assert.equal(match.ended, true);
  assert.equal(match.winner, 0, 'team 0 wins through its surviving member');
});

test('the last players of every team topping out together is a draw', () => {
  const match = createMatch(7, [0, 1, 2]);
  for (const side of [0, 1, 2]) topOut(match, side);
  advanceMatch(match, ['drop', 'drop', 'drop']);
  assert.equal(match.ended, true);
  assert.equal(match.winner, null);
});

test('a six-player replay with aim changes reproduces the live match', () => {
  const teams = [0, 1, 2, 0, 1, 2];
  const actions: VersusAction[] = ['left', 'right', 'rotate', 'down', 'drop', 'drop', 'cycle', 'focus1', 'focus2', 'focus4'];
  let rng = 99;
  const random = () => { rng = (rng * 1103515245 + 12345) >>> 0; return rng / 2 ** 32; };
  const live = createMatch(5, teams);
  const inputs: VersusInput[] = [];
  while (!live.ended && live.tick < 8000) {
    const slot = emptySlot(live);
    for (const side of teams.keys()) {
      if (random() > 0.3) continue;
      slot[side] = actions[Math.floor(random() * actions.length)];
      inputs.push({ tick: live.tick + 1, side, action: slot[side]! });
    }
    advanceMatch(live, slot);
  }
  assert.equal(live.ended, true);
  assert.ok(live.out.filter(tick => tick !== null).length >= 2, 'players were eliminated along the way');
  assert.deepEqual(replayMatch(5, inputs, live.tick, teams), live);
  assert.throws(() => replayMatch(5, [{ tick: 1, side: 6, action: 'left' }], 5, teams));
  assert.throws(() => replayMatch(5, [{ tick: 1, side: 0, action: 'focus9' }], 5, teams));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GARBAGE, type Action, type Cell } from '../src/lib/game';
import { advanceMatch, createMatch, pendingGarbage, replayMatch, type Side, type VersusInput, type VersusMatch } from '../src/lib/versus';

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
  for (let i = 0; i < 80 && (match.games[0].motion || match.games[1].motion); i++) advanceMatch(match, [undefined, undefined]);
}

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

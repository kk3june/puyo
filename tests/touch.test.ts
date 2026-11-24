import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action } from '../src/lib/game';
import { BoardGesture } from '../src/lib/touch-gesture';

function recorder(accept: (count: number) => boolean = () => true) {
  const actions: Action[] = [];
  return { actions, emit: (action: Action) => { if (!accept(actions.length)) return false; actions.push(action); return true; } };
}

test('a short tap rotates', () => {
  const { actions, emit } = recorder();
  const gesture = BoardGesture.start(100, 100, 0, 40);
  gesture.move(103, 104, 60, emit);
  gesture.end(103, 104, 120, emit);
  assert.deepEqual(actions, ['rotate']);
});

test('a long press without movement does nothing', () => {
  const { actions, emit } = recorder();
  BoardGesture.start(100, 100, 0, 40).end(101, 101, 600, emit);
  assert.deepEqual(actions, []);
});

test('horizontal drag follows the finger one cell at a time, both ways', () => {
  const { actions, emit } = recorder();
  const gesture = BoardGesture.start(100, 100, 0, 40);
  gesture.move(120, 102, 50, emit); // 0.5 cell: not yet
  assert.deepEqual(actions, []);
  gesture.move(125, 102, 70, emit); // 0.625 cell: first step
  gesture.move(190, 104, 150, emit); // 2.25 cells
  assert.deepEqual(actions, ['right', 'right']);
  gesture.move(60, 104, 300, emit); // back to -1 cell
  gesture.end(60, 104, 400, emit);
  assert.deepEqual(actions, ['right', 'right', 'left', 'left', 'left']);
});

test('rejected moves are retried instead of lost', () => {
  let open = false;
  const { actions, emit } = recorder(() => open);
  const gesture = BoardGesture.start(0, 0, 0, 40);
  gesture.move(90, 0, 50, emit);
  assert.deepEqual(actions, []);
  open = true;
  gesture.move(91, 0, 60, emit);
  assert.deepEqual(actions, ['right', 'right']);
});

test('slow downward drag soft drops without a hard drop', () => {
  const { actions, emit } = recorder();
  const gesture = BoardGesture.start(100, 100, 0, 40);
  gesture.move(102, 130, 300, emit);
  gesture.move(104, 190, 700, emit);
  gesture.end(104, 190, 900, emit);
  assert.deepEqual(actions, ['down', 'down']);
});

test('a fast downward flick hard drops without soft dropping first', () => {
  const { actions, emit } = recorder();
  const gesture = BoardGesture.start(100, 100, 0, 40);
  gesture.move(101, 120, 20, emit);
  gesture.move(101, 160, 60, emit);
  gesture.end(101, 200, 100, emit);
  assert.deepEqual(actions, ['drop']);
});

test('a flick still drops after the finger rested on the board first', () => {
  const { actions, emit } = recorder();
  const gesture = BoardGesture.start(100, 100, 0, 40);
  gesture.move(101, 102, 400, emit); // resting
  gesture.move(101, 140, 440, emit);
  gesture.end(101, 190, 480, emit);
  assert.deepEqual(actions, ['drop']);
});

test('a drag that starts slowly and ends in a flick drops', () => {
  const { actions, emit } = recorder();
  const gesture = BoardGesture.start(100, 100, 0, 40);
  for (let t = 50; t <= 300; t += 50) gesture.move(100, 100 + t * 0.1, t, emit); // 0.1 px/ms
  gesture.move(100, 170, 340, emit);
  gesture.end(100, 220, 380, emit);
  assert.equal(actions.at(-1), 'drop');
});

test('a fast drag that stops before release soft drops to the finger', () => {
  const { actions, emit } = recorder();
  const gesture = BoardGesture.start(100, 100, 0, 40);
  gesture.move(100, 140, 40, emit);
  gesture.move(100, 190, 80, emit); // fast: soft drop waits
  assert.deepEqual(actions, []);
  gesture.move(100, 190, 300, emit); // finger holds still
  gesture.end(100, 190, 320, emit);
  assert.deepEqual(actions, ['down', 'down']);
});

test('horizontal drags never turn into rotations or drops', () => {
  const { actions, emit } = recorder();
  const gesture = BoardGesture.start(100, 100, 0, 40);
  gesture.move(140, 110, 50, emit);
  gesture.end(140, 160, 100, emit);
  assert.deepEqual(actions, ['right']);
});

test('upward swipes are ignored', () => {
  const { actions, emit } = recorder();
  const gesture = BoardGesture.start(100, 200, 0, 40);
  gesture.move(100, 100, 50, emit);
  gesture.end(100, 80, 100, emit);
  assert.deepEqual(actions, []);
});

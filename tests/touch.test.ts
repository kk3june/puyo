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
  gesture.move(103, 104, emit);
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
  gesture.move(120, 102, emit); // 0.5 cell: not yet
  assert.deepEqual(actions, []);
  gesture.move(125, 102, emit); // 0.625 cell: first step
  gesture.move(190, 104, emit); // 2.25 cells
  assert.deepEqual(actions, ['right', 'right']);
  gesture.move(60, 104, emit); // back to -1 cell
  gesture.end(60, 104, 400, emit);
  assert.deepEqual(actions, ['right', 'right', 'left', 'left', 'left']);
});

test('rejected moves are retried instead of lost', () => {
  let open = false;
  const { actions, emit } = recorder(() => open);
  const gesture = BoardGesture.start(0, 0, 0, 40);
  gesture.move(90, 0, emit);
  assert.deepEqual(actions, []);
  open = true;
  gesture.move(91, 0, emit);
  assert.deepEqual(actions, ['right', 'right']);
});

test('slow downward drag soft drops without a hard drop', () => {
  const { actions, emit } = recorder();
  const gesture = BoardGesture.start(100, 100, 0, 40);
  gesture.move(102, 130, emit);
  gesture.move(104, 190, emit);
  gesture.end(104, 190, 900, emit);
  assert.deepEqual(actions, ['down', 'down']);
});

test('a fast downward flick hard drops', () => {
  const { actions, emit } = recorder();
  const gesture = BoardGesture.start(100, 100, 0, 40);
  gesture.move(101, 160, emit);
  gesture.end(101, 200, 120, emit);
  assert.equal(actions.at(-1), 'drop');
});

test('horizontal drags never turn into rotations or drops', () => {
  const { actions, emit } = recorder();
  const gesture = BoardGesture.start(100, 100, 0, 40);
  gesture.move(140, 110, emit);
  gesture.end(140, 160, 100, emit);
  assert.deepEqual(actions, ['right']);
});

test('upward swipes are ignored', () => {
  const { actions, emit } = recorder();
  const gesture = BoardGesture.start(100, 200, 0, 40);
  gesture.move(100, 100, emit);
  gesture.end(100, 80, 100, emit);
  assert.deepEqual(actions, []);
});

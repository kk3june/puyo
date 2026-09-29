import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, placeGarbage, replay, resolveBoard, TICK_MS, MAX_TICKS, type MotionStep, type Move } from '../src/lib/game';
import { sampleResolution } from '../src/lib/game-renderer';

test('chain timeline keeps both burst boards and falling positions before mutating them',()=>{
  const board=createGame(1).board;
  board[11]=[1,1,1,1,2,2];board[10]=[0,0,2,2,0,0];
  const steps:MotionStep[]=[];
  assert.deepEqual(resolveBoard(board,steps),{chain:2,score:360,cleared:8});
  assert.deepEqual(steps.map(s=>s.kind),['clear','fall','land','clear']);
  assert.equal(steps[0].board[11][0],1);
  assert.deepEqual(steps[1].blobs.map(b=>[b.fromY,b.toY]),[[10,11],[10,11]]);
  assert.equal(steps[3].chain,2);assert.equal(steps[3].score,320);
  assert.ok(board.flat().every(c=>c===0));
  const motion={id:1,startTick:1,steps,ticks:steps.reduce((n,s)=>n+s.ticks,0)};
  assert.equal(sampleResolution(motion,399)?.step.kind,'clear');
  assert.equal(sampleResolution(motion,400)?.step.kind,'fall');
  assert.equal(sampleResolution(motion,motion.ticks*TICK_MS),null);
});
test('drop and landing consume deterministic ticks and cannot move the next piece early',()=>{
  const game=createGame(42);advance(game,'drop');
  assert.equal(game.motion?.steps[0].kind,'drop');
  assert.equal(game.motion?.steps[1].kind,'land');
  const x=game.active.x,pieces=game.pieces,score=game.score;
  while(game.motion && game.tick-game.motion.startTick<game.motion.ticks-1) {
    advance(game,'drop');assert.equal(game.pieces,pieces);assert.equal(game.active.x,x);assert.equal(game.score,score);
  }
  advance(game);assert.equal(game.motion,null);
  advance(game,'left');assert.equal(game.active.x,x-1);
});
test('animation does not extend the 3-minute timer, including the final resolution',()=>{
  const game=createGame(42);game.tick=MAX_TICKS-2;
  advance(game,'drop');assert.ok(game.motion);
  advance(game);assert.equal(game.ended,true);assert.equal(game.tick,MAX_TICKS);
});
test('legacy signed games replay without new animation delays',()=>{
  const game=createGame(271,'sprint-v1'),moves:Move[]=[];
  while(!game.ended){moves.push({tick:game.tick+1,action:'drop'});advance(game,'drop');assert.equal(game.motion,null);}
  assert.deepEqual(replay(271,moves,game.tick,'sprint-v1'),game);
  assert.throws(()=>replay(271,moves,game.tick,'sprint-v2'));
});
test('garbage fall adds deterministic fall and landing motion',()=>{
  const game=createGame(1),steps:MotionStep[]=[];
  const result=placeGarbage(game.board,7,99,steps);
  assert.equal(result.placed,7);assert.equal(result.overflow,false);
  assert.deepEqual(steps.map(step=>step.kind),['fall','land']);
  assert.equal(steps[0].blobs.length,7);
  assert.ok(steps[0].blobs.every(blob=>blob.fromY<0 && blob.toY>=10));
});

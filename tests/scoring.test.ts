import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoreClear} from '../src/lib/scoring';
import {advance,createGame,replay,resolveBoard,MAX_TICKS,type Move} from '../src/lib/game';

test('reference chain bonuses 1–19 and cumulative 3/5-chain examples',()=>{
  const expected=[0,8,16,32,64,96,128,160,192,224,256,288,320,352,384,416,448,480,512];
  expected.forEach((bonus,i)=>assert.equal(scoreClear(i+1,[4],1).points,40*Math.max(1,bonus)));
  assert.equal([1,2,3].reduce((sum,chain)=>sum+scoreClear(chain,[4],1).points,0),1000);
  assert.equal([1,2,3,4,5].reduce((sum,chain)=>sum+scoreClear(chain,[4],1).points,0),4840);
});
test('reference connection and color bonuses, including the unused fifth color',()=>{
  [40,100,180,280,400,540,700,1100,1200].forEach((points,i)=>assert.equal(scoreClear(1,[i+4],1).points,points));
  [40,240,720,1920,4800].forEach((points,i)=>assert.equal(scoreClear(1,Array(i+1).fill(4),i+1).points,points));
  assert.equal(scoreClear(2,[5,4],2).points,1170); // 9 * (8 + 2 + 3) * 10
});
test('disconnected same-color groups are not treated as one large connection',()=>{
  const board=createGame(1).board;
  board[11]=[1,1,0,0,1,1];board[10]=[1,1,0,0,1,1];
  assert.deepEqual(resolveBoard(board),{chain:1,score:80,cleared:8});
  assert.equal(scoreClear(1,[8],1).points,400);
});
test('down awards one point per moved row, max eleven per pair; blocked input adds zero',()=>{
  const game=createGame(42);
  for(let i=0;i<11;i++){advance(game,'down');assert.equal(game.score,i+1);}
  assert.equal(game.active.y,11);assert.equal(game.pieceDropBonus,11);
  advance(game,'down');assert.equal(game.score,11);assert.equal(game.pieceDropBonus,0);
  advance(game,'down');assert.equal(game.score,11,'input during landing adds no points');
  while(game.motion) advance(game);
  advance(game,'down');assert.equal(game.score,12,'next pair starts a new allowance');
});
test('natural gravity, hard drop and previous scoring versions do not earn soft-drop points',()=>{
  const natural=createGame(42);for(let i=0;i<14;i++) advance(natural);
  assert.equal(natural.active.y,1);assert.equal(natural.score,0);
  const hard=createGame(42);advance(hard,'drop');assert.equal(hard.score,0);
  for(const rules of ['sprint-v1','sprint-v2'] as const){
    const old=createGame(42,rules);advance(old,'down');assert.equal(old.score,0);
  }
});
test('server replay includes soft-drop bonuses and supports old signed scoring versions',()=>{
  for(const rules of ['sprint-v1','sprint-v2','sprint-v3'] as const){
    const game=createGame(42,rules),moves:Move[]=[];
    while(!game.ended && game.tick<MAX_TICKS){
      const action=game.motion?undefined:'down';
      if(action) moves.push({tick:game.tick+1,action});
      advance(game,action);
    }
    assert.deepEqual(replay(42,moves,game.tick,rules),game);
    if(rules==='sprint-v3') assert.ok(game.score>0);
  }
});

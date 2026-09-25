import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, GARBAGE, placeGarbage, resolveBoard, replay, settle, MAX_TICKS, type Cell, type Move } from '../src/lib/game';
import { signTicket, verifyTicket } from '../src/lib/ticket';
const board = () => Array.from({length:12}, () => Array<Cell>(6).fill(0));
test('four connected colors clear; three and diagonals do not', () => {
  const b=board(); b[11]=[1,1,1,0,2,0]; b[10][5]=2;
  assert.equal(resolveBoard(b).cleared,0);
  b[11][3]=1;
  assert.deepEqual(resolveBoard(b),{chain:1,score:40,cleared:4});
});
test('two chains score 40 + 320 after gravity, preserving unconnected pieces', () => {
  const b=board();
  b[11]=[1,1,1,1,2,2]; b[10]=[0,0,2,2,0,0];
  assert.deepEqual(resolveBoard(b),{chain:2,score:360,cleared:8});
  assert.ok(b.flat().every(c=>c===0));
});
test('gravity preserves vertical order and handles split support', () => {
  const b=board(); b[0][0]=1; b[5][0]=2; b[10][1]=3;
  settle(b); assert.equal(b[10][0],1); assert.equal(b[11][0],2); assert.equal(b[11][1],3);
});
test('simultaneous different-color groups receive color bonus', () => {
  const b=board(); b[11]=[1,1,2,2,0,0]; b[10]=[1,1,2,2,0,0];
  assert.deepEqual(resolveBoard(b),{chain:1,score:240,cleared:8});
});
test('garbage does not clear by itself and only orthogonally adjacent garbage pops', () => {
  const b=board();
  b[11]=[1,1,1,1,GARBAGE,GARBAGE];
  b[10][0]=GARBAGE;b[10][4]=GARBAGE;
  assert.deepEqual(resolveBoard(b),{chain:1,score:40,cleared:4});
  assert.equal(b[11][0],0,'garbage directly above the cleared group is removed');
  assert.equal(b.flat().filter(cell=>cell===GARBAGE).length,2);
  assert.equal(b[11][4],GARBAGE,'diagonal garbage survives and settles downward');
  assert.equal(b[11][5],GARBAGE,'garbage connected only through garbage survives');
  const onlyGarbage=board();onlyGarbage[11]=[GARBAGE,GARBAGE,GARBAGE,GARBAGE,0,0];
  assert.deepEqual(resolveBoard(onlyGarbage),{chain:0,score:0,cleared:0});
});
test('garbage placement is deterministic, capped at thirty and reports overflow', () => {
  const first=board(),second=board();
  const a=placeGarbage(first,31,1234),b=placeGarbage(second,31,1234);
  assert.deepEqual(a,b);assert.deepEqual(first,second);
  assert.equal(a.placed,30);assert.equal(a.overflow,false);
  assert.equal(first.flat().filter(cell=>cell===GARBAGE).length,30);
  assert.deepEqual(first.slice(7),Array.from({length:5},()=>Array(6).fill(GARBAGE)));
  const crowded=board();for(let y=1;y<12;y++) crowded[y].fill(1);
  const overflow=placeGarbage(crowded,12,1);
  assert.equal(overflow.placed,6);assert.equal(overflow.overflow,true);
});
test('wall kicks keep all pieces in bounds', () => {
  const g=createGame(9); advance(g,'left'); advance(g,'left'); advance(g,'rotate'); advance(g,'rotate'); advance(g,'rotate');
  assert.equal(g.active.rotation,3); assert.equal(g.active.x,1);
});
test('seeded replay exactly matches client final score and board', () => {
  const game=createGame(12345), moves: Move[]=[];
  while(!game.ended) { const action=game.tick%3===0?'right':'drop'; moves.push({tick:game.tick+1,action}); advance(game,action); }
  assert.deepEqual(replay(12345,moves,game.tick),game);
  assert.throws(()=>replay(12345,moves,game.tick+1));
});
test('reject duplicate/out-of-order inputs, unknown actions, unfinished games and oversized input', () => {
  assert.throws(()=>replay(1,[{tick:1,action:'drop'},{tick:1,action:'drop'}],5));
  assert.throws(()=>replay(1,[{tick:1,action:'cheat'}],5));
  assert.throws(()=>replay(1,[],5));
  assert.throws(()=>replay(1,[],MAX_TICKS+1));
  assert.throws(()=>replay(1,new Array(MAX_TICKS+1).fill({tick:1,action:'drop'}),5));
});
test('sprint stops at exactly 3600 ticks and cannot change after ending', () => {
  const game=createGame(1); game.tick=MAX_TICKS-1; advance(game);
  assert.equal(game.ended,true); assert.equal(game.tick,MAX_TICKS);
  const before=JSON.stringify(game); advance(game,'drop'); assert.equal(JSON.stringify(game),before);
});
test('signed tickets reject tampering, wrong browser, wrong secret and expiration', () => {
  const secret='a'.repeat(64), ticket={id:'id',seed:42,issued:1000,guest:'guest',rules:'sprint-v1' as const};
  const token=signTicket(ticket,secret);
  assert.deepEqual(verifyTicket(token,'guest',secret,2000),ticket);
  assert.throws(()=>verifyTicket(token,'other',secret,2000));
  assert.throws(()=>verifyTicket(token,'guest','b'.repeat(64),2000));
  assert.throws(()=>verifyTicket(token,'guest',secret,86_402_000));
  assert.throws(()=>verifyTicket(`${token}a`,'guest',secret,2000));
  assert.throws(()=>verifyTicket(token,'guest',secret,999));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type Entry = { id: string; status: 'waiting' | 'matched'; matchId: string | null; role: 'host' | 'guest' | null; seed: number | null };

test('matchmaking pairs two players and relays signals only within the match', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile(new URL('../supabase/migrations/202611020001_versus_matchmaking.sql', import.meta.url), 'utf8'));
    const call = async <T>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(`select ${sql} as r`, params)).rows[0].r;
    await db.exec('set role service_role');

    const a = await call<Entry>('versus_enqueue($1, $2)', ['alice', 11]);
    assert.equal(a.status, 'waiting');
    const again = await call<Entry>('versus_enqueue($1, $2)', ['alice', 12]);
    assert.equal(again.status, 'waiting', 'a player never matches themself');
    assert.equal(await call('versus_poll($1, $2)', [a.id, 'alice']), null, 'requeueing replaces the old ticket');

    const b = await call<Entry>('versus_enqueue($1, $2)', ['bob', 13]);
    assert.equal(b.status, 'matched');
    assert.equal(b.role, 'guest');
    const host = await call<Entry>('versus_poll($1, $2)', [again.id, 'alice']);
    assert.deepEqual([host.status, host.role, host.matchId, host.seed], ['matched', 'host', b.matchId, 13]);
    assert.equal(await call('versus_poll($1, $2)', [b.id, 'mallory']), null, 'tickets are bound to their player');

    await call('versus_post_signal($1, $2, $3)', [b.matchId, 'alice', JSON.stringify({ type: 'offer', sdp: 'x' })]);
    assert.deepEqual(await call('versus_read_signals($1, $2, 0)', [b.matchId, 'alice']), [], 'own signals are not echoed');
    const received = await call<{ id: number; payload: { type: string } }[]>('versus_read_signals($1, $2, 0)', [b.matchId, 'bob']);
    assert.equal(received[0].payload.type, 'offer');
    assert.deepEqual(await call('versus_read_signals($1, $2, $3)', [b.matchId, 'bob', received[0].id]), []);
    await assert.rejects(() => call('versus_post_signal($1, $2, $3)', [b.matchId, 'mallory', '{}']), /not a match member/);
    await assert.rejects(() => call('versus_read_signals($1, $2, 0)', [b.matchId, 'mallory']), /not a match member/);
    for (let i = 0; i < 20; i++) await call('versus_post_signal($1, $2, $3)', [b.matchId, 'bob', '{}']);
    await assert.rejects(() => call('versus_post_signal($1, $2, $3)', [b.matchId, 'bob', '{}']), /too many signals/);

    const c = await call<Entry>('versus_enqueue($1, $2)', ['carol', 14]);
    await db.exec(`update versus_queue set seen_at = now() - interval '30 seconds' where id = '${c.id}'`);
    assert.equal((await call<Entry>('versus_enqueue($1, $2)', ['dave', 15])).status, 'waiting', 'abandoned tickets are skipped');
    await call('versus_cancel($1, $2)', [c.id, 'carol']);
    assert.equal(await call('versus_poll($1, $2)', [c.id, 'carol']), null);

    await db.exec('reset role; set role anon');
    await assert.rejects(() => db.query('select * from versus_queue'), /permission denied/);
    await assert.rejects(() => db.query(`select versus_enqueue('eve', 1)`), /permission denied/);
  } finally { await db.close(); }
});

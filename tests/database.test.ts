import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('migration enforces unique sessions, private writes, personal best, weekly rank, and deletion', async () => {
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`);
    await db.exec(await readFile(new URL('../supabase/migrations/202609280001_scores.sql',import.meta.url),'utf8'));
    await db.exec(`insert into scores(session_id,user_id,score,max_chain,cleared,ticks,ruleset,created_at) values
      ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',1000,3,12,300,'sprint-v1',now()-interval '8 days'),
      ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',100,1,4,200,'sprint-v1',now()),
      ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002',200,2,8,200,'sprint-v1',now());`);
    type Leaderboard={entries:{score:number;rank:number}[];me:{score:number;rank:number}};
    const all=await db.query<{result:Leaderboard}>(`select get_leaderboard('all','00000000-0000-0000-0000-000000000002') as result`);
    assert.equal(all.rows[0].result.entries.length,2);
    assert.equal(all.rows[0].result.entries[0].score,1000);
    assert.equal(all.rows[0].result.me.rank,2);
    const weekly=await db.query<{result:Leaderboard}>(`select get_leaderboard('week','00000000-0000-0000-0000-000000000002') as result`);
    assert.equal(weekly.rows[0].result.entries[0].score,200); assert.equal(weekly.rows[0].result.me.rank,1);
    await assert.rejects(()=>db.exec(`insert into scores select * from scores limit 1`),/duplicate key/);
    await db.exec('set role anon');
    await assert.rejects(()=>db.query('select * from scores'),/permission denied/);
    await assert.rejects(()=>db.exec(`insert into scores(session_id,user_id,score,max_chain,cleared,ticks,ruleset) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000001',99999,1,4,200,'sprint-v1')`),/permission denied/);
    await assert.rejects(()=>db.query('select get_leaderboard()'),/permission denied/);
    await db.exec('reset role; set role service_role');
    assert.equal((await db.query('select get_leaderboard()')).rows.length,1);
    await db.exec(`reset role; delete from auth.users where id='00000000-0000-0000-0000-000000000001'`);
    assert.equal((await db.query('select * from scores')).rows.length,1);
    await db.exec(await readFile(new URL('../supabase/migrations/202609280002_motion_rules.sql',import.meta.url),'utf8'));
    const fresh=await db.query<{result:Leaderboard}>(`select get_leaderboard() as result`);
    assert.equal(fresh.rows[0].result.entries.length,0);
    assert.equal((await db.query('select * from scores')).rows.length,1,'old scores are preserved');
    await db.exec(`insert into scores(session_id,user_id,score,max_chain,cleared,ticks,ruleset) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000002',360,2,8,300,'sprint-v2')`);
    const animated=await db.query<{result:Leaderboard}>(`select get_leaderboard() as result`);
    assert.equal(animated.rows[0].result.entries[0].score,360);
    await db.exec(await readFile(new URL('../supabase/migrations/202609280003_scoring_rules.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('select * from scores')).rows.length,2,'earlier rulesets remain stored');
    const current=await db.query<{result:Leaderboard}>(`select get_leaderboard() as result`);
    assert.equal(current.rows[0].result.entries.length,0);
    await db.exec(`insert into scores(session_id,user_id,score,max_chain,cleared,ticks,ruleset) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000002',371,2,8,300,'sprint-v3')`);
    const scored=await db.query<{result:Leaderboard}>(`select get_leaderboard() as result`);
    assert.equal(scored.rows[0].result.entries[0].score,371);
    await db.exec('set role anon');
    await assert.rejects(()=>db.query('select get_leaderboard()'),/permission denied/);
  } finally { await db.close(); }
});

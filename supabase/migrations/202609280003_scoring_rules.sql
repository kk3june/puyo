-- Soft-drop scoring changes competitive totals. Preserve prior rows and replay support.
alter table public.scores drop constraint scores_ruleset_check;
alter table public.scores add constraint scores_ruleset_check check (ruleset in ('sprint-v1','sprint-v2','sprint-v3'));

create or replace function public.get_leaderboard(p_period text default 'all', p_user_id uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with best as (
    select distinct on (user_id) user_id, score, max_chain, created_at, session_id
    from public.scores
    where ruleset = 'sprint-v3' and (
      p_period <> 'week' or created_at >= (date_trunc('week', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
    )
    order by user_id, score desc, created_at asc, session_id
  ), ranked as (
    select row_number() over (order by score desc, created_at asc, session_id) as rank,
      user_id, '젤리-' || left(replace(user_id::text, '-', ''), 8) as name, score, max_chain
    from best
  )
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object('rank', rank, 'name', name, 'score', score, 'max_chain', max_chain) order by rank) from ranked where rank <= 20), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rank, 'name', name, 'score', score, 'max_chain', max_chain) from ranked where user_id = p_user_id)
  );
$$;

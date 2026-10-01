-- Run once in your Supabase project's SQL editor (or supabase db push).
create table public.scores (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  score integer not null check (score >= 0),
  max_chain integer not null check (max_chain between 0 and 100),
  cleared integer not null check (cleared >= 0),
  ticks integer not null check (ticks between 1 and 3600),
  ruleset text not null check (ruleset = 'sprint-v1'),
  created_at timestamptz not null default now()
);
create index scores_user_best on public.scores (user_id, score desc, created_at);
create index scores_recent on public.scores (created_at desc);
alter table public.scores enable row level security;
-- All access is via server endpoints; anon/authenticated cannot insert forged scores.
revoke all on public.scores from anon, authenticated;
grant all on public.scores to service_role;

create function public.get_leaderboard(p_period text default 'all', p_user_id uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with best as (
    select distinct on (user_id) user_id, score, max_chain, created_at, session_id
    from public.scores
    where ruleset = 'sprint-v1' and (
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
revoke all on function public.get_leaderboard(text, uuid) from public, anon, authenticated;
grant execute on function public.get_leaderboard(text, uuid) to service_role;

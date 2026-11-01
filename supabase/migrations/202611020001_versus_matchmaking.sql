-- 1:1 versus matchmaking and WebRTC signaling. Matches themselves run
-- peer-to-peer; the database only pairs players and relays a few SDP blobs.
create table public.versus_queue (
  id uuid primary key default gen_random_uuid(),
  player text not null check (char_length(player) between 1 and 64),
  created_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  match_id uuid,
  role text check (role in ('host', 'guest')),
  seed bigint check (seed between 1 and 4294967295),
  unique (match_id, role)
);
create index versus_queue_waiting on public.versus_queue (created_at) where match_id is null;
create index versus_queue_player on public.versus_queue (player);

create table public.versus_signals (
  id bigint generated always as identity primary key,
  match_id uuid not null,
  sender text not null check (sender in ('host', 'guest')),
  payload jsonb not null check (octet_length(payload::text) <= 16384),
  created_at timestamptz not null default now()
);
create index versus_signals_match on public.versus_signals (match_id, id);

alter table public.versus_queue enable row level security;
alter table public.versus_signals enable row level security;
revoke all on public.versus_queue, public.versus_signals from public, anon, authenticated;
grant all on public.versus_queue, public.versus_signals to service_role;

create or replace function public.versus_entry(entry public.versus_queue)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', entry.id,
    'status', case when entry.match_id is null then 'waiting' else 'matched' end,
    'matchId', entry.match_id, 'role', entry.role, 'seed', entry.seed);
$$;

-- The player who has waited longest becomes host; the newcomer joins as guest.
create or replace function public.versus_enqueue(p_player text, p_seed bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  other public.versus_queue;
  mine public.versus_queue;
  new_match uuid := gen_random_uuid();
begin
  delete from public.versus_queue where seen_at < now() - interval '10 minutes';
  delete from public.versus_signals where created_at < now() - interval '10 minutes';
  delete from public.versus_queue where player = p_player and match_id is null;
  select * into other from public.versus_queue
    where match_id is null and player <> p_player and seen_at > now() - interval '8 seconds'
    order by created_at limit 1 for update skip locked;
  if found then
    update public.versus_queue set match_id = new_match, role = 'host', seed = p_seed where id = other.id;
    insert into public.versus_queue (player, match_id, role, seed) values (p_player, new_match, 'guest', p_seed) returning * into mine;
  else
    insert into public.versus_queue (player) values (p_player) returning * into mine;
  end if;
  return public.versus_entry(mine);
end $$;

create or replace function public.versus_poll(p_id uuid, p_player text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare mine public.versus_queue;
begin
  update public.versus_queue set seen_at = now() where id = p_id and player = p_player returning * into mine;
  if not found then return null; end if;
  return public.versus_entry(mine);
end $$;

create or replace function public.versus_cancel(p_id uuid, p_player text)
returns void language sql security definer set search_path = '' as $$
  delete from public.versus_queue where id = p_id and player = p_player and match_id is null;
$$;

create or replace function public.versus_post_signal(p_match uuid, p_player text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare my_role text;
begin
  select role into my_role from public.versus_queue where match_id = p_match and player = p_player;
  if my_role is null then raise exception 'not a match member' using errcode = '42501'; end if;
  if (select count(*) from public.versus_signals where match_id = p_match and sender = my_role) >= 20 then
    raise exception 'too many signals' using errcode = '54000';
  end if;
  insert into public.versus_signals (match_id, sender, payload) values (p_match, my_role, p_payload);
end $$;

create or replace function public.versus_read_signals(p_match uuid, p_player text, p_after bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare my_role text;
begin
  select role into my_role from public.versus_queue where match_id = p_match and player = p_player;
  if my_role is null then raise exception 'not a match member' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'payload', payload) order by id)
    from public.versus_signals where match_id = p_match and sender <> my_role and id > p_after), '[]'::jsonb);
end $$;

revoke all on function public.versus_entry(public.versus_queue), public.versus_enqueue(text, bigint), public.versus_poll(uuid, text),
  public.versus_cancel(uuid, text), public.versus_post_signal(uuid, text, jsonb), public.versus_read_signals(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.versus_enqueue(text, bigint), public.versus_poll(uuid, text), public.versus_cancel(uuid, text),
  public.versus_post_signal(uuid, text, jsonb), public.versus_read_signals(uuid, text, bigint) to service_role;

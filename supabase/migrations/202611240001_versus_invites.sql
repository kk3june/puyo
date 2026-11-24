-- Friend invites for 1:1 versus. An invite is a waiting queue row with a
-- short code; it never takes part in random matchmaking, and only one friend
-- can join it. The host may be away sharing the link (its page paused), so an
-- invite stays joinable while its row exists (10 minutes since last seen).
alter table public.versus_queue add column invite text unique check (invite ~ '^[A-HJ-NP-Z2-9]{6}$');

-- Same as before, except open invites are never picked as random opponents.
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
    where match_id is null and invite is null and player <> p_player and seen_at > now() - interval '8 seconds'
    order by created_at limit 1 for update skip locked;
  if found then
    update public.versus_queue set match_id = new_match, role = 'host', seed = p_seed where id = other.id;
    insert into public.versus_queue (player, match_id, role, seed) values (p_player, new_match, 'guest', p_seed) returning * into mine;
  else
    insert into public.versus_queue (player) values (p_player) returning * into mine;
  end if;
  return public.versus_entry(mine);
end $$;

-- A unique_violation on the code means it is taken; the caller retries with another.
create or replace function public.versus_create_invite(p_player text, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare mine public.versus_queue;
begin
  delete from public.versus_queue where seen_at < now() - interval '10 minutes';
  delete from public.versus_signals where created_at < now() - interval '10 minutes';
  delete from public.versus_queue where player = p_player and match_id is null;
  insert into public.versus_queue (player, invite) values (p_player, p_code) returning * into mine;
  return public.versus_entry(mine) || jsonb_build_object('invite', mine.invite);
end $$;

create or replace function public.versus_join_invite(p_player text, p_code text, p_seed bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  other public.versus_queue;
  mine public.versus_queue;
  new_match uuid := gen_random_uuid();
begin
  select * into other from public.versus_queue
    where invite = p_code and match_id is null and seen_at > now() - interval '10 minutes'
    for update;
  if not found then raise exception 'invite not found' using errcode = 'P0002'; end if;
  if other.player = p_player then raise exception 'own invite' using errcode = '22023'; end if;
  update public.versus_queue set match_id = new_match, role = 'host', seed = p_seed where id = other.id;
  insert into public.versus_queue (player, match_id, role, seed) values (p_player, new_match, 'guest', p_seed) returning * into mine;
  return public.versus_entry(mine);
end $$;

revoke all on function public.versus_create_invite(text, text), public.versus_join_invite(text, text, bigint) from public, anon, authenticated;
grant execute on function public.versus_create_invite(text, text), public.versus_join_invite(text, text, bigint) to service_role;

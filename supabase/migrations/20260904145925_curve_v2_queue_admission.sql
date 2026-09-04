-- The curve-v2 queue guard refused every enqueue, including compatible clients.
--
-- private.guard_ranked_admission() fires BEFORE INSERT on matchmaking_queue.
-- public.enqueue_ranked_player() inserts player_id ONLY, so the new row carries
-- the column defaults protocol_version = 1 and capabilities = '{}'. Under curve
-- v2 the guard's client check then raised on every row, and the UPDATE in
-- enqueue_ranked_player_v3 that writes the real protocol/capabilities never
-- ran, because the INSERT it follows had already aborted the statement.
--
-- The transition flag is the fix, and the function already contains the proof
-- of what was meant: enqueue_ranked_player_v3 sets
-- knucklebones.progression_v2_queue before delegating, the queue branch's
-- curve_version check honours it, and the matches branch honours it in BOTH of
-- its checks. Only this one condition was left out. The client is still
-- validated for that path -- enqueue_ranked_player_v3 raises 'ranked client
-- does not support active curve v2' before it inserts anything -- and a direct
-- write, which sets no flag, is still guarded exactly as before.
--
-- FOR WHOEVER ADDS THE NEXT BEFORE-INSERT GUARD HERE: this table is written in
-- two statements. public.enqueue_ranked_player() inserts the player id, and its
-- caller updates the client facts immediately after; both enqueue_ranked_player_v3
-- and its v2 predecessor are shaped that way. So a BEFORE INSERT trigger on
-- matchmaking_queue sees COLUMN DEFAULTS for protocol_version, capabilities and
-- curve_version, never the client's values, and any guard that reads them
-- without honouring the transition flag will reject every player exactly as
-- this one did. Guard the UPDATE, or fold the values into the INSERT first.
create or replace function private.guard_ranked_admission()
returns trigger
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_contract private.ranked_runtime_contract%rowtype;
  v_transition boolean;
begin
  select * into strict v_contract
    from private.ranked_runtime_contract where singleton for share;
  if v_contract.admission_paused then
    raise exception 'ranked admission is paused' using errcode = 'P0001';
  end if;

  if tg_table_name = 'matchmaking_queue' then
    v_transition := current_setting('knucklebones.progression_v2_queue', true) = '1';
    if not v_transition and new.curve_version <> v_contract.curve_version then
      raise exception 'ranked queue curve is not active' using errcode = 'P0001';
    end if;
    if v_contract.curve_version = 2 and not v_transition
       and (new.protocol_version <> 2 or not ('curve_v2' = any(new.capabilities))) then
      raise exception 'ranked client must support active curve v2' using errcode = 'P0001';
    end if;
  else
    v_transition := current_setting('knucklebones.progression_v2_start', true) = '1';
    if not v_transition and new.curve_version <> v_contract.curve_version then
      raise exception 'ranked match curve is not active' using errcode = 'P0001';
    end if;
    if v_contract.curve_version = 2 and not v_transition then
      raise exception 'curve-v2 matches require start_ranked_match_v4'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_ranked_admission()
  from public, anon, authenticated, service_role;

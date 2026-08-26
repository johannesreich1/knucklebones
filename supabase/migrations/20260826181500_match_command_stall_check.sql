-- Classic auto-move stall recovery, re-verified by the database clock. The
-- Rune Trial path (commit_match_action) already rejects an auto command whose
-- expected last_move_at drifted or whose 12-second stall has not elapsed by
-- clock_timestamp(); classic commit_match_command trusted the Edge runtime
-- clock alone, so a fast Edge clock could force a random move slightly early.
-- Recreate the command with an optional trailing stall precondition: the null
-- default keeps the currently-deployed edge function (which never passes it)
-- valid until pvp-move is redeployed, making the rollout order-safe.
drop function public.commit_match_command(
  uuid, uuid, uuid, smallint, boolean, integer, smallint, smallint,
  jsonb, smallint, smallint, jsonb, jsonb
);

create function public.commit_match_command(
  p_match_id uuid,
  p_command_id uuid,
  p_actor uuid,
  p_requested_col smallint,
  p_auto boolean,
  p_expected_move_count integer,
  p_expected_turn smallint,
  p_expected_next_die smallint,
  p_moves jsonb,
  p_next_turn smallint,
  p_next_die smallint,
  p_settlement jsonb,
  p_response_meta jsonb default '{}'::jsonb,
  p_expected_last_move_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
  v_command private.match_commands%rowtype;
  v_move jsonb;
  v_pos integer := 0;
  v_idx integer;
  v_who smallint;
  v_col smallint;
  v_die smallint;
  v_settled jsonb;
  v_response jsonb;
begin
  if p_requested_col not between -1 and 2
     or p_expected_move_count < 0
     or p_expected_turn not in (0, 1)
     or p_expected_next_die not between 1 and 6
     or jsonb_typeof(p_moves) <> 'array'
     or jsonb_array_length(p_moves) not between 1 and 2
     or jsonb_typeof(coalesce(p_response_meta, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid match command payload' using errcode = '22023';
  end if;

  -- Lock first, then look for the idempotency record. A concurrent copy of the
  -- same command waits here and sees the committed response on its next
  -- READ-COMMITTED statement.
  select * into v_match
    from public.matches
   where id = p_match_id
   for update;
  if not found then
    raise exception 'match does not exist' using errcode = 'P0002';
  end if;

  select * into v_command
    from private.match_commands
   where match_id = p_match_id and command_id = p_command_id;
  if found then
    if v_command.actor <> p_actor
       or v_command.requested_col <> p_requested_col
       or v_command.auto <> p_auto
       or v_command.expected_move_count <> p_expected_move_count then
      raise exception 'command id was reused with different input' using errcode = '22023';
    end if;
    return v_command.response;
  end if;

  if p_actor not in (v_match.p1, v_match.p2) then
    raise exception 'command actor is not a match participant' using errcode = '22023';
  end if;
  if v_match.status <> 'active'
     or v_match.turn <> p_expected_turn
     or v_match.next_die is distinct from p_expected_next_die
     or (select count(*) from public.match_moves where match_id = p_match_id) <> p_expected_move_count then
    raise exception 'match changed before command commit' using errcode = 'P0001';
  end if;
  if p_auto then
    -- The Edge clock proposed a stall; when it also supplies the projection it
    -- inspected, the database clock is the authority on the 12-second gate. A
    -- null precondition is the deployed legacy caller and keeps old behavior.
    if p_expected_last_move_at is not null
       and (p_expected_last_move_at is distinct from v_match.last_move_at
         or clock_timestamp() - v_match.last_move_at < interval '12 seconds') then
      raise exception 'command is not stalled yet' using errcode = 'P0001';
    end if;
  elsif p_expected_last_move_at is not null then
    raise exception 'manual command carries a stall precondition' using errcode = '22023';
  elsif (v_match.p1 = p_actor and p_expected_turn <> 1)
     or (v_match.p2 = p_actor and p_expected_turn <> 0) then
    raise exception 'manual command actor does not own the turn' using errcode = '22023';
  end if;

  for v_move in select value from jsonb_array_elements(p_moves)
  loop
    if jsonb_typeof(v_move) <> 'object' then
      raise exception 'match command move is not an object' using errcode = '22023';
    end if;
    v_idx := (v_move->>'idx')::integer;
    v_who := (v_move->>'who')::smallint;
    v_col := (v_move->>'col')::smallint;
    v_die := (v_move->>'die')::smallint;
    if v_idx <> p_expected_move_count + v_pos
       or v_who <> ((p_expected_turn + v_pos) % 2)::smallint
       or v_col not between 0 and 2
       or v_die not between 1 and 6
       or (v_pos = 0 and v_die <> p_expected_next_die) then
      raise exception 'invalid move sequence in match command' using errcode = '22023';
    end if;
    insert into public.match_moves (match_id, idx, who, col, die)
    values (p_match_id, v_idx, v_who, v_col, v_die);
    v_pos := v_pos + 1;
  end loop;

  if p_settlement is null then
    if p_next_turn not in (0, 1) or p_next_die not between 1 and 6 then
      raise exception 'nonterminal command has no next projection' using errcode = '22023';
    end if;
    update public.matches
       set turn = p_next_turn,
           next_die = p_next_die,
           last_move_at = clock_timestamp()
     where id = p_match_id and status = 'active'
     returning * into strict v_match;
    v_response := jsonb_build_object('match', to_jsonb(v_match))
      || coalesce(p_response_meta, '{}'::jsonb);
  else
    if jsonb_typeof(p_settlement) <> 'object' then
      raise exception 'terminal settlement is not an object' using errcode = '22023';
    end if;
    select public.settle_match(
      p_match_id,
      p_settlement->>'status',
      (p_settlement->>'winner')::uuid,
      (p_settlement->>'p1_score')::integer,
      (p_settlement->>'p2_score')::integer,
      (p_settlement->>'p1_delta')::integer,
      (p_settlement->>'p2_delta')::integer,
      p_settlement->'expected_p1',
      p_settlement->'expected_p2',
      p_settlement->'next_p1',
      p_settlement->'next_p2'
    ) into v_settled;
    if not coalesce((v_settled->>'applied')::boolean, false) then
      raise exception 'active command did not claim its settlement' using errcode = 'P0001';
    end if;
    v_response := jsonb_build_object('match', v_settled->'match')
      || coalesce(p_response_meta, '{}'::jsonb);
  end if;

  insert into private.match_commands (
    match_id, command_id, actor, requested_col, auto, expected_move_count, response
  ) values (
    p_match_id, p_command_id, p_actor, p_requested_col, p_auto, p_expected_move_count, v_response
  );
  return v_response;
end;
$function$;

revoke execute on function public.commit_match_command(
  uuid, uuid, uuid, smallint, boolean, integer, smallint, smallint,
  jsonb, smallint, smallint, jsonb, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.commit_match_command(
  uuid, uuid, uuid, smallint, boolean, integer, smallint, smallint,
  jsonb, smallint, smallint, jsonb, jsonb, timestamptz
) to service_role;

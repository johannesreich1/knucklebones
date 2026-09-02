-- Ranked progression contract v2.
--
-- This migration is deliberately dormant on apply: the singleton runtime
-- contract remains curve/scoring v1 and admission remains open. New clients
-- and Edge Functions may ship against the additive columns/RPCs first. A
-- later owner-only cutover must pause admission, drain active work, map all
-- points atomically, and only then flip this authority to v2.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

create table private.ranked_runtime_contract (
  singleton boolean primary key default true check (singleton),
  curve_version smallint not null default 1 check (curve_version in (1, 2)),
  scoring_version smallint not null default 1 check (scoring_version in (1, 2)),
  admission_paused boolean not null default false,
  activated_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check ((curve_version = 1 and scoring_version = 1 and activated_at is null)
    or (curve_version = 2 and scoring_version = 2 and activated_at is not null))
);
insert into private.ranked_runtime_contract (singleton) values (true);
revoke all on table private.ranked_runtime_contract
  from public, anon, authenticated, service_role;

create table public.player_ranked_outcomes (
  player_id uuid not null references public.profiles(id) on delete cascade,
  outcome_id text not null check (outcome_id in (
    'classic','singlestrike','colshield','bounty','rowmult',
    'rune_trial','rowswitch','limited'
  )),
  grant_source text not null check (grant_source in (
    'legacy_pool','curve_v2_start','curve_v2_milestone','curve_v2_apex'
  )),
  source_match_id uuid references public.matches(id) on delete set null,
  granted_at timestamptz not null default clock_timestamp(),
  primary key (player_id, outcome_id)
);
create index player_ranked_outcomes_source_match_idx
  on public.player_ranked_outcomes (source_match_id)
  where source_match_id is not null;
alter table public.player_ranked_outcomes enable row level security;
create policy player_ranked_outcomes_select_own
  on public.player_ranked_outcomes for select to authenticated
  using (player_id = (select auth.uid()));
revoke all on table public.player_ranked_outcomes
  from public, anon, authenticated, service_role;
grant select on table public.player_ranked_outcomes to authenticated;
grant select, insert, update, delete on table public.player_ranked_outcomes to service_role;

create table public.player_ranked_features (
  player_id uuid not null references public.profiles(id) on delete cascade,
  feature_id text not null check (feature_id in ('equipped_runes','weekly_challenge')),
  grant_source text not null check (grant_source in (
    'legacy_peak','curve_v2_milestone','curve_v2_apex'
  )),
  source_match_id uuid references public.matches(id) on delete set null,
  granted_at timestamptz not null default clock_timestamp(),
  primary key (player_id, feature_id)
);
create index player_ranked_features_source_match_idx
  on public.player_ranked_features (source_match_id)
  where source_match_id is not null;
alter table public.player_ranked_features enable row level security;
create policy player_ranked_features_select_own
  on public.player_ranked_features for select to authenticated
  using (player_id = (select auth.uid()));
revoke all on table public.player_ranked_features
  from public, anon, authenticated, service_role;
grant select on table public.player_ranked_features to authenticated;
grant select, insert, update, delete on table public.player_ranked_features to service_role;

create table public.ranked_weekly_rotations (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  modifier text not null check (modifier in (
    'classic','singlestrike','colshield','bounty','rowmult','rowswitch','limited'
  )),
  created_at timestamptz not null default clock_timestamp(),
  unique (starts_at),
  unique (ends_at),
  check (ends_at = starts_at + interval '7 days'),
  check (extract(isodow from starts_at at time zone 'UTC') = 1
    and (starts_at at time zone 'UTC')::time = time '00:00:00')
);
alter table public.ranked_weekly_rotations enable row level security;
create policy ranked_weekly_rotations_read
  on public.ranked_weekly_rotations for select to anon, authenticated using (true);
revoke all on table public.ranked_weekly_rotations
  from public, anon, authenticated, service_role;
grant select on table public.ranked_weekly_rotations to anon, authenticated;
grant select, insert, update, delete on table public.ranked_weekly_rotations to service_role;

create table public.ranked_weekly_completions (
  player_id uuid not null references public.profiles(id) on delete cascade,
  rotation_id uuid not null references public.ranked_weekly_rotations(id) on delete cascade,
  source_match_id uuid references public.matches(id) on delete set null,
  completed_at timestamptz not null default clock_timestamp(),
  primary key (player_id, rotation_id)
);
create index ranked_weekly_completions_rotation_idx
  on public.ranked_weekly_completions (rotation_id);
create index ranked_weekly_completions_source_match_idx
  on public.ranked_weekly_completions (source_match_id)
  where source_match_id is not null;
alter table public.ranked_weekly_completions enable row level security;
create policy ranked_weekly_completions_select_own
  on public.ranked_weekly_completions for select to authenticated
  using (player_id = (select auth.uid()));
revoke all on table public.ranked_weekly_completions
  from public, anon, authenticated, service_role;
grant select on table public.ranked_weekly_completions to authenticated;
grant select, insert, update, delete on table public.ranked_weekly_completions to service_role;

create table public.player_neon_medals (
  player_id uuid not null references public.profiles(id) on delete cascade,
  season_id smallint not null references public.seasons(id) on delete cascade,
  source_match_id uuid references public.matches(id) on delete set null,
  earned_at timestamptz not null default clock_timestamp(),
  primary key (player_id, season_id)
);
create index player_neon_medals_source_match_idx
  on public.player_neon_medals (source_match_id)
  where source_match_id is not null;
alter table public.player_neon_medals enable row level security;
create policy player_neon_medals_select_own
  on public.player_neon_medals for select to authenticated
  using (player_id = (select auth.uid()));
revoke all on table public.player_neon_medals
  from public, anon, authenticated, service_role;
grant select on table public.player_neon_medals to authenticated;
grant select, insert, update, delete on table public.player_neon_medals to service_role;

create table private.ranked_bot_debuts (
  player_id uuid not null references public.profiles(id) on delete cascade,
  outcome_id text not null check (outcome_id in (
    'rowmult','rune_trial','rowswitch','limited'
  )),
  teaching_order smallint not null check (teaching_order between 1 and 4),
  source_match_id uuid references public.matches(id) on delete set null,
  started_match_id uuid references public.matches(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','completed')),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key (player_id, outcome_id),
  check ((status = 'pending' and started_match_id is null and completed_at is null)
    or (status = 'completed' and completed_at is not null))
);
create index ranked_bot_debuts_pending_idx
  on private.ranked_bot_debuts (player_id, teaching_order)
  where status = 'pending';
create index ranked_bot_debuts_source_match_idx
  on private.ranked_bot_debuts (source_match_id)
  where source_match_id is not null;
revoke all on table private.ranked_bot_debuts
  from public, anon, authenticated, service_role;

create table private.ranked_curve_v2_cutover (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  old_historical_peak integer not null check (old_historical_peak >= 0),
  old_ranked_pool_tier text not null check (old_ranked_pool_tier in ('stone','bone','ivory')),
  mapped_historical_peak integer not null check (mapped_historical_peak >= 0),
  was_current_apex boolean not null default false,
  apex_season_id smallint references public.seasons(id) on delete restrict,
  mapped_at timestamptz not null default clock_timestamp(),
  check ((not was_current_apex and apex_season_id is null)
    or (was_current_apex and apex_season_id is not null))
);
revoke all on table private.ranked_curve_v2_cutover
  from public, anon, authenticated, service_role;

alter table public.matches
  add column curve_version smallint not null default 1,
  add column scoring_version smallint not null default 1,
  add column p1_base_rating_delta integer,
  add column p2_base_rating_delta integer,
  add column p1_finish_rating_delta integer,
  add column p2_finish_rating_delta integer,
  add column entry_kind text not null default 'ordinary',
  add column weekly_rotation_id uuid references public.ranked_weekly_rotations(id) on delete restrict,
  add column outcome_roster text[],
  add column reward_version smallint not null default 1,
  add column claim_slot smallint,
  add column claim_rune text;

update public.matches
   set p1_base_rating_delta = p1_rating_delta,
       p2_base_rating_delta = p2_rating_delta,
       p1_finish_rating_delta = case when p1_rating_delta is null then null else 0 end,
       p2_finish_rating_delta = case when p2_rating_delta is null then null else 0 end
 where status <> 'active';

alter table public.matches
  add constraint matches_curve_version_check check (curve_version in (1, 2)),
  add constraint matches_scoring_version_check check (scoring_version in (1, 2)),
  add constraint matches_entry_kind_check check (entry_kind in ('ordinary','weekly')),
  add constraint matches_reward_version_check check (reward_version in (1, 2)),
  add constraint matches_outcome_roster_check check (
    outcome_roster is null
    or (
      cardinality(outcome_roster) between 1 and 8
      and ((entry_kind = 'ordinary' and 'classic' = any(outcome_roster))
        or (entry_kind = 'weekly' and cardinality(outcome_roster) = 1))
      and outcome_roster <@ array[
        'classic','singlestrike','colshield','bounty','rowmult',
        'rune_trial','rowswitch','limited'
      ]::text[]
      and array_position(outcome_roster, null) is null
      and cardinality(array_positions(outcome_roster, 'classic')) <= 1
      and cardinality(array_positions(outcome_roster, 'singlestrike')) <= 1
      and cardinality(array_positions(outcome_roster, 'colshield')) <= 1
      and cardinality(array_positions(outcome_roster, 'bounty')) <= 1
      and cardinality(array_positions(outcome_roster, 'rowmult')) <= 1
      and cardinality(array_positions(outcome_roster, 'rune_trial')) <= 1
      and cardinality(array_positions(outcome_roster, 'rowswitch')) <= 1
      and cardinality(array_positions(outcome_roster, 'limited')) <= 1
    )
  ),
  add constraint matches_claim_slot_check check (claim_slot is null or claim_slot between 0 and 2),
  add constraint matches_claim_rune_check check (claim_rune is null or claim_rune in (
    'fate','nudge','ward','sunder','pilfer','anvil'
  )),
  add constraint matches_rating_components_check check (
    (p1_base_rating_delta is null and p2_base_rating_delta is null
      and p1_finish_rating_delta is null and p2_finish_rating_delta is null)
    or (p1_base_rating_delta is not null and p2_base_rating_delta is not null
      and p1_finish_rating_delta is not null and p2_finish_rating_delta is not null
      and p1_rating_delta is not null and p2_rating_delta is not null
      and p1_rating_delta = p1_base_rating_delta + p1_finish_rating_delta
      and p2_rating_delta = p2_base_rating_delta + p2_finish_rating_delta
      and p1_finish_rating_delta = -p2_finish_rating_delta
      and abs(p1_finish_rating_delta) <= 7
      and (scoring_version = 2
        or (p1_finish_rating_delta = 0 and p2_finish_rating_delta = 0)))
  ),
  add constraint matches_weekly_snapshot_check check (
    (entry_kind = 'ordinary' and weekly_rotation_id is null)
    or (entry_kind = 'weekly' and weekly_rotation_id is not null)
  ),
  add constraint matches_claim_snapshot_check check (
    (reward_version = 1 and claim_slot is null and claim_rune is null)
    or (reward_version = 2 and format = 'rune_trial'
      and claim_slot is not null and claim_rune is not null
      and trial_offer is not null and claim_rune = trial_offer[claim_slot + 1])
  );

alter table public.matchmaking_queue
  add column curve_version smallint not null default 1,
  add column entry_kind text not null default 'ordinary',
  add column weekly_rotation_id uuid references public.ranked_weekly_rotations(id) on delete restrict;
alter table public.matchmaking_queue drop constraint matchmaking_queue_capabilities_check;
alter table public.matchmaking_queue
  add constraint matchmaking_queue_curve_version_check check (curve_version in (1, 2)),
  add constraint matchmaking_queue_entry_kind_check check (entry_kind in ('ordinary','weekly')),
  add constraint matchmaking_queue_weekly_snapshot_check check (
    (entry_kind = 'ordinary' and weekly_rotation_id is null)
    or (entry_kind = 'weekly' and curve_version = 2 and weekly_rotation_id is not null)
  ),
  add constraint matchmaking_queue_capabilities_check check (
    capabilities <@ array[
      'rune_trial_v1','equipped_rune_v1','curve_v2','rune_trial_claim_v2'
    ]::text[]
    and array_position(capabilities, null) is null
    and cardinality(capabilities) <= 4
    and cardinality(array_positions(capabilities, 'rune_trial_v1')) <= 1
    and cardinality(array_positions(capabilities, 'equipped_rune_v1')) <= 1
    and cardinality(array_positions(capabilities, 'curve_v2')) <= 1
    and cardinality(array_positions(capabilities, 'rune_trial_claim_v2')) <= 1
    and (cardinality(capabilities) = 0 or protocol_version = 2)
    and (not ('equipped_rune_v1' = any(capabilities))
      or 'rune_trial_v1' = any(capabilities))
    and (not ('rune_trial_claim_v2' = any(capabilities))
      or ('rune_trial_v1' = any(capabilities) and 'curve_v2' = any(capabilities)))
  );

alter table public.ranked_progression_events
  add column curve_version smallint not null default 1
    check (curve_version in (1, 2)),
  add column outcome_grants text[] not null default '{}'::text[],
  add column weekly_unlocked_before boolean not null default false,
  add column weekly_unlocked_after boolean not null default false,
  add column neon_medal_granted boolean not null default false;
alter table public.ranked_progression_events
  add constraint ranked_progression_events_outcome_grants_check check (
    outcome_grants <@ array[
      'classic','singlestrike','colshield','bounty','rowmult',
      'rune_trial','rowswitch','limited'
    ]::text[]
    and array_position(outcome_grants, null) is null
    and cardinality(array_positions(outcome_grants, 'classic')) <= 1
    and cardinality(array_positions(outcome_grants, 'singlestrike')) <= 1
    and cardinality(array_positions(outcome_grants, 'colshield')) <= 1
    and cardinality(array_positions(outcome_grants, 'bounty')) <= 1
    and cardinality(array_positions(outcome_grants, 'rowmult')) <= 1
    and cardinality(array_positions(outcome_grants, 'rune_trial')) <= 1
    and cardinality(array_positions(outcome_grants, 'rowswitch')) <= 1
    and cardinality(array_positions(outcome_grants, 'limited')) <= 1
  ),
  add constraint ranked_progression_events_weekly_monotonic_check
    check (not weekly_unlocked_before or weekly_unlocked_after);

comment on table private.ranked_runtime_contract is
  'Singleton server-owned ranked curve/scoring authority. Migration apply leaves v1 active; activation is explicit and drain-checked.';
comment on table public.player_ranked_outcomes is
  'Durable per-outcome access. Cutover unions legacy promises with the clean curve-v2 schedule; demotion never removes rows.';
comment on table private.ranked_bot_debuts is
  'One durable bot-practice promise per newly earned teaching outcome; human matches and failed starts do not consume it.';
comment on column public.matches.reward_version is
  '1 awards the resolved selected Trial rune; 2 awards only the immutable CLAIM rune when the winner selected it.';
comment on column public.matches.claim_slot is
  'Zero-based immutable slot into trial_offer for CLAIM reward version 2.';
comment on column public.matches.scoring_version is
  '1 stores base-only rating deltas; 2 stores opponent-strength base plus the signed finish-margin transfer.';

-- Additive JSON fields let new clients explain formula-v2 history while old
-- clients continue reading the original eight names from the same RPC.
drop function public.match_history(integer, timestamptz, uuid);
create function public.match_history(
  limit_n integer default 40,
  before_t timestamptz default null,
  before_id uuid default null
)
returns table(id uuid, finished_at timestamptz, opponent text, mode text,
              mine integer, theirs integer, delta integer, result text,
              base_delta integer, finish_delta integer,
              scoring_version smallint)
language sql stable security definer
set search_path = ''
as $function$
  with history as (
    select match.id,
           match.finished_at,
           opponent.nickname as opponent,
           coalesce(match.modifier, 'classic') as mode,
           match.p1_score as mine,
           match.p2_score as theirs,
           match.p1_rating_delta as delta,
           case when match.winner is null then 'draw'
                when match.winner = auth.uid() then 'win' else 'loss' end as result,
           match.p1_base_rating_delta as base_delta,
           match.p1_finish_rating_delta as finish_delta,
           match.scoring_version
      from public.matches match
      join public.profiles opponent on opponent.id = match.p2
     where match.p1 = auth.uid()
       and match.status <> 'active'
       and match.season_id = public.current_season()
       and (
         before_t is null
         or (before_id is null and match.finished_at < before_t)
         or (before_id is not null
           and (match.finished_at, match.id) < (before_t, before_id))
       )

    union all

    select match.id,
           match.finished_at,
           opponent.nickname as opponent,
           coalesce(match.modifier, 'classic') as mode,
           match.p2_score as mine,
           match.p1_score as theirs,
           match.p2_rating_delta as delta,
           case when match.winner is null then 'draw'
                when match.winner = auth.uid() then 'win' else 'loss' end as result,
           match.p2_base_rating_delta as base_delta,
           match.p2_finish_rating_delta as finish_delta,
           match.scoring_version
      from public.matches match
      join public.profiles opponent on opponent.id = match.p1
     where match.p2 = auth.uid()
       and match.status <> 'active'
       and match.season_id = public.current_season()
       and (
         before_t is null
         or (before_id is null and match.finished_at < before_t)
         or (before_id is not null
           and (match.finished_at, match.id) < (before_t, before_id))
       )
  )
  select history.id, history.finished_at, history.opponent, history.mode,
         history.mine, history.theirs, history.delta, history.result,
         history.base_delta, history.finish_delta, history.scoring_version
    from history
   order by history.finished_at desc nulls last, history.id desc
   limit least(greatest(limit_n, 1), 100);
$function$;
revoke execute on function public.match_history(integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.match_history(integer, timestamptz, uuid)
  to authenticated;

create or replace function private.ladder_board(p_season smallint)
returns table(
  player uuid,
  nickname text,
  points integer,
  wins bigint,
  losses bigint,
  games bigint,
  rank bigint,
  apex boolean,
  avatar text,
  peak integer
)
language sql stable security invoker
set search_path = ''
as $function$
  with runtime as (
    select curve_version
      from private.ranked_runtime_contract where singleton
  ),
  humans as (
    select count(*) as n
      from public.season_ratings rating
      join public.profiles profile on profile.id = rating.player
     where rating.season_id = p_season
       and not profile.is_bot
       and rating.wins + rating.losses + rating.draws > 0
  ),
  board as (
    select rating.player,
           profile.nickname,
           rating.points,
           rating.wins::bigint as wins,
           rating.losses::bigint as losses,
           (rating.wins + rating.losses + rating.draws)::bigint as games,
           rank() over (order by rating.points desc, rating.wins desc) as rnk,
           count(*) over () as pop,
           profile.avatar,
           rating.peak
      from public.season_ratings rating
      join public.profiles profile on profile.id = rating.player
     where rating.season_id = p_season
       and rating.wins + rating.losses + rating.draws > 0
       and (not profile.is_bot or (select n from humans) < 100)
  )
  select board.player,
         board.nickname,
         board.points,
         board.wins,
         board.losses,
         board.games,
         board.rnk,
         case when board.pop < 100 then board.points >= case
                when (select curve_version from runtime) = 2 then 6090
                else 4350 end
              else board.rnk <= greatest(1, floor(board.pop * 0.01)) end,
         board.avatar,
         board.peak
    from board;
$function$;
revoke execute on function private.ladder_board(smallint)
  from public, anon, authenticated, service_role;

create function private.map_ranked_points_v1_to_v2(p_points integer)
returns integer
language sql immutable strict security invoker
set search_path = ''
as $function$
  select case
    when p_points < 0 then null
    when p_points < 300 then round(p_points::numeric * 360 / 300)::integer
    when p_points < 720 then 360 + round((p_points - 300)::numeric * 480 / 420)::integer
    when p_points < 1260 then 840 + round((p_points - 720)::numeric * 650 / 540)::integer
    when p_points < 2010 then 1490 + round((p_points - 1260)::numeric * 1000 / 750)::integer
    when p_points < 3000 then 2490 + round((p_points - 2010)::numeric * 1400 / 990)::integer
    else 3890 + round((p_points - 3000)::numeric * 2200 / 1350)::integer
  end;
$function$;
revoke all on function private.map_ranked_points_v1_to_v2(integer)
  from public, anon, authenticated, service_role;

create function private.ranked_pool_tier_for_peak_version(
  p_peak integer,
  p_curve_version smallint
)
returns text
language sql immutable security invoker
set search_path = ''
as $function$
  select case
    when p_curve_version = 1 and coalesce(p_peak, 0) >= 720 then 'ivory'
    when p_curve_version = 1 and coalesce(p_peak, 0) >= 300 then 'bone'
    when p_curve_version = 2 and coalesce(p_peak, 0) >= 840 then 'ivory'
    when p_curve_version = 2 and coalesce(p_peak, 0) >= 360 then 'bone'
    else 'stone'
  end;
$function$;
revoke all on function private.ranked_pool_tier_for_peak_version(integer, smallint)
  from public, anon, authenticated, service_role;

create function private.legacy_ranked_outcomes_for_peak(p_peak integer)
returns setof text
language sql immutable security invoker
set search_path = ''
as $function$
  select outcome_id
    from unnest(case
      when coalesce(p_peak, 0) >= 720 then array[
        'classic','singlestrike','colshield','limited',
        'rowswitch','rowmult','bounty','rune_trial'
      ]::text[]
      when coalesce(p_peak, 0) >= 300 then array[
        'classic','singlestrike','colshield','limited',
        'rowswitch','rowmult','bounty'
      ]::text[]
      else array['classic','singlestrike','colshield','limited']::text[]
    end) outcome_id;
$function$;
revoke all on function private.legacy_ranked_outcomes_for_peak(integer)
  from public, anon, authenticated, service_role;

create function private.progression_v2_outcomes_for_peak(
  p_peak integer,
  p_apex boolean default false
)
returns setof text
language sql immutable security invoker
set search_path = ''
as $function$
  select outcome_id
    from unnest(case
      when coalesce(p_apex, false) or coalesce(p_peak, 0) >= 2490 then array[
        'classic','singlestrike','colshield','bounty','rowmult',
        'rune_trial','rowswitch','limited'
      ]::text[]
      when coalesce(p_peak, 0) >= 840 then array[
        'classic','singlestrike','colshield','bounty','rowmult','rune_trial'
      ]::text[]
      when coalesce(p_peak, 0) >= 360 then array[
        'classic','singlestrike','colshield','bounty','rowmult'
      ]::text[]
      else array['classic','singlestrike','colshield','bounty']::text[]
    end) outcome_id;
$function$;
revoke all on function private.progression_v2_outcomes_for_peak(integer, boolean)
  from public, anon, authenticated, service_role;

-- Populate durable facts without changing the deployed v1 wheel. Existing
-- matchmaking continues to read profiles.ranked_pool_tier until activation.
insert into public.player_ranked_outcomes (player_id, outcome_id, grant_source)
select profile.id, outcome.outcome_id, 'legacy_pool'
  from public.profiles profile
  cross join lateral private.legacy_ranked_outcomes_for_peak(greatest(
    coalesce((select max(rating.peak) from public.season_ratings rating
      where rating.player = profile.id), 0),
    coalesce(profile.rating, 0),
    case profile.ranked_pool_tier
      when 'ivory' then 720
      when 'bone' then 300
      else 0
    end
  )) outcome(outcome_id)
on conflict (player_id, outcome_id) do nothing;

insert into public.player_ranked_features (player_id, feature_id, grant_source)
select profile.id, 'equipped_runes', 'legacy_peak'
  from public.profiles profile
 where exists (
   select 1 from public.season_ratings rating
    where rating.player = profile.id and rating.peak >= 1260
 )
on conflict (player_id, feature_id) do nothing;

create function private.seed_ranked_entitlements_for_profile()
returns trigger
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_curve smallint;
begin
  select curve_version into strict v_curve
    from private.ranked_runtime_contract where singleton;
  if v_curve = 1 then
    insert into public.player_ranked_outcomes (player_id, outcome_id, grant_source)
    select new.id, outcome_id, 'legacy_pool'
      from private.legacy_ranked_outcomes_for_peak(0) outcome_id;
  else
    insert into public.player_ranked_outcomes (player_id, outcome_id, grant_source)
    select new.id, outcome_id, 'curve_v2_start'
      from private.progression_v2_outcomes_for_peak(0, false) outcome_id;
  end if;
  return new;
end;
$function$;
revoke all on function private.seed_ranked_entitlements_for_profile()
  from public, anon, authenticated, service_role;
create trigger profiles_seed_ranked_entitlements
after insert on public.profiles
for each row execute function private.seed_ranked_entitlements_for_profile();

create function private.guard_weekly_rotation_overlap()
returns trigger
language plpgsql security definer
set search_path = ''
as $function$
begin
  lock table public.ranked_weekly_rotations in share row exclusive mode;
  if exists (
    select 1 from public.ranked_weekly_rotations rotation
     where rotation.id <> new.id
       and tstzrange(rotation.starts_at, rotation.ends_at, '[)')
           && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'ranked weekly rotations overlap' using errcode = '23P01';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_weekly_rotation_overlap()
  from public, anon, authenticated, service_role;
create trigger ranked_weekly_rotations_guard_overlap
before insert or update of starts_at, ends_at on public.ranked_weekly_rotations
for each row execute function private.guard_weekly_rotation_overlap();

create function private.ranked_weekly_modifier_for_start(p_starts_at timestamptz)
returns text
language plpgsql immutable
set search_path = ''
as $function$
declare
  v_week_offset integer;
  v_modifiers constant text[] := array[
    'classic','singlestrike','colshield','bounty','rowmult','rowswitch','limited'
  ];
begin
  if extract(isodow from p_starts_at at time zone 'UTC') <> 1
     or (p_starts_at at time zone 'UTC')::time <> time '00:00:00' then
    raise exception 'ranked weekly rotation must start Monday at 00:00 UTC'
      using errcode = '22023';
  end if;
  v_week_offset := ((p_starts_at at time zone 'UTC')::date - date '2026-08-31') / 7;
  return v_modifiers[mod(mod(v_week_offset, 7) + 7, 7) + 1];
end;
$function$;
revoke all on function private.ranked_weekly_modifier_for_start(timestamptz)
  from public, anon, authenticated, service_role;

create function private.ensure_current_ranked_weekly_rotation()
returns public.ranked_weekly_rotations
language plpgsql volatile security definer
set search_path = ''
as $function$
declare
  v_start timestamptz := date_trunc(
    'week', clock_timestamp() at time zone 'UTC'
  ) at time zone 'UTC';
  v_rotation public.ranked_weekly_rotations%rowtype;
begin
  select * into v_rotation
    from public.ranked_weekly_rotations rotation
   where rotation.starts_at = v_start;
  if found then
    return v_rotation;
  end if;

  -- Only the first request of a new UTC week takes this lock. Rechecking
  -- under it makes the persisted row idempotent across concurrent clients.
  lock table public.ranked_weekly_rotations in share row exclusive mode;
  select * into v_rotation
    from public.ranked_weekly_rotations rotation
   where rotation.starts_at = v_start;
  if not found then
    insert into public.ranked_weekly_rotations (starts_at, ends_at, modifier)
    values (
      v_start,
      v_start + interval '7 days',
      private.ranked_weekly_modifier_for_start(v_start)
    )
    returning * into strict v_rotation;
  end if;
  return v_rotation;
end;
$function$;
revoke all on function private.ensure_current_ranked_weekly_rotation()
  from public, anon, authenticated, service_role;

create function public.ranked_runtime_contract()
returns jsonb
language sql stable security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'curve_version', curve_version,
    'scoring_version', scoring_version,
    'admission_paused', admission_paused
  )
  from private.ranked_runtime_contract
  where singleton;
$function$;
revoke execute on function public.ranked_runtime_contract()
  from public, anon, authenticated, service_role;
grant execute on function public.ranked_runtime_contract() to service_role;

create function public.set_ranked_admission_paused(p_paused boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_contract private.ranked_runtime_contract%rowtype;
begin
  if p_paused is null then
    raise exception 'ranked admission pause state is required' using errcode = '22023';
  end if;
  update private.ranked_runtime_contract
     set admission_paused = p_paused,
         updated_at = clock_timestamp()
   where singleton
   returning * into strict v_contract;
  return jsonb_build_object(
    'curve_version', v_contract.curve_version,
    'scoring_version', v_contract.scoring_version,
    'admission_paused', v_contract.admission_paused
  );
end;
$function$;
revoke execute on function public.set_ranked_admission_paused(boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.set_ranked_admission_paused(boolean) to service_role;

-- Admission guards are intentionally INSERT-only on matches: pausing must not
-- touch any update path needed to finish/drain an existing game. The queue
-- guard covers new claims and metadata rewrites; DELETE remains available.
create function private.guard_ranked_admission()
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
    if v_contract.curve_version = 2
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
create trigger matchmaking_queue_guard_ranked_admission
before insert or update of curve_version, protocol_version, capabilities,
  entry_kind, weekly_rotation_id on public.matchmaking_queue
for each row execute function private.guard_ranked_admission();
create trigger matches_guard_ranked_admission
before insert on public.matches
for each row execute function private.guard_ranked_admission();

create function public.enqueue_ranked_player_v3(
  p_player uuid,
  p_protocol_version smallint,
  p_capabilities text[],
  p_entry_kind text default 'ordinary'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_contract private.ranked_runtime_contract%rowtype;
  v_result jsonb;
  v_tier text;
  v_rotation public.ranked_weekly_rotations%rowtype;
begin
  if p_protocol_version not in (1, 2)
     or p_capabilities is null
     or not p_capabilities <@ array[
       'rune_trial_v1','equipped_rune_v1','curve_v2','rune_trial_claim_v2'
     ]::text[]
     or array_position(p_capabilities, null) is not null
     or cardinality(p_capabilities) > 4
     or cardinality(array_positions(p_capabilities, 'rune_trial_v1')) > 1
     or cardinality(array_positions(p_capabilities, 'equipped_rune_v1')) > 1
     or cardinality(array_positions(p_capabilities, 'curve_v2')) > 1
     or cardinality(array_positions(p_capabilities, 'rune_trial_claim_v2')) > 1
     or p_entry_kind not in ('ordinary','weekly') then
    raise exception 'invalid ranked client capabilities or entry kind'
      using errcode = '22023';
  end if;
  if cardinality(p_capabilities) > 0 and p_protocol_version <> 2 then
    raise exception 'ranked capabilities require protocol v2' using errcode = '22023';
  end if;
  if 'equipped_rune_v1' = any(p_capabilities)
     and not ('rune_trial_v1' = any(p_capabilities)) then
    raise exception 'equipped rune capability requires Rune Trial action support'
      using errcode = '22023';
  end if;
  if 'rune_trial_claim_v2' = any(p_capabilities)
     and (not ('rune_trial_v1' = any(p_capabilities))
       or not ('curve_v2' = any(p_capabilities))) then
    raise exception 'CLAIM capability requires Rune Trial and curve v2'
      using errcode = '22023';
  end if;

  select * into strict v_contract
    from private.ranked_runtime_contract where singleton for share;
  if v_contract.admission_paused then
    raise exception 'ranked admission is paused' using errcode = 'P0001';
  end if;
  if v_contract.curve_version = 1 and p_entry_kind <> 'ordinary' then
    raise exception 'weekly entry is unavailable on curve v1' using errcode = 'P0001';
  end if;
  if v_contract.curve_version = 2
     and (p_protocol_version <> 2 or not ('curve_v2' = any(p_capabilities))) then
    raise exception 'ranked client does not support active curve v2'
      using errcode = 'P0001';
  end if;
  if p_entry_kind = 'weekly' then
    if not exists (
      select 1 from public.player_ranked_features feature
       where feature.player_id = p_player and feature.feature_id = 'weekly_challenge'
    ) then
      raise exception 'weekly ranked entry is locked' using errcode = '42501';
    end if;
    v_rotation := private.ensure_current_ranked_weekly_rotation();
  end if;

  perform set_config('knucklebones.progression_v2_queue', '1', true);
  v_result := public.enqueue_ranked_player(p_player);
  select ranked_pool_tier into strict v_tier
    from public.profiles where id = p_player;
  if v_result->>'status' = 'queued' then
    update public.matchmaking_queue
       set protocol_version = p_protocol_version,
           capabilities = p_capabilities,
           pool_tier = v_tier,
           curve_version = v_contract.curve_version,
           entry_kind = p_entry_kind,
           weekly_rotation_id = case when p_entry_kind = 'weekly'
             then v_rotation.id else null end
     where player_id = p_player;
  end if;
  return v_result || jsonb_build_object(
    'protocol_version', p_protocol_version,
    'capabilities', to_jsonb(p_capabilities),
    'pool_tier', v_tier,
    'curve_version', v_contract.curve_version,
    'entry_kind', p_entry_kind,
    'weekly_rotation_id', case when p_entry_kind = 'weekly'
      then v_rotation.id else null end
  );
end;
$function$;
revoke execute on function public.enqueue_ranked_player_v3(uuid, smallint, text[], text)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_ranked_player_v3(uuid, smallint, text[], text)
  to service_role;

create function public.active_ranked_curve_version()
returns smallint
language sql stable security definer
set search_path = ''
as $function$
  select curve_version from private.ranked_runtime_contract where singleton;
$function$;
comment on function public.active_ranked_curve_version() is
  'Public scalar needed to classify signed-out ladder rows against the active server curve.';
revoke execute on function public.active_ranked_curve_version()
  from public, anon, authenticated, service_role;
grant execute on function public.active_ranked_curve_version() to anon, authenticated;

create function public.ranked_progression_status()
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $function$
declare
  v_player uuid := (select auth.uid());
  v_contract private.ranked_runtime_contract%rowtype;
  v_outcomes jsonb;
  v_debuts jsonb;
  v_weekly_unlocked boolean;
  v_rotation public.ranked_weekly_rotations%rowtype;
  v_weekly jsonb;
  v_medals jsonb;
begin
  if v_player is null then
    raise exception 'ranked progression status requires authentication'
      using errcode = '42501';
  end if;
  select * into strict v_contract
    from private.ranked_runtime_contract where singleton;
  select coalesce(jsonb_agg(outcome_id order by case outcome_id
      when 'classic' then 1 when 'singlestrike' then 2
      when 'colshield' then 3 when 'bounty' then 4
      when 'rowmult' then 5 when 'rune_trial' then 6
      when 'rowswitch' then 7 when 'limited' then 8 end), '[]'::jsonb)
    into v_outcomes
    from public.player_ranked_outcomes where player_id = v_player;
  select exists (
    select 1 from public.player_ranked_features
     where player_id = v_player and feature_id = 'weekly_challenge'
  ) into v_weekly_unlocked;
  select coalesce(jsonb_agg(outcome_id order by teaching_order), '[]'::jsonb)
    into v_debuts
    from private.ranked_bot_debuts
   where player_id = v_player and status = 'pending';
  select coalesce(jsonb_agg(season_id order by season_id), '[]'::jsonb)
    into v_medals
    from public.player_neon_medals where player_id = v_player;

  if v_contract.curve_version = 2 and v_weekly_unlocked then
    v_rotation := private.ensure_current_ranked_weekly_rotation();
    v_weekly := jsonb_build_object(
      'rotation_id', v_rotation.id,
      'starts_at', v_rotation.starts_at,
      'ends_at', v_rotation.ends_at,
      'modifier', v_rotation.modifier,
      'completed', exists (
        select 1 from public.ranked_weekly_completions completion
         where completion.player_id = v_player
           and completion.rotation_id = v_rotation.id
      )
    );
  end if;

  return jsonb_build_object(
    'curve_version', v_contract.curve_version,
    'scoring_version', v_contract.scoring_version,
    'admission_paused', v_contract.admission_paused,
    'outcomes', v_outcomes,
    'weekly_unlocked', v_weekly_unlocked,
    'pending_bot_debuts', v_debuts,
    'neon_medal_seasons', v_medals,
    'weekly', v_weekly
  );
end;
$function$;
revoke execute on function public.ranked_progression_status()
  from public, anon, authenticated, service_role;
grant execute on function public.ranked_progression_status() to authenticated;

create function public.preview_ranked_curve_v2_activation()
returns jsonb
language sql stable security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'curve_version', contract.curve_version,
    'scoring_version', contract.scoring_version,
    'admission_paused', contract.admission_paused,
    'active_matches', (select count(*) from public.matches where status = 'active'),
    'queue_entries', (select count(*) from public.matchmaking_queue),
    'players', (select count(*) from public.profiles),
    'season_rows', (select count(*) from public.season_ratings)
  )
  from private.ranked_runtime_contract contract where singleton;
$function$;
revoke execute on function public.preview_ranked_curve_v2_activation()
  from public, anon, authenticated, service_role;
grant execute on function public.preview_ranked_curve_v2_activation() to service_role;

-- The application can pause and inspect ranked, but only the database owner
-- may perform the irreversible numeric cutover. The caller must supply the
-- exact row counts it inspected after pausing; table locks and a second count
-- close the race with account/season writes inside this one transaction.
create function private.activate_progression_v2(
  p_expected_profiles bigint,
  p_expected_season_rows bigint
)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $function$
declare
  v_contract private.ranked_runtime_contract%rowtype;
  v_profiles bigint;
  v_season_rows bigint;
  v_active bigint;
  v_queue bigint;
  v_rows bigint;
  v_outcome_grants bigint := 0;
  v_feature_grants bigint := 0;
  v_medal_grants bigint := 0;
  v_inserted bigint;
  v_current_season smallint;
begin
  if p_expected_profiles is null or p_expected_profiles < 0
     or p_expected_season_rows is null or p_expected_season_rows < 0 then
    raise exception 'expected progression-v2 cutover counts must be non-negative'
      using errcode = '22023';
  end if;

  select * into strict v_contract
    from private.ranked_runtime_contract where singleton for update;
  if v_contract.curve_version <> 1 or v_contract.scoring_version <> 1
     or v_contract.activated_at is not null then
    raise exception 'ranked progression v2 is not awaiting activation'
      using errcode = 'P0001';
  end if;
  if not v_contract.admission_paused then
    raise exception 'ranked admission must be paused before progression-v2 activation'
      using errcode = 'P0001';
  end if;

  lock table public.matches in share row exclusive mode;
  lock table public.matchmaking_queue in share row exclusive mode;
  lock table public.profiles in share row exclusive mode;
  lock table public.season_ratings in share row exclusive mode;
  lock table private.ranked_curve_v2_cutover in exclusive mode;

  select count(*) into v_active from public.matches where status = 'active';
  select count(*) into v_queue from public.matchmaking_queue;
  if v_active <> 0 or v_queue <> 0
     or exists (select 1 from private.active_match_players) then
    raise exception 'ranked v1 work must be fully drained before progression-v2 activation'
      using errcode = 'P0001';
  end if;

  select count(*) into v_profiles from public.profiles;
  select count(*) into v_season_rows from public.season_ratings;
  if v_profiles <> p_expected_profiles
     or v_season_rows <> p_expected_season_rows then
    raise exception 'progression-v2 cutover counts changed: profiles %/%, season rows %/%',
      v_profiles, p_expected_profiles, v_season_rows, p_expected_season_rows
      using errcode = '40001';
  end if;
  if exists (select 1 from private.ranked_curve_v2_cutover) then
    raise exception 'progression-v2 cutover ledger is not empty' using errcode = 'P0001';
  end if;

  v_current_season := public.current_season();
  if v_current_season is null then
    raise exception 'progression-v2 activation requires a current season'
      using errcode = 'P0001';
  end if;

  -- Capture positional/fallback NEON membership while the board still reads
  -- the unmapped v1 ladder. Numeric mapping must not erase an earned apex.
  with apex as (
    select board.player
      from private.ladder_board(v_current_season) board
     where board.apex
  ), historical as (
    select profile.id, profile.ranked_pool_tier,
           greatest(
             coalesce(profile.rating, 0),
             coalesce(max(rating.peak), 0)
           )::integer as old_peak
      from public.profiles profile
      left join public.season_ratings rating on rating.player = profile.id
     group by profile.id, profile.rating, profile.ranked_pool_tier
  )
  insert into private.ranked_curve_v2_cutover (
    player_id, old_historical_peak, old_ranked_pool_tier,
    mapped_historical_peak, was_current_apex, apex_season_id
  )
  select historical.id, historical.old_peak,
         historical.ranked_pool_tier,
         private.map_ranked_points_v1_to_v2(historical.old_peak),
         apex.player is not null,
         case when apex.player is not null then v_current_season end
    from historical
    left join apex on apex.player = historical.id;
  get diagnostics v_rows = row_count;
  if v_rows <> v_profiles then
    raise exception 'progression-v2 cutover ledger count mismatch' using errcode = '40001';
  end if;

  update public.season_ratings
     set points = private.map_ranked_points_v1_to_v2(points),
         peak = private.map_ranked_points_v1_to_v2(peak);
  get diagnostics v_rows = row_count;
  if v_rows <> v_season_rows then
    raise exception 'progression-v2 season mapping count mismatch' using errcode = '40001';
  end if;

  update public.profiles
     set rating = private.map_ranked_points_v1_to_v2(rating);
  get diagnostics v_rows = row_count;
  if v_rows <> v_profiles then
    raise exception 'progression-v2 profile mapping count mismatch' using errcode = '40001';
  end if;

  -- Preserve the complete deployed-v1 promise at activation time. The durable
  -- pool tier is authoritative even when old season evidence has been pruned,
  -- and it also captures progress earned after this migration was applied.
  insert into public.player_ranked_outcomes (
    player_id, outcome_id, grant_source
  )
  select cutover.player_id, outcome_id, 'legacy_pool'
    from private.ranked_curve_v2_cutover cutover
    cross join lateral private.legacy_ranked_outcomes_for_peak(greatest(
      cutover.old_historical_peak,
      case cutover.old_ranked_pool_tier
        when 'ivory' then 720
        when 'bone' then 300
        else 0
      end
    )) outcome_id
  on conflict (player_id, outcome_id) do nothing;
  get diagnostics v_outcome_grants = row_count;

  -- Union the clean v2 schedule. Pre-cutover apex members receive the full
  -- catch-up independently of their numeric peak, without events or debuts.
  insert into public.player_ranked_outcomes (
    player_id, outcome_id, grant_source
  )
  select cutover.player_id, outcome_id,
         case when cutover.was_current_apex
           then 'curve_v2_apex' else 'curve_v2_start' end
    from private.ranked_curve_v2_cutover cutover
    cross join lateral private.progression_v2_outcomes_for_peak(
      cutover.mapped_historical_peak, cutover.was_current_apex
    ) outcome_id
  on conflict (player_id, outcome_id) do nothing;
  get diagnostics v_inserted = row_count;
  v_outcome_grants := v_outcome_grants + v_inserted;

  insert into public.player_ranked_features (
    player_id, feature_id, grant_source
  )
  select cutover.player_id, 'equipped_runes',
         case when cutover.was_current_apex
           then 'curve_v2_apex' else 'curve_v2_milestone' end
    from private.ranked_curve_v2_cutover cutover
   where cutover.mapped_historical_peak >= 1490 or cutover.was_current_apex
  on conflict (player_id, feature_id) do nothing;
  get diagnostics v_inserted = row_count;
  v_feature_grants := v_feature_grants + v_inserted;

  insert into public.player_ranked_features (
    player_id, feature_id, grant_source
  )
  select cutover.player_id, 'weekly_challenge',
         case when cutover.was_current_apex
           then 'curve_v2_apex' else 'curve_v2_milestone' end
    from private.ranked_curve_v2_cutover cutover
   where cutover.mapped_historical_peak >= 3890 or cutover.was_current_apex
  on conflict (player_id, feature_id) do nothing;
  get diagnostics v_inserted = row_count;
  v_feature_grants := v_feature_grants + v_inserted;

  -- ranked_pool_tier remains a compatibility input to the frozen v1 start
  -- helper used under v4. Apex catch-up therefore needs Ivory authority even
  -- when a positional NEON player's numeric peak is unusually low.
  update public.profiles profile
     set ranked_pool_tier = case
       when cutover.was_current_apex or cutover.mapped_historical_peak >= 840
         then 'ivory'
       when cutover.mapped_historical_peak >= 360
            and profile.ranked_pool_tier = 'stone' then 'bone'
       else profile.ranked_pool_tier
     end
    from private.ranked_curve_v2_cutover cutover
   where cutover.player_id = profile.id;

  insert into public.player_neon_medals (player_id, season_id)
  select cutover.player_id, cutover.apex_season_id
    from private.ranked_curve_v2_cutover cutover
    join public.profiles profile on profile.id = cutover.player_id
   where cutover.was_current_apex and not profile.is_bot
  on conflict (player_id, season_id) do nothing;
  get diagnostics v_medal_grants = row_count;

  update private.ranked_runtime_contract
     set curve_version = 2,
         scoring_version = 2,
         activated_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where singleton
   returning * into strict v_contract;

  return jsonb_build_object(
    'curve_version', v_contract.curve_version,
    'scoring_version', v_contract.scoring_version,
    'admission_paused', v_contract.admission_paused,
    'profiles_mapped', v_profiles,
    'season_rows_mapped', v_season_rows,
    'outcomes_added', v_outcome_grants,
    'features_added', v_feature_grants,
    'neon_medals_added', v_medal_grants
  );
end;
$function$;
revoke all on function private.activate_progression_v2(bigint, bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.activate_progression_v2(bigint, bigint) to postgres;

create function private.progression_v2_equipped_rune_for_match(
  p_player uuid,
  p_seed text
)
returns text
language sql stable security invoker
set search_path = ''
as $function$
  select case when exists (
      select 1 from public.player_ranked_features feature
       where feature.player_id = profile.id
         and feature.feature_id = 'equipped_runes'
    ) then
      case when profile.random_rune_mode then coalesce(
        private.random_owned_rune_for_match(profile.id, p_seed),
        profile.equipped_rune
      ) else profile.equipped_rune end
    else null end
    from public.profiles profile
   where profile.id = p_player;
$function$;
revoke all on function private.progression_v2_equipped_rune_for_match(uuid, text)
  from public, anon, authenticated, service_role;

create function public.start_ranked_match_v4(
  p_requester uuid,
  p_p1 uuid,
  p_p2 uuid,
  p_seed text,
  p_next_die smallint,
  p_modifier text,
  p_season_id smallint,
  p_queued_opponent uuid,
  p_opening_col smallint,
  p_opening_die smallint,
  p_after_turn smallint,
  p_after_next_die smallint,
  p_protocol_version smallint,
  p_pool_tier text,
  p_format text,
  p_trial_offer text[],
  p_selection_deadline timestamptz,
  p_p1_auto_rune text,
  p_p2_auto_rune text,
  p_equipped_rune_protocol boolean,
  p_curve_version smallint,
  p_entry_kind text,
  p_weekly_rotation_id uuid,
  p_outcome_roster text[],
  p_reward_version smallint,
  p_claim_slot smallint,
  p_claim_rune text,
  p_bot_debut_outcome text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_contract private.ranked_runtime_contract%rowtype;
  v_started jsonb;
  v_match public.matches%rowtype;
  v_queue_count integer;
  v_expected_queue_count integer;
  v_selected_outcome text;
  v_debut private.ranked_bot_debuts%rowtype;
  v_other_is_bot boolean;
  v_p1_is_bot boolean;
  v_p2_is_bot boolean;
  v_expected_roster text[];
  v_rows integer;
begin
  select * into strict v_contract
    from private.ranked_runtime_contract where singleton for share;
  if v_contract.admission_paused then
    raise exception 'ranked admission is paused' using errcode = 'P0001';
  end if;
  if v_contract.curve_version <> 2 or v_contract.scoring_version <> 2
     or p_curve_version <> 2 or p_protocol_version <> 2 then
    raise exception 'ranked v2 start does not match active runtime contract'
      using errcode = 'P0001';
  end if;

  -- Match the frozen v3 lock order, but acquire both participant and exact
  -- queue-claim locks before inspecting any v2 snapshot metadata. A concurrent
  -- re-enqueue can no longer swap lane/rotation/CLAIM capabilities between
  -- v4 validation and v3's compare-and-delete.
  perform profile.id
    from public.profiles profile
   where profile.id in (p_p1, p_p2)
   order by profile.id
   for update;
  get diagnostics v_rows = row_count;
  if v_rows <> 2 then
    raise exception 'ranked participant profile is missing' using errcode = 'P0002';
  end if;
  select profile.is_bot into strict v_p1_is_bot
    from public.profiles profile where profile.id = p_p1;
  select profile.is_bot into strict v_p2_is_bot
    from public.profiles profile where profile.id = p_p2;
  perform queue.player_id
    from public.matchmaking_queue queue
   where queue.player_id = p_requester or queue.player_id = p_queued_opponent
   order by queue.player_id
   for update;

  if p_entry_kind not in ('ordinary','weekly')
     or p_outcome_roster is null
     or cardinality(p_outcome_roster) not between 1 and 8
     or (p_entry_kind = 'ordinary' and not ('classic' = any(p_outcome_roster)))
     or (p_entry_kind = 'weekly' and cardinality(p_outcome_roster) <> 1)
     or not p_outcome_roster <@ array[
       'classic','singlestrike','colshield','bounty','rowmult',
       'rune_trial','rowswitch','limited'
     ]::text[]
     or array_position(p_outcome_roster, null) is not null then
    raise exception 'invalid ranked v2 roster or entry kind' using errcode = '22023';
  end if;
  v_selected_outcome := case when p_format = 'rune_trial'
    then 'rune_trial' else p_modifier end;
  if not (v_selected_outcome = any(p_outcome_roster)) then
    raise exception 'selected outcome is outside negotiated roster' using errcode = '22023';
  end if;

  if p_entry_kind = 'ordinary' and p_weekly_rotation_id is not null then
    raise exception 'ordinary match carries weekly rotation' using errcode = '22023';
  elsif p_entry_kind = 'weekly' then
    if p_weekly_rotation_id is null or p_format <> 'standard'
       or not exists (
         select 1 from public.ranked_weekly_rotations rotation
          where rotation.id = p_weekly_rotation_id
            and rotation.modifier = p_modifier
            and rotation.starts_at <= clock_timestamp()
            and rotation.ends_at > clock_timestamp()
       ) then
      raise exception 'weekly match does not match active rotation' using errcode = 'P0001';
    end if;
  end if;

  if p_entry_kind = 'weekly' then
    v_expected_roster := array[p_modifier]::text[];
  else
    -- Human-vs-human is the permanent-entitlement intersection. A synthetic
    -- bot is capability-complete and inherits the human teaching roster, as
    -- the Edge policy does; its own ladder history must not relock a debut.
    select array_agg(canonical.outcome_id order by canonical.ord)
      into v_expected_roster
      from unnest(array[
        'classic','singlestrike','colshield','bounty','rowmult',
        'rune_trial','rowswitch','limited'
      ]::text[]) with ordinality canonical(outcome_id, ord)
     where (v_p1_is_bot or exists (
       select 1 from public.player_ranked_outcomes entitlement
        where entitlement.player_id = p_p1
          and entitlement.outcome_id = canonical.outcome_id
     )) and (v_p2_is_bot or exists (
       select 1 from public.player_ranked_outcomes entitlement
        where entitlement.player_id = p_p2
          and entitlement.outcome_id = canonical.outcome_id
     )) and (canonical.outcome_id <> 'rune_trial' or not exists (
       select 1 from public.matchmaking_queue queue
        where (queue.player_id = p_requester or queue.player_id = p_queued_opponent)
          and not ('rune_trial_claim_v2' = any(queue.capabilities))
     ));
  end if;
  if v_expected_roster is null
     or cardinality(p_outcome_roster) <> cardinality(v_expected_roster)
     or not (p_outcome_roster @> v_expected_roster)
     or not (v_expected_roster @> p_outcome_roster) then
    raise exception 'ranked v2 roster does not match authoritative eligibility'
      using errcode = 'P0001';
  end if;

  if p_format = 'rune_trial' then
    if p_reward_version <> 2 or p_claim_slot not between 0 and 2
       or p_claim_rune is null or p_trial_offer is null
       or p_claim_rune is distinct from p_trial_offer[p_claim_slot + 1] then
      raise exception 'Rune Trial is missing its CLAIM reward snapshot'
        using errcode = '22023';
    end if;
  elsif p_reward_version <> 1 or p_claim_slot is not null or p_claim_rune is not null then
    raise exception 'standard match carries Trial reward metadata' using errcode = '22023';
  end if;

  v_expected_queue_count := case when p_queued_opponent is null then 1 else 2 end;
  select count(*)::integer into v_queue_count
    from public.matchmaking_queue queue
   where queue.player_id = p_requester or queue.player_id = p_queued_opponent;
  if v_queue_count <> v_expected_queue_count or exists (
    select 1 from public.matchmaking_queue queue
     where (queue.player_id = p_requester or queue.player_id = p_queued_opponent)
       and (queue.curve_version <> 2
         or queue.entry_kind <> p_entry_kind
         or queue.weekly_rotation_id is distinct from p_weekly_rotation_id
         or not ('curve_v2' = any(queue.capabilities))
         or (p_format = 'rune_trial'
           and not ('rune_trial_claim_v2' = any(queue.capabilities))))
  ) then
    raise exception 'ranked queue claims do not match v2 start metadata'
      using errcode = 'P0001';
  end if;

  select is_bot into strict v_other_is_bot
    from public.profiles
   where id = case when p_requester = p_p1 then p_p2 else p_p1 end;
  if p_bot_debut_outcome is not null then
    if p_entry_kind = 'weekly' or p_queued_opponent is not null or not v_other_is_bot
       or p_bot_debut_outcome is distinct from v_selected_outcome then
      raise exception 'bot debut is not a matching bot outcome' using errcode = '22023';
    end if;
    select * into v_debut
      from private.ranked_bot_debuts debut
     where debut.player_id = p_requester and debut.status = 'pending'
     order by debut.teaching_order
     limit 1
     for update;
    if not found or v_debut.outcome_id is distinct from p_bot_debut_outcome then
      raise exception 'bot debut is not the oldest pending promise' using errcode = 'P0001';
    end if;
  end if;

  perform set_config('knucklebones.progression_v2_start', '1', true);
  v_started := public.start_ranked_match_v3(
    p_requester, p_p1, p_p2, p_seed, p_next_die, p_modifier,
    p_season_id, p_queued_opponent, p_opening_col, p_opening_die,
    p_after_turn, p_after_next_die, p_protocol_version, p_pool_tier,
    p_format, p_trial_offer, p_selection_deadline,
    p_p1_auto_rune, p_p2_auto_rune, p_equipped_rune_protocol
  );
  if coalesce((v_started->>'created')::boolean, false) then
    update public.matches match
       set curve_version = 2,
           scoring_version = 2,
           entry_kind = p_entry_kind,
           weekly_rotation_id = p_weekly_rotation_id,
           outcome_roster = p_outcome_roster,
           reward_version = p_reward_version,
           claim_slot = p_claim_slot,
           claim_rune = p_claim_rune,
           rune_rules_version = case
             when p_format = 'standard' and p_equipped_rune_protocol then 1
             else match.rune_rules_version end,
           p1_rune = case
             when p_format = 'standard' and p_equipped_rune_protocol then
               private.progression_v2_equipped_rune_for_match(match.p1, p_seed)
             else match.p1_rune end,
           p2_rune = case
             when p_format = 'standard' and p_equipped_rune_protocol then
               private.progression_v2_equipped_rune_for_match(match.p2, p_seed)
             else match.p2_rune end
     where match.id = (v_started->'match'->>'id')::uuid
     returning match.* into strict v_match;
    if p_bot_debut_outcome is not null then
      update private.ranked_bot_debuts
         set status = 'completed', started_match_id = v_match.id,
             completed_at = clock_timestamp()
       where player_id = p_requester
         and outcome_id = p_bot_debut_outcome and status = 'pending';
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception 'bot debut changed before match creation' using errcode = 'P0001';
      end if;
    end if;
    v_started := jsonb_set(v_started, '{match}', to_jsonb(v_match), false);
  end if;
  return v_started;
end;
$function$;

revoke execute on function public.start_ranked_match_v4(
  uuid, uuid, uuid, text, smallint, text, smallint, uuid,
  smallint, smallint, smallint, smallint, smallint, text, text,
  text[], timestamptz, text, text, boolean, smallint, text, uuid,
  text[], smallint, smallint, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.start_ranked_match_v4(
  uuid, uuid, uuid, text, smallint, text, smallint, uuid,
  smallint, smallint, smallint, smallint, smallint, text, text,
  text[], timestamptz, text, text, boolean, smallint, text, uuid,
  text[], smallint, smallint, text, text
) to service_role;

create function private.guard_ranked_match_snapshot_immutability()
returns trigger
language plpgsql security definer
set search_path = ''
as $function$
begin
  if current_setting('knucklebones.progression_v2_start', true) <> '1' then
    raise exception 'ranked contract snapshots are immutable' using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_ranked_match_snapshot_immutability()
  from public, anon, authenticated, service_role;
create trigger matches_guard_ranked_snapshot_immutability
before update of curve_version, scoring_version, entry_kind, weekly_rotation_id,
  outcome_roster, reward_version, claim_slot, claim_rune on public.matches
for each row
when (
  old.curve_version is distinct from new.curve_version
  or old.scoring_version is distinct from new.scoring_version
  or old.entry_kind is distinct from new.entry_kind
  or old.weekly_rotation_id is distinct from new.weekly_rotation_id
  or old.outcome_roster is distinct from new.outcome_roster
  or old.reward_version is distinct from new.reward_version
  or old.claim_slot is distinct from new.claim_slot
  or old.claim_rune is distinct from new.claim_rune
)
execute function private.guard_ranked_match_snapshot_immutability();

create or replace function private.rune_trial_payload(p_match_id uuid, p_actor uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
  v_choice private.rune_trial_choices%rowtype;
  v_yours text;
  v_opponent_committed boolean;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'match does not exist' using errcode = 'P0002';
  end if;
  if p_actor not in (v_match.p1, v_match.p2) then
    raise exception 'actor is not a match participant' using errcode = '42501';
  end if;
  if v_match.format <> 'rune_trial' then
    return jsonb_build_object('match', to_jsonb(v_match));
  end if;
  select * into strict v_choice
    from private.rune_trial_choices where match_id = p_match_id;
  if p_actor = v_match.p1 then
    v_yours := v_choice.p1_choice;
    v_opponent_committed := v_choice.p2_choice is not null;
  else
    v_yours := v_choice.p2_choice;
    v_opponent_committed := v_choice.p1_choice is not null;
  end if;
  return jsonb_build_object(
    'match', to_jsonb(v_match),
    'trial', jsonb_build_object(
      'offer', to_jsonb(v_match.trial_offer),
      'phase', v_match.phase,
      'deadline', to_jsonb(v_match.selection_deadline),
      'your_choice', v_yours,
      'opponent_committed', v_opponent_committed,
      'reward_version', v_match.reward_version,
      'claim_slot', v_match.claim_slot,
      'claim_rune', v_match.claim_rune
    )
  );
end;
$function$;
revoke all on function private.rune_trial_payload(uuid, uuid)
  from public, anon, authenticated, service_role;

create function private.grant_ranked_progression_v2(
  p_player uuid,
  p_peak integer,
  p_apex boolean,
  p_source_match uuid,
  p_create_debuts boolean
)
returns text[]
language plpgsql security invoker
set search_path = ''
as $function$
declare
  v_grants text[];
  v_source text := case when p_apex then 'curve_v2_apex' else 'curve_v2_milestone' end;
begin
  with inserted as (
    insert into public.player_ranked_outcomes (
      player_id, outcome_id, grant_source, source_match_id
    )
    select p_player, outcome_id, v_source, p_source_match
      from private.progression_v2_outcomes_for_peak(p_peak, p_apex) outcome_id
    on conflict (player_id, outcome_id) do nothing
    returning outcome_id
  )
  select coalesce(array_agg(outcome_id order by case outcome_id
      when 'classic' then 1 when 'singlestrike' then 2
      when 'colshield' then 3 when 'bounty' then 4
      when 'rowmult' then 5 when 'rune_trial' then 6
      when 'rowswitch' then 7 when 'limited' then 8 end), '{}'::text[])
    into v_grants from inserted;
  if p_apex or p_peak >= 1490 then
    insert into public.player_ranked_features (
      player_id, feature_id, grant_source, source_match_id
    ) values (p_player, 'equipped_runes', v_source, p_source_match)
    on conflict (player_id, feature_id) do nothing;
  end if;
  if p_apex or p_peak >= 3890 then
    insert into public.player_ranked_features (
      player_id, feature_id, grant_source, source_match_id
    ) values (p_player, 'weekly_challenge', v_source, p_source_match)
    on conflict (player_id, feature_id) do nothing;
  end if;
  if p_create_debuts then
    insert into private.ranked_bot_debuts (
      player_id, outcome_id, teaching_order, source_match_id
    )
    select p_player, grant_id,
           case grant_id when 'rowmult' then 1 when 'rune_trial' then 2
             when 'rowswitch' then 3 when 'limited' then 4 end,
           p_source_match
      from unnest(v_grants) grant_id
     where grant_id in ('rowmult','rune_trial','rowswitch','limited')
    on conflict (player_id, outcome_id) do nothing;
  end if;
  return v_grants;
end;
$function$;
revoke all on function private.grant_ranked_progression_v2(
  uuid, integer, boolean, uuid, boolean
) from public, anon, authenticated, service_role;

-- The auth/profile trigger necessarily runs before mint_bot assigns its target
-- rating. Keep deployed v1 behavior frozen, but once v2 is active make the
-- synthetic opponent's durable authority agree with the rating it was minted
-- to. Bots receive no teaching debut, progression event, or NEON medal.
create or replace function public.mint_bot(target_rating integer)
returns uuid
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_uid uuid := gen_random_uuid();
  v_curve smallint;
begin
  select curve_version into strict v_curve
    from private.ranked_runtime_contract where singleton for share;

  insert into auth.users (
    instance_id, id, aud, role, email, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid,
    'authenticated', 'authenticated',
    'bot-' || v_uid || '@internal.invalid', now(), now()
  );
  update public.profiles
     set is_bot = true,
         rating = target_rating,
         avatar = 'die:' ||
           (1 + (abs(pg_catalog.hashtext(v_uid::text)) % 6))::text || ':' ||
           (array['cy','mg','gold','green','violet','orange'])[
             1 + ((abs(pg_catalog.hashtext(v_uid::text)) / 6) % 6)
           ],
         ranked_pool_tier = case when v_curve = 2
           then private.ranked_pool_tier_for_peak_version(target_rating, 2::smallint)
           else ranked_pool_tier end
   where id = v_uid;

  if v_curve = 2 then
    perform private.grant_ranked_progression_v2(
      v_uid, target_rating, false, null, false
    );
  end if;
  return v_uid;
end;
$function$;
revoke all on function public.mint_bot(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.mint_bot(integer) to service_role;

-- Preserve the exact deployed v1 implementation behind the same public
-- eleven-argument boundary. The move and replacement occur in this migration
-- transaction, so no applied schema state ever lacks public.settle_match().
alter function public.settle_match(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) rename to settle_match_progression_v1_locked;
alter function public.settle_match_progression_v1_locked(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) set schema private;
revoke all on function private.settle_match_progression_v1_locked(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;

create function public.settle_match(
  p_match_id uuid,
  p_status text,
  p_winner uuid,
  p_p1_score integer,
  p_p2_score integer,
  p_p1_delta integer,
  p_p2_delta integer,
  p_expected_p1 jsonb,
  p_expected_p2 jsonb,
  p_next_p1 jsonb,
  p_next_p2 jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $function$
begin
  return private.settle_match_progression_v1_locked(
    p_match_id, p_status, p_winner, p_p1_score, p_p2_score,
    p_p1_delta, p_p2_delta,
    p_expected_p1, p_expected_p2, p_next_p1, p_next_p2
  );
end;
$function$;
revoke execute on function public.settle_match(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.settle_match(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) to service_role;

create function private.apply_claim_reward_v2_locked(
  p_match_id uuid,
  p_winner uuid
)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
  v_selected text;
  v_inserted text;
  v_bot_equipped text;
begin
  if p_winner is null then return null; end if;
  select * into strict v_match from public.matches where id = p_match_id;
  if v_match.format <> 'rune_trial' then return null; end if;
  if v_match.reward_version <> 2 or v_match.claim_rune is null then
    raise exception 'CLAIM Trial is missing immutable reward authority'
      using errcode = '23514';
  end if;
  v_selected := case when p_winner = v_match.p1
    then v_match.p1_rune when p_winner = v_match.p2 then v_match.p2_rune end;
  if v_selected is null then
    raise exception 'settled Rune Trial has no winner assignment'
      using errcode = '23514';
  end if;
  if v_selected <> v_match.claim_rune then return null; end if;
  insert into public.player_runes (player_id, rune_id, source_match_id)
  values (p_winner, v_match.claim_rune, p_match_id)
  on conflict (player_id, rune_id) do nothing returning rune_id into v_inserted;
  select private.bot_owned_rune_choice(id) into v_bot_equipped
    from public.profiles
   where id = p_winner and is_bot and equipped_rune is null;
  if v_bot_equipped is not null then
    update public.profiles set equipped_rune = v_bot_equipped
     where id = p_winner and is_bot and equipped_rune is null;
  end if;
  return jsonb_build_object(
    'rune_id', v_match.claim_rune,
    'newly_collected', v_inserted is not null
  );
end;
$function$;
revoke all on function private.apply_claim_reward_v2_locked(uuid, uuid)
  from public, anon, authenticated, service_role;

create function private.record_progression_v2_player_locked(
  p_player uuid,
  p_source_match uuid,
  p_season smallint,
  p_expected jsonb,
  p_next jsonb,
  p_apex_before boolean,
  p_apex_after boolean,
  p_pool_before text,
  p_equipped_before text,
  p_random_before boolean,
  p_rune_before boolean,
  p_weekly_before boolean,
  p_is_bot boolean
)
returns void
language plpgsql security invoker
set search_path = ''
as $function$
declare
  v_grants text[];
  v_tier text;
  v_pool_after text;
  v_equipped_after text;
  v_random_after boolean;
  v_rune_after boolean;
  v_weekly_after boolean;
  v_medal boolean := false;
  v_inserted uuid;
begin
  v_grants := private.grant_ranked_progression_v2(
    p_player, (p_next->>'peak')::integer, p_apex_before or p_apex_after,
    p_source_match, not p_is_bot
  );
  v_tier := case when p_apex_before or p_apex_after then 'ivory'
    else private.ranked_pool_tier_for_peak_version(
      (p_next->>'peak')::integer, 2::smallint
    ) end;
  update public.profiles set ranked_pool_tier = case
      when ranked_pool_tier = 'ivory' or v_tier = 'ivory' then 'ivory'
      when ranked_pool_tier = 'bone' or v_tier = 'bone' then 'bone'
      else 'stone' end
   where id = p_player
   returning ranked_pool_tier, equipped_rune, random_rune_mode
     into strict v_pool_after, v_equipped_after, v_random_after;
  select exists (select 1 from public.player_ranked_features
    where player_id = p_player and feature_id = 'equipped_runes')
    into v_rune_after;
  select exists (select 1 from public.player_ranked_features
    where player_id = p_player and feature_id = 'weekly_challenge')
    into v_weekly_after;
  if (p_apex_before or p_apex_after) and not p_is_bot then
    insert into public.player_neon_medals (player_id, season_id, source_match_id)
    values (p_player, p_season, p_source_match)
    on conflict (player_id, season_id) do nothing returning player_id into v_inserted;
    v_medal := v_inserted is not null;
  end if;
  if not p_is_bot then
    insert into public.ranked_progression_events (
      player_id, source_match_id, season_id,
      points_before, points_after, apex_before, apex_after,
      pool_tier_before, pool_tier_after,
      equipped_rune_before, equipped_rune_after,
      random_rune_mode_before, random_rune_mode_after,
      rune_seat_active_before, rune_seat_active_after,
      curve_version, outcome_grants, weekly_unlocked_before,
      weekly_unlocked_after, neon_medal_granted
    ) values (
      p_player, p_source_match, p_season,
      (p_expected->>'points')::integer, (p_next->>'points')::integer,
      p_apex_before, p_apex_after,
      p_pool_before, v_pool_after,
      p_equipped_before, v_equipped_after,
      p_random_before, v_random_after,
      p_rune_before, v_rune_after,
      2, v_grants, p_weekly_before, v_weekly_after, v_medal
    ) on conflict (source_match_id, player_id) do nothing;
  end if;
end;
$function$;
revoke all on function private.record_progression_v2_player_locked(
  uuid, uuid, smallint, jsonb, jsonb, boolean, boolean,
  text, text, boolean, boolean, boolean, boolean
) from public, anon, authenticated, service_role;

-- Formula-v2 settlement branches before the frozen v1 wrapper. It calls the
-- shared compare-and-swap exactly once, then performs only v2 post-CAS work;
-- a CLAIM match therefore can neither receive the old selected-rune reward
-- nor collide with a v1 progression event.
create function private.settle_match_progression_v2_locked(
  p_match_id uuid,
  p_status text,
  p_winner uuid,
  p_p1_score integer,
  p_p2_score integer,
  p_p1_delta integer,
  p_p2_delta integer,
  p_expected_p1 jsonb,
  p_expected_p2 jsonb,
  p_next_p1 jsonb,
  p_next_p2 jsonb
)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
  v_result jsonb;
  v_reward jsonb;
  v_season smallint;
  v_p1_base integer;
  v_p2_base integer;
  v_p1_finish integer;
  v_p2_finish integer;
  v_forced_magnitude integer;
  v_p1_apex_before boolean;
  v_p2_apex_before boolean;
  v_p1_apex_after boolean;
  v_p2_apex_after boolean;
  v_p1_pool_before text;
  v_p2_pool_before text;
  v_p1_equipped_before text;
  v_p2_equipped_before text;
  v_p1_random_before boolean;
  v_p2_random_before boolean;
  v_p1_rune_before boolean;
  v_p2_rune_before boolean;
  v_p1_weekly_before boolean;
  v_p2_weekly_before boolean;
  v_p1_is_bot boolean;
  v_p2_is_bot boolean;
begin
  select * into v_match
    from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match % does not exist', p_match_id using errcode = 'P0002';
  end if;
  if v_match.curve_version <> 2 or v_match.scoring_version <> 2
     or (v_match.format = 'rune_trial' and v_match.reward_version <> 2)
     or (v_match.format <> 'rune_trial' and v_match.reward_version <> 1) then
    raise exception 'match does not carry a complete progression-v2 contract'
      using errcode = '23514';
  end if;

  perform id
    from public.profiles
   where id in (v_match.p1, v_match.p2)
   order by id
   for update;

  if v_match.status = 'active'
     and v_match.format = 'rune_trial'
     and v_match.phase = 'selection' then
    v_match := private.finalize_rune_trial_locked(p_match_id, true);
  end if;
  if v_match.pending_aim is not null then
    update public.matches set pending_aim = null
     where id = p_match_id returning * into strict v_match;
  end if;

  if coalesce(p_next_p1->>'_scoring_version', '') <> '2'
     or coalesce(p_next_p2->>'_scoring_version', '') <> '2'
     or coalesce(p_next_p1->>'_base_rating_delta', '') !~ '^-?[0-9]+$'
     or coalesce(p_next_p2->>'_base_rating_delta', '') !~ '^-?[0-9]+$'
     or coalesce(p_next_p1->>'_finish_rating_delta', '') !~ '^-?[0-9]+$'
     or coalesce(p_next_p2->>'_finish_rating_delta', '') !~ '^-?[0-9]+$' then
    raise exception 'formula-v2 settlement component metadata is missing or invalid'
      using errcode = '22023';
  end if;
  v_p1_base := (p_next_p1->>'_base_rating_delta')::integer;
  v_p2_base := (p_next_p2->>'_base_rating_delta')::integer;
  v_p1_finish := (p_next_p1->>'_finish_rating_delta')::integer;
  v_p2_finish := (p_next_p2->>'_finish_rating_delta')::integer;
  if p_p1_delta is null or p_p2_delta is null
     or p_p1_delta <> v_p1_base + v_p1_finish
     or p_p2_delta <> v_p2_base + v_p2_finish
     or v_p1_finish <> -v_p2_finish
     or abs(v_p1_finish) > 7 then
    raise exception 'formula-v2 settlement components do not match signed totals'
      using errcode = '22023';
  end if;
  if p_winner is null then
    if v_p1_finish <> 0 or v_p2_finish <> 0 then
      raise exception 'a non-decisive result cannot transfer finish points'
        using errcode = '22023';
    end if;
  elsif p_winner = v_match.p1 then
    if v_p1_finish < 0 or v_p2_finish > 0 then
      raise exception 'finish transfer signs do not match the winner'
        using errcode = '22023';
    end if;
  elsif p_winner = v_match.p2 then
    if v_p2_finish < 0 or v_p1_finish > 0 then
      raise exception 'finish transfer signs do not match the winner'
        using errcode = '22023';
    end if;
  else
    raise exception 'winner is not a match participant' using errcode = '22023';
  end if;
  if p_status = 'forfeit' and p_winner is not null then
    if p_winner = v_match.p1 then
      v_forced_magnitude := least(
        7,
        greatest(0, 120 - abs(v_p2_base)),
        greatest(0, (p_expected_p2->>'points')::integer + v_p2_base)
      );
      if v_p1_finish <> v_forced_magnitude
         or v_p2_finish <> -v_forced_magnitude then
        raise exception 'forced finish transfer does not match the funded cap'
          using errcode = '22023';
      end if;
    else
      v_forced_magnitude := least(
        7,
        greatest(0, 120 - abs(v_p1_base)),
        greatest(0, (p_expected_p1->>'points')::integer + v_p1_base)
      );
      if v_p2_finish <> v_forced_magnitude
         or v_p1_finish <> -v_forced_magnitude then
        raise exception 'forced finish transfer does not match the funded cap'
          using errcode = '22023';
      end if;
    end if;
  end if;

  v_season := coalesce(v_match.season_id, 1);
  -- Serialize one season's apex read/change/read window. Otherwise two
  -- disjoint matches could both observe a transient ladder position and make
  -- the durable NEON award depend on statement interleaving.
  perform pg_catalog.pg_advisory_xact_lock(1263559502, v_season::integer);
  select profile.ranked_pool_tier, profile.equipped_rune,
         profile.random_rune_mode, profile.is_bot
    into strict v_p1_pool_before, v_p1_equipped_before,
                v_p1_random_before, v_p1_is_bot
    from public.profiles profile where profile.id = v_match.p1;
  select profile.ranked_pool_tier, profile.equipped_rune,
         profile.random_rune_mode, profile.is_bot
    into strict v_p2_pool_before, v_p2_equipped_before,
                v_p2_random_before, v_p2_is_bot
    from public.profiles profile where profile.id = v_match.p2;
  select exists (
    select 1 from public.player_ranked_features feature
     where feature.player_id = v_match.p1 and feature.feature_id = 'equipped_runes'
  ) into v_p1_rune_before;
  select exists (
    select 1 from public.player_ranked_features feature
     where feature.player_id = v_match.p2 and feature.feature_id = 'equipped_runes'
  ) into v_p2_rune_before;
  select exists (
    select 1 from public.player_ranked_features feature
     where feature.player_id = v_match.p1 and feature.feature_id = 'weekly_challenge'
  ) into v_p1_weekly_before;
  select exists (
    select 1 from public.player_ranked_features feature
     where feature.player_id = v_match.p2 and feature.feature_id = 'weekly_challenge'
  ) into v_p2_weekly_before;
  v_p1_apex_before := coalesce((
    select board.apex from private.ladder_board(v_season) board
     where board.player = v_match.p1
  ), false);
  v_p2_apex_before := coalesce((
    select board.apex from private.ladder_board(v_season) board
     where board.player = v_match.p2
  ), false);

  v_result := private.apply_settlement_locked(
    p_match_id, p_status, p_winner, p_p1_score, p_p2_score,
    p_p1_delta, p_p2_delta,
    p_expected_p1, p_expected_p2, p_next_p1, p_next_p2
  );
  if not coalesce((v_result->>'applied')::boolean, false) then
    return v_result;
  end if;

  update public.matches
     set p1_base_rating_delta = v_p1_base,
         p2_base_rating_delta = v_p2_base,
         p1_finish_rating_delta = v_p1_finish,
         p2_finish_rating_delta = v_p2_finish
   where id = p_match_id
   returning * into strict v_match;
  v_result := jsonb_set(v_result, '{match}', to_jsonb(v_match), false);

  v_reward := private.apply_claim_reward_v2_locked(p_match_id, p_winner);
  if v_reward is not null then
    v_result := v_result || jsonb_build_object('reward', v_reward);
  end if;

  if v_match.entry_kind = 'weekly' and p_winner is not null
     and ((p_winner = v_match.p1 and not v_p1_is_bot)
       or (p_winner = v_match.p2 and not v_p2_is_bot)) then
    insert into public.ranked_weekly_completions (
      player_id, rotation_id, source_match_id
    ) values (p_winner, v_match.weekly_rotation_id, p_match_id)
    on conflict (player_id, rotation_id) do nothing;
  end if;

  v_p1_apex_after := coalesce((
    select board.apex from private.ladder_board(v_season) board
     where board.player = v_match.p1
  ), false);
  v_p2_apex_after := coalesce((
    select board.apex from private.ladder_board(v_season) board
     where board.player = v_match.p2
  ), false);

  perform private.record_progression_v2_player_locked(
    v_match.p1, p_match_id, v_season, p_expected_p1, p_next_p1,
    v_p1_apex_before, v_p1_apex_after,
    v_p1_pool_before, v_p1_equipped_before, v_p1_random_before,
    v_p1_rune_before, v_p1_weekly_before, v_p1_is_bot
  );
  perform private.record_progression_v2_player_locked(
    v_match.p2, p_match_id, v_season, p_expected_p2, p_next_p2,
    v_p2_apex_before, v_p2_apex_after,
    v_p2_pool_before, v_p2_equipped_before, v_p2_random_before,
    v_p2_rune_before, v_p2_weekly_before, v_p2_is_bot
  );
  return v_result;
end;
$function$;
revoke all on function private.settle_match_progression_v2_locked(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.settle_match(
  p_match_id uuid,
  p_status text,
  p_winner uuid,
  p_p1_score integer,
  p_p2_score integer,
  p_p1_delta integer,
  p_p2_delta integer,
  p_expected_p1 jsonb,
  p_expected_p2 jsonb,
  p_next_p1 jsonb,
  p_next_p2 jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_match public.matches%rowtype;
  v_result jsonb;
begin
  select * into v_match
    from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match % does not exist', p_match_id using errcode = 'P0002';
  end if;

  if v_match.curve_version = 1 and v_match.scoring_version = 1
     and v_match.reward_version = 1 then
    v_result := private.settle_match_progression_v1_locked(
      p_match_id, p_status, p_winner, p_p1_score, p_p2_score,
      p_p1_delta, p_p2_delta,
      p_expected_p1, p_expected_p2, p_next_p1, p_next_p2
    );
    if coalesce((v_result->>'applied')::boolean, false) then
      update public.matches
         set p1_base_rating_delta = p_p1_delta,
             p2_base_rating_delta = p_p2_delta,
             p1_finish_rating_delta = 0,
             p2_finish_rating_delta = 0
       where id = p_match_id
       returning * into strict v_match;
      v_result := jsonb_set(v_result, '{match}', to_jsonb(v_match), false);
    end if;
    return v_result;
  end if;

  if v_match.curve_version = 2 and v_match.scoring_version = 2 then
    return private.settle_match_progression_v2_locked(
      p_match_id, p_status, p_winner, p_p1_score, p_p2_score,
      p_p1_delta, p_p2_delta,
      p_expected_p1, p_expected_p2, p_next_p1, p_next_p2
    );
  end if;
  raise exception 'match curve/scoring versions are inconsistent'
    using errcode = '23514';
end;
$function$;
revoke execute on function public.settle_match(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.settle_match(
  uuid, text, uuid, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb
) to service_role;

create function public.ranked_player_matchmaking_access(p_player uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'outcomes', coalesce((
      select jsonb_agg(outcome_id order by case outcome_id
        when 'classic' then 1 when 'singlestrike' then 2
        when 'colshield' then 3 when 'bounty' then 4
        when 'rowmult' then 5 when 'rune_trial' then 6
        when 'rowswitch' then 7 when 'limited' then 8 end)
        from public.player_ranked_outcomes where player_id = p_player
    ), '[]'::jsonb),
    'pending_bot_debut', (
      select outcome_id from private.ranked_bot_debuts
       where player_id = p_player and status = 'pending'
       order by teaching_order limit 1
    ),
    'weekly_unlocked', exists (
      select 1 from public.player_ranked_features
       where player_id = p_player and feature_id = 'weekly_challenge'
    )
  );
$function$;
revoke execute on function public.ranked_player_matchmaking_access(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ranked_player_matchmaking_access(uuid) to service_role;

commit;

-- QUEUE LIVENESS IS NOT QUEUE AGE.
--
-- public.matchmaking_queue.created_at is the player's PLACE IN LINE:
-- findOldestEligiblePartner (pvp-join/matchmaking.ts) reads the queue oldest
-- first, and enqueue_ranked_player's `on conflict do nothing` deliberately
-- leaves it alone so re-polling never costs a player their position.
--
-- pvp-join's stale sweep then measured abandonment with that same column, and
-- the two meanings do not fit in one number:
--
--   · A ROW OUTLIVES ITS CLIENT BY UP TO THE WHOLE WINDOW. The client re-calls
--     pvp-join every 2.5s (queue-screen.ts) but created_at never moves, so a
--     player whose app was killed 30s ago is indistinguishable from one who
--     joined 30s ago. The sweep could only wait out the full window before
--     removing them, and until it did they were matchable — a real player
--     could be paired against a seat nobody was sitting in.
--   · A LONG WAITER LOST THEIR PLACE, EVERY WINDOW. The sweep runs BEFORE the
--     caller is enqueued, so a player waiting longer than the window had their
--     own row deleted by their own next poll and re-inserted with a fresh
--     created_at. The one player who had waited longest was the one being sent
--     to the back of the line, repeatedly, and the queue could never age.
--
-- So liveness gets its own column, and the table stamps it rather than any
-- caller: a trigger cannot be forgotten by a new enqueue path the way a line
-- in one RPC body can, and every writer — v2, v3, whatever follows — refreshes
-- it for free. created_at goes back to meaning only what it says.
--
-- NO CLIENT CHANGE, AND NONE POSSIBLE TO MISS: the refresh happens server-side
-- on a request every installed build already makes every 2.5 seconds, so this
-- needs no capability negotiation and no phased release
-- (docs/CLIENT_COMPATIBILITY.md) — an app from before this migration is
-- protected by it on its next poll.

alter table public.matchmaking_queue
  add column last_seen_at timestamptz not null default now();

comment on column public.matchmaking_queue.last_seen_at is
  'When the client last proved it was still waiting. Stamped by the table on '
  'every write; created_at remains the queue position.';

comment on column public.matchmaking_queue.created_at is
  'Queue position. Never refreshed by a re-join: matchmaking reads oldest '
  'first. Abandonment is measured with last_seen_at.';

create function private.stamp_ranked_queue_liveness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- clock_timestamp(), not now(): now() is the TRANSACTION start, and the
  -- sweep in the same request runs before this, so a transaction timestamp
  -- would date the heartbeat to before the sweep it is meant to survive.
  new.last_seen_at := clock_timestamp();
  return new;
end;
$function$;

-- Fires after matchmaking_queue_guard_ranked_admission by name order, which is
-- what we want: an admission the guard refuses must not be stamped alive.
create trigger matchmaking_queue_stamp_liveness
before update on public.matchmaking_queue
for each row execute function private.stamp_ranked_queue_liveness();

-- The sweep reads it on every join; the queue is small, but the index keeps
-- that a range scan rather than a seq scan as the ladder grows.
create index if not exists matchmaking_queue_last_seen_at_idx
  on public.matchmaking_queue (last_seen_at);

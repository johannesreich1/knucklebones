begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

/* WHAT THIS FILE PROTECTS: created_at is the queue POSITION and last_seen_at is
   the client's PULSE, and the whole point of splitting them is that a re-join
   must move exactly one of the two. Nothing asserted either before — the stale
   window lived only in pvp-join's TypeScript, so the fact that a long waiter's
   own poll deleted and re-inserted their row, sending them to the back of the
   line every window, was invisible to every test in the repository. */

select has_column('public', 'matchmaking_queue', 'last_seen_at',
  'the queue records when its client was last heard from');
select col_not_null('public', 'matchmaking_queue', 'last_seen_at',
  'a queue row without a pulse would be swept or immortal, never merely absent');
select col_has_default('public', 'matchmaking_queue', 'last_seen_at',
  'joining IS being seen, so the insert needs no cooperation from the caller');
select has_trigger('public', 'matchmaking_queue', 'matchmaking_queue_stamp_liveness',
  'the TABLE stamps the pulse, so no enqueue path can forget to');

insert into auth.users (id, email, created_at, updated_at)
values ('8a000000-0000-0000-0000-000000000001', 'liveness-1@example.invalid', now(), now()),
       ('8a000000-0000-0000-0000-000000000002', 'liveness-2@example.invalid', now(), now());

/* A player who joined a while ago: created_at and last_seen_at both back-dated,
   the way a row looks after a genuine wait. */
insert into public.matchmaking_queue (player_id, created_at, last_seen_at)
values ('8a000000-0000-0000-0000-000000000001', now() - interval '4 minutes',
        now() - interval '4 minutes'),
       ('8a000000-0000-0000-0000-000000000002', now() - interval '4 minutes',
        now() - interval '4 minutes');

create temporary table liveness_before as
select player_id, created_at, last_seen_at from public.matchmaking_queue
 where player_id in ('8a000000-0000-0000-0000-000000000001',
                     '8a000000-0000-0000-0000-000000000002');

/* THE POLL. Exactly the columns enqueue_ranked_player_v3 writes on every
   re-join, which is what an installed client sends every 2.5 seconds. */
update public.matchmaking_queue
   set protocol_version = 2, capabilities = array['curve_v2']::text[],
       pool_tier = 'stone', entry_kind = 'ordinary'
 where player_id = '8a000000-0000-0000-0000-000000000001';

select ok(
  (select q.last_seen_at > b.last_seen_at
     from public.matchmaking_queue q join liveness_before b using (player_id)
    where q.player_id = '8a000000-0000-0000-0000-000000000001'),
  'a re-join proves the client is still there'
);
select ok(
  (select q.created_at = b.created_at
     from public.matchmaking_queue q join liveness_before b using (player_id)
    where q.player_id = '8a000000-0000-0000-0000-000000000001'),
  'and does NOT cost the player their place in line'
);
/* The trigger stamps clock_timestamp(), the instant of the write, rather than
   now(), the transaction start. This assertion pins only that the stamp is
   RECENT: it would pass under now() too, because pgTAP runs this file in one
   transaction and a pvp-join request does NOT — its sweep and its enqueue are
   separate PostgREST requests, so now() would serve production as well. The
   wall clock is kept as the stricter meaning of a pulse, not as a fix. */
select ok(
  (select last_seen_at > now() - interval '1 second'
     from public.matchmaking_queue
    where player_id = '8a000000-0000-0000-0000-000000000001'),
  'the pulse is fresh after the re-join, not the back-dated value it replaced'
);
select ok(
  (select q.last_seen_at = b.last_seen_at
     from public.matchmaking_queue q join liveness_before b using (player_id)
    where q.player_id = '8a000000-0000-0000-0000-000000000002'),
  'a player who said nothing is not credited with a pulse by someone else''s poll'
);

/* THE SWEEP, as pvp-join now issues it. The still-waiting player survives it;
   the silent one does not — and under the old created_at rule BOTH would have
   gone, the live player included, losing the queue position this file just
   proved was preserved. */
delete from public.matchmaking_queue
 where last_seen_at < now() - interval '30 seconds'
   and player_id in ('8a000000-0000-0000-0000-000000000001',
                     '8a000000-0000-0000-0000-000000000002');
select results_eq(
  $$select player_id::text from public.matchmaking_queue
     where player_id in ('8a000000-0000-0000-0000-000000000001',
                         '8a000000-0000-0000-0000-000000000002')$$,
  $$values ('8a000000-0000-0000-0000-000000000001')$$,
  'the liveness sweep takes the abandoned seat and leaves the waiting one'
);

select * from finish();
rollback;

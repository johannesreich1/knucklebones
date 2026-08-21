-- Leaving the queue is the CLIENT's move, so it needs the right to make it:
-- Cancel (and the new hide-the-app abort) only stopped the POLLING, while the
-- server-side queue row sat claimable for up to QUEUE_STALE_MS — a player who
-- walked away could still be pulled into a match they would never see, which
-- their opponent then wins off a 30s stall (user report: going afk in the
-- queue). Deleting one's OWN row is the whole grant; nobody can touch
-- another's, and pvp-join's service role is untouched.
create policy queue_delete_own on public.matchmaking_queue
  for delete to authenticated using (player_id = (select auth.uid()));
grant delete on public.matchmaking_queue to authenticated;

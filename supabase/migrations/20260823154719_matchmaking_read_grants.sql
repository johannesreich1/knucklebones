-- pvp-join reads both helpers through its service-role client. Their original
-- migrations revoked PUBLIC execution but only restored the browser roles,
-- so fresh matchmaking failed before a player could enter the queue.
begin;

grant execute on function public.current_season()
  to service_role;
grant execute on function public.players_near(uuid, integer)
  to service_role;

commit;

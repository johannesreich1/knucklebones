-- LIMITED mode: the dice bag is finite (every face exactly 4 times). The
-- modifier CHECK must accept the new id BEFORE pvp-join ever deals it.
alter table matches drop constraint if exists matches_modifier_check;
alter table matches add constraint matches_modifier_check
  check (modifier = any (array['classic','rowswitch','rowmult','colshield','singlestrike','bounty','limited']));;

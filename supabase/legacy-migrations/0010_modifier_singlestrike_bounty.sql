-- Extend the mode wheel: SINGLE STRIKE (one die falls — the centre-closest)
-- and BOUNTY (each destroyed die banks a permanent +1) join the allowed
-- modifiers. Ids are stable API — never rename a value stored matches use.
alter table public.matches drop constraint matches_modifier_check;
alter table public.matches add constraint matches_modifier_check
  check (modifier in ('classic', 'rowswitch', 'rowmult', 'colshield', 'singlestrike', 'bounty'));

-- extend the mode wheel: SINGLE STRIKE and BOUNTY join the allowed modifiers
alter table public.matches drop constraint matches_modifier_check;
alter table public.matches add constraint matches_modifier_check
  check (modifier in ('classic', 'rowswitch', 'rowmult', 'colshield', 'singlestrike', 'bounty'));;

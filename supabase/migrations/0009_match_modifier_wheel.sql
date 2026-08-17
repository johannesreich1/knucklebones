-- The ranked mode wheel: each match carries its modifier, picked server-side
-- as a deterministic draw from the match seed (core/modes.ts pickMode).
-- Ids are stable API: never rename a value that stored matches reference.
alter table public.matches
  add column modifier text not null default 'classic'
  constraint matches_modifier_check
  check (modifier in ('classic', 'rowswitch', 'rowmult', 'colshield'));

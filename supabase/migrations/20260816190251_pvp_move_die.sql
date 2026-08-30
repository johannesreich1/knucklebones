-- Each logged move records the die it placed. Past dice are public knowledge
-- (both players watched them); this lets a client rebuild board state from
-- the log alone after missed realtime events. FUTURE dice remain secret in
-- match_seeds.
alter table public.match_moves add column die smallint check (die between 1 and 6);;

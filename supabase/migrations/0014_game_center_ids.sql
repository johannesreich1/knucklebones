-- Game Center identities: the map from Apple's player id to a player here.
--
-- NOT applied yet — it waits on a signed iOS build to exercise it (see
-- supabase/functions/gc-auth). Nothing else in the schema references this
-- table, so applying it early would be harmless but pointless.
--
-- No policies and no grants: this table is service-role only. A player has no
-- business reading the mapping — not even their own row — and gc-auth is the
-- only thing that ever writes it. RLS stays ON so that a future grant can
-- never accidentally expose it.
create table if not exists public.game_center_ids (
  player_id text primary key,                        -- Apple's gamePlayerID or teamPlayerID
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.game_center_ids enable row level security;

-- user_id is UNIQUE on purpose: one account per Game Center identity. Without
-- it a bug in gc-auth could quietly attach two Apple accounts to one player and
-- there would be no way to tell which career belonged to whom.

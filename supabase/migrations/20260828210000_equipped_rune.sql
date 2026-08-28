-- THE EQUIPPED RUNE: one collected rune a player carries into ranked from
-- SILVER upward. Design study 52d (EQ4 — the ring socket) is the selected
-- shape; this is the state behind it.
--
-- Ownership is enforced BY THE DATABASE, not by the client. player_runes'
-- primary key is exactly (player_id, rune_id), so a composite foreign key on
-- (id, equipped_rune) makes "equip a rune you do not own" unrepresentable
-- rather than merely refused by an RPC somebody could route around. A NULL
-- equipped_rune is not checked at all (MATCH SIMPLE), which is what "nothing
-- equipped" should be: a legitimate choice, not a violation.
alter table public.profiles
  add column if not exists equipped_rune text;

-- ON DELETE SET NULL names the column deliberately. The default form would
-- null EVERY column of the key, and the first of those is `id`, the profile's
-- own primary key. Losing a rune must clear the seat, never the account.
alter table public.profiles
  drop constraint if exists profiles_equipped_rune_owned;
alter table public.profiles
  add constraint profiles_equipped_rune_owned
  foreign key (id, equipped_rune)
  references public.player_runes (player_id, rune_id)
  on delete set null (equipped_rune)
  on update cascade;

-- The registry check is duplicated from player_runes on purpose: the foreign
-- key already implies it, and a reader of this column should not have to
-- follow the key to learn what values are legal.
alter table public.profiles
  drop constraint if exists profiles_equipped_rune_known;
alter table public.profiles
  add constraint profiles_equipped_rune_known
  check (equipped_rune is null
    or equipped_rune in ('fate','nudge','ward','sunder','pilfer','anvil'));

comment on column public.profiles.equipped_rune is
  'The one collected rune carried into ordinary ranked from SILVER upward. '
  'NULL means nothing equipped, which is a deliberate choice and not an error. '
  'Rune Trial ignores this and never overwrites it — it loans its own offer.';

-- Equipping is a WRITE THE SERVER OWNS. profiles_update_own already lets a
-- player update their own row, and the composite key above means the worst a
-- forged request can do is name a rune they hold. That is the whole threat
-- model for this column, so no RPC is needed: the constraint is the check.
--
-- What is NOT here, deliberately: nothing reads this column into a match yet.
-- Dealing an equipped rune into ordinary ranked is a server-authoritative
-- change to match creation, and it lands only once the balance question is
-- answered — the roster was measured against a BARE twin, never against
-- itself, so equipped-vs-equipped and equipped-vs-bare are both unmeasured.
-- Until then this stores and shows a choice that does not yet enter play,
-- which is exactly what the SILVER gate in the UI says it does.

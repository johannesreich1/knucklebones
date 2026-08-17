# Stage 3 — Backend design (Supabase)

Status: **SUPERSEDED IN PART by the PvP pivot (2026-08-16)** — the owner's
decision: solo/AI games are never ranked; ranked = online PvP only, with bot
backfill behind generated usernames. Elo ladder; bot games count for humans,
bots never listed. The deployed reality is migrations 0003-0008 +
supabase/functions/{pvp-join,pvp-move,pvp-claim,account-delete}, all live and e2e-verified
(tests/e2e-pvp.mjs: full human-vs-human match with zero-sum Elo, bot match,
seed secrecy, rating-tamper denial, out-of-turn/illegal-move rejection).
The sections below describe the original solo-ranked design and remain as
rationale for the shared-core replay approach the PvP authority reuses.

## Principles

- **Playing never requires an account.** Accounts gate ranked play, the
  leaderboard and cross-device sync. Offline play keeps working with the
  backend completely unreachable.
- **The server never trusts a claimed score.** Ranked games submit the full
  move list + the server-issued seed; an Edge Function replays them through
  the same `src/core/rules.ts` the client runs and stores the score IT
  computes. One rules implementation, zero drift.
- **Data minimisation.** Leaderboards show nicknames only. Deleting an
  account cascades every row (Apple requires in-app deletion anyway).

## Schema (proposal)

```sql
-- one row per auth user; nickname is the only public fact
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text unique not null check (nickname ~ '^[A-Za-z0-9_]{3,16}$'),
  created_at timestamptz not null default now()
);

-- a ranked game starts by asking the server for a seed
create table ranked_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references profiles(id) on delete cascade,
  seed text not null,
  used_at timestamptz,               -- null = still playable
  created_at timestamptz not null default now()
);

-- finished ranked games; score is REPLAY-COMPUTED, never client-supplied
create table games (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references ranked_sessions(id),
  player_id uuid not null references profiles(id) on delete cascade,
  moves jsonb not null,              -- [[who, col], ...] in play order
  score int not null,
  opponent_score int not null,
  difficulty text not null check (difficulty in ('easy','medium','hard')),
  won boolean not null,
  created_at timestamptz not null default now()
);

create index games_score_idx on games (score desc);
create index games_player_idx on games (player_id, created_at desc);

-- leaderboards are just queries
create view leaderboard_alltime as
  select p.nickname, max(g.score) as best,
         count(*) filter (where g.won) as wins, count(*) as games
  from games g join profiles p on p.id = g.player_id
  group by p.nickname order by best desc;

create view leaderboard_weekly as
  select p.nickname, max(g.score) as best
  from games g join profiles p on p.id = g.player_id
  where g.created_at > now() - interval '7 days'
  group by p.nickname order by best desc;
```

RLS: profiles readable by all authenticated users, writable by owner;
`ranked_sessions`/`games` readable by owner (views are the public surface);
INSERTs happen only inside Edge Functions (service role) — clients cannot
write game rows at all.

## Edge Functions

- `ranked-start`: auth required → creates a `ranked_sessions` row with a
  crypto-random seed, returns `{session_id, seed}`.
- `ranked-submit`: takes `{session_id, moves}` →
  1. session belongs to caller, unused, not expired (24h)
  2. derive the dice sequence from the seed (shared `core/dice.ts`, a seeded
     PRNG that client and server both import — to be added WITH this function
     and its determinism test)
  3. replay `moves` through `core/rules.ts`: every move legal, game complete
  4. store the replayed score; mark session used
  Any check fails → reject, nothing stored.

## Client integration (the game keeps its soul)

- Title screen gains a small "Ranked" entry; everything auth lazy-loads
  (supabase-js is NOT in the boot path — the chunked build exists for this).
- Sign-in: email magic link first (no passwords to store); Sign in with
  Apple + Google later, together (Apple's rule), before the store release.
- Account screen: nickname, sync status, and DELETE ACCOUNT from day one.
- Ranked play = CPU game where the dice come from the seed stream instead of
  Math.random — `rollDice()` already funnels through one place.

## Formerly open questions — decided

1. Nickname moderation: **rename-on-report** (owner decision 2026-08-16).
   No reserve/block list for now; a reported name gets force-renamed. The
   report flow itself is not built yet — tracked in docs/STATUS.md.
2. Ranked difficulties: **moot** — the PvP pivot removed solo ranked play;
   difficulty is a practice-only concept.
3. Leaderboard scope: launched as a single all-time Elo top-50
   (security-definer function, bots excluded). Weekly/seasonal scopes remain
   a future product decision.

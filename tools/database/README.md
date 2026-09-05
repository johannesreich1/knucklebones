# Production database rollouts

Production migrations are deliberately separate from the Cloudflare deploy.
Since the 2026-08-30 reconciliation and ranked-rune rollouts,
`supabase/migrations/` begins with the same reconciled 59-file timestamped
prefix as production, pinned by
`supabase/migration-history.json` and `tests/migration-ledger.test.ts`. The
guarded rollout manifest separately pins the applied 60th historical-SILVER
and 61st eleven-locale player-settings stages. The 62nd,
`20260901162456_progression_v2.sql`, was applied and activated on 2026-09-04
(see the callout below); `20260904145925_curve_v2_queue_admission.sql` and
`20260905101500_queue_liveness_heartbeat.sql` followed, so repository and
production hold the same 64 migrations and nothing is pending.
The former compact aliases, obsolete 12-bot seed, and two wrong-stamped files live
under `supabase/legacy-migrations/` and are never executable.

It is now valid to run migration history checks and a linked dry run from the
working tree. Production applies are still explicit owner operations. Never
use `--include-all` from the repository root: the guarded helper uses it only
inside a fresh temporary workdir whose entire migration directory is the fixed,
hash-pinned allow-list.

## Progression-v2 owner cutover

> **EXECUTED 2026-09-04. Production is on curve v2**
> (`public.active_ranked_curve_version()` = 2); 205 profiles and 203 season rows
> were remapped. The sequence below is kept as the record of what was run and as
> the mechanism to read when repairing forward — it is NOT a pending task, and
> it cannot be replayed: the activation is irreversible and
> `private.activate_progression_v2` rechecks the contract and aborts on a curve
> that is already 2. Legacy v1 point-edit, bot-seed/refresh and wipe helpers now
> refuse by design.

Progression v2 deliberately used the normal linked history/dry-run/apply path:
the migration is a single forward-only suffix after the pinned live 61-file
ledger, while the irreversible numeric remap lives behind a separate
database-owner-only function. Do not combine these steps or infer activation
from migration history.

1. Run `supabase migration list --linked`, then
   `supabase db push --linked --dry-run`. Stop unless the exact pending plan is
   only `20260901162456_progression_v2.sql`; never add `--include-all`.
2. Run `supabase db push --linked`. The public active curve must still read 1.
3. Preview and apply the authoritative closure:
   `mise exec -- npm run functions:production:ranked-runes`, then
   `KB_ALLOW_PRODUCTION_RANKED_RUNE_FUNCTIONS=1 mise exec -- npm run
   functions:production:ranked-runes -- --apply`.
4. With service-role/database-owner authority, call
   `public.set_ranked_admission_paused(true)`. Drain all active matches and
   queue entries, then read `public.preview_ranked_curve_v2_activation()`.
5. As database owner (`postgres`), call
   `private.activate_progression_v2(p_expected_profiles => <players>,
   p_expected_season_rows => <season_rows>)` using the exact preview counts.
   The function locks and rechecks them and aborts atomically on any mismatch or
   remaining v1 work.
6. Verify `public.active_ranked_curve_version()` returns 2 and inspect the
   activation result before calling `public.set_ranked_admission_paused(false)`.

Keep admission paused on any uncertain result. The activation cannot be rolled
back by editing migration history: repair forward with a reviewed migration.
The detailed remap/grandfathering invariants are in
`docs/architecture/backend.md` and `docs/LADDER.md §7`.

Use the guarded rollout command for its fixed selections:

```sh
# Read production history/schema and prove the exact dry-run plan. No writes.
mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs settings-locale

mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs match-command-retention

mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs match-command-stall-check

mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs rune-trial

mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs ranked-runes

mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs ranked-progression-events

mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs ladder-streak-baselines

mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs apple-game-center

# Apply the already-previewed allow-list, then validate history and schema.
KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1 \
  mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs settings-locale --apply

KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1 \
  mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs match-command-retention --apply

KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1 \
  mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs match-command-stall-check --apply

KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1 \
  mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs rune-trial --apply

KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1 \
  mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs ranked-runes --apply

KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1 \
  mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs ranked-progression-events --apply

KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1 \
  mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs ladder-streak-baselines --apply

KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1 \
  mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs apple-game-center --apply
```

`mise exec -- npm run db:production:settings`,
`mise exec -- npm run db:production:commands`,
`mise exec -- npm run db:production:rune-trial`,
`mise exec -- npm run db:production:ranked-runes`,
`mise exec -- npm run db:production:ranked-progression-events`, and
`mise exec -- npm run db:production:streak-baselines` are the existing shorter
preview commands. The identity database preview is
`mise exec -- npm run db:production:apple-game-center`. Add `-- --apply` plus
the same environment opt-in to apply any selected rollout.

The `settings-locale` allow-list currently has four ordered stages: the base
settings table, the original `en`/`de`/`fr` locale column, the six-ID expansion,
and the forward-only expansion to stable IDs `en`, `pt`, `es`, `de`, `fr`,
`it`, `pl`, `tr`, `id`, `ja`, and `ko`. Apply and validate the fourth stage
before deploying a client that can persist the new IDs. Presentation tags such
as `pt-BR` are intentionally rejected by the database and remain an
HTML/`Intl`/native concern.

The command is fail-closed. It:

1. verifies Node 24, the configured production project, the exact
   lockfile-installed Supabase CLI, committed migration bytes, and manifest
   SHA-256 hashes (run `mise exec -- npm ci` first; the command never downloads
   a CLI);
2. reads the production history and catalog without returning player rows;
3. creates a fresh temporary Supabase project and fetches the canonical live
   history into it;
4. adds only the rollout's explicit ordered migration allow-list;
5. requires the CLI dry run to contain exactly that pending suffix, with no
   roles or seed data, and repeats the dry run immediately before an apply;
6. applies through the official CLI so SQL and migration history commit
   together; and
7. re-reads history, exact columns/defaults/checks/keys, RLS policy predicates,
   grants, locale constraint/comment, and stored locale values before reporting
   success.

The `rune-trial` allow-list contains only
`20260825205241_rune_trial_ranked_v2.sql`, pinned to its committed SHA-256.
Its validator additionally checks the full progression/protocol table surface,
private command tables, indexes, RLS and exact ACLs, function signatures and
stored body hashes, Realtime publication membership, and the exact retention
cron contract. Immediately after an apply it also proves the historical tier
backfill, safe v1 defaults for live matches/queue rows, and that all five new
tables are still empty before the v2 functions are deployed.

The `ranked-runes` allow-list has three ordered, SHA-256-pinned stages:
`20260830155543_equipped_runes_ranked.sql` establishes fixed equipped seats,
then `20260830160000_random_rune_mode.sql` adds the persisted RANDOM setting
without changing the deployed `start_ranked_match_v3` signature, and
`20260831133000_historical_silver_ranked_runes.sql` makes a historical Silver
peak the permanent match-start unlock for fixed and RANDOM seats and converts
the already-deployed progression event contract in the same transaction. The combined
validator composes the complete Rune Trial audit with the exact widened
capability and match constraints, boolean column/default/check/comment, the
existing owned/known equipment constraints, exact profile RLS, owner SELECT and
UPDATE policies/grants, and the absence of broad table UPDATE. RANDOM has no
direct column grant: the validator pins the authenticated-only
`set_rune_equipment` function
owner, body, search path, and exact execute ACL alongside the compatibility
trigger, private deterministic chooser, every stored function body, and every
service/helper ACL. The historical-Silver stage pins its exact replacement
`start_ranked_match_v3` body and both permanent-unlock column comments while
the shared function and RANDOM-comment audits continue to admit exact stage-1
and stage-2 states. It accepts only absent, fixed-seat,
complete RANDOM, or historical-Silver stages; no partial or out-of-order
catalog can pass.

All three stages audit bot seat coverage and ownership without requiring a
helper that the historical stage does not create. The durable and immediate
postchecks require every bot to stay out of RANDOM and retain an owned fixed seat. The
initial fixed-seat backfill additionally proves its stable owned-rune choice;
later stages preserve any existing owned seat because later wins may have
expanded that bot's inventory since the backfill. Apply snapshots one
deterministic count/fingerprint of every non-bot fixed seat **and** RANDOM flag
immediately before and after the migration, and refuses success if either human
setting changed.

The `ranked-progression-events` allow-list preserves the applied
`20260830182406_ranked_progression_events.sql` bytes and adds the same applied
`20260831133000_historical_silver_ranked_runes.sql` used by ranked-runes. Its
exact catalog audit pins
the 18-column event table, all constraints and indexes, comments, the sole
authenticated owner-SELECT policy, the table's read-only authenticated ACL,
and the authenticated-only owner acknowledgement function. It recognizes the
exact deployed live-rune stage and the exact corrected stage, including mutually
exclusive constraints, comments, and settlement bodies. The correction
normalizes existing rows to the current durable all-season truth—intentionally
suppressing stale or duplicate unlock presentation—then validates the monotonic
constraint; new settlements retain the genuine false-to-true first crossing.
Both database selectors compose the companion audit, so match-start stage 3 and
progression stage 2 must arrive together. The specialized
`test:db:historical-silver-upgrade` gate exercises the real legacy-to-final
migration boundary and restores the local database afterward.

The `ladder-streak-baselines` allow-list contains only
`20260826153000_ladder_streak_baselines.sql`. Its validator pins the private
three-column table, composite cascade key, check and comment; proves that no
Data API role has direct access; and pins the unchanged public player-card and
best-streak signatures, bodies, ownership, search paths, and grants. A later
audit accepts non-empty baseline data only while every row still belongs to a
season rating and does not exceed that row's wins. Only the immediate migration
postcheck requires the new table to be empty.

The `apple-game-center` allow-list contains exactly
`20260826153100_game_center_ids.sql`,
`20260826153101_game_center_service_grants.sql`,
`20260826153102_apple_identity_credentials.sql`, and
`20260826181000_apple_revocation_unstage.sql`. All four timestamps follow
the deployed ladder-streak baseline migration. Its stage audit accepts only
the complete ordered prefixes: absent, Game Center table only, table plus the
exact service-role grant, the full Vault-backed Apple revocation lifecycle
with its six credential functions, or that lifecycle plus the exact
`unstage_apple_revocation` compensator — all seven credential functions.
Any partial table, function, index, RLS, or ACL state blocks preview and apply.

The `match-command-stall-check` allow-list contains exactly
`20260826181500_match_command_stall_check.sql`, which replaces the 13-argument
`commit_match_command` with the 14-argument version whose trailing
`timestamptz` precondition re-verifies the auto-move stall on the database
clock. Its audit accepts exactly two states — the reviewed legacy function or
the reviewed replacement, each as the single `commit_match_command` — and
fails closed on any other body, grant, or overload. The trailing null default
keeps the currently-deployed `pvp-move` valid, so apply this migration before
deploying the Edge function that passes the new argument.

Supabase CLI 2.115.0 has no documented `db push` lock-timeout flag. The guarded
command therefore does not pretend to set one through an unsupported
environment variable; interrupt a blocked owner operation and inspect database
locks before retrying the remaining forward-only suffix.

The temporary fetched history is removed in `finally` and is never printed.
An interrupted or partial rollout is repaired forward: rerun the preview and
apply the remaining validated suffix. Never use linked `migration down`,
`db reset`, or history repair as an automatic rollback.

To add a future rollout, add a code-owned manifest with ordered migration
filenames, their committed hashes, and a fixed read-only schema validator.
Do not accept arbitrary SQL or arbitrary filenames from command-line input.

## BadRandolf transition testing

This helper is curve-v1-only and fails closed when
`public.active_ranked_curve_version()` returns 2. Its numeric presets and
`ranked_pool_tier` mutations do not describe durable v2 outcome entitlements;
do not bypass that refusal after activation.

The guarded player-points helper sets an exact current-season point value for
the single production human profile named `BadRandolf`. The presets below put
that account immediately below a ladder boundary so the next ranked win can
exercise the real promotion deck. Preview is read-only:

```sh
mise exec -- npm run db:production:player-points -- 1259
```

Apply the exact previewed value with a matching literal opt-in:

```sh
KB_ALLOW_PRODUCTION_PLAYER_POINTS=1259 \
  mise exec -- npm run db:production:player-points -- 1259 --apply
```

Ordinary mode preserves the season peak and permanent pool. To exercise a
genuine first-time pool unlock after this test account has already climbed
higher, add the explicit high-water reset flag. Preview remains read-only:

```sh
mise exec -- npm run db:production:player-points -- 299 --reset-high-water
```

Reset apply has a separate point-specific phrase; the ordinary points opt-in
is deliberately insufficient:

```sh
KB_ALLOW_PRODUCTION_PLAYER_HIGH_WATER_RESET=RESET_BADRANDOLF_HIGH_WATER_TO_299 \
  mise exec -- npm run db:production:player-points -- \
  299 --reset-high-water --apply
```

For that exact BONE setup, the transaction writes current-season points and
peak to 299, the profile rating mirror to 299, and the permanent pool to
STONE. Every win earns at least 30 points, so the next win crosses BONE and
the settlement records the STONE → BONE pool advance needed for the promotion
card plus all three newly unlocked outcome cards.

Useful next-win positions are:

| Points | Current group | Next boundary |
|---:|---|---|
| 299 | STONE | BONE |
| 719 | BONE | IVORY |
| 1,259 | IVORY | SILVER |
| 2,009 | SILVER | GOLD |
| 2,999 | GOLD | OBSIDIAN |

The minimum win award is 30 points, so each value guarantees that any next win
crosses the named points boundary. NEON is the season's top 1%, not a fixed
points boundary, so no numeric preset can guarantee entry.

This helper is deliberately narrower than an admin RPC: it accepts only a
canonical integer and only `BadRandolf`, requires Node 24, clean committed
local `main`, the exact linked production project, and the lockfile-pinned
Supabase CLI. Apply rechecks the target, season, rating, peak and permanent
ranked-pool tier inside one short transaction. It refuses an active match,
ranked queue entry, account deletion, or unseen progression event. It updates
the current season's points and profile rating mirror. If the new value exceeds
the existing season peak, the same transaction permanently raises that peak
and may permanently advance the ranked-pool tier; setting a lower point value
later does not undo either high-water mark. Preview prints the exact peak and
pool before/after values so this effect is visible before the opt-in. The helper
does not rewrite match history, stats, runes, equipment, or progression events.
In ordinary mode, a previously earned SILVER rune unlock therefore remains
earned and is not replayed as a first-time unlock after repositioning.

`--reset-high-water` is the deliberate test-only exception to monotonic peak
and pool behavior. It sets the current season's points and peak to the same
requested value and derives the exact pool tier from that value, in the same
short locked/CAS transaction. It still preserves wins, losses, draws, matches,
runes, equipment, and event history, and it keeps every ordinary blocker. It
does not rewrite a prior season's peak, so a SILVER achievement from another
season remains valid; that distinction matters when testing the separate
historical-SILVER rune-seat card.

## Test-account reset and bot population

All three phases are curve-v1-only and fail closed after progression-v2
activation. The fixed point spread, pool tiers, and seed invariants belong to
the v1 fixture. A future v2 population tool needs a separately reviewed plan;
do not weaken this guard to reuse the old one.

The pre-launch production test population has its own three-phase guarded helper.
Every phase requires committed clean `main`, the exact linked/configured project,
the pinned CLI, and a phase-specific literal opt-in. Preview first:

```sh
mise exec -- npm run db:production:test-data -- wipe
mise exec -- npm run db:production:test-data -- seed-bots
mise exec -- npm run db:production:test-data -- refresh-bot-profiles
```

The wipe removes matches first, then all Auth users and their cascading account,
ranked, session, token, settings, and identity rows. It preserves seasons,
provider/client configuration, schema, cron, and audit logs, and refuses to run
when an account owns a Storage object. Apply it only to the explicitly approved
pre-launch test population:

```sh
KB_ALLOW_PRODUCTION_ACCOUNT_WIPE=WIPE_ALL_ACCOUNTS \
  mise exec -- npm run db:production:test-data -- wipe --apply
```

The game is live, so the standard wipe additionally refuses — inside its
locked transaction — any non-bot profile: the fixed seed plan mints bots only,
which makes the human-account ceiling zero. Deleting live human players
requires a second, distinct literal on top of the ordinary wipe opt-in, and it
selects a separate fixed program whose only difference is that omitted ceiling
guard:

```sh
KB_ALLOW_PRODUCTION_ACCOUNT_WIPE=WIPE_ALL_ACCOUNTS \
KB_ALLOW_PRODUCTION_HUMAN_ACCOUNT_WIPE=WIPE_REAL_HUMAN_ACCOUNTS \
  mise exec -- npm run db:production:test-data -- wipe --apply
```

After the exact Rune Trial and streak-baseline migration audits pass, the seed
phase requires the account/ranked graph to be empty and creates exactly 200
bots with unique 0–4600 points. Their deterministic aggregate history is
deliberately beatable: displayed win rates span about 41–54%, games span
18–410, best streaks span 2–7, and exactly half have a modest prior peak above
current points. It does not invent match rows; ordinary settlement owns every
later rating/record change, while a longer real winning run supersedes the
private baseline. The same transaction grants the reviewed 539 plausible Rune
Trial winnings to 155 bots and persists one stable pseudo-random owned choice
through `private.bot_owned_rune_choice(uuid)`. It never calls volatile
`random()`, so rerunning the exact fixture reproduces the database state.

```sh
KB_ALLOW_PRODUCTION_BOT_SEED=SEED_EXACTLY_200_BOTS \
  mise exec -- npm run db:production:test-data -- seed-bots --apply
```

The account-preserving refresh phase exists for the exact original bot seed
(200 since 2026-08-28; the count is single-sourced from
`PRODUCTION_BOT_COUNT`). It begins only from zero human, match, move, queue,
rune, setting, session, token, and owned-Storage rows; matches the complete old
or already-refreshed fixed profile plan; then converges the same transaction to
the canonical 539 winnings and 155 stable owned seats described above. It
never deletes an account. Once rune data or real play exists, the phase is
deliberately and permanently unavailable.

```sh
KB_ALLOW_PRODUCTION_BOT_PROFILE_REFRESH=REFRESH_EXACT_200_UNPLAYED_BOTS \
  mise exec -- npm run db:production:test-data -- refresh-bot-profiles --apply
```

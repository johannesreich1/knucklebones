# Production database rollouts

Production migrations are deliberately separate from the Cloudflare deploy.
Since the 2026-08-30 reconciliation and equipped-ranked rollout,
`supabase/migrations/` begins with the same canonical 57-file timestamped
prefix as production, pinned by
`supabase/migration-history.json` and `tests/migration-ledger.test.ts`. The
former compact aliases, obsolete 12-bot seed, and two wrong-stamped files live
under `supabase/legacy-migrations/` and are never executable.

It is now valid to run migration history checks and a linked dry run from the
working tree. Production applies are still explicit owner operations. Never
use `--include-all` from the repository root: the guarded helper uses it only
inside a fresh temporary workdir whose entire migration directory is the fixed,
hash-pinned allow-list.

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
  tools/database/production-rollout.mjs ladder-streak-baselines --apply

KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1 \
  mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs apple-game-center --apply
```

`mise exec -- npm run db:production:settings`,
`mise exec -- npm run db:production:commands`,
`mise exec -- npm run db:production:rune-trial`, and
`mise exec -- npm run db:production:ranked-runes`,
`mise exec -- npm run db:production:streak-baselines` are the existing shorter
preview commands. The identity database preview is
`mise exec -- npm run db:production:apple-game-center`. Add `-- --apply` plus
the same environment opt-in to apply any selected rollout.

The `settings-locale` allow-list currently has three ordered stages: the base
settings table, the original `en`/`de`/`fr` locale column, and the forward-only
expansion to stable IDs `en`, `pt`, `es`, `de`, `fr`, and `it`. Apply and
validate that third stage before deploying a client that can persist the new
IDs. Presentation tags such as `pt-BR` are intentionally rejected by the
database and remain an HTML/`Intl`/native concern.

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

The `ranked-runes` allow-list has two ordered, SHA-256-pinned stages:
`20260830155543_equipped_runes_ranked.sql` establishes fixed equipped seats,
then `20260830160000_random_rune_mode.sql` adds the persisted RANDOM setting
without changing the deployed `start_ranked_match_v3` signature. The combined
validator composes the complete Rune Trial audit with the exact widened
capability and match constraints, boolean column/default/check/comment, the
existing owned/known equipment constraints, exact profile RLS, owner SELECT and
UPDATE policies/grants, and the absence of broad table UPDATE. RANDOM has no
direct column grant: the validator pins the authenticated-only
`set_rune_equipment` function
owner, body, search path, and exact execute ACL alongside the compatibility
trigger, private deterministic chooser, every stored function body, and every
service/helper ACL. It accepts only the absent, fixed-seat, or complete RANDOM
stage; no partial or out-of-order catalog can pass.

Both stages audit bot seat coverage and ownership without requiring a helper
that the pending stage has not created. The durable and immediate postchecks
also require every bot to stay out of RANDOM and every fixed bot seat to equal
the stable owned-rune choice. Apply snapshots one deterministic
count/fingerprint of every non-bot fixed seat **and** RANDOM flag immediately
before and after the migration, and refuses success if either human setting
changed.

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

## Test-account reset and bot population

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

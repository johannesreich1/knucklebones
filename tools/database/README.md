# Production database rollouts

Production migrations are deliberately separate from the Cloudflare deploy.
The repository's historical local filenames and the production migration
history are not identical, so never run `supabase db push --linked` directly
from the working tree and never use `--include-all` there.

Use the guarded rollout command instead:

```sh
# Read production history/schema and prove the exact dry-run plan. No writes.
mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs settings-locale

mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs match-command-retention

mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs rune-trial

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
  tools/database/production-rollout.mjs rune-trial --apply

KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1 \
  mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs apple-game-center --apply
```

`mise exec -- npm run db:production:settings`,
`mise exec -- npm run db:production:commands`, and
`mise exec -- npm run db:production:rune-trial` are the existing shorter preview
commands. The held identity preview is
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

The held `apple-game-center` allow-list contains exactly
`20260826102600_game_center_ids.sql`,
`20260826102601_game_center_service_grants.sql`, and
`20260826102602_apple_identity_credentials.sql`. All three timestamps follow
the already-recorded Rune Trial migration. Its stage audit accepts only the
complete ordered prefixes: absent, Game Center table only, table plus the exact
service-role grant, or the full Vault-backed Apple revocation lifecycle. Any
partial table, function, index, RLS, or ACL state blocks preview and apply.

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

The pre-launch production test population has its own two-phase guarded helper.
Both phases require committed clean `main`, the exact linked/configured project,
the pinned CLI, and a phase-specific literal opt-in. Preview first:

```sh
mise exec -- npm run db:production:test-data -- wipe
mise exec -- npm run db:production:test-data -- seed-bots
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

After the exact Rune Trial migration audit passes, the seed phase requires the
account/ranked graph to be empty and creates exactly 150 bots with unique
0–4600 points, plausible varied starting win/loss/draw aggregates, a matching
current-season row and profile mirror, and the historical-peak pool tier. It
does not invent match history; ordinary settlement owns every later change.

```sh
KB_ALLOW_PRODUCTION_BOT_SEED=SEED_EXACTLY_150_BOTS \
  mise exec -- npm run db:production:test-data -- seed-bots --apply
```

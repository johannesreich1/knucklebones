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
  tools/database/production-rollout.mjs rune-trial --apply

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
`mise exec -- npm run db:production:streak-baselines` are the existing shorter
preview commands. The held identity preview is
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

The `ladder-streak-baselines` allow-list contains only
`20260826153000_ladder_streak_baselines.sql`. Its validator pins the private
three-column table, composite cascade key, check and comment; proves that no
Data API role has direct access; and pins the unchanged public player-card and
best-streak signatures, bodies, ownership, search paths, and grants. A later
audit accepts non-empty baseline data only while every row still belongs to a
season rating and does not exceed that row's wins. Only the immediate migration
postcheck requires the new table to be empty.

The held `apple-game-center` allow-list contains exactly
`20260826153100_game_center_ids.sql`,
`20260826153101_game_center_service_grants.sql`, and
`20260826153102_apple_identity_credentials.sql`. All three timestamps follow
the deployed ladder-streak baseline migration. Its stage audit accepts only
the complete ordered prefixes: absent, Game Center table only, table plus the
exact service-role grant, or the full Vault-backed Apple revocation lifecycle.
Any partial table, function, index, RLS, or ACL state blocks preview and apply.

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

After the exact Rune Trial and streak-baseline migration audits pass, the seed
phase requires the account/ranked graph to be empty and creates exactly 150
bots with unique 0–4600 points. Their deterministic aggregate history is
deliberately beatable: displayed win rates span about 41–54%, games span
18–410, best streaks span 2–7, and exactly half have a modest prior peak above
current points. It does not invent match rows; ordinary settlement owns every
later rating/record change, while a longer real winning run supersedes the
private baseline.

```sh
KB_ALLOW_PRODUCTION_BOT_SEED=SEED_EXACTLY_150_BOTS \
  mise exec -- npm run db:production:test-data -- seed-bots --apply
```

The update-only refresh phase exists for the exact original 150-bot seed. It
refuses any human, match, move, queue, rune, setting, session, token, or owned
Storage data; matches the complete old or already-refreshed fixed plan; never
deletes an account; and becomes permanently unavailable as soon as real play
exists.

```sh
KB_ALLOW_PRODUCTION_BOT_PROFILE_REFRESH=REFRESH_EXACT_150_UNPLAYED_BOTS \
  mise exec -- npm run db:production:test-data -- refresh-bot-profiles --apply
```

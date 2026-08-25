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

# Apply the already-previewed allow-list, then validate history and schema.
KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1 \
  mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs settings-locale --apply

KB_ALLOW_PRODUCTION_DB_MIGRATIONS=1 \
  mise exec -- node --experimental-strip-types \
  tools/database/production-rollout.mjs match-command-retention --apply
```

`mise exec -- npm run db:production:settings` and
`mise exec -- npm run db:production:commands` are the shorter preview commands.
Add `-- --apply` plus the same environment opt-in to apply.

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

The temporary fetched history is removed in `finally` and is never printed.
An interrupted or partial rollout is repaired forward: rerun the preview and
apply the remaining validated suffix. Never use linked `migration down`,
`db reset`, or history repair as an automatic rollback.

To add a future rollout, add a code-owned manifest with ordered migration
filenames, their committed hashes, and a fixed read-only schema validator.
Do not accept arbitrary SQL or arbitrary filenames from command-line input.

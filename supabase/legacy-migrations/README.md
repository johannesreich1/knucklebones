# Non-executable legacy migration archive

These 31 SQL files are historical evidence, not an executable migration
ledger. Supabase reads only `supabase/migrations/`; never copy an archived file
back there and never apply one to a linked database.

On 2026-08-30 the repository was reconciled to the canonical production
history without changing production migration records or running SQL. The 29
compact local files (`0001` through `0031`, with the historical gaps) and two
locally mis-timestamped equipped-rune files moved here verbatim. Thirty-four
production-only files were fetched from
`supabase_migrations.schema_migrations`, leaving, at that moment, a 56-file
timestamped prefix in `supabase/migrations/` that matched production (the
pinned reconciled base is 59 files; `docs/STATUS.md` carries the live count).

`supabase/migration-history.json` pins both the canonical production prefix and
the complete archive. `tests/migration-ledger.test.ts` rejects a compact file
in the active ledger, a missing or reordered production migration, an archive
change, or a pending migration that sorts inside the production prefix.

## The retired bot seed

`0007_bot_pool.sql` was executed directly in August 2026 and never received a
production migration-history row. It inserts 12 Auth accounts with the literal
addresses `bot-1@internal.invalid` through `bot-12@internal.invalid`; executing
it against the later 200-bot population would create 12 additional profiles.
It therefore stays archive-only. Its preserved SHA-256 is
`3d5dfd07ec6defa14748622ecdd5b649c3bfb72ed1a3a5652c9dea03101f2503`.

Do not mark this file applied as a workaround and do not make its insert
idempotent. The current guarded population helper owns test bots; this file is
only the record of a superseded one-off operation.

## The two timestamp corrections

- `20260828210000_equipped_rune.sql` is archived; the active production
  identity is `20260828192801_equipped_rune.sql`.
- `20260830120000_equipped_rune_grant.sql` is archived; the active production
  identity is `20260830112653_equipped_rune_grant.sql`.

Historical prose should cite the active canonical filenames. This archive is
the place to inspect what the former local ledger contained at reconciliation.

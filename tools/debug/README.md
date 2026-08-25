# Production match diagnostics

These tools inspect the configured Supabase production project through the
Management API's read-only SQL endpoint. They never mutate production and do
not print raw match/player UUIDs, seeds, nicknames, email addresses, or access
tokens.

Run them from the repository root with the Node 24 version required by this
project:

```sh
mise exec -- node --experimental-strip-types tools/debug/list-production-matches.mjs 10
mise exec -- node --experimental-strip-types tools/debug/replay-production-match.mjs <match-key>
mise exec -- node --experimental-strip-types tools/debug/replay-production-match.mjs <match-key> --all
```

The list command returns a 16-character opaque match key. The replay command
accepts 10-32 hexadecimal characters, replays the authoritative move log
through `src/core/rules.ts`, compares computed and stored scores, and prints
all destruction events plus the last eight moves. Column arrays are ordered
from the slot nearest the centre line outward.

Authentication uses `SUPABASE_ACCESS_TOKEN` when present. On macOS it otherwise
reads the existing Supabase CLI token from Keychain service `Supabase CLI`,
account `supabase`; the token needs `database_read` permission. Never pass a
token as a command-line argument or commit one to the repository.

The pure sanitized regression can run without credentials or network access:

```sh
mise exec -- node --experimental-strip-types tools/debug/match-replay.test.mjs
```

These are explicit live diagnostics, not part of `npm test`.

# Edge Functions

- `pvp-join` — matchmaking: pair with the longest-waiting human, or (when the
  client sends `allow_bot: true` after waiting) start a match against a pooled
  bot. Idempotent — rejoining returns your active match.
- `pvp-move` — THE match authority: validates each move against the
  server-rebuilt state (turn, legality, seed-stream die), writes the move log,
  atomically commits the public projection and exact idempotent response,
  detects the end, applies ladder settlement; computes the bot's reply in-request when the
  opponent is a bot. With `auto: true` it places a uniform legal die for
  whoever's turn it is, once its own clock proves the configured stall: in PvP the
  waiting opponent asks; vs a bot the absent player's own backgrounded client
  asks for itself, since a bot has no client to do the asking.
- `pvp-claim` — the forfeit finisher, aimed either way: claim a win off an
  opponent beyond the server-enforced stall threshold, or with `resign: true` give the match
  away yourself — no stall to prove, valid any time the match is live (the
  quit button's confirmed tap). Either way the opponent's client hears the
  match row flip and shows the result immediately.
- `account-delete` — settles every active opponent through the shared atomic
  contract, then deletes the authenticated account so privacy cascades remove
  its profile, ratings, queue rows, and match history.
- `gc-auth` — verifies an Apple Game Center identity assertion and Apple's
  certificate signing authority, then attaches or restores the corresponding
  authenticated account. Its assertion is the auth boundary (`verify_jwt =
  false`), so it is held until a durable deployment-layer rate limit and signed
  device test exist.

Anti-cheat model: new clients submit intent plus replay identity
`{match_id, col, command_id, expected_move_count}` — no authoritative die,
score, or rating. Dice derive from a seed stored in the service-only `match_seeds` table;
scores and ladder changes are computed from the server-written move log;
`profiles.rating` is not client-writable (column-level grants expose only
`nickname` and `avatar`).

## Deploying

Ranked rollout is database-first. Apply the ranked lifecycle/command/history
migrations before deploying `account-delete`, `pvp-claim`, `pvp-join`, and
`pvp-move`. Game Center is separate: apply `0014_game_center_ids.sql`, then
`20260823132611_game_center_service_grants.sql`, configure the external rate
limit, and only then deploy `gc-auth`. Repository checks do not prove dashboard
state.

The PvP functions import `./core/*` — src/ files uploaded VERBATIM next to
`index.ts`, mirroring the repo layout with `src/` stripped (`src/core/rules.ts`
→ `core/rules.ts`, `src/config.ts` → `config.ts`). One rules implementation,
client and server. Nothing in the repo copies them: **the upload is the copy**,
and a hand-made copy under `supabase/functions/<slug>/core/` is a fork of the
rules that no test covers — `tests/fnsync.test.ts` fails on one.

**Which files** is computed, never remembered:

```bash
mise exec -- node tools/fnfiles.mjs pvp-join
```

This list used to be written out here in prose, and prose cannot be re-checked:
it still named `elo.ts` (deleted long before) and omitted `ladder.ts` and
`modes.ts`, which every PvP function imports. `tests/fnsync.test.ts` now walks
the same imports and fails when one resolves to nothing.

The Rune Trial compatibility rollout uses the guarded whole-closure helper,
not a sequence of hand-built deploy calls:

```bash
# Preview the exact six-function plan. No production write.
mise exec -- npm run functions:production:rune-trial

# Apply only after the guarded Rune Trial database migration is exact.
KB_ALLOW_PRODUCTION_RUNE_FUNCTIONS=1 \
  mise exec -- npm run functions:production:rune-trial -- --apply
```

The helper deploys `pvp-rune-select`, `pvp-action`, `account-delete`,
`pvp-claim`, `pvp-move`, then `pvp-join` last so Trial matchmaking cannot
activate before every authority endpoint is ready. It requires committed
closures and the pinned CLI, reuses the database rollout's exact history,
owner, RLS, ACL, function-body, Realtime, and cron audit, deploys every closure
whole, then downloads and compares every runtime path and byte before
continuing. Supabase's readback prunes two type-only modules; the helper accepts
only those exact omissions while pinning their committed source hashes.

Other explicitly reviewed deploys may go through the Supabase MCP
(`deploy_edge_function`). Its `files` argument is exactly what the tool prints:

```bash
mise exec -- node tools/fnfiles.mjs pvp-join --json
```

### Deployed is not repo — read it back

The gate can only see the repo. What Supabase is *running* lives in Supabase,
so the only proof is to fetch it (`get_edge_function <slug>`) and compare
against the manifest above. Skip that and drift is silent and open-ended:
an older deployed `pvp-join` once ran a `core/rules.ts` that predated the spell
layer while status prose recorded the copies as current. It was harmless —
no function imports `core/spells.ts`, so nothing the server replays could
diverge — but harmless was luck, not design.

So: **a function that changes gets redeployed WHOLE**, all files from the tool,
never index.ts alone. Then read it back before writing anything down about it.

Legacy functions from the superseded solo-ranked design must not be inferred
from this repository. Check the dashboard when deployment cleanup is in scope.

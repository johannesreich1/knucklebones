# Edge Functions

- `pvp-join` — matchmaking: pair with the longest-waiting human, or (when the
  client sends `allow_bot: true` after waiting) start a match against a pooled
  bot. Idempotent — rejoining returns your active match.
- `pvp-move` — THE match authority: validates each move against the
  server-rebuilt state (turn, legality, seed-stream die), writes the move log,
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
- `gc-auth` — verifies an Apple Game Center identity assertion and attaches or
  restores the corresponding authenticated account.

Anti-cheat model: clients submit only `{match_id, col}` — there is no field to
lie in. Dice derive from a seed stored in the service-only `match_seeds` table;
scores and ladder changes are computed from the server-written move log;
`profiles.rating` is not client-writable (column-level grants expose only
`nickname` and `avatar`).

## Deploying

The PvP functions import `./core/*` — src/ files uploaded VERBATIM next to
`index.ts`, mirroring the repo layout with `src/` stripped (`src/core/rules.ts`
→ `core/rules.ts`, `src/config.ts` → `config.ts`). One rules implementation,
client and server. Nothing in the repo copies them: **the upload is the copy**,
and a hand-made copy under `supabase/functions/<slug>/core/` is a fork of the
rules that no test covers — `tests/fnsync.test.ts` fails on one.

**Which files** is computed, never remembered:

```bash
node tools/fnfiles.mjs pvp-join
```

This list used to be written out here in prose, and prose cannot be re-checked:
it still named `elo.ts` (deleted long before) and omitted `ladder.ts` and
`modes.ts`, which every PvP function imports. `tests/fnsync.test.ts` now walks
the same imports and fails when one resolves to nothing.

Deploys go through the Supabase MCP (`deploy_edge_function`). Its `files`
argument is exactly what the tool prints:

```bash
node tools/fnfiles.mjs pvp-join --json
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

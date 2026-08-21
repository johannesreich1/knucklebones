# Edge Functions (PvP)

- `pvp-join` — matchmaking: pair with the longest-waiting human, or (when the
  client sends `allow_bot: true` after waiting) start a match against a pooled
  bot. Idempotent — rejoining returns your active match.
- `pvp-move` — THE match authority: validates each move against the
  server-rebuilt state (turn, legality, seed-stream die), writes the move log,
  detects the end, applies Elo; computes the bot's reply in-request when the
  opponent is a bot. With `auto: true` it places a uniform legal die for
  whoever's turn it is, once its own clock proves the stall (12s): in PvP the
  waiting opponent asks; vs a bot the absent player's own backgrounded client
  asks for itself, since a bot has no client to do the asking.
- `pvp-claim` — the forfeit finisher, aimed either way: claim a win off an
  opponent silent >30s on their turn, or with `resign: true` give the match
  away yourself — no stall to prove, valid any time the match is live (the
  quit button's confirmed tap). Either way the opponent's client hears the
  match row flip and shows the result immediately.

Anti-cheat model: clients submit only `{match_id, col}` — there is no field to
lie in. Dice derive from a seed stored in the service-only `match_seeds` table;
scores/Elo are computed from the server-written move log; `profiles.rating` is
not client-writable (column-level grant: `nickname` only).

## Deploying

`pvp-move`/`pvp-claim` import `./core/*` — those files are `src/config.ts` and
`src/core/{rules,dice,match,elo,ai}.ts`, uploaded VERBATIM next to `index.ts`
at deploy time (one rules implementation, client and server). Deploys so far
go through the Supabase MCP (`deploy_edge_function`); if deploys move to the
CLI, a sync step must copy those files first — never hand-edit copies.

Two legacy functions from the superseded solo-ranked design may still be
deployed (`ranked-start`, `ranked-submit`) — their tables are gone and they
should be deleted in the dashboard.

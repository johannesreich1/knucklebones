# Backend architecture

Read this page with `supabase/DESIGN.md` before changing Supabase Auth, RLS,
tables, migrations, RPCs, Realtime, or Edge Functions. Check current Supabase
documentation and changelog for implementation work; dashboard state and
deployed function versions are not inferred from repository prose.

## Authority boundaries

- The browser uses the publishable project key. It is public by design and is
  protected by grants, RLS, and authenticated Edge Function boundaries.
- A service-role/secret key belongs only inside trusted Edge Functions. It is
  never committed, logged, returned, or bundled into a client.
- The server owns match seeds, validates requested moves by replaying the
  server-written log, and computes final scores and ladder changes.
- A normal client action describes intent; it does not submit authoritative
  scores, dice, ratings, player identity, or match state.
- `src/core/` is imported by Edge Functions as the same source used by the
  browser and Node gate. Do not maintain copied rule implementations.

## Repository layout

- `supabase/migrations/` is the immutable imperative migration ledger.
  Existing files describe history and are not rewritten after application.
- `supabase/functions/<name>/index.ts` is a thin HTTP adapter around shared
  authentication, match, and persistence operations.
- `supabase/functions/_shared/` is the home for code reused by functions.
  Browser/Edge game rules remain in root `src/core/`; do not copy them there.
- `tools/fnfiles.mjs` and `tests/fnsync.test.ts` define and verify each
  function's deployable import closure.

The repository currently uses imperative migrations. Do not introduce a
declarative `supabase/schemas/` view until it can be reconciled against the
complete live migration ledger and its generation workflow is documented.

## Database and security rules

- Every table exposed through the Data API has explicit grants and RLS.
  Enabling RLS and granting schema/table access are separate requirements.
- Policies authorize an owned row, not merely the `authenticated` role.
  Update policies need both read eligibility and a `WITH CHECK` boundary.
- Cross-device UI preferences live in the owner-only `player_settings` row,
  separate from the profile/avatar surface. The browser validates the complete
  shape before applying it; typed columns, hue constraints, and RLS enforce the
  same boundary independently in PostgreSQL.
- Privileged functions have a pinned `search_path`, explicit execute grants,
  and the narrowest useful location. `SECURITY DEFINER` is never a shortcut
  around a permissions error.
- Public views/RPCs reveal only their intended fields. Service-only seeds and
  moderation/admin capabilities stay inaccessible to client roles.
- Keyset paging uses a total order and sends every cursor member. Match history
  orders by `(finished_at, id)` and tied ladder ranks by `(rank, nickname)`;
  timestamp-only and rank-only seams can skip or repeat rows. Reverse ladder
  paging uses its own compound-cursor RPC rather than subtracting numeric ranks,
  because `rank()` leaves gaps after ties.
- Add indexes from an observed query and verified plan/advisor evidence, not
  from column-name intuition.
- Keep transactions short. External HTTP calls, animation, or client waits do
  not belong inside database transactions.

## Match completion

Every terminal path must use one settlement contract: normal board finish,
explicit resignation, stalled-human claim, abandoned bot-match cleanup, and
active-match account deletion. The operation claims an active match once,
checks the expected current ladder rows, and writes match outcome, both season
rows, and profile mirrors atomically.

TypeScript owns the ladder formula in `src/core/ladder.ts`; the database owns
atomic compare-and-set persistence. Do not duplicate ladder arithmetic in SQL.
Retries must be idempotent, and a partial rating/profile payout is a failure,
not an acceptable intermediate state.

Account deletion first settles every active opponent through that same
contract. A settlement failure preserves the account for retry; successful
Auth deletion then cascades the profile, season row, and match history for
privacy, while the opponent's already-written points and profile mirror remain.

## Ranked lifecycle and commands

- `private.active_match_players` is the database-level one-active-match seat
  invariant. Match triggers lock both profiles in UUID order, reject accounts
  behind the deletion barrier, synchronize seats on active/terminal changes,
  and remove both participants' queue claims. This also covers older service
  writers during a database-first rollout.
- `enqueue_ranked_player`, `start_ranked_match`, and `leave_ranked_queue` take
  the same profile locks. Starting consumes the requester and human-opponent
  queue rows in the match/seed/optional bot-opener transaction; leaving returns
  `left` or the match that serialized first.
- A move command carries a UUID plus `expected_move_count`. PostgreSQL locks the
  match and atomically appends the log, updates the public projection, performs
  an optional TypeScript-computed settlement, and records the exact response
  for explicit same-key replay. Cached legacy bodies without both new fields
  remain accepted during rollout.
- The browser does not automatically retry a lost move response because it may
  briefly reach the preceding non-idempotent Edge Function. It rebuilds from
  the authoritative log instead, and every fresh match crosses that sync
  boundary before input so an already-committed bot opener cannot be skipped.
- Stall claims and resignations use a checked settlement snapshot (turn,
  `last_move_at`, and move count). The legacy move-insert trigger advances
  `last_move_at` in the append transaction, so a split writer cannot be
  forfeited while its separate projection update is still pending.

History pages use the tuple cursor `(finished_at, id)` and participant indexes
ordered `finished_at DESC NULLS LAST, id DESC`. pgTAP keeps an `EXPLAIN` contract
for both participant branches; do not claim advisor results that were not run.

## Rollout boundaries

Apply ranked migrations before auto-deploying the corresponding web/function
clients. The browser has a narrow missing-`leave_ranked_queue` fallback to the
older RLS-protected own-row DELETE, but database-first remains the normal order.

Game Center is a separate held rollout: `0014_game_center_ids.sql` must be
followed by `20260823132611_game_center_service_grants.sql` before `gc-auth` is
deployed. Because restore deliberately has no Supabase JWT, configure a durable
deployment-layer rate limit first; handler input bounds and a bounded Apple
certificate cache reduce work but are not a distributed rate limiter.

## Verification

Backend work is complete only after:

1. the migration/RPC or function is tested locally or against an authorized
   staging target;
2. ownership, unauthorized access, race, retry, and rollback cases pass;
3. Edge Function type checking and handler tests pass;
4. `tests/fnsync.test.ts` proves the deployed closure uses current shared core;
5. database advisors and relevant query plans are reviewed;
6. pgTAP migration, privilege, RLS, and negative data-visibility contracts run
   in CI against a fresh local Supabase stack;
7. a live probe, when required, uses disposable environment-provided accounts,
   explicit target opt-in, and cleanup.

Cloudflare and Supabase dashboard operations belong to Johannes unless a
connected Supabase tool is used within the requested scope.

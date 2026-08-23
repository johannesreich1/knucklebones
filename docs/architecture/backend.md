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
- Privileged functions have a pinned `search_path`, explicit execute grants,
  and the narrowest useful location. `SECURITY DEFINER` is never a shortcut
  around a permissions error.
- Public views/RPCs reveal only their intended fields. Service-only seeds and
  moderation/admin capabilities stay inaccessible to client roles.
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

Account deletion needs an explicit policy for match retention, opponent
payout, anonymisation, and cascade effects before its terminal path is changed.

## Verification

Backend work is complete only after:

1. the migration/RPC or function is tested locally or against an authorized
   staging target;
2. ownership, unauthorized access, race, retry, and rollback cases pass;
3. Edge Function type checking and handler tests pass;
4. `tests/fnsync.test.ts` proves the deployed closure uses current shared core;
5. database advisors and relevant query plans are reviewed;
6. a live probe, when required, uses disposable environment-provided accounts,
   explicit target opt-in, and cleanup.

Cloudflare and Supabase dashboard operations belong to Johannes unless a
connected Supabase tool is used within the requested scope.

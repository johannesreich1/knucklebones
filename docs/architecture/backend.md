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
- For Rune Trial, the server also owns the common offer, private choices,
  deterministic deadline auto-picks, revealed rune snapshots, and idempotent
  collection reward. A client never chooses an offer or claims ownership.
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

Remote schema rollout is an explicit owner operation. Compare history with
`supabase migration list --linked`, preview pending work with
`supabase db push --linked --dry-run`, then apply it with
`supabase db push --linked`. `supabase db pull <name>` captures schema changes
made remotely into a new local migration; it does not fetch application rows.
Never delete or edit an already-applied migration to undo it—write and test a
new forward migration that reverses the change.

This repository's compact historical local filenames do not exactly match the
timestamped production history, so the generic commands above describe the
normal Supabase model but are not safe to run from this working tree today.
Production allow-listed rollouts use `tools/database/production-rollout.mjs`:
it fetches the canonical remote history into a fresh temporary project, adds
only committed manifest files, requires an exact dry run, applies through the
official pinned CLI, and validates history plus schema afterward. See
`tools/database/README.md`. Never use `--include-all` from the repository root
to work around a history mismatch; that can cross a deliberately held rollout.
Rune Trial uses the explicit `rune-trial` selection (or
`npm run db:production:rune-trial`), and the held identity rollout uses
`apple-game-center` (or `npm run db:production:apple-game-center`), never an
arbitrary filename passed by a caller. Their committed hashes and post-deploy
catalog/security contracts are fixed in the tool before the database owner
opts in to an apply.

For a disposable local database, `supabase migration down --local --last 1`
can step back and `supabase migration up --local` can reapply pending files;
the repository gate normally prefers `supabase db reset --local` so the entire
ledger is replayed from a clean database. Do not use `migration down --linked`
or `db reset --linked` as a production rollback: those rebuild schema state
and can destroy data. `migration fetch --linked` synchronizes migration
history, while the production-match debug tools fetch gameplay rows; neither
applies, removes, or reverses schema changes.

## Database and security rules

- Every table exposed through the Data API has explicit grants and RLS.
  Enabling RLS and granting schema/table access are separate requirements.
- Policies authorize an owned row, not merely the `authenticated` role.
  Update policies need both read eligibility and a `WITH CHECK` boundary.
- Cross-device UI preferences live in the owner-only `player_settings` row,
  separate from the profile/avatar surface. The browser validates the complete
  shape before applying it; typed columns, hue constraints, and RLS enforce the
  same boundary independently in PostgreSQL. Its locale constraint stores only
  the six stable catalog IDs (`en`, `pt`, `es`, `de`, `fr`, `it`), never BCP-47
  presentation tags such as `pt-BR`; extend that allow-list with a forward
  migration and deploy it before any client can save a newly registered locale.
- Permanent rune ownership lives in owner-readable `player_runes`, not in
  `player_settings` or public profiles. New/existing players start with no
  rows. `(player_id, rune_id)` is the idempotent ownership key; `seen_at` is a
  durable acknowledgement of a first-unlock reveal, not a client-only badge.
  The source-match foreign key is indexed and may become null when privacy
  deletion removes match history without deleting the earned rune.
- Unrevealed Trial choices live in the private schema. The participant-facing
  match row exposes the shared offer and, only after both choices resolve, both
  immutable assigned runes. RLS/grants must not let either participant inspect
  the opponent's pending choice or invoke service-only command RPCs directly.
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
- **`rank` is never an offset.** Sequential ladder paging keeps the
  `(rank, nickname)` keyset; RANDOM access — what a dragged scrollbar produces —
  uses the dense `pos` added by `20260827203007_ladder_dense_positions`, with
  `from_pos` on `leaderboard`. `rank - 1` is only ever the position of a tie
  group's FIRST member, and `leaderboard_before`'s cursor deliberately enters a
  group part-way, so its first row is the k-th member: measured on the pgTAP
  fixture's 60-player tie, fifty rows all report rank 1 while sitting at
  positions 11 to 60. Both board RPCs also return `population`, because the
  ladder is public and `player_standing` needs a uuid the reader never has.
  Cost, honestly: the `pos` predicate cannot be pushed below the window, so a
  page sorts and numbers the whole board where `from_rank` filtered first. It
  does not change the complexity class — `ladder_board` already runs `rank()`
  and `count(*)` across the board on every request — but it is a real constant.
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

Rune Trial extends that same settlement transaction. Before any terminal path
settles a selecting match, it deterministically fills each missing choice from
the participant-specific auto-pick recorded with the offer. A human or bot win,
normal finish, resignation, stall timeout, or deletion-forfeit inserts the
winner's selected rune with `ON CONFLICT DO NOTHING`; a loss or draw inserts
nothing, and a duplicate is not replaced. Rating/profile settlement and rune
grant either commit together or not at all.

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
- The additive v2 path preserves those v1 placement commands for standard
  matches. Queue entries advertise protocol version and known capabilities;
  human matchmaking intersects both participants' permanent pool and
  capabilities, while a bot uses its human's pool. Rune Trial is selected only
  for two capable v2 participants (or a capable human with a bot).
- Permanent pool access is a monotonic profile high-water mark backfilled from
  the greatest recorded ladder peak: STONE at 0, BONE at 300, IVORY at 720.
  Demotion or a new season never writes a lower tier. Promotion settlement may
  raise the tier, and the newly eligible pool applies to the next match.
- Seeded opponents can carry a private, season-scoped best-streak baseline
  without fabricated match rows. `player_card()` returns the greater of that
  baseline and the longest real current-season winning run; `best_streak()`
  delegates to it. The locked baseline table cascades from `season_ratings`
  and stays separate because settlement's stale-write check serializes that
  public row's exact five-field rating shape.
- Ranked outcomes keep Classic at exactly 40% and divide 60% equally across
  the shared eligible additions. STONE has three additions, BONE six, and
  IVORY seven including Rune Trial. Trial persists as
  `format='rune_trial'`, `modifier='classic'`, with an immutable rune-rules
  version; strict readers reject an unknown format/modifier/version tuple.
- Rune Trial begins in a private-selection phase with one uniform three-of-six
  offer and a 30-second server deadline. Submission is idempotent and reveals
  both assignments atomically when resolved. `selection_version` is the
  Realtime/poll invalidation counter; public `p1_rune`/`p2_rune` remain null
  until both private choices finalize. Reconnect returns the durable phase,
  offer, caller submission state, and revealed assignments rather than
  depending on a transient broadcast.
- Protocol v2 orders `aim`, `cast`, and `place` in one `match_actions` stream. Commands
  carry a UUID and expected `action_version`; server replay derives die/supply,
  one-cast-per-turn state, charges, persistent charm, legality, projection, and
  terminal score. A cast retains the turn and may end the match, so neither
  alternating placement rows nor move count can be the v2 authority clock. The
  ANVIL `aim` row spends its charge and persists `pending_aim`; matching cast
  resolution or server timeout is mandatory before placement can commit. The
  existing-style action stall boundary remains 12 seconds; it is distinct from
  Trial's 30-second private-selection deadline.
- Command responses are retry receipts, not match history. An hourly
  `pg_cron` job deletes at most 5,000 receipts whose command and terminal match
  are both older than seven days; active-match receipts never expire. The
  authoritative `matches`, `match_moves`, and `match_seeds` rows are untouched,
  so production replay diagnostics continue to inspect the complete game.
- The browser does not automatically retry a lost move response because it may
  briefly reach the preceding non-idempotent Edge Function. It rebuilds from
  the authoritative log instead, and every fresh match crosses that sync
  boundary before input so an already-committed bot opener cannot be skipped.
- Stall claims and resignations use a checked settlement snapshot (turn,
  `last_move_at`, and move count). The legacy move-insert trigger advances
  `last_move_at` in the append transaction, so a split writer cannot be
  forfeited while its separate projection update is still pending.
- Auto play covers a bounded absence, counted rather than timed.
  `p{1,2}_auto_streak` records consecutive automatic placements per seat; a
  genuine move resets the mover's count, and a bot reply committed in the same
  command never touches the human's. At `AUTO_FORFEIT_STREAK` the operation
  settles a forfeit against that seat instead of appending a move, so two
  automatic placements land and the third attempt is the loss. It must not be
  a wall clock: every automatic placement writes `last_move_at`, so a
  seconds-based threshold measured from it resets before it can be reached —
  which is why an away player used to be auto-played indefinitely. There is no
  scheduled sweep, and none is wanted; the decision happens wherever a client
  asks the server to take a turn. Only a client that stopped calling home
  entirely in a bot match has no caller, and `pvp-join`'s
  `forfeitStalledBotMatch` already settles that on their next queue attempt,
  which the one-active-match seat invariant forces them through.
- `AUTO_MS` gates a RECOVERY only — one party placing for another. A client
  placing on its own expired turn clock sends `auto` with a null
  `p_expected_last_move_at`, and the commit RPCs check turn ownership instead
  of a stall; a 10s turn clock could otherwise never satisfy a 12s gate, which
  is what forced the visible client to report its timer as a tap and left the
  count unenforceable.

History pages use the tuple cursor `(finished_at, id)` and participant indexes
ordered `finished_at DESC NULLS LAST, id DESC`. pgTAP keeps an `EXPLAIN` contract
for both participant branches; do not claim advisor results that were not run.

## Rollout boundaries

Apply ranked migrations before auto-deploying the corresponding web/function
clients. The browser has a narrow missing-`leave_ranked_queue` fallback to the
older RLS-protected own-row DELETE, but database-first remains the normal order.

The current locale expansion is the forward-only migration
`20260825161016_expand_player_settings_locales.sql`. It widens the original
`en`/`de`/`fr` constraint to the registry-derived six stable IDs without
rewriting stored values. Production records it, and the allow-listed
`settings-locale` audit confirms its history, exact constraint, comment, and
stored-value contract. The legal publication switch is a later, independent
release step.

Game Center and Apple credential lifecycle are a separate held rollout.
The guarded `apple-game-center` selection applies
`20260826153100_game_center_ids.sql`,
`20260826153101_game_center_service_grants.sql`, and
`20260826153102_apple_identity_credentials.sql` as one strictly ordered,
post-Rune-Trial allow-list. Sessionless Game Center restore crosses the
strict-origin, durably rate-limited Cloudflare identity gateway; only that
gateway knows the shared header required by `gc-auth`. Apple refresh tokens
live in Vault, are staged before user deletion, and have a bounded retry
lifecycle after the user row is gone.

Rune Trial is another database-first, forward-only rollout. Production records
`20260825205241_rune_trial_ranked_v2.sql`; it repairs the complete
ordinary modifier allow-list and adds pool, format/phase, action, private-choice,
and collection state. Its exact catalog/security/data/Realtime/cron audit and
the byte-verified v2 join/select/action/settlement function rollout completed
before the capable client release. Retain the v1 standard path throughout the
compatibility window so old clients remain standard-only.

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

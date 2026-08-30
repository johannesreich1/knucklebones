# Guarded Edge Function rollouts

`production-rollout.mjs` deploys one **plan** — a fixed, ordered set of Edge
Functions — to the production project. It never deploys "whatever changed":
you name the plan, and the plan names its functions.

| Plan | Functions | Opt-in | Database prerequisite |
|---|---|---|---|
| `ranked-runes` | `pvp-rune-select`, `pvp-action`, `account-delete`, `pvp-claim`, `pvp-move`, `pvp-join` | `KB_ALLOW_PRODUCTION_RANKED_RUNE_FUNCTIONS` | migration `20260830155543_equipped_runes_ranked`, its exact ranked-rune audit, and the complete Rune Trial foundation |
| `identity-hardening` | `identity-status`, `apple-token-register`, `apple-revocation-retry` | `KB_ALLOW_PRODUCTION_IDENTITY_FUNCTIONS` | the Apple/Game Center audit at stage 3 or 4 |
| `game-center` | `gc-auth`, and nothing else | `KB_ALLOW_PRODUCTION_GAME_CENTER_FUNCTIONS` | the Apple/Game Center audit at stage 2, 3 or 4 |

```bash
# Preview: what would deploy, and what production runs right now. No write.
mise exec -- npm run functions:production:ranked-runes
mise exec -- npm run functions:production:identity
mise exec -- npm run functions:production:game-center

# Apply. The opt-in belongs to one plan; every other plan's variable is inert.
KB_ALLOW_PRODUCTION_IDENTITY_FUNCTIONS=1 \
  mise exec -- npm run functions:production:identity -- --apply
```

Preview names each function, the size of the closure that would deploy, and the
version production is running right now — `deployed v7`, or `not deployed yet`
when the listing is readable and simply has no such row, or
`deployed version unknown` when the listing could not be read at all. Preview
never reads the database and never writes anything.

## What the guard actually checks

Every plan runs the same preflight, and any failure stops before a byte is
written to production:

- **Node 24 and the pinned CLI.** `package.json`, `package-lock.json` and the
  installed binary must all agree on the exact Supabase CLI version.
- **Committed inputs only.** The plan's control files *and* every source file in
  every function closure (`tools/fnfiles.mjs` computes the closure; it is never
  a remembered list) must match committed `HEAD` — no staged, unstaged or
  untracked drift, run from `main` in the repository root.
- **Its own opt-in.** `--apply` requires the plan's own environment variable set
  to `1`. A plan reads only its own variable, so an opt-in exported for one
  rollout cannot deploy the other.
- **Its own database prerequisite** (apply only, never in preview). The
  functions' RPCs and tables must already exist in the reviewed shape; the
  database rollout's audits are the single implementation of that contract.
- **Readback of every deployed function.** Each function is deployed alone into
  a materialized temporary project, its row is re-read (`ACTIVE`, the reviewed
  `verify_jwt`, plausible metadata), then the deployed closure is downloaded and
  compared path-by-path and byte-by-byte against what was uploaded. A mismatch
  fails immediately, before the next function is touched.

`verify_jwt` is asserted per function, not assumed: `apple-revocation-retry` is
cron-invoked behind a constant-time shared secret, and `gc-auth` is how a player
gets a session in the first place, so neither may require one — while every
other deployable function must. `FUNCTION_VERIFY_JWT` mirrors
`supabase/config.toml`, and `tests/production-functions.test.ts` fails if the two
ever disagree.

## gc-auth deploys alone

`gc-auth` is the auth boundary itself (`verify_jwt = false`): a bad deploy is
not a degraded feature, it is an open door. So it has a plan of its own — its
own selector, its own opt-in, its own database gate — and **nothing else is in
it**. Deploying the auth boundary is therefore always one deliberate act, never
a side effect of shipping an identity feature.

That isolation is enforced at import, not by convention:
`GAME_CENTER_ROLLOUT_SLUGS` must be claimed by the `game-center` plan and by no
other, and that plan's slug list must *be* that array — appending to it, or
moving `gc-auth` into another set, fails the module before any rollout can run.
`tests/production-functions.test.ts` pins the selector, the opt-in, and that
`gc-auth` appears in exactly one plan.

Its database gate is deliberately narrower than the identity set's: `gc-auth`
reads and writes one table, `public.game_center_ids`, through the service role,
so stage 2 — that table plus its service grants — is the whole durable contract
it has. Over-gating a boundary deploy on schema it never touches only teaches
operators to reach for a broader opt-in than the act needs.

**The signed-device pass is acceptance, not a precondition.** `docs/IDENTITY.md`
asks for launch restore, attach, account switching, Apple repair, deletion and
revocation on a signed device; that runs *immediately after* this plan applies.
It cannot run before, because the device exercises the deployed function —
requiring the pass first is a condition no rollout could ever satisfy. If the
pass fails, the fix is a corrected redeploy of the same single-function plan.

## Adding a plan

Add an entry to `FUNCTION_ROLLOUT_PLANS` with its slugs (in deploy order —
the riskiest activation last), its own opt-in constant, its project id, its
readback omissions, its control files and its prerequisite; add the matching
`FUNCTION_VERIFY_JWT` posture and a `functions:production:*` script. A slug may
belong to exactly one plan, and no plan may share another's opt-in; the module
refuses to load otherwise.

Readback omissions exist only because Supabase's API bundler prunes type-only
inputs from a downloaded closure. Each omission pins the expected source hash of
that exact `slug:path`, so a file that gains runtime code stops being omittable
and fails closed. The identity and game-center plans omit nothing — every file
in their closures is runtime code, so an absent readback path is drift.

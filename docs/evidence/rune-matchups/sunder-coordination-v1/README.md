# SUNDER coordination sensitivity v1

Targeted treatment generated on 2026-08-24 with Node 24. This directory does
not replace the frozen blind-Normal baseline in `../v1/`; it measures the
production Normal SUNDER cast/placement coordination and BOUNTY-aware cast
valuation added after that baseline.

## Design

- Every directed one-cast cell containing SUNDER in Classic and BOUNTY: 22
  mechanical configurations.
- Both directed SUNDER/WARD one-cast cells in COLUMN SHIELD.
- Both directed FATE/SUNDER chain cells in Classic and BOUNTY: four additional
  mechanical configurations.
- Four fixed replications (`20260824-a` through `20260824-d`) and 3,000 games
  per record: 112 records / 336,000 actual games.
- Normal placement policy: depth 2, risk weight 0.9, opponent weight 1.
- Production Normal previews with the exact projected SUNDER charm and reuses
  that column after 95% of casts. Its named 5% slip performs the ordinary blind
  placement search instead. Easy remains blind; Hard reuses exactly.
- SUNDER cast valuation preserves live WARDs. In BOUNTY only, each additional
  destroyed die contributes its banked `+1` to cast/hold valuation. Placement
  search itself remains board-only.
- Exact frozen-v1 game seeds and supply streams. All 112 baseline records, the
  three source-report hashes, and the frozen emitter hash are validated before
  paired aggregate deltas are calculated.

Regenerate:

```text
mise exec -- node --no-warnings --experimental-strip-types \
  tools/rune-sunder-sensitivity.ts \
  --baseline docs/evidence/rune-matchups/v1/raw-classic.json \
  --baseline docs/evidence/rune-matchups/v1/raw-bounty.json \
  --baseline docs/evidence/rune-matchups/v1/raw-colshield.json \
  --output docs/evidence/rune-matchups/sunder-coordination-v1/raw-treatment.json
```

## Direct outcome findings

Outcome rate means `win + 0.5 x draw`. Uniform-opponent rows give every one of
the six opponent runes equal weight, including the mirror. Intervals are
descriptive paired-seed t intervals from only four aggregate replications;
they are not per-game intervals or a multiple-comparison analysis.

| Scope | Frozen v1 | Coordinated | Delta | Descriptive 95% interval for delta |
|---|---:|---:|---:|---:|
| Classic, one cast, uniform opponent | 52.1222% | 52.3010% | +0.1788pp | [+0.0325,+0.3252]pp |
| BOUNTY, one cast, uniform opponent | 52.5344% | 52.7847% | +0.2503pp | [+0.1568,+0.3439]pp |
| COLUMN SHIELD, one cast, WARD only | 52.4229% | 52.4375% | +0.0146pp | [-0.0534,+0.0825]pp |
| Classic, FATE chain | 52.5375% | 52.7458% | +0.2083pp | [-0.3366,+0.7532]pp |
| BOUNTY, FATE chain | 53.3667% | 53.8042% | +0.4375pp | [+0.1977,+0.6773]pp |

The one-cast Classic delta is positive in all four paired replications
(+0.0889 to +0.3069pp). The one-cast BOUNTY delta is also positive in all four
(+0.1778 to +0.3208pp). The treatment therefore detects a small fixed-policy
improvement, not a multi-point rebalance.

At the pooled point estimate, coordinated SUNDER still loses narrowly to
PILFER in Classic (49.3646%) while beating each other distinct rune. In
BOUNTY, it beats every distinct rune; PILFER is its narrowest win at 51.1521%.
The BOUNTY uniform-opponent result was already the roster high in v1 and moves
another +0.2503pp upward.

An explicitly partial wheel overlay substitutes measured Classic and BOUNTY
cells while retaining all unmeasured modes at frozen v1. In that mixed-policy
diagnostic, SUNDER moves from 49.9459% to approximately 50.0425%, PILFER remains
approximately 54.8226%, and PILFER's wheel-weighted head-to-head against SUNDER
remains approximately 55.0198%. This is evidence that the measured correction
does not close the broad gap; it is not a production-policy seven-mode result.

## Cast and placement telemetry

The one-cast rows contain 144,000 SUNDER role-game exposures in each of
Classic and BOUNTY. The two directed COLUMN SHIELD/WARD cells contain 24,000.

| Scope | Baseline casts | Coordinated casts | Potential coordinated/blind column difference | Slips | Slips that changed the final column |
|---|---:|---:|---:|---:|---:|
| Classic | 68,014 | 67,316 | 9,634 / 67,316 (14.31%) | 3,341 / 67,316 (4.96%) | 476 / 67,316 (0.707%) |
| BOUNTY | 66,991 | 68,924 | 10,041 / 68,924 (14.57%) | 3,402 / 68,924 (4.94%) | 501 / 68,924 (0.727%) |
| COLUMN SHIELD vs WARD | 3,150 | 3,142 | 112 / 3,142 (3.56%) | 163 / 3,142 (5.19%) | 11 / 3,142 (0.350%) |

Thus 5% is the actual policy-slip rate, but it does not mean 5% visibly wrong
columns. The blind and coordinated searches usually agree. Only about 0.7% of
Classic/BOUNTY SUNDER casts finish in a different column because of the slip,
or about 0.33%-0.35% of SUNDER role-games under this policy.

Across all 360,000 selected SUNDER role-game exposures, 8,148 of 163,925 slip
checks fired (4.9706%), and 1,186 final columns differed from the preview. That
is 0.7235% of casts or 0.3294% of role-games—about one changed placement per
304 role-games. There is no direct 1%-versus-5% cohort; scaling the observed
conditional disagreement linearly would put 1% near one per 1,518 role-games,
which is an extrapolation rather than a measurement.

BOUNTY-aware valuation also changes cast/hold behaviour. One-cast BOUNTY uses
increase by 1,933, from 46.5215% to 47.8639% of role-games (+1.3424pp); the
FATE-chain cohort gains 359 casts, from 50.5042% to 52.0000% (+1.4958pp).
Classic one-cast uses instead fall by 698 (-0.4847pp), primarily because live
WARD preservation removes false victim value.

The coordinated cast had positive attributable destruction in almost every
one-cast use:

- Classic: 152,129 additional kills across 67,316 casts (2.260 per cast), with
  35 zero-kill/zero-marginal casts (0.052%).
- BOUNTY: 157,591 additional kills across 68,924 casts (2.286 per cast), with
  45 zero-kill/zero-marginal casts (0.065%). The 157,591 kills produce exactly
  157,591 additional banked bounty points in the cast comparison.
- COLUMN SHIELD versus WARD: 4,600 additional kills across 3,142 casts (1.464
  per cast), with two zero-kill/zero-marginal casts.

Live enemy WARD state was present for 1,174 Classic casts and 1,259 BOUNTY
casts. Preserving it changed the coordinated root column 23 and 34 times,
respectively. Planned and actual absorption matched exactly: 291 strike
outcomes / 625 dice in Classic and 283 / 619 in BOUNTY. This verifies the
previous fresh-charm valuation error is absent from the treatment.

## Rune Trial point-estimate sensitivity

A direct Classic overlay replaces only the 11 pooled one-cast cells containing
SUNDER with their coordinated treatment values and leaves the other 25 cells
at frozen v1. This is a derivation from the two raw artifacts, not another
simulation cohort.

- Frozen v1 classified all 20 three-rune offers as having one pure saddle: 16
  mirrors and four off-diagonal SUNDER/PILFER saddles.
- With coordinated SUNDER, 16 offers retain one pure saddle, all mirrors. The
  four offers containing both SUNDER and PILFER have no pure saddle at the
  pooled point estimate.
- Every offer still has at least one strictly dominated choice for each role.
- Across individual 3,000-game replications, the four SUNDER/PILFER offers
  flip among `PILFER -> SUNDER`, `SUNDER -> PILFER`, and no pure saddle. This is
  a useful instability diagnostic, not four independent classifications of a
  true equilibrium.

After eliminating each affected offer's dominated third rune, its pooled
PILFER/SUNDER point game has an approximate exact 2x2 equilibrium: opener
7.79% PILFER / 92.21% SUNDER, reply 73.81% PILFER / 26.19% SUNDER, and opener
value 51.0440%. Those precise shares inherit the same cell uncertainty and are
a structural diagnostic, not a player-choice forecast.

The old four-saddle conclusion depended on a minimum deviation margin of only
0.0792pp. A policy correction of a few tenths of a point is enough to erase it.
Rune Trial therefore remains a solved-choice warning in 16 offers, but its
four SUNDER/PILFER offers must be treated as mixed/cyclic and statistically
unresolved rather than assigned a deterministic selection share.

## Limits

- This is one fixed Normal CPU policy, not Hard, human, opponent-aware, or
  optimal play.
- Deeper plies do not retain charm, the cast policy does not inspect the
  opponent's equipped rune, and BOUNTY bank value is not part of placement
  search. Those remain separate policy sensitivities.
- The 5% slip consumes the production search stream. Paired base seeds preserve
  dice/supply provenance, but no per-game joint transition file is retained.
- Only Classic and BOUNTY have complete SUNDER rows and columns. COLUMN SHIELD
  covers SUNDER/WARD only; the other four modes are untouched. This artifact
  cannot produce a complete coordinated seven-mode wheel or prove a new global
  dominance relation.
- Human choice, counterplay, learning, collection ownership, and Trial choice
  behaviour remain unmeasured.

## Artifact SHA-256

```text
d0d856ae2d7ac4a46bafa62ee74978599ae0e0d935b4b1f93b155ba56e8de750  raw-treatment.json
4cf90d69427d0b0307e604e18758ff2d46210b729729fb9ba9f081449047602f  tools/rune-sunder-sensitivity.ts
d68ed691c2e8aa5869e9b7b2d60b6ec339edad4d8994d7fdc1c44f4284f8d458  tests/rune-sunder-sensitivity.test.ts
de01f52854a54677d29d7ea710b7e2aafaa7a1e12f213c886cc518e56183b1be  src/flow/spell-ai.ts
a875c056c6f98071b679f184e0672e80438965148ae2bd76796b1acf42e90acf  tools/rune-matchups.ts (frozen source)
3544887e21c531fee5151067727d22f9f35ba779f97db4f099b40a921a154b3e  ../v1/raw-classic.json
3eae8c44d7a61c14b3a0e74b15e431c030ca69548f96ba0e0c2dad4d62217f3e  ../v1/raw-bounty.json
6c2e9cccf07555381d63af5c01fdd858da647221abeb332a6dabf2da478b1c14  ../v1/raw-colshield.json
```

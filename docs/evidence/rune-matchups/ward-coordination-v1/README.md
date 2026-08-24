# WARD coordination sensitivity v1

Targeted treatment generated on 2026-08-24 with Node 24. This directory does
not replace the frozen blind-Normal baseline in `../v1/`; it measures only the
production Normal WARD cast/placement coordination added after that baseline.

## Design

- COLUMN SHIELD only.
- Every directed one-cast cell containing WARD: 11 mechanical configurations.
- The two directed FATE/WARD chain cells, the only branch-sensitive cells in
  this scope.
- Four fixed replications (`20260824-a` through `20260824-d`) and 3,000 games
  per record: 52 records / 156,000 games.
- Normal placement policy: depth 2, risk weight 0.9, opponent weight 1.
- Exact frozen-v1 game seeds and supply streams. A WARD hazard preview advances
  its role's search stream before Normal independently chooses the final
  placement, matching production behaviour.
- The attached baseline validates all 52 source records and the frozen
  simulator SHA-256 before calculating paired aggregate deltas.

In the frozen raw summary, `baselineWardScore` and `coordinatedWardScore` mean
win/draw/loss outcome-point rate (`win + 0.5 × draw`), not board score. The
names are retained so this manifest continues to match the hashed instrument
and artifact exactly.

Regenerate:

```text
/opt/homebrew/bin/node --no-warnings --experimental-strip-types \
  tools/rune-ward-sensitivity.ts \
  --baseline docs/evidence/rune-matchups/v1/raw-colshield.json \
  --output docs/evidence/rune-matchups/ward-coordination-v1/raw-colshield.json
```

## Direct findings

Across 144,000 one-cast WARD role-game exposures (132,000 actual games; the
WARD/WARD mirror contributes two WARD exposures per game):

- the frozen policy cast WARD 41,976 times;
- coordinated Normal inspected 44,337 candidate casts whose selected target
  required a hazard preview, vetoed 41,688 (94.03%), and cast 2,649 times;
- the preview and final placement differed 15 times (0.034% of previews);
- 5 successful casts were made immediately redundant by the independent final
  placement (0.189% of successful casts). The earlier, separately scoped
  uncoordinated WARD/WARD reproduction observed 93.3%; that contrast is
  illustrative, not a paired effect estimate.

The two FATE/WARD chain orientations add 24,000 WARD-role games: 7,219 hazard
previews, 6,790 vetoes, 429 successful casts, 6 preview/final divergences, and
1 immediate redundancy.

The correction did not rescue WARD's measured COLUMN SHIELD balance. Its
one-cast outcome-point rate against a uniform rune population changed from
40.6274% to 40.6038% (-0.0236 percentage points). A descriptive paired-seed
t interval from only four replications is approximately [-0.0529,+0.0057]pp,
so the uniform result does not establish a negative effect. The largest
matchup movement is WARD versus FATE at -0.0604pp; it is negative in all four
paired replications, with a naive unadjusted interval of about
[-0.0878,-0.0331]pp. That post-hoc cell is weak evidence worth retesting, not a
robust conclusion: there are only four seeds, no multiplicity correction, and
no per-game joint transition record. The direct supported result is that the
39,327-cast reduction becomes exactly 39,327 additional unused charges under
this narrow policy.

## Limits

- This is Normal policy, not Hard, human, opponent-aware, or optimal play.
- Hard reuses its safe preview and therefore has zero immediate recurrence by
  construction; this treatment measures Normal's independent second choice.
- Only immediate completion of the newly warded COLUMN SHIELD column is
  counted. Delayed completion, WARD trigger rate, and final live charm state
  remain unmeasured.
- Only WARD-sensitive COLUMN SHIELD cells were substituted. The file cannot
  recompute seven-mode rune strengths or global dominance.
- SUNDER's separate charm-blind placement defect is not corrected here.

## Artifact SHA-256

```text
b47189209944b03de32afe8b5f33c34339e0506a0788bb16a679cfbb43d922d5  raw-colshield.json
409eaf7b6c7663845ef558b8f9896c6d930d363b58e2631846d21371262ad2df  tools/rune-ward-sensitivity.ts
196bfcb5effbd2e32d92ff47314e8753b23a97c8346e0027faf5c96de972fabb  tests/rune-ward-sensitivity.test.ts
a875c056c6f98071b679f184e0672e80438965148ae2bd76796b1acf42e90acf  tools/rune-matchups.ts (frozen source)
6c2e9cccf07555381d63af5c01fdd858da647221abeb332a6dabf2da478b1c14  ../v1/raw-colshield.json
```

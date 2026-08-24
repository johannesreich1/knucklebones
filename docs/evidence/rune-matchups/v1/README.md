# Rune matchup evidence v1

Frozen blind-Normal-policy baseline generated on 2026-08-24 with Node 24.
This directory is evidence for the current `machineCast` + depth-2 placement
policy. It is not a Hard-AI, opponent-aware, charm-coordinated, or human-play
claim.

## Design

- Six opener runes × six reply runes × seven modes.
- Four independent seeds: `20260824-a` through `20260824-d`.
- 3,000 games per seeded opener-oriented cell.
- One-cast grammar for all 252 cells.
- Chain grammar for the 77 FATE-containing cells; 175 non-FATE cells are
  mechanically inherited by the analyzed chain branch.
- 1,316 raw records and 3,948,000 simulated games total.
- Each analyzed effective cell pools four replications / 12,000 games.

Each raw report embeds the simulator version, request, policy, seed derivation,
field semantics, and SHA-256 of all eight runtime source dependencies. The raw
simulator SHA is
`a875c056c6f98071b679f184e0672e80438965148ae2bd76796b1acf42e90acf`.

## Regenerate the derivative analysis

```text
/opt/homebrew/bin/node --no-warnings --experimental-strip-types \
  tools/rune-matchup-analysis.ts \
  docs/evidence/rune-matchups/v1/raw-classic.json \
  docs/evidence/rune-matchups/v1/raw-rowswitch.json \
  docs/evidence/rune-matchups/v1/raw-rowmult.json \
  docs/evidence/rune-matchups/v1/raw-colshield.json \
  docs/evidence/rune-matchups/v1/raw-singlestrike.json \
  docs/evidence/rune-matchups/v1/raw-bounty.json \
  docs/evidence/rune-matchups/v1/raw-limited.json \
  --output docs/evidence/rune-matchups/v1/analysis.json
```

The analyzer validates exact requested coverage, unique seed derivation,
cross-report policy/source compatibility, W/D/L, terminal totals, internal
opener splits, and cast histograms before producing both effective branches.
The derivative file does not embed its seven input-file hashes; keep this
manifest and the raw files with it.

## Artifact SHA-256

```text
3eae8c44d7a61c14b3a0e74b15e431c030ca69548f96ba0e0c2dad4d62217f3e  raw-bounty.json
3544887e21c531fee5151067727d22f9f35ba779f97db4f099b40a921a154b3e  raw-classic.json
6c2e9cccf07555381d63af5c01fdd858da647221abeb332a6dabf2da478b1c14  raw-colshield.json
9f8e9d33007596d105b63a6fc3f9484dbf555702b69c5c8e5a6ca77f7fd7d247  raw-limited.json
38d4f7c235ad99ec7e7484dd01adb9bd5f4c647321f003cdd6388b7c5f0bbe01  raw-rowmult.json
dc33e5bab92021a7e98fe12d094caf9551aef051868ab8839cafe5ca46daf93f  raw-rowswitch.json
1834d5e779970c7c4bb2f1f01b31c6a467c4fc14422d74afee0f33f0babd02ce  raw-singlestrike.json
47585146b03d4157ffee2092fce3a13a046fe8eaf0c2d8d9bcad271cb8cb949c  analysis.json
```

Source instruments at manifest creation:

```text
a875c056c6f98071b679f184e0672e80438965148ae2bd76796b1acf42e90acf  tools/rune-matchups.ts
4abe2039982011db90d558627081b0fdc796dea9692a42bda756f3964b69f895  tools/rune-matchup-analysis.ts
```

If the analyzer changes, regenerate `analysis.json` and update its two hashes.
Never overwrite the raw v1 files with a coordinated-policy rerun; preserve that
as a separately versioned treatment.

---
name: knucklebones-docs
description: "Use BEFORE touching an unfamiliar area of this repository, and whenever you need to know which document owns a decision. Says what each document owns — and does not — for: game rules, modes, spells/runes, the ladder, matchmaking and the queue, bots and the AI, accounts, Game Center and identity, Supabase (schema, RLS, RPCs, Edge Functions, Realtime, migrations, pgTAP, production rollouts, live-match diagnostics), the frontend and its state, CSS and layout, localization, builds/PWA/native/iOS/Android, the launcher icon, tests, worktrees and the release gate, design cards and DesignSync, App Store metadata and screenshots, client compatibility and forced updates, legal and store listings, and the historical rationale behind rejected alternatives. Also use when asked where something is documented, or where a new decision should be written down."
---

# Where the knowledge lives

This repository keeps its reasoning in documents, not in commit archaeology.
Read the one that owns your area **before** changing code in it; almost every
expensive mistake in this project's history was a rediscovery of something
already written down. **Do not read everything** — route, read one or two
sections, then work.

The task → document table is in `CLAUDE.md` (identical in `AGENTS.md`), which
is already in context; it is not repeated here. This file adds what that table
cannot afford: what each document owns section by section, what it does *not*
own, and the protocol for writing a new decision down.
`tests/docs-router.test.ts` fails when `CLAUDE.md` routes to a document this
map does not describe (or the reverse), when a routed path is missing, when a
`§ N` reference matches zero or two headings, or when this skill is not tracked.

## What each document owns

| Document | Owns | Not here — go to |
|---|---|---|
| `docs/STATUS.md` | Current-state table, decisions still in force, open owner actions (external dashboards, submissions), the `docs/` map. Dated; the header says how current. | Mechanisms → architecture docs; rationale → the history file. |
| `docs/architecture/frontend.md` | Runtime shape, dependency direction, the one shared game view, state and concurrency, size and context budgets. | CSS → styles; server contracts → backend. |
| `docs/architecture/styles.md` | Entry points and CSS ownership, the cascade order, selector rules (including `:where()` adding no specificity and box-versus-text centring), overlays and backdrop, localized-copy geometry, the widget boundary, engine-specific effects, the verification matrix. | Copy length budgets → localization. |
| `docs/architecture/localization.md` | Locale model and registry, runtime API and ownership, catalog rules, game-view length budgets. | App Store locales → the marketing README; the `player_settings.locale` migration → backend. |
| `docs/architecture/backend.md` | Authority boundaries, repository layout, database and security rules, match completion, the ranked lifecycle and commands, rollout boundaries, verification. | Schema rationale → `supabase/DESIGN.md`; per-function purpose → `supabase/functions/README.md`; the queue's lifecycle → `docs/LADDER.md` § 8. |
| `supabase/DESIGN.md` | Principles, the schema as proposed, Edge Function roles, client integration, the formerly open questions and their decisions. | What is live now → `docs/STATUS.md`. |
| `supabase/functions/README.md` | What each Edge Function is for, and how to deploy one (closure file lists come from the fnfiles tool, never prose). | The guarded production rollout → `tools/functions/README.md`. |
| `tools/functions/README.md` | Guarded Edge Function rollouts: what the guard checks, why `gc-auth` deploys alone, adding a plan. | Database cutovers → `tools/database/README.md`. |
| `tools/database/README.md` | Production database cutovers as run: the progression-v2 activation record, BadRandolf transition testing, test-account reset and the bot population; the legacy v1 helpers refuse by design. | Migration authoring rules → backend. |
| `tools/debug/README.md` | Diagnosing a production match from its rows. | — |
| `docs/architecture/build.md` | Source and outputs, public assets and the service worker, the native wrapper, Node and CI, build verification. | Verifying a payload reached a device → the release rules in CLAUDE.md. |
| `docs/architecture/testing.md` | The release gate and its manifest, test ownership, assertion policy, native release verification, live tests, regression coverage for bug fixes, the traps this harness has already fallen into, change verification, the two-engine rule. | — |
| `design/README.md`, `README.md` → Design system, `design/fonts/README.md` | Claude Design cards: classification, study lifecycle, DesignSync; the root README's Design system section for the build; the fonts README for the typeface candidates of study 58 and what none of them cover. | The shipped face → `src/styles/foundations/typeface.css`. |
| `docs/MODES.md` | §1–3 what a mode may change, may not break, the registry; §4 ranked odds and progression (the live curve-v2 pool table); §5 lessons; §6 modes × spells; §7 the seven; §8 BOUNTY's coin; §9 LIMITED's bag; §10 future notebook (hypotheses, not roadmap). | Progression pacing → `docs/LADDER.md` § 7. |
| `docs/SPELLS.md` | §1–2 principles and house rules; §3 why COLUMN SWAP was retired; §4 the roster and its vs-bare numbers; §5 measurement; §6 adding a spell; §7 interface rules; §8 offline collections and ranked runes (Trial, CLAIM). | Ranked/equipped-rune decisions and their evidence → `docs/RUNE_MULTIPLAYER_INVESTIGATION.md`. |
| `docs/RUNE_MULTIPLAYER_INVESTIGATION.md` | The resolved implementation record, evidence discipline, format definitions, baseline facts, the simulator, state spaces, balance by format, authority and replay, progression scope, the decision checklist, the owner decision register. | Exploratory runes that never shipped → `docs/RUNE_CANDIDATE_STUDY.md`. |
| `docs/LADDER.md` | §1 points, §2 groups, §3 seasons, §4/§4b bots and their equipped seats, §5 the profile, §6 migration plan, §7 progression v2 (live since 2026-09-04), §8 the queue (position, liveness, abandonment, forfeits), appendix measurements and seating. | Client refusal on the curve cutover → `docs/CLIENT_COMPATIBILITY.md`. |
| `docs/IDENTITY.md` | Where identity lives, profile identity on this device, why connection failures are not sign-out, state, housekeeping. Guest upgrade, nickname, Apple, Game Center. | Auth schema → backend. |
| `docs/CLIENT_COMPATIBILITY.md` | §1 capabilities, not version numbers; §2 release phases; §3 the refusal and its wiring; §4 what the platforms give you; §5 the curve-v2 cutover as a worked example. | — |
| `docs/LEGAL.md` | Release status and the language decision, confirmed owner facts, remaining owner actions, what the final notice must match, deliverables, references. Impressum, privacy, consent, store audience. | Listing copy → the marketing README. |
| `marketing/app-store/ios/README.md`, `marketing/app-store/ios/DECISIONS.md` | The README: output layout, the single-source locale rule, regenerate and verify, the locked six-image story, listing ownership, the App Store Connect draft sync. DECISIONS: the exact fixtures, the matrix, superseded alternatives, truthfulness caveats, the regeneration contract and acceptance. | Legal and audience blockers → `docs/LEGAL.md`. |
| `docs/history/2026-08-sprint.md`, `docs/RUNE_CANDIDATE_STUDY.md`, `supabase/snapshots/2026-08-20-pre-ladder-ratings.md` | The sprint file: August 2026 production state then, what was built, standing rules learned the hard way, the ladder as shipped, open items of the day. The candidate study: exploratory runes, none shipped. The snapshot: ratings the moment before the ladder cutover. | Anything current → `docs/STATUS.md`. |

## When you learn something new

Write it into the document that owns the area, in the same change. If no
document owns it, say so and propose one — a decision that lives only in a
commit message will be rediscovered the expensive way. A new document gets a
row in `CLAUDE.md` and `AGENTS.md` (byte-identical) AND a row in the map
above; the router test will not let either drift. Never restate a number, a
list or a section number that another file owns — derive from the owner and
assert agreement (`CLAUDE.md`, "Derive, do not restate").

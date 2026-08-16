# Edge Functions

- `ranked-start` — issues a server-side dice seed (row in `ranked_sessions`)
- `ranked-submit` — replays the submitted move list against that seed via the
  shared game core and stores the score IT computes; every deviation → 422

## Deploying

The submit function imports `./core/replay.ts` (which pulls in
`./core/rules.ts`, `./core/dice.ts`, `./config.ts`). Those files are **not
duplicated here** — they are `src/core/*` and `src/config.ts`, uploaded
verbatim next to `index.ts` at deploy time. One rules implementation,
client and server.

Deploys so far go through the Supabase MCP (`deploy_edge_function`) with the
file set:

```
ranked-submit/
├── index.ts        (this repo: supabase/functions/ranked-submit/index.ts)
├── config.ts       (this repo: src/config.ts)
└── core/
    ├── rules.ts    (this repo: src/core/rules.ts)
    ├── dice.ts     (this repo: src/core/dice.ts)
    └── replay.ts   (this repo: src/core/replay.ts)
```

If deploys move to the Supabase CLI later, a sync step must copy those files
before `supabase functions deploy` — never hand-edit copies.

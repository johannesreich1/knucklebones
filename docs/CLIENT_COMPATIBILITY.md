# Client compatibility and phased server rollout

How an installed app and a moved server stay honest with each other, and the
order to change them in. Written 2026-09-04, the day a curve cutover refused
every client in production for two and a half hours.

The short version: **the server negotiates capabilities, not versions; a new
client plays the old world; and the server only moves once the old client is a
rounding error in real play.**

---

## 1. The mechanism: capabilities, not version numbers

The client tells the server what it can do; the server decides whether that is
enough. It never asks "which build is this".

```
client  → protocol_version: 2
          capabilities: ['rune_trial_v1','equipped_rune_v1','curve_v2','rune_trial_claim_v2']
server  → curve is 2; you speak curve_v2; admitted
```

`rankedJoinAdvertisement()` (`src/online/api/match-api.ts`) advertises against
the curve the server has **confirmed**, not against what the build can do:

- server on curve 1 → the client withholds `curve_v2` and `rune_trial_claim_v2`
- server on curve 2 → the client offers everything

This is the property the whole rollout order depends on: **a client built for
the new world plays the old one unchanged.** Ship it whenever; nothing moves
until the server does.

Prefer this to a `min_supported_version` field. A version number is a proxy for
capability and it is wrong in every interesting case — a fork, a TestFlight
build, a half-rolled-out feature, a reinstall of something ancient. Two sources
of truth also disagree eventually, and the version one is the one that will be
wrong. `public.enqueue_ranked_player_v3` validates the capability array itself;
that is the authority.

---

## 2. Release phases

For any server change that a client must understand, in this order:

**Phase 1 — ship the client that speaks both.**
Publish to every store. It advertises the new capability only once the server
confirms the new world, so it behaves exactly like the current build until then.
Nothing observable changes. This phase is safe to sit in indefinitely.

**Phase 2 — wait for adoption, and measure it.**
`public.matches.protocol_version` is durable, so real play answers the question:

```sql
select protocol_version,
       count(*) as matches,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from public.matches
where created_at > now() - interval '14 days'
group by protocol_version
order by protocol_version;
```

Wait for the old version to reach ≈0% of *active play*. Note what this is not:
it is not "the update is published". Publishing is an event, adoption is a long
tail, and on iOS there is no way to shorten it (§4).

**Phase 3 — move the server.**
Pause admission, drain, flip, verify, resume. `docs/architecture/backend.md`
carries the exact commands for the progression-v2 case.

**Phase 4 — the tail gets told.**
Whatever is left gets refused, and the refusal must say *update*, not *check
your connection*. See §3 — fixed 2026-09-04 (`749ecf69`); the store link in
that modal is still owed.

### When phases are not enough

A **points remap cannot be gradual.** v1 and v2 points mean different things, so
one ladder cannot hold both and the cutover is inherently a single transaction.
Most changes are not like this: prefer a server that accepts both shapes until
adoption catches up, and retire the old one later. Reach for a hard cutover only
when the data itself changes meaning.

A **server rule that depends on client cadence** is set for the *oldest
installed* cadence, not the newest. The queue's partner-freshness window
(`docs/LADDER.md` § 8) is 8s because builds before 2026-09-05 poll every 2.5s;
the 1s poll that shipped with it makes the same window ~8 polls wide, which is
merely slack. Tightening it is a Phase 2 → 3 move: measure adoption of the
1s build first, then lower the window. Reversed, a live player on the old
cadence would be treated as a ghost.

---

## 3. The refusal, and the wiring defect

### What the player should see

Ranked entry has exactly three connection states, all of them the **shared ask
card** (`src/ui/askcard.ts`, seven call sites). `connection-sheet.ts` supplies
copy and a retry decision; the card owns modal behaviour, focus and locale
repaint. No bespoke modal exists or should.

| state | title | when |
|---|---|---|
| `connection.offline` | YOU'RE OFFLINE | `navigator.onLine === false` |
| `connection.unavailable` | CAN'T CONNECT | the server could not be reached, or answered anything the client does not classify — today that includes a deliberately paused ladder (503 `ranked-paused`) |
| `connection.updateRequired` | UPDATE REQUIRED | this build cannot play the active rules |

`queue-screen.ts` already routes them: `status === 'unavailable'` →
`connectionUnavailable`, `status === 'incompatible'` → `updateRequired`.

### The refusal defect (fixed 2026-09-04)

**A capability refusal used to reach the player as "check your connection."**

`pvp-join/operation.ts` collapsed every RPC error into one answer:

```js
if (queueError || !queuedRaw || typeof queuedRaw !== 'object') {
  return json({ error: 'queue-failed' }, 500);
}
```

So when `enqueue_ranked_player_v3` raised `ranked client does not support active
curve v2` (P0001), the reason was discarded, the client saw a 500, and it showed
CAN'T CONNECT. A player who needed to update was sent to inspect their wifi.

**Fixed** by `pvp-join/enqueue-refusal.ts`: `classifyEnqueueFailure()` reads the
error and returns `incompatible-client` (409) for a capability refusal, 503 for
a paused admission, and `queue-failed` (500) only for what is genuinely
unclassified. The client already routed `incompatible` to UPDATE REQUIRED, so
this needed no new modal, copy or state — only to stop discarding the reason.
It reached production with pvp-join v46 (deployed 2026-09-05; the read-back
closure carries `enqueue-refusal.ts` and `queue-liveness.ts`).

The shape of that fix is the reusable part: **an Edge Function that collapses
distinct server refusals into one status is lying to the player**, and the lie
is invisible until the day a refusal is correct. Classify at the boundary.

**Still owed:** the modal tells the player to update but does not take them
anywhere. It should carry a store link — `itms-apps://` on iOS, the Play listing
on Android.

That belongs before any App Store submission. Until a binary ships, the only
affected device is the owner's; afterwards it is everyone who did not update,
and a build already in someone's hand cannot be fixed retroactively.

---

## 4. What the platforms actually give you

**iOS: no force-update API.** Not in StoreKit, not in App Store Connect. Phased
Release controls the speed of *automatic* updates (~7 days) but anyone can pull
a release manually on day one. The supported pattern is to compare the running
build against the store version — via your own backend or the iTunes Search API
— and present the store page with `SKStoreProductViewController`. Apple supplies
the presentation, never the compulsion.

One claim seen while researching this and **not verified**: that Apple's
guidelines forbid blocking a user until they update. The guideline text found
concerns forcing ratings, reviews and downloads of *other* apps, which is a
different thing, and hard update gates are common in shipped apps. Treat as
unconfirmed; confirm before building a hard block rather than a soft prompt.

**Android: Play In-App Updates** (`AppUpdateManager`) is real, with a FLEXIBLE
flow (background download, keep playing) and an IMMEDIATE flow (full-screen,
Play-owned, cannot proceed). IMMEDIATE is a genuine forced update. It requires
install-from-Play and an available update.

Since iOS needs a server-driven answer regardless, build that first; Android's
IMMEDIATE flow is then a nicer front-end for the same decision, not a second
system.

**Territories are not the risk.** An approved App Store version is available in
every enabled territory at once. There is no country-by-country race to lose —
the variable is adoption time, not availability.

---

## 5. Worked example: the curve-v2 cutover, 2026-09-04

Kept because it is the cheapest way to see all of the above at once.

Progression v2 was activated in production: 205 profiles and 203 season rows
remapped, scoring and curve switched together, about four minutes of paused
admission with nothing in flight. It went cleanly. Then **every enqueue failed,
for every client, including a freshly built one** — 0 queue rows and 0 matches
until the repair shipped.

The cause was not compatibility at all. `private.guard_ranked_admission()` fires
BEFORE INSERT on `matchmaking_queue`, and `public.enqueue_ranked_player()`
inserts `player_id` only — so the guard read the column defaults
(`protocol_version = 1`, `capabilities = '{}'`) rather than the client's real
values, which arrive in an UPDATE one statement later that never ran. The repair
is one condition (`and not v_transition`) in
`20260904145925_curve_v2_queue_admission.sql`, and the function already carried
the proof of intent: the curve check one line above honours that flag, and the
matches branch honours it in both of its checks.

Three lessons, in the order they cost time:

1. **The gate had the hole before the bug did.** `progression-v2.test.sql` had
   59 assertions and not one enqueued anything after the curve flipped. It is 64
   now: without the migration, tests 34 and 35 fail.
2. **The refusal was unreadable.** Even correct behaviour reached the player as
   "check your connection" — §3.
3. **Nobody else was affected, by luck rather than design.** No binary had
   shipped, and 100% of the prior 30 days' matches were already
   `protocol_version = 2`. The phases in §2 exist so the next one does not
   depend on that.

Related: the pgTAP suites in `supabase/tests/database/` do not run in
`npm test` at all, which is why a green gate (103 suites, that day) shipped a
dead queue.
Closing that is separate, open, and worth more than either fix above.

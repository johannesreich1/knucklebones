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
your connection*. See §3, which is currently a known defect.

### When phases are not enough

A **points remap cannot be gradual.** v1 and v2 points mean different things, so
one ladder cannot hold both and the cutover is inherently a single transaction.
Most changes are not like this: prefer a server that accepts both shapes until
adoption catches up, and retire the old one later. Reach for a hard cutover only
when the data itself changes meaning.

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
| `connection.unavailable` | CAN'T CONNECT | the server could not be reached |
| `connection.updateRequired` | UPDATE REQUIRED | this build cannot play the active rules |

`queue-screen.ts` already routes them: `status === 'unavailable'` →
`connectionUnavailable`, `status === 'incompatible'` → `updateRequired`.

### The defect (open)

**A capability refusal reaches the player as "check your connection."**

`supabase/functions/pvp-join/operation.ts` collapses every RPC error into one
answer:

```js
if (queueError || !queuedRaw || typeof queuedRaw !== 'object') {
  return json({ error: 'queue-failed' }, 500);
}
```

So when `enqueue_ranked_player_v3` raises `ranked client does not support active
curve v2` (P0001), the reason is discarded, the client sees a 500, and it shows
CAN'T CONNECT. A player who needs to update is sent to inspect their wifi.

**The fix** is to catch that P0001 and return `{ error: 'incompatible-client' }`
with 409 — the same answer `operation.ts` already returns from its own
pre-insert guard, and which the client already routes to UPDATE REQUIRED. No new
modal, no new copy, no new state: stop discarding the reason.

**Also owed:** the modal tells the player to update but does not take them
anywhere. It should carry a store link — `itms-apps://` on iOS, the Play listing
on Android.

Both belong before any App Store submission. Until a binary ships, the only
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

Related: the 16 pgTAP suites in `supabase/tests/database/` do not run in
`npm test` at all, which is why a 103-suite green gate shipped a dead queue.
Closing that is separate, open, and worth more than either fix above.

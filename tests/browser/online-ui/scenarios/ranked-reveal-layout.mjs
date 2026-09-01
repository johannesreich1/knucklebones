// THE PAIRING STANDS STILL ACROSS THE WHOLE RANKED BEAT.
//
// A ranked Rune Ritual is three screens with no transition between them: the
// mode dial settling, the private choice on top of it, and both runes turned
// over. The two players and their VS are on all three, so the line jumping
// between them is the kind of fault a player sees immediately and a suite
// never does. Reported from a device with the three screenshots side by side.
//
// IT WENT UNCAUGHT BECAUSE NOTHING COULD REACH THE RANKED LAYOUT. Producing it
// otherwise needs a live match, a dealt offer and a server deadline, so the
// first probe written for this injected a pairing into an OFFLINE reveal, which
// carries none of its own (.dwho:empty is display:none). That landed close
// enough to the choice sheet's own fallback that the assertion passed with the
// alignment REMOVED — a test that agreed with the bug.
//
// __kbRankedReveal runs the real thing instead, the same way __kbResult drives
// the result screen. Everything below is measured off that.

const PAIRING = {
  me: { name: 'BadRandolf', rating: 462, avatar: 'die:6:cy' },
  foe: { name: 'BoldFox762', rating: 555, avatar: 'die:3:mg' },
};

export async function runRankedRevealLayoutScenarios({ visit, out, check }) {
  const seen = await visit({
    named: true,
    skipStandardProbes: true,
    probe: (page) => page.evaluate(async (pairing) => {
      const box = (selector) => {
        const el = document.querySelector(selector);
        if (!el || el.hidden) return null;
        const r = el.getBoundingClientRect();
        return r.height > 0 ? { top: r.top, bottom: r.bottom, mid: r.top + r.height / 2 } : null;
      };
      const read = {};
      const finished = window.__kbRankedReveal({
        modeId: 'rune_trial',
        pairing,
        /* rune_trial is a format the mode registry does not carry, so ranked
           supplies its copy; the words do not matter to a layout reading, only
           that the dial can name what it landed on. */
        copy: (id) => ({ name: id === 'rune_trial' ? 'RUNE RITUAL' : id,
                         blurb: 'Choose one of three runes in secret.' }),
        candidates: [{ id: 'rune_trial' }, { id: 'classic' }, { id: 'limited' }],
        sides: async () => {
          /* The dial has landed and the pairing is painted: this is the first of
             the three screens, in its real ranked layout. */
          read.reveal = box('#wheelWho');
          /* Now the choice, opened over it exactly as ranked opens it. */
          const chosen = window.__kbTrialPick(['fate', 'ward', 'sunder'], {
            player: { name: () => 'YOU', hue: 'var(--p1)' },
            deadline: () => new Date(Date.now() + 10_000).toISOString(),
            versus: pairing,
            claim: { rewardVersion: 2, slot: 1, rune: 'ward' },
            claimOwned: false,
          });
          await new Promise((resolve) => setTimeout(resolve, 400));
          read.choice = box('#trialSelectWho');
          read.cards = box('#trialSelectCards');
          read.viewportMid = window.innerHeight / 2;
          read.names = [...document.querySelectorAll('#trialSelectWho .dnm')]
            .map((n) => n.textContent);
          read.claims = [...document.querySelectorAll('#trialSelectCards [data-claim="true"]')]
            .map((card) => ({
              rune: card.dataset.rune,
              claim: card.querySelector('.trial-select__claim')?.textContent?.trim(),
              ownership: card.querySelector('.trial-select__claim-owned')?.textContent?.trim(),
              badge: box('.trial-select__claim'),
            }));
          document.querySelector('#trialSelectCards button')?.click();
          await chosen;
          /* Null abandons the sequence, which the shell handles — the measuring
             is done and there is no reason to sit through the turn-over. */
          return null;
        },
      });
      await finished;
      return read;
    }, PAIRING),
  });
  out.rankedRevealLayout = seen.probeResult;
  const r = seen.probeResult;

  check(!!r && !!r.reveal,
    'the ranked reveal painted no pairing, so nothing below is measuring it', r);
  check(!!r && !!r.choice && r.names.join('|') === 'BadRandolf|BoldFox762',
    'the choice sheet lost the pairing the reveal was showing', r);
  check(!!r && r.claims.length === 1 && r.claims[0].rune === 'ward'
      && r.claims[0].claim === 'CLAIM' && r.claims[0].ownership === 'NEW'
      && !!r.claims[0].badge,
    'ranked Rune Ritual did not visibly mark exactly its snapshotted CLAIM card before choice', r);
  /* THE assertion. One pixel for rounding; the fault this was written for was
     a fixed offset sitting ~50px above the reveal's own line. */
  check(!!r && !!r.reveal && !!r.choice && Math.abs(r.choice.top - r.reveal.top) <= 1,
    'THE PAIRING JUMPS BETWEEN THE REVEAL AND THE CHOICE SHEET',
    { reveal: r.reveal, choice: r.choice });
  /* ...and the cards still sit in the middle of the sheet rather than being
     shoved down by a pairing that now has real height above them. */
  check(!!r && !!r.cards
    && Math.abs(r.cards.mid - r.viewportMid) < r.viewportMid * 0.25,
  'the choice sheet is no longer centred once the pairing is on it', r);

  await runBareRitualScenarios({ visit, out, check });
  await runStandardRuneRevealScenarios({ visit, out, check });
  await runStandardRuneRejoinScenarios({ visit, out, check });
  await runUnreadableTrialRejoinScenario({ visit, out, check });
}

// NOTHING HANGS OVER THE TURNED-OVER RUNES.
//
// The Ritual's final beat is declared `bare`: it prints no name line and no
// blurb, because the two cards ARE the answer. But the reveal's settled strip is
// a separate surface — absolutely positioned near the top of the screen — and
// the runner wrote the PREVIOUS beat's answer into it at every swap without
// asking whether the beat it was about to sit over wanted one. So the mode
// dial's own "RUNE RITUAL" pill reappeared above the cards one beat after being
// stripped from them. Reported from a device 2026-08-30: "the tag that is
// positioned on top still flickers through in online mode... we wanted to fully
// remove it."
//
// MEASURE THE PAINTED BOX. `.wsettled:empty{display:none}` means an empty strip
// is invisible while a filled one is not, and both answer querySelector the
// same way — counting nodes here would pass either way.
const SIDES = [
  { spell: { id: 'fate' }, name: () => 'BadRandolf', hue: '#28e8ff' },
  { spell: { id: 'ward' }, name: () => 'BoldFox762', hue: '#ff2fa0' },
];

async function runBareRitualScenarios({ visit, out, check }) {
  const seen = await visit({
    named: true, skipStandardProbes: true,
    probe: (page) => page.evaluate(async ({ pairing, sides }) => {
      const painted = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return {
          visible: !el.hidden && getComputedStyle(el).display !== 'none'
            && box.height > 0,
          height: Math.round(box.height),
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
        };
      };
      const read = {};
      const finished = window.__kbRankedReveal({
        modeId: 'rune_trial',
        pairing,
        copy: (id) => ({ name: id === 'rune_trial' ? 'RUNE RITUAL' : id,
                         blurb: 'Choose one of three runes in secret.' }),
        candidates: [{ id: 'rune_trial' }, { id: 'classic' }, { id: 'limited' }],
        sides: async () => {
          /* Dismiss the choice the moment it opens: this measures the beat
             AFTER it, which is the one that was wearing the stale tag. */
          const chosen = window.__kbTrialPick(['fate', 'ward', 'sunder'], {
            player: { name: () => 'YOU', hue: 'var(--p1)' },
            versus: pairing,
          });
          await new Promise((resolve) => setTimeout(resolve, 300));
          document.querySelector('#trialSelectCards button')?.click();
          await chosen;
          return sides.map((side, index) => ({ ...side, name: () => side.nameText ?? ['BadRandolf', 'BoldFox762'][index] }));
        },
      });
      /* WAIT FOR THE BEAT, DO NOT GUESS AT IT. The dial settles on its own
         schedule and the choice sits in front of it; a fixed delay sampled the
         DIAL and reported the tag missing from a beat that was never on
         screen. Poll for the cards, then read. */
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && !document.querySelector('.trial-reveal')) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      read.settled = painted('#wheelSettled');
      read.name = painted('#wheelName');
      read.blurb = painted('#wheelBlurb');
      read.cards = painted('.trial-reveal');
      await finished;
      return read;
    }, { pairing: PAIRING, sides: SIDES.map((s) => ({ spell: s.spell, hue: s.hue })) }),
  });
  out.bareRitualReveal = seen.probeResult;
  const r = seen.probeResult;

  check(!!r?.cards?.visible,
    'the turned-over runes never reached the screen, so nothing below is '
    + 'measuring the beat that wears the tag', r);
  /* THE assertion. */
  check(!!r && !r.settled?.visible,
    'THE RITUAL STILL WEARS A TAG ABOVE ITS CARDS — the previous beat settles '
    + 'into a strip pinned near the top of the screen, which is the line the '
    + 'beat was declared bare to remove', r);
  /* ...and the two lines the beat was already stripped of stay gone, so the fix
     is not a blanket repaint that put the shell copy back. */
  check(!!r && !r.name?.visible && !r.blurb?.visible,
    'the bare beat printed its name or blurb after all', r);
}

// STANDARD RANKED NEVER BORROWS RUNE TRIAL'S CARD-TURNOVER BEAT.
//
// Immutable equipped seats still belong to the match and may paint on the
// table, but only Rune Trial makes revealing both runes the game mode itself.
// Watch a fresh match from before the queue opens: calling the shared reveal
// hook directly would let the test construct a standard-only beat production
// no real flow is meant to request.
const STANDARD_REVEAL_RECORDER = () => {
  const w = window;
  w.__kbStandardReveal = {
    overlayFrames: 0,
    pairedFrames: 0,
    rankedTitleFrames: 0,
  };
  const painted = (element) => {
    if (!element || element.hidden) return false;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) > 0;
  };
  const tick = () => {
    const read = w.__kbStandardReveal;
    const overlay = document.getElementById('ovWheel');
    if (painted(overlay)) {
      read.overlayFrames++;
      if (painted(overlay.querySelector('.trial-reveal'))) read.pairedFrames++;
      if (painted(document.getElementById('wheelTitle'))
          && document.querySelector('#wheelTitle .wtitlecopy')?.textContent?.trim()
            === 'RANKED RUNES') {
        read.rankedTitleFrames++;
      }
    }
    if (!w.__kbOnline?.()) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const readStandardEntry = (page) => page.evaluate(() => {
  const cards = [...document.querySelectorAll('#spellBar .rune')]
    .filter((element) => !element.hidden && element.getBoundingClientRect().height > 0)
    .map((element) => `${element.dataset.seat}:${element.dataset.spell}`)
    .sort();
  return { ...window.__kbStandardReveal, cards };
});

async function runStandardRuneRevealScenarios({ visit, out, check }) {
  const empty = await visit({
    named: true, skipStandardProbes: true, door: 'match',
    trialMatch: {
      format: 'standard', rejoined: false, myRune: null, foeRune: null,
    },
    matchReadySelector: null,
    initScript: STANDARD_REVEAL_RECORDER,
    probe: readStandardEntry,
  });
  const equipped = await visit({
    named: true, skipStandardProbes: true, door: 'match',
    trialMatch: {
      format: 'standard', rejoined: false, myRune: 'ward', foeRune: 'pilfer',
    },
    initScript: STANDARD_REVEAL_RECORDER,
    probe: readStandardEntry,
  });
  out.standardRuneReveal = {
    empty: empty.probeResult,
    equipped: equipped.probeResult,
  };
  const e = empty.probeResult;
  const r = equipped.probeResult;

  check(!!e && e.overlayFrames > 0,
    'the empty-seat case never crossed a real fresh ranked reveal', e);
  check(!!e && e.pairedFrames === 0 && e.rankedTitleFrames === 0,
    'STANDARD RANKED PAINTED RUNE TRIAL\'S PAIRED CARD BEAT for two empty seats', e);
  check(!!e && e.cards.length === 0,
    'a standard match with two null snapshots invented a table rune', e);

  check(!!r && r.overlayFrames > 0,
    'the equipped-seat case never crossed a real fresh ranked reveal', r);
  check(!!r && r.pairedFrames === 0 && r.rankedTitleFrames === 0,
    'STANDARD RANKED PAINTED RUNE TRIAL\'S PAIRED CARD BEAT even though its '
    + 'immutable runes belong only on the table', r);
  check(!!r && r.cards.join('|') === '0:pilfer|1:ward',
    'the standard reveal was removed by dropping the immutable runes from the game', r);
  check(empty.errs.length === 0 && equipped.errs.length === 0,
    'page errors during fresh standard ranked entries', { empty: empty.errs, equipped: equipped.errs });
}

// A STANDARD REJOIN SKIPS THE REVEAL BUT KEEPS ITS NULLABLE RUNE SNAPSHOT.
//
// The ordinary ranked contract permits either seat to be empty. Rejoining a
// playing match must therefore use the same nullable validation as a fresh
// entry, then carry every non-empty immutable rune onto the shared table. It
// must not tighten the row to Rune Trial's two-mandatory-runes contract merely
// because both paths share the no-reveal queue branch.
async function runStandardRuneRejoinScenarios({ visit, out, check }) {
  const empty = await visit({
    named: true, skipStandardProbes: true, door: 'match',
    trialMatch: {
      format: 'standard', rejoined: true, myRune: null, foeRune: null,
    },
    matchReadySelector: null,
    initScript: STANDARD_REVEAL_RECORDER,
    probe: readStandardEntry,
  });
  const equipped = await visit({
    named: true, skipStandardProbes: true, door: 'match',
    trialMatch: {
      format: 'standard', rejoined: true, myRune: 'ward', foeRune: null,
    },
    matchReadySelector: null,
    initScript: STANDARD_REVEAL_RECORDER,
    probe: readStandardEntry,
  });
  out.standardRuneRejoin = {
    empty: empty.probeResult,
    equipped: equipped.probeResult,
  };
  const e = empty.probeResult;
  const r = equipped.probeResult;

  check(!!e && e.overlayFrames === 0 && e.pairedFrames === 0
      && e.rankedTitleFrames === 0 && e.cards.length === 0,
    'a valid empty-seat STANDARD rejoin was rejected or borrowed Rune Trial reveal UI', e);
  check(!!r && r.overlayFrames === 0 && r.pairedFrames === 0
      && r.rankedTitleFrames === 0 && r.cards.join('|') === '1:ward',
    'a valid nullable STANDARD rejoin lost its equipped rune or borrowed Rune Trial reveal UI', r);
  check(empty.errs.length === 0 && equipped.errs.length === 0,
    'page errors during valid standard ranked rejoins', { empty: empty.errs, equipped: equipped.errs });
}

// A REJOIN HAS NO REVEAL TO VALIDATE ITS TWO SETTLED CHOICES.
//
// An unknown server rune must therefore fail at the queue boundary just like
// an unknown rune in a fresh reveal. Entering the shared table would silently
// turn that seat into NONE because the local registry cannot make charges for
// it, replaying a different match from the authoritative row.
async function runUnreadableTrialRejoinScenario({ visit, out, check }) {
  const rejected = await visit({
    named: true,
    skipStandardProbes: true,
    door: 'match',
    expectMatchRejection: true,
    trialMatch: {
      format: 'rune_trial', rejoined: true,
      myRune: 'future-rune', foeRune: 'ward',
    },
    matchReadySelector: null,
    probe: async (page, routes) => ({
      ...await page.evaluate(() => ({
        homeVisible: document.getElementById('ovStart')?.classList.contains('on'),
        onlineOpen: document.getElementById('ovOnline')?.classList.contains('on'),
        onlineMatch: window.__kbOnline?.() ?? null,
        tableVisible: document.getElementById('game')?.hidden === false,
      })),
      joinCalls: routes.trialJoinCalls?.() ?? 0,
    }),
  });
  out.unreadableTrialRejoin = rejected.probeResult;
  check(rejected.probeResult?.homeVisible
      && !rejected.probeResult.onlineOpen
      && rejected.probeResult.onlineMatch === null
      && !rejected.probeResult.tableVisible
      && rejected.probeResult.joinCalls === 1,
    'an unreadable settled Rune Trial rejoin entered the shared table instead of failing closed',
    rejected.probeResult);
  check(rejected.errs.length === 0,
    'rejecting an unreadable settled Rune Trial raised a page error', rejected.errs);
}

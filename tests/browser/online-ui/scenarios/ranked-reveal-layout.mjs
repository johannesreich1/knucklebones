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
          });
          await new Promise((resolve) => setTimeout(resolve, 400));
          read.choice = box('#trialSelectWho');
          read.cards = box('#trialSelectCards');
          read.viewportMid = window.innerHeight / 2;
          read.names = [...document.querySelectorAll('#trialSelectWho .dnm')]
            .map((n) => n.textContent);
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

// STANDARD RANKED REVEALS THE TWO IMMUTABLE SEATS TOO.
//
// Unlike Rune Ritual, these are not two mandatory private choices. Each side
// is the snapshot matchmaking wrote from that profile's equipped seat: a real
// rune or honest NONE, independently. The reveal must therefore keep two
// owner-labelled cards even when only one rune exists, and it must not invent a
// rune when both match-row fields are null.
async function runStandardRuneRevealScenarios({ visit, out, check }) {
  const seen = await visit({
    named: true, skipStandardProbes: true,
    probe: (page) => page.evaluate(async ({ pairing }) => {
      const revealCase = async (sides) => {
        const finished = window.__kbRankedReveal({
          modeId: 'classic',
          pairing,
          candidates: [{ id: 'classic' }, { id: 'limited' }],
          rankedSides: sides,
        });
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && !document.querySelector('.trial-reveal')) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const read = {
          title: document.querySelector('#wheelTitle .wtitlecopy')?.textContent?.trim(),
          owners: [...document.querySelectorAll('.trial-reveal__owner .nm')]
            .map((element) => element.textContent?.trim()),
          runes: [...document.querySelectorAll('.trial-reveal__card')]
            .map((element) => element.dataset.rune),
          labels: [...document.querySelectorAll('.trial-reveal__card .rlbl')]
            .map((element) => element.textContent?.trim()),
          visible: [...document.querySelectorAll('.trial-reveal__card')]
            .every((element) => {
              const box = element.getBoundingClientRect();
              return box.width > 0 && box.height > 0 && getComputedStyle(element).opacity === '1';
            }),
        };
        document.querySelector('#ovWheel')?.dispatchEvent(new PointerEvent(
          'pointerdown', { bubbles: true },
        ));
        await finished;
        return read;
      };
      return {
        oneSided: await revealCase([
          { spell: { id: 'ward' }, nameText: 'BadRandolf', hue: '#28e8ff' },
          { spell: null, nameText: 'BoldFox762', hue: '#ff2fa0' },
        ]),
        empty: await revealCase([
          { spell: null, nameText: 'BadRandolf', hue: '#28e8ff' },
          { spell: null, nameText: 'BoldFox762', hue: '#ff2fa0' },
        ]),
      };
    }, { pairing: PAIRING }),
  });
  out.standardRuneReveal = seen.probeResult;
  const r = seen.probeResult;

  check(r?.oneSided?.title === 'RANKED RUNES'
      && r.oneSided.owners.join('|') === 'BadRandolf|BoldFox762'
      && r.oneSided.runes.join('|') === 'ward|none'
      && r.oneSided.labels.join('|') === 'WARD|NONE'
      && r.oneSided.visible,
    'a fresh standard match did not reveal its one equipped seat and one explicit NONE',
    r?.oneSided);
  check(r?.empty?.title === 'RANKED RUNES'
      && r.empty.owners.join('|') === 'BadRandolf|BoldFox762'
      && r.empty.runes.join('|') === 'none|none'
      && r.empty.labels.join('|') === 'NONE|NONE'
      && r.empty.visible,
    'a fresh standard match invented or hid a rune when both immutable seats were empty',
    r?.empty);
  check(seen.errs.length === 0, 'page errors during standard ranked rune reveals', seen.errs);
}

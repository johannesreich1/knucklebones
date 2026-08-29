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
}

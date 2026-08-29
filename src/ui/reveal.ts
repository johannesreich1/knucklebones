// THE PRE-GAME REVEAL answers "what am I about to play?" with one sequence of
// beats and ONE countdown (ui/reveal-hold.ts). Each beat owns its theatre and
// answer; this shell alone owns the overlay, title, settled strip, readout,
// note line, sequencing, and anti-spoiler rule. Answers are written only after
// landing, so a beat cannot leak early.
//
// A beat may also be DEFERRED — see `Act` below. Everything the player is asked
// between two answers belongs inside this one overlay: the Rune Trial's private
// choice opens over the mode the dial just found and turns both hands over on
// the same stage. Closing the overlay to ask a question and opening it again to
// answer it is the shape that was here before, and it read as a second spin.
// `#ovWheel` stays stable because tests, CSS, and design cards already share it.
import type { ModeSpec } from '../core/modes.ts';
import type { Player } from '../core/rules.ts';
import type { SpellSpec } from '../core/spells.ts';
import { formatNumber, subscribeLocale, t } from '../i18n/index.ts';
import { dialBeat } from './modedial.ts';
import type { DialModeChoice, DialModeCopy } from './modedial.ts';
import { dealBeat } from './runedeal.ts';
import { trialRuneRevealBeat, type TrialRevealSide } from './trial-reveal.ts';
import { paintAvatar } from './avatar.ts';
import { $, show, hide } from './dom.ts';
import { appRoot } from './embed.ts';
import { colorOf, nameOf } from './identity.ts';
import { hold } from './reveal-hold.ts';
import { ownerEyebrow, settledAnswer, versus } from './reveal-answer.ts';
import type { Beat, DialPeer, DialSide } from './reveal-types.ts';

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(() => r(), ms));

/* One rune beat: what was drawn, for whom, and the deck the shuffle may show.
   `player` is what makes a deal OWNED — a shared RANDOM rune simply omits it
   and keeps the deal's own title with no eyebrow. `candidates` must be the
   roster the draw could actually have come from, or the shuffle fans cards it
   could never have turned over. */
export interface RuneDeal {
  readonly spell: SpellSpec;
  readonly player?: Player;
  readonly candidates?: readonly SpellSpec[];
}

/* One beat of the reveal: a question, its theatre, and its answer.
   `run` resolves when the answer is on screen and the readout may be written;
   it calls `settle` at the moment the theatre stops hunting, which is what
   flips the overlay from `.hunting` to `.landed`. Splitting those two lets a
   beat land its own last frame (the dial holds its winner's flare through
   one more frame) without the shell knowing how. */
let built = false;
function build(): void {
  if (built) return;
  built = true;
  appRoot().insertAdjacentHTML('beforeend', `
<div class="ov" id="ovWheel">
  <div class="dwho" id="wheelWho"></div>
  <div class="wsettled" id="wheelSettled"></div>
  <div class="wtitle" id="wheelTitle"><span class="wtitlecopy">${t('game', 'reveal.gameMode')}</span>
    ${ownerEyebrow(undefined, undefined, 'wheelOwner')}</div>
  <div class="wstage" id="wheelStage"></div>
  <div class="wname" id="wheelName">&nbsp;</div>
  <div class="wblurb" id="wheelBlurb">&nbsp;</div>
  <div class="wnote" id="wheelNote" hidden></div>
  <div class="dhold" id="wheelHold"><b id="wheelCount">&nbsp;</b><span id="wheelHint">&nbsp;</span></div>
</div>`);
}

/* One line under the readout for something that is neither an answer nor a
   question: a wait the player did not ask for and cannot shorten. It is the
   shell's, not a beat's, because a beat has ended by the time it is needed. */
function note(text: string | null): void {
  if (!built) return;
  const line = appRoot().querySelector<HTMLElement>('#wheelNote');
  if (!line) return;
  line.textContent = text ?? '';
  line.hidden = !text;
}

interface ActiveReveal {
  readonly ov: HTMLElement;
  readonly beats: Beat[];
  readonly me?: DialSide;
  readonly foe?: DialSide;
  activeIndex: number;
  landed: boolean;
  repaintHold?: () => void;
}

let activeReveal: ActiveReveal | null = null;

function repaintRating(side: Element | null, player?: DialSide): void {
  const rating = side?.querySelector<HTMLElement>('.rt');
  if (rating && player?.rating != null) rating.textContent = formatNumber(player.rating);
}

/** Paint the prompt and its optional recipient without replacing either node. */
function repaintTitle(ov: HTMLElement, beat: Beat): void {
  const title = ov.querySelector<HTMLElement>('#wheelTitle');
  const copy = title?.querySelector<HTMLElement>('.wtitlecopy');
  const owner = title?.querySelector<HTMLElement>('#wheelOwner');
  const ownerName = owner?.querySelector<HTMLElement>('.wownername');
  const context = beat.context;
  if (copy) copy.textContent = beat.label;
  if (!title || !owner || !ownerName) return;
  title.classList.toggle('has-owner', !!context);
  owner.hidden = !context;
  ownerName.textContent = context ?? '';
  if (context) owner.style.color = beat.contextHue ?? beat.hue;
  else owner.style.removeProperty('color');
}

/**
 * Repaint only locale-owned text in the live reveal. Theatre markup, settled
 * cards, avatars, listeners, and WAAPI animations remain the exact same nodes.
 */
function repaintReveal(context: ActiveReveal): void {
  const { ov, beats } = context;
  const beat = beats[context.activeIndex];
  if (!beat) return;

  const who = ov.querySelector<HTMLElement>('#wheelWho');
  const versusLabel = who?.querySelector<HTMLElement>('.dvs');
  if (versusLabel) versusLabel.textContent = t('common', 'versus');
  repaintRating(who?.querySelector('.dside.me') ?? null, context.me);
  repaintRating(who?.querySelector('.dside.foe') ?? null, context.foe);

  repaintTitle(ov, beat);
  const stage = ov.querySelector<HTMLElement>('#wheelStage');
  if (stage) beat.repaintStage?.(stage);

  /* A bare beat prints neither line, and hides the elements rather than
     emptying them: an empty .wname still holds its own height, which would
     leave the cards floating above a gap that reads as a missing answer. */
  const nameLine = ov.querySelector<HTMLElement>('#wheelName');
  const blurbLine = ov.querySelector<HTMLElement>('#wheelBlurb');
  if (nameLine) nameLine.hidden = !!beat.bare;
  if (blurbLine) blurbLine.hidden = !!beat.bare;
  if (context.landed && !beat.bare) {
    const currentName = ov.querySelector<HTMLElement>('#wheelName .wcopy');
    const currentBlurb = ov.querySelector<HTMLElement>('#wheelBlurb');
    if (currentName) currentName.textContent = beat.name;
    if (currentBlurb) currentBlurb.textContent = beat.blurb;
  }

  const settledStrip = ov.querySelector<HTMLElement>('#wheelSettled');
  if (settledStrip) settledStrip.hidden = !!beat.bare;
  ov.querySelectorAll<HTMLElement>('#wheelSettled .wsett').forEach((answer, index) => {
    const settledBeat = beats[index];
    if (!settledBeat) return;
    const name = answer.querySelector<HTMLElement>('.wpill b');
    const owner = answer.querySelector<HTMLElement>('.wownername');
    const blurb = answer.querySelector<HTMLElement>('.wblurb');
    if (name) name.textContent = settledBeat.name;
    if (owner && settledBeat.context) owner.textContent = settledBeat.context;
    if (blurb) blurb.textContent = settledBeat.blurb;
  });
  context.repaintHold?.();
}

subscribeLocale(() => {
  if (activeReveal?.ov.classList.contains('on')) repaintReveal(activeReveal);
});

/* WHAT THE OVERLAY IS WEARING, remembered by the shell that put it on.
   A beat dresses the overlay while it runs — the rune deal's `dealing` resizes
   --stage to a CARD, and the title, the name and the blurb are all anchored to
   --stage — so taking that dress off is not optional. It used to be taken off
   by naming the classes THIS reveal uses, which is a list that cannot know
   about the last one: the final beat's class was never removed at all, so an
   offline deal left `dealing` behind and the next ranked reveal (mode only,
   which never asks for `dealing` to come off) measured its readout against a
   card while the dial was on screen — and printed the answer across the wheel
   it was still turning. Remembering beats listing: there is nothing to keep in
   sync, and a beat added later is undressed by code that never heard of it. */
let worn: string | null = null;
function wear(ov: HTMLElement, cls?: string): void {
  if (worn) ov.classList.remove(worn);
  worn = cls ?? null;
  if (worn) ov.classList.add(worn);
}

/* How long a landed answer stays ALONE on the stage before the next beat takes
   it. Long enough to actually read the name and the rule that just arrived —
   at a second it was a glimpse, and the eye was still on the dial when the
   deck replaced it (user call). */
const READ_MS = 1500;
const SWAP_MS = 260;

/* A beat that does not exist yet: it is produced only once the beat before it
   has been read. That is the Rune Trial's whole shape — the mode lands, the
   choice is made ON TOP of the overlay that is still showing it, and only then
   is there a pair of runes to turn over. Resolving to null means the sequence
   was abandoned (the queue generation was replaced, the player backed out) and
   the overlay leaves without a hold. */
type Act = Beat | (() => Promise<Beat | null>);

/** run the reveal for whatever was left to chance; resolves when the player is done */
export async function reveal(opts: {
  mode?: Pick<ModeSpec, 'id'> | null;
  modeCandidates?: readonly DialModeChoice[];
  modeCopy?: (id: string) => DialModeCopy;
  runes?: readonly RuneDeal[];
  trial?: {
    /* Runs while the mode it belongs to is still on the stage. `note` writes
       one line under the readout — the opponent's clock — and is cleared for
       whatever comes next. */
    resolve: (note: (text: string | null) => void) =>
      Promise<readonly [TrialRevealSide, TrialRevealSide] | null>;
  };
  peer?: DialPeer; me?: DialSide; foe?: DialSide;
}): Promise<void> {
  const acts: Act[] = [];
  if (opts.mode) acts.push(dialBeat(opts.mode, {
    candidates: opts.modeCandidates,
    copy: opts.modeCopy,
  }));
  for (const rune of opts.runes ?? []) {
    const owner = rune.player;
    acts.push(dealBeat(rune.spell, owner === undefined ? { candidates: rune.candidates } : {
      candidates: rune.candidates,
      label: () => t('game', 'reveal.runeFor'),
      context: () => nameOf(owner),
      contextHue: colorOf(owner),
    }));
  }
  const trial = opts.trial;
  if (trial) acts.push(async () => {
    const sides = await trial.resolve(note);
    return sides ? trialRuneRevealBeat(sides) : null;
  });
  if (!acts.length) return;                // nothing was left to chance
  build();
  const ov = $('#ovWheel');
  /* A ranked match is a comparison, so the screen shows the comparison: both
     players, both ratings — each wearing the profile avatar they chose, the
     same face the ladder and the face-off card show for them. */
  const who = $('#wheelWho');
  who.innerHTML = opts.foe && opts.me ? versus(opts.me, opts.foe) : '';
  if (opts.foe && opts.me) {
    paintAvatar(who.querySelector('.dside.me .dav') as HTMLElement, opts.me.avatar, 44);
    paintAvatar(who.querySelector('.dside.foe .dav') as HTMLElement, opts.foe.avatar, 44);
  }
  const settled = $('#wheelSettled'), stage = $('#wheelStage');
  settled.innerHTML = '';
  settled.removeAttribute('data-count');
  ov.classList.remove('landed', 'ready', 'holding');
  note(null);
  wear(ov);                       // whatever the LAST reveal left on, whoever ran it
  show('#ovWheel');
  const beats: Beat[] = [];
  const context: ActiveReveal = {
    ov,
    beats,
    me: opts.me,
    foe: opts.foe,
    activeIndex: 0,
    landed: false,
  };
  activeReveal = context;
  let held = false;

  try {
    for (let k = 0; k < acts.length; k++) {
      const act = acts[k];
      /* Resolved BEFORE the beat it follows is retired, so a deferred act runs
         over a stage that still shows the answer it belongs to, and what it
         opened dismisses onto the settled strip rather than onto nothing. */
      const beat = typeof act === 'function' ? await act() : act;
      if (!beat) return;                     // abandoned; the finally undresses
      if (k > 0) {
        note(null);
        settled.insertAdjacentHTML('beforeend', settledAnswer(beats[k - 1]));
        settled.dataset.count = String(settled.children.length);
        stage.classList.add('out');
        await pause(SWAP_MS);
        stage.classList.remove('out');
        wear(ov);
      }
      beats.push(beat);
      context.activeIndex = k;
      context.landed = false;
      // the hunting state: nothing named, nothing lit, nothing in the middle
      ov.classList.remove('landed');
      ov.classList.add('hunting');
      wear(ov, beat.cls);
      repaintTitle(ov, beat);
      $('#wheelName').innerHTML = '&nbsp;';
      $('#wheelName').style.color = '';
      $('#wheelBlurb').innerHTML = '&nbsp;';
      stage.innerHTML = beat.stage;
      beat.repaintStage?.(stage);

      await beat.run(() => { ov.classList.remove('hunting'); ov.classList.add('landed'); });

      const name = $('#wheelName');
      /* Keep the icon node stable across locale changes; only .wcopy changes. */
      name.innerHTML = `${beat.icon} <span class="wcopy"></span>`;
      name.style.color = beat.hue;
      context.landed = true;
      repaintReveal(context);

      if (k < acts.length - 1) await pause(READ_MS);
    }
    ov.classList.add('holding');
    held = true;
    await hold(ov, context, opts.peer);
  } finally {
    if (activeReveal === context) activeReveal = null;
    /* THE OVERLAY COMES OFF ON EVERY EXIT — hence a finally, not three tidy
       endings. A deferred act can REJECT (ranked throws on a Trial offer this
       build cannot read), and the hold installs the only dismissal there is,
       so an escaping throw left a full-screen #ovWheel with no countdown and
       nothing listening, over a queue panel already hidden: a reload. */
    if (!held) opts.peer?.onPeer(() => undefined)();   // hold owns that teardown
    wear(ov);                       // and it leaves the way it arrived
    hide('#ovWheel');
  }
}

/* Presentation hook, the same idiom as __kbResult and __kbTrialPick: run the
   reveal with the shape RANKED gives it — a mode dial settling on a format,
   with a real pairing painted above it. Nothing else produces that layout: it
   otherwise needs a live match, a dealt offer and a server deadline. That gap
   is how two layout faults reached a device, and worse, how the probe written
   to catch one of them could not — it injected a pairing into an OFFLINE
   reveal, which has none, and that landed close enough to the choice sheet's
   own fallback to pass with the fix removed. `sides` resolves the trial beat,
   so a test can hold the screen open, measure it, and let it end. */
if (typeof window !== 'undefined') {
  (window as any).__kbRankedReveal = (opts: {
    modeId: string;
    pairing: { me: DialSide; foe: DialSide };
    /* rune_trial is a FORMAT, not a mode, so the dial cannot name it on its
       own — ranked passes copy for it too (queue-reveal's revealCopy). */
    copy?: (id: string) => DialModeCopy;
    candidates?: readonly DialModeChoice[];
    sides: () => Promise<readonly [TrialRevealSide, TrialRevealSide] | null>;
  }): Promise<void> => reveal({
    mode: { id: opts.modeId },
    modeCopy: opts.copy,
    modeCandidates: opts.candidates,
    trial: { resolve: () => opts.sides() },
    me: opts.pairing.me,
    foe: opts.pairing.foe,
  });
}


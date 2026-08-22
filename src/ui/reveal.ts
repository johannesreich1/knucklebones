// THE PRE-GAME REVEAL: the one screen that answers "what am I about to play?"
//
// ONE screen, a SEQUENCE OF BEATS. Ranked leaves one thing to chance (the
// mode the server drew) and offline can leave two (the mode, the rune, or
// both) — so this is not "the mode wheel plus a spell wheel", it is one
// reveal that runs a beat per unanswered question and then holds ONCE.
// Two overlays with two five-second countdowns is the same screen shown
// twice, and the player would have watched the mode's answer scroll away
// before the rune arrived.
//
// What a beat owns: its theatre and its answer. What this shell owns and no
// beat may re-implement: the overlay, the title line, the readout under the
// stage, the settled strip, the countdown, and THE RULE THE WHOLE SCREEN
// OBEYS — it must not spoil itself. The name, the blurb and the colour of
// the answer are written by `land`, never by a beat's own markup, so a beat
// physically cannot leak its result early.
//
// The overlay's id is `#ovWheel` for the same reason `matches.modifier` is
// still called that: it is the name the tests, the CSS and the design cards
// already know, and renaming it buys the player nothing.
import type { ModeSpec } from '../core/modes.ts';
import type { SpellSpec } from '../core/spells.ts';
import { dialBeat } from './modedial.ts';
import { dealBeat } from './runedeal.ts';
import { paintAvatar } from './avatar.ts';
import { $, show, hide } from './dom.ts';
import { Sfx } from './audio.ts';

export const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(() => r(), ms));

/* One beat of the reveal: a question, its theatre, and its answer.
   `run` resolves when the answer is on screen and the readout may be written;
   it calls `settle` at the moment the theatre stops hunting, which is what
   flips the overlay from `.hunting` to `.landed`. Splitting those two lets a
   beat land its own last frame (the dial holds its winner's flare through
   one more frame) without the shell knowing how. */
/* what a beat found: the four things the readout and the pill are made of.
   Written by the SHELL when the beat lands — never by the beat's own markup,
   so a beat physically cannot leak its result early. */
export interface Answer { name: string; blurb: string; hue: string; icon: string }

export interface Beat extends Answer {
  label: string;           // the title line while this beat runs
  cls?: string;            // a class the overlay wears while this beat runs
  stage: string;           // the centred theatre, as markup
  run(settle: () => void): Promise<void>;
}

/** a player on the versus line — ranked fills both, offline leaves them out */
export interface DialSide { name: string; rating?: number | null; avatar?: string | null }

/* Who else has to agree before the countdown can be cut short.
   The reveal itself knows nothing about opponents or networks: OFFLINE passes
   nothing and one tap starts the game, ranked passes a peer backed by the
   match's realtime channel. Whatever happens, the countdown still expires on
   its own — an unheard peer costs a few seconds, never the game. */
export interface DialPeer {
  announce(): void;                        // tell the other side I am ready
  onPeer(cb: () => void): () => void;      // ...and hear when they are
}

const esc = (t: string): string => t.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/* one side of the versus line — the .dav slot is filled by paintAvatar after
   the innerHTML write, so the avatar has exactly one renderer (ui/avatar.ts) */
function sideHtml(p: DialSide, cls: 'me' | 'foe'): string {
  const rating = p.rating != null ? `<span class="rt">${p.rating}</span>` : '';
  return `<span class="dside ${cls}"><span class="dav"></span>` +
         `<span class="dnm">${esc(p.name)}</span>${rating}</span>`;
}
/* Both ratings are shown; the DIFFERENCE between them is not. It is arithmetic
   the player can do if they care, and printing it turns a duel into a forecast.
   Exported for the same reason settledAnswer and answerLines below are: the
   design build renders the pairing through THIS function ({{versus}}), and the
   two dial cards had been carrying a hand-written one-line "Opponent NAME ·
   RATING" — the pre-study treatment this replaced — for as long as it existed. */
export function versus(me: DialSide, foe: DialSide): string {
  return sideHtml(me, 'me') + '<span class="dvs">VS</span>' + sideHtml(foe, 'foe');
}

/* An answer that is done being looked at, kept where it can still be read. It
   exists so a second beat does not erase the first one's result: the mode
   settles into the top half and is still on screen — RULE AND ALL — when the
   rune is dealt, which is what makes ONE countdown honest for BOTH answers.
   It keeps the blurb, not just the name: "COLUMN SHIELD" on its own is a label,
   and the line under it is the half that says what you are about to play. Same
   line, same class, as the readout under the stage.
   Pure, and exported, because the design build renders these two through the
   very same functions ({{wsettled}}, {{wanswer}}): a card that re-typed a
   mode's blurb would be one more copy of the registry. */
export const settledAnswer = (b: Answer): string =>
  `<div class="wsett" style="color:${b.hue}">`
  + `<span class="wpill">${b.icon}<b>${esc(b.name)}</b></span>`
  + `<span class="wblurb">${esc(b.blurb)}</span></div>`;

/** the readout under the stage — what a landed beat says, and its colour */
export const answerLines = (b: Answer): string =>
  `<div class="wname" style="color:${b.hue}">${b.icon} ${esc(b.name)}</div>`
  + `<div class="wblurb">${esc(b.blurb)}</div>`;

let built = false;
function build(): void {
  if (built) return;
  built = true;
  document.body.insertAdjacentHTML('beforeend', `
<div class="ov" id="ovWheel">
  <div class="dwho" id="wheelWho"></div>
  <div class="wsettled" id="wheelSettled"></div>
  <div class="wtitle" id="wheelTitle">GAME MODE</div>
  <div class="wstage" id="wheelStage"></div>
  <div class="wname" id="wheelName">&nbsp;</div>
  <div class="wblurb" id="wheelBlurb">&nbsp;</div>
  <div class="dhold" id="wheelHold"><b id="wheelCount">&nbsp;</b><span id="wheelHint">&nbsp;</span></div>
</div>`);
}

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

const HOLD_SECS = 5;

/* The result has to be READ, not glimpsed. It holds for five seconds with a
   countdown under it, and a tap says "I have read it" — once everyone has, the
   wait ends there. */
function hold(ov: HTMLElement, peer?: DialPeer): Promise<void> {
  const count = $('#wheelCount'), hint = $('#wheelHint');
  let left = HOLD_SECS;
  let mine = false;
  let theirs = !peer;                      // nobody to wait for when alone
  const paint = (): void => {
    count.textContent = String(Math.max(0, left));
    hint.textContent = !mine ? 'Tap when you are ready'
      : theirs ? 'Starting' : 'Ready — waiting for your opponent';
    ov.classList.toggle('ready', mine);
  };
  paint();
  return new Promise<void>((resolve) => {
    let ticker = 0, off: (() => void) | null = null;
    const done = (): void => {
      clearInterval(ticker);
      ov.removeEventListener('pointerdown', tap);
      off?.();
      resolve();
    };
    const both = (): void => { if (mine && theirs) done(); };
    function tap(): void {
      if (mine) return;
      mine = true;
      Sfx.tap();
      peer?.announce();
      paint();
      both();
    }
    ticker = setInterval(() => {
      left -= 1;
      paint();
      if (left <= 0) done();
    }, 1000) as unknown as number;
    ov.addEventListener('pointerdown', tap);
    off = peer?.onPeer(() => { theirs = true; paint(); both(); }) ?? null;
  });
}

/* How long a landed answer stays ALONE on the stage before the next beat takes
   it. Long enough to actually read the name and the rule that just arrived —
   at a second it was a glimpse, and the eye was still on the dial when the
   deck replaced it (user call). */
const READ_MS = 1500;
const SWAP_MS = 260;

/** run the reveal for whatever was left to chance; resolves when the player is done */
export async function reveal(opts: {
  mode?: ModeSpec | null;
  spell?: SpellSpec | null;
  peer?: DialPeer; me?: DialSide; foe?: DialSide;
}): Promise<void> {
  const beats: Beat[] = [];
  if (opts.mode) beats.push(dialBeat(opts.mode));
  if (opts.spell) beats.push(dealBeat(opts.spell));
  if (!beats.length) return;               // nothing was left to chance
  build();
  const ov = $('#ovWheel');
  /* A ranked match is a comparison, so the screen shows the comparison: both
     players, both ratings — each wearing the profile avatar they chose, the
     same face the leaderboard and the face-off card show for them. */
  const who = $('#wheelWho');
  who.innerHTML = opts.foe && opts.me ? versus(opts.me, opts.foe) : '';
  if (opts.foe && opts.me) {
    paintAvatar(who.querySelector('.dside.me .dav') as HTMLElement, opts.me.avatar, 44);
    paintAvatar(who.querySelector('.dside.foe .dav') as HTMLElement, opts.foe.avatar, 44);
  }
  const settled = $('#wheelSettled'), stage = $('#wheelStage');
  settled.innerHTML = '';
  ov.classList.remove('landed', 'ready', 'holding');
  wear(ov);                       // whatever the LAST reveal left on, whoever ran it
  show('#ovWheel');

  for (let k = 0; k < beats.length; k++) {
    const beat = beats[k];
    // the hunting state: nothing named, nothing lit, nothing in the middle
    ov.classList.remove('landed');
    ov.classList.add('hunting');
    wear(ov, beat.cls);
    $('#wheelTitle').textContent = beat.label;
    $('#wheelName').innerHTML = '&nbsp;';
    $('#wheelName').style.color = '';
    $('#wheelBlurb').innerHTML = '&nbsp;';
    stage.innerHTML = beat.stage;

    await beat.run(() => { ov.classList.remove('hunting'); ov.classList.add('landed'); });

    const name = $('#wheelName');
    name.innerHTML = `${beat.icon} ${beat.name}`;
    name.style.color = beat.hue;
    $('#wheelBlurb').textContent = beat.blurb;

    if (k === beats.length - 1) break;
    await pause(READ_MS);
    settled.insertAdjacentHTML('beforeend', settledAnswer(beat));
    stage.classList.add('out');
    await pause(SWAP_MS);
    stage.classList.remove('out');
    wear(ov);
  }
  ov.classList.add('holding');
  await hold(ov, opts.peer);
  wear(ov);                       // and it leaves the way it arrived
  hide('#ovWheel');
}

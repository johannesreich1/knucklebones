// The mode dial: one beat of the pre-game reveal (ui/reveal.ts), in which the
// game hunts for the rules it will play by.
//
// ONE dial, two callers. Ranked reveals the server's pick; OFFLINE reveals its
// own when the player chose RANDOM. It therefore lives in ui/ with its CSS in
// main.css — the offline game must never pull in the online chunk to see it.
//
// Pure theatre aimed at a server-decided result — the odds live in the weighted
// server pick (core/modes.ts), never here. The dial draws every mode as an equal
// node on a ring, so the hunt is honest even though its answer is not random.
// Candidate inclusion belongs to the caller; their display order is always
// the ranked-outcome registry's canonical teaching order.
//
// The one rule this beat obeys is that it must not SPOIL ITSELF. Everything
// that could name the answer early is withheld until the comet stops:
//   · every node flares as the comet crosses it, and the winner is exactly as
//     dark as the rest until it is found,
//   · the centre is empty while hunting (a sonar pulse in nobody's colour) and
//     blooms the found mode on landing,
//   · the name and the blurb below are the SHELL's to write, and it writes
//     them only once this beat's `run` has resolved.
import { MODES } from '../core/modes.ts';
import { orderRankedOutcomes } from '../core/ranked-outcomes.ts';
import { modeCopy, t } from '../i18n/index.ts';
import { modeIcon, modeHue } from './modeicons.ts';
import { $ } from './dom.ts';
import { Sfx } from './audio.ts';
import { REDUCED } from './fx.ts';
import type { Beat } from './reveal-types.ts';

/* node k sits k*SEG clockwise from 12 o'clock, and the comet's bright head sits
   at its own rotation — so "the comet is on node k" is simply rotation ≡ k*SEG */
const mod360 = (d: number) => ((d % 360) + 360) % 360;

/* Must match .dnode's resting opacity in main.css: a flare ends exactly on it
   so the node settles back without a step. */
const DIM = 0.28;

/* The node ring, as markup — the ONE description of where a mode sits on the
   dial and what colour it wears. Pure, so the design build imports it too
   (design/build.mjs, {{dialnodes}}): a card can never draw a ring the app
   does not build. `found` is the card's slot — at runtime the app lights the
   winner itself, but a still needs it baked in. */
export interface DialModeChoice { readonly id: string }
export interface DialModeCopy { readonly name: string; readonly blurb: string }
export interface DialBeatOptions {
  readonly candidates?: readonly DialModeChoice[];
  readonly copy?: (id: string) => DialModeCopy;
}

export const dialNodes = (found?: string, candidates: readonly DialModeChoice[] = MODES): string => {
  const ordered = orderRankedOutcomes(candidates);
  const segment = 360 / ordered.length;
  return ordered.map((m, i) =>
  `<i class="dnode${m.id === found ? ' on' : ''}" data-mode="${m.id}"`
  + ` style="--a:${(i * segment).toFixed(2)}deg;color:${modeHue(m.id)}">${modeIcon(m.id, 24)}</i>`).join('');
};

/* The comet's deceleration, in one place: the compositor animates with it and
   the frame loop below evaluates it, so the light and the flare it causes can
   never drift apart. */
const EASE: readonly [number, number, number, number] = [0.1, 0.62, 0.05, 1];
const CSS_EASE = `cubic-bezier(${EASE.join(',')})`;
/* Let the eye register the selected node and centre bloom before the shell
   writes the mode name and rule below it. This is an information beat, not
   extra motion, so reduced-motion players keep the same readable sequence. */
const ANSWER_BEAT_MS = 360;

/** the same curve the browser is running, as a function of elapsed fraction */
function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {            // Newton converges in a handful
      const err = fx(t) - x;
      if (Math.abs(err) < 1e-6) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    t = Math.min(1, Math.max(0, t));
    return ((ay * t + by) * t + cy) * t;
  };
}
const easeAt = bezier(...EASE);

/** one node lights as the comet goes past, then fades back to resting */
function flare(el: HTMLElement): void {
  /* never on the found node: a flare is a WAAPI animation and would OVERRIDE
     .on's full opacity, fading the winner toward dim and snapping it back
     when the flare expires — the "flicker once selected" (user report) */
  if (REDUCED || el.classList.contains('on')) return;
  el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.14 }, { opacity: DIM }],
    { duration: 480, easing: 'ease-out' });
}

/* Where the comet came to rest last time. It sets off from there, so the arc is
   never identical even when the same mode is drawn twice running. */
let restingAt = 0;

/** hunt the ring and land on the pick the caller was already handed */
export function dialBeat(spec: DialModeChoice, options: DialBeatOptions = {}): Beat {
  const candidates = orderRankedOutcomes(options.candidates?.length ? options.candidates : MODES);
  const segment = 360 / candidates.length;
  const i = Math.max(0, candidates.findIndex((m) => m.id === spec.id));
  const foundHue = modeHue(spec.id);
  const copy = (): DialModeCopy => options.copy?.(spec.id) ?? modeCopy(spec.id);
  return {
    /* These are getters, not a locale snapshot. The shell reads them again
       when a visible reveal repaints, without rebuilding or restarting the
       dial theatre. */
    get label() { return t('game', 'reveal.gameMode'); },
    get name() { return copy().name; },
    get blurb() { return copy().blurb; },
    hue: foundHue,
    icon: modeIcon(spec.id, 17),
    /* the found icon rides in the markup from the first frame and is held back
       by opacity alone (#ovWheel.landed .dfound) — one place decides when the
       answer is visible, and it is not this string */
    stage: `<div class="dial" id="wheelDial">
      <i class="dring"></i>
      <i class="dcomet" id="wheelComet"><i class="dtrail"></i><i class="dhead"></i></i>
      ${dialNodes(undefined, candidates)}
      <div class="dcore"><i class="dsonar"></i>
        <i class="dfound" style="color:${foundHue}">${modeIcon(spec.id, 40)}</i></div>
    </div>`,
    async run(settle) {
      const comet = $('#wheelComet') as HTMLElement;
      const nodes = Array.from($('#wheelDial').querySelectorAll<HTMLElement>('.dnode'));
      const from = restingAt;
      const target = i * segment;
      /* Two things vary so no two hunts read alike — how far it travels (4-6
         whole laps) and where it starts. Only the ending is fixed: it was
         decided before this screen appeared. */
      const laps = 4 + Math.floor(Math.random() * 3);
      const sweep = laps * 360 + mod360(target - from);
      restingAt = target;
      // a longer sweep runs proportionally longer, so every hunt decelerates at
      // the same rate — one fixed duration would make the long ones frantic
      const ms = Math.max(2400, Math.min(4600, sweep / 0.62));

      if (REDUCED) {
        comet.style.transform = `rotate(${target}deg)`;
      } else {
        const spin = comet.animate(
          [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${from + sweep}deg)` }],
          { duration: ms, easing: CSS_EASE, fill: 'forwards' });
        /* Light whatever it passes. The comet's angle is derived from the curve
           rather than read back from the DOM: no layout reads, and it stays exact
           even if a frame is dropped. */
        const t0 = performance.now();
        let prev = from;
        const tick = (): void => {
          const u = Math.min(1, (performance.now() - t0) / ms);
          const at = from + sweep * easeAt(u);
          for (let k = 0; k < candidates.length; k++) {
            const a = k * segment;
            if (Math.floor((at - a) / 360) > Math.floor((prev - a) / 360)) flare(nodes[k]);
          }
          prev = at;
          if (u < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        await spin.finished;
      }

      // found: the node stays lit and the centre blooms
      settle();
      /* the comet's FINAL crossing is the landing itself, and its flare may fire
         on this very frame — one beat for it to land, then cut it, so the winner
         holds the flare's full light instead of fading and snapping back */
      if (!REDUCED) await new Promise(requestAnimationFrame);
      nodes[i]?.getAnimations().forEach((a) => a.cancel());
      nodes[i]?.classList.add('on');
      Sfx.place();
      await new Promise<void>((resolve) => setTimeout(resolve, ANSWER_BEAT_MS));
    },
  };
}

// THE result screen — one implementation for every way a game can end.
//
// Local play and a ranked match report the same five things: who won, in what
// words, the two scores, optional context, and what you may do next. They
// used to do it through two overlays with two stylesheets, which is how the
// ranked screen ended up with no fireworks at all while the local one had
// them. Now the differences are a SPEC the caller fills — the context line is
// a slot (tutorial completion, or a points chip and a ladder spot), and each action
// carries its own label and handler.
//
// Adding a third context (a tournament, a daily) is another spec, not another
// screen.
import { $, show, hide } from './dom.ts';
import { formatNumber } from '../i18n/index.ts';
import { tap } from './tap.ts';
import { Sfx, vibrate } from './audio.ts';
import { fireworks } from './fx.ts';
import { paintFeature, type EndFeature } from './endscreen-feature.ts';
import {
  dealFreshPlates,
  forgetPlates,
  repaintPlatesLocale,
  type EndPlate,
} from './endscreen-plates.ts';
import { repaintShareLabel, resetShare, setShareText, shareResult } from './endscreen-share.ts';

export interface EndAction {
  label: string;
  /* Semantic, never inferred from translated copy: #btnAgain is also the
     tutorial's Finish action, which deliberately has no play die. */
  icon?: 'play';
  run: () => void;
}

export interface EndSpec {
  outcome: 'win' | 'lose' | 'draw';
  title: string;                 // VICTORY / DEFEAT / PLAYER 2 WINS / DEAD HEAT
  sub: string;                   // the one-line reason
  you: { score: number; label: string };
  them: { score: number; label: string };
  meta?: string;                 // HTML for the context line (tutorial completion, points chip…)
  /* who played, as plates (design 36f). Ranked deals two — you with the
     delta beside the number it changed, the beaten foe stamped. Local play
     leaves it empty and keeps its score labels instead. */
  plates?: EndPlate[];
  feature?: EndFeature;           // optional typed reward/feature card
  again?: EndAction;             // the primary action; absent hides it
  /* the ONE quiet way on, in the short cut — a way out should not stand as
     tall as NEXT DUEL. Ranked's is Home; local play's is the setup screen it
     came from. It used to be two buttons offline (Change difficulty AND Home)
     under a screen whose whole job is "play again or don't" (user call). */
  quiet?: EndAction;             // absent hides it
  share?: string;                // text to share; absent hides the share link
  /* how long the board keeps the last move before the screen arrives. Local
     play holds for its celebration beat; a ranked match has already had one. */
  delay?: number;
}

/* The live spec IS the wiring: the buttons are bound once, and every press
   asks the current spec what it means. That is what lets one screen serve
   flows whose "Next duel" means completely different things. */
let live: EndSpec | null = null;
/* Localized results provide a fresh spec on demand. Locale repaint consumes
   only its copy-bearing fields; outcome classes, plates, timing, focus, and
   the one-time entrance theatre stay exactly where they are. */
let localizedSpec: (() => EndSpec) | null = null;
let titleResizeObserver: ResizeObserver | null = null;

export function bindEnd(): void {
  const act = (a?: EndAction) => { Sfx.tap(); a?.run(); };
  tap($('#btnAgain'), () => act(live?.again));
  tap($('#btnEndQuiet'), () => act(live?.quiet));
  tap($('#btnShare'), () => { Sfx.tap(); void shareResult(); });
  // bound once like the rest: a listener per paint stacks up one per result
  tap($('#endFeature'), () => { Sfx.tap(); live?.feature?.tap(); });
  /* WIDTH ONLY. A ResizeObserver reports the whole box, and fitting the verdict
     changes its FONT SIZE — so the clip gets shorter, the observer wakes, the
     fit is recomputed, and the title moves again. .titleclip is width:100% of
     its parent, so its width is never the title's doing and is the only input
     the fit actually has (limit = min(clip width, 90% of the viewport)); its
     height is entirely the title's doing and therefore a feedback loop. This
     read as an element that never settled: Playwright timed out after 30s of
     "element is not stable" and took the whole localization suite with it. It
     could not happen while the fitter was returning early on most locales; the
     moment it started doing its job it never stopped. */
  if (typeof ResizeObserver !== 'undefined') {
    const clip = $('#ovEnd .titleclip');
    titleResizeObserver ??= new ResizeObserver(() => {
      const width = Math.round(clip.clientWidth);
      if (width === lastFittedClipWidth) return;
      lastFittedClipWidth = width;
      fitEndTitle();
    });
    titleResizeObserver.observe(clip);
  }
}

/* A translated verdict is allowed the full normal type scale. Only an
   unbroken word that would exceed 90% of the owned app viewport is reduced,
   and only by the exact ratio needed to fit. This is copy- and locale-neutral:
   a future long English/French/German word follows the same rule, while
   multi-word duo verdicts retain their intentional wrapping. */
/* The clip width the last fit was computed for; the observer ignores anything
   that leaves it unchanged. Reset on paint so a fresh result always fits. */
let lastFittedClipWidth = -1;

function fitEndTitle(): void {
  const title = $('#endTitle');
  title.style.removeProperty('--fitted-verdict');
  const oneLine = !/\s/u.test(title.textContent?.trim() ?? '');
  title.classList.toggle('fit-one-line', oneLine);
  if (!oneLine) return;
  const clip = $('#ovEnd .titleclip');
  const root = title.closest('#kbroot') as HTMLElement | null;
  const viewportWidth = root?.getBoundingClientRect().width || window.innerWidth;
  const limit = Math.min(clip.clientWidth, viewportWidth * .9);
  /* The UNTRANSFORMED, UNROUNDED box. A bounding rect includes the win
     entrance's opening scale(3.2), so an observer waking mid-animation read a
     299px word as 958px and permanently refitted VICTORY to 20px — on some
     rounds and not others. The h1 is a flex item, so its used width
     shrink-wraps to its text; offsetWidth rounds that to a whole pixel, and a
     ratio taken from the rounded figure lands a long word up to a pixel past
     the 90% lane (measured: ZWYCIĘSTWO 288.86px in a 288px lane). */
  /* offsetWidth, not the computed width: the BORDER box, which is what the lane
     actually has to hold and what a screenshot measures. #endTitle carries a
     padding-inline-start of .2em (~9px at this size, screens/result.css), and
     the computed width leaves it out — so a verdict could clear the check on
     its content and still paint past 90% of the phone by most of that padding.
     ui-rounded was narrow enough to hide it; Chakra Petch is not, and Polish
     ZWYCIĘSTWO painted 288.72 into a 288 lane on a 320px phone. offsetWidth is
     also immune to the win entrance's opening scale(3.2), which is the hazard
     the previous measure was chosen to dodge — an observer waking mid-animation
     once read a 299px word as 958px and refit VICTORY to 20px. Its cost is
     rounding to a whole pixel, and the target below absorbs that. */
  const naturalWidth = title.offsetWidth;
  /* Aim half a pixel inside the lane so offsetWidth's rounding cannot land the
     painted word past it. */
  const target = limit - .5;
  if (!(limit > 0 && naturalWidth > target)) return;
  const naturalSize = parseFloat(getComputedStyle(title).fontSize);
  let fitted = naturalSize * target / naturalWidth;
  title.style.setProperty('--fitted-verdict', `${fitted}px`);
  /* Glyph advances round per glyph at a fractional size, so the word can land
     a fraction of a pixel past the lane the ratio aimed at (measured: up to
     0.7px over on a ten-glyph verdict). This used to apply ONE correction, on
     the measurement that one was enough — true of the ui-rounded stack, and no
     longer true once the app bundles its own faces: Chakra Petch rounds its
     advances differently and Polish ZWYCIĘSTWO settled 0.72px past a 288px lane
     with the single pass, which the gate reads as a verdict wider than 90% of a
     320px phone. So it CONVERGES instead of assuming: each pass multiplies by
     the ratio it still needs, and a word already inside costs nothing because
     the loop never runs. The cap is a guard against a pathological face, not a
     budget — three passes is far more than the one this has ever needed. */
  for (let pass = 0; pass < 3; pass++) {
    const fittedWidth = title.offsetWidth;
    if (!(fittedWidth > target)) break;
    fitted *= target / fittedWidth;
    title.style.setProperty('--fitted-verdict', `${fitted}px`);
  }
}

function paintCopy(spec: EndSpec): void {
  const title = $('#endTitle');
  title.textContent = spec.title;
  fitEndTitle();
  $('#endSub').textContent = spec.sub;
  $('#endYou').textContent = formatNumber(spec.you.score);
  $('#endCpu').textContent = formatNumber(spec.them.score);
  $('#endYouLbl').textContent = spec.you.label;
  $('#endCpuLbl').textContent = spec.them.label;
  setMeta(spec.meta ?? '');
  label('#btnAgain', spec.again);
  label('#btnEndQuiet', spec.quiet);
  setShareText(spec.share);
}

function presentEnd(spec: EndSpec, localize: (() => EndSpec) | null): void {
  resetShare();
  live = spec;
  localizedSpec = localize;
  const title = $('#endTitle');
  title.className = spec.outcome;
  // the SCREEN wears the outcome too: the entrance differs by it, and CSS
  // cannot ask a child which way this game went
  const ov = $('#ovEnd');
  ov.classList.remove('win', 'lose', 'draw', 'settled');
  ov.classList.add(spec.outcome);
  paintCopy(spec);
  dealFreshPlates(spec.plates ?? []);
  paintFeature(spec.feature);
  setTimeout(() => {
    show('#ovEnd');
    fitEndTitle();
    // restart the entrance: a class that is already there animates nothing
    replay(ov, 'enter');
    // the rise is clipped while it travels; once it lands, the clip (and the
    // glow it would otherwise crop into a box) can come back
    title.addEventListener('animationend', () => ov.classList.add('settled'), { once: true });
    if (spec.outcome === 'win') {
      // into the screen's OWN layer: #fx sits below every overlay, so a
      // celebration drawn there would have burst behind this very screen
      fireworks(['var(--p1)', 'var(--gold)', '#8dffcf', '#fff'], $('#endFx'));
      vibrate([20, 50, 20, 50, 60]);
    }
  }, spec.delay ?? 0);
}

export function showEnd(spec: EndSpec): void {
  presentEnd(spec, null);
}

/* A localized caller owns how its copy is rebuilt. Repainting calls the
   factory again and edits the existing result DOM in place; it never replays
   showEnd's entrance, fireworks, plate deal, bindings, or delay. */
export function showLocalizedEnd(makeSpec: () => EndSpec): void {
  presentEnd(makeSpec(), makeSpec);
}

export function repaintEndLocale(): void {
  if (!live) return;
  let localizedPlates: EndPlate[] | undefined;
  if (localizedSpec) {
    const copy = localizedSpec();
    localizedPlates = copy.plates;
    live = {
      ...live,
      title: copy.title,
      sub: copy.sub,
      you: copy.you,
      them: copy.them,
      meta: copy.meta,
      feature: copy.feature,
      again: copy.again,
      quiet: copy.quiet,
      share: copy.share,
    };
    paintCopy(live);
    paintFeature(live.feature);
  } else {
    /* A legacy caller may have corrected its meta late with setMeta(). Do not
       restore the original HTML before that caller adopts the locale factory. */
    $('#endYou').textContent = formatNumber(live.you.score);
    $('#endCpu').textContent = formatNumber(live.them.score);
    repaintShareLabel();
  }
  repaintPlatesLocale(localizedPlates);
}

/* the context line can arrive LATE — ranked paints a points chip from cache and
   corrects it when the profile and ladder come back */
export function setMeta(html: string): void {
  const m = $('#endMeta');
  m.innerHTML = html;
  m.hidden = !html;
}

export function closeEnd(): void {
  hide('#ovEnd');
  resetShare();
  live = null;
  localizedSpec = null;
  forgetPlates();
  paintFeature(undefined);
}

function label(sel: string, a?: EndAction): void {
  const b = $(sel) as HTMLButtonElement;
  b.hidden = !a;
  const play = a?.icon === 'play';
  b.classList.toggle('play-cta', play);
  const icon = b.querySelector<HTMLElement>(':scope > .btn-leading-icon');
  if (icon) icon.hidden = !play;
  if (!a) return;
  const copy = b.querySelector<HTMLElement>(':scope > .btn-label');
  if (copy) copy.textContent = a.label;
  else b.textContent = a.label;
}

/* restart a CSS animation by removing the class and forcing a reflow */
function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

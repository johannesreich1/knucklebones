// THE result screen — one implementation for every way a game can end.
//
// Local play and a ranked match report the same five things: who won, in what
// words, the two scores, one line of context, and what you may do next. They
// used to do it through two overlays with two stylesheets, which is how the
// ranked screen ended up with no fireworks at all while the local one had
// them. Now the differences are a SPEC the caller fills — the context line is
// a slot (a session record, or a points chip and a ladder spot), and each action
// carries its own label and handler.
//
// Adding a third context (a tournament, a daily) is another spec, not another
// screen.
import { $, show, hide } from './dom.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { tap } from './tap.ts';
import { Sfx, vibrate } from './audio.ts';
import { fireworks } from './fx.ts';
import { fillPlate, repaintPlateLocale, type PlateSpec } from './plate.ts';

export interface EndAction { label: string; run: () => void }

/* an identity plate on the result (design 36f) — the home plate's spec plus
   an optional door. With a tap the row is a <button> and grows its chevron. */
export interface EndPlate extends PlateSpec { tap?: () => void }

export interface EndSpec {
  outcome: 'win' | 'lose' | 'draw';
  title: string;                 // VICTORY / DEFEAT / PLAYER 2 WINS / DEAD HEAT
  sub: string;                   // the one-line reason
  you: { score: number; label: string };
  them: { score: number; label: string };
  meta?: string;                 // HTML for the context line (session record, points chip…)
  /* who played, as plates (design 36f). Ranked deals two — you with the
     delta beside the number it changed, the beaten foe stamped. Local play
     leaves it empty and keeps its score labels instead. */
  plates?: EndPlate[];
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
let shareText = '';
type ShareFeedback = 'idle' | 'copied' | 'copyFailed';
let shareFeedback: ShareFeedback = 'idle';
let shareFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
let presentationRevision = 0;
/* the last deal, kept so the theatre can run again on a screen that was only
   covered — the plates are the one thing here that is worth a second showing */
let dealt: EndPlate[] = [];

export function bindEnd(): void {
  const act = (a?: EndAction) => { Sfx.tap(); a?.run(); };
  tap($('#btnAgain'), () => act(live?.again));
  tap($('#btnEndQuiet'), () => act(live?.quiet));
  tap($('#btnShare'), () => { Sfx.tap(); void shareResult(); });
}

function paintCopy(spec: EndSpec): void {
  const title = $('#endTitle');
  title.textContent = spec.title;
  $('#endSub').textContent = spec.sub;
  $('#endYou').textContent = formatNumber(spec.you.score);
  $('#endCpu').textContent = formatNumber(spec.them.score);
  $('#endYouLbl').textContent = spec.you.label;
  $('#endCpuLbl').textContent = spec.them.label;
  setMeta(spec.meta ?? '');
  label('#btnAgain', spec.again);
  label('#btnEndQuiet', spec.quiet);
  shareText = spec.share ?? '';
  const share = $('#btnShare') as HTMLButtonElement;
  share.hidden = !spec.share;
  paintShareFeedback();
}

function presentEnd(spec: EndSpec, localize: (() => EndSpec) | null): void {
  presentationRevision++;
  resetShareFeedback();
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
  delete $('#endPlates').dataset.dealtAt;   // a NEW result: the stamp may slam again
  setPlates(spec.plates ?? []);
  setTimeout(() => {
    show('#ovEnd');
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
      again: copy.again,
      quiet: copy.quiet,
      share: copy.share,
    };
    paintCopy(live);
  } else {
    /* A legacy caller may have corrected its meta late with setMeta(). Do not
       restore the original HTML before that caller adopts the locale factory. */
    $('#endYou').textContent = formatNumber(live.you.score);
    $('#endCpu').textContent = formatNumber(live.them.score);
    paintShareFeedback();
  }
  if (localizedPlates?.length === dealt.length) dealt = localizedPlates;
  const box = $('#endPlates');
  Array.from(box.children).forEach((plate, index) => {
    const spec = dealt[index];
    if (spec) repaintPlateLocale(plate as HTMLElement, { large: true, ...spec });
  });
}

/* the context line can arrive LATE — ranked paints a points chip from cache and
   corrects it when the profile and ladder come back */
export function setMeta(html: string): void {
  const m = $('#endMeta');
  m.innerHTML = html;
  m.hidden = !html;
}

/* the plates can arrive LATE too, for the same reason — ranked deals them from
   cache and re-deals once the fresh standing lands */
export function setPlates(plates: EndPlate[]): void {
  const box = $('#endPlates');
  dealt = plates;
  /* the slam (styles: .pstamp) plays ONCE per result — a re-deal carries
     fresh numbers, not a fresh verdict. But only once it truly played: a
     re-deal landing inside the slam's delay+duration window (~1.7s) rebuilds
     the stamp before it ever rendered, so there the animation restarts
     instead of being suppressed — the player still sees exactly one slam. */
  const first = Number(box.dataset.dealtAt || 0);
  box.classList.toggle('restamp', !!first && performance.now() - first > 1700);
  if (plates.length && !first) box.dataset.dealtAt = String(performance.now());
  box.innerHTML = '';
  box.hidden = !plates.length;
  for (const p of plates) {
    const el = document.createElement(p.tap ? 'button' : 'div');
    // the result's plates wear the roomier cut by default; a spec may override
    fillPlate(el, { large: true, ...p, chev: p.chev ?? !!p.tap });
    if (p.tap) el.addEventListener('click', () => { Sfx.tap(); p.tap!(); });
    box.appendChild(el);
  }
}

/* THE PLATES' THEATRE, RUN AGAIN — and nothing else on the screen with it.
   A screen that was merely COVERED (the own plate's door to the profile, see
   online/ui) comes back to a still frame, so it gets one beat of life: the
   cards deal in turn, the stamp slams, the beaten row takes the hit. The
   title landed once and the fireworks fired once — replaying those would
   announce a second verdict rather than resume the one already given (user
   call). Dropping dealtAt is what re-arms the slam; setPlates does the rest,
   because rebuilding a node is what restarts a CSS animation. */
export function replayPlates(): void {
  if (!dealt.length) return;
  delete $('#endPlates').dataset.dealtAt;
  setPlates(dealt);
}

export function closeEnd(): void {
  hide('#ovEnd');
  presentationRevision++;
  resetShareFeedback();
  live = null;
  localizedSpec = null;
  dealt = [];
}

function label(sel: string, a?: EndAction): void {
  const b = $(sel) as HTMLButtonElement;
  b.hidden = !a;
  if (a) b.textContent = a.label;
}

/* restart a CSS animation by removing the class and forcing a reflow */
function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

async function shareResult(): Promise<void> {
  const revision = presentationRevision;
  const url = location.origin + location.pathname;
  try {
    if (navigator.share) { await navigator.share({ text: shareText, url }); return; }
    await navigator.clipboard.writeText(shareText + ' ' + url);
    if (presentationRevision === revision) showShareFeedback('copied');
  } catch {
    if (presentationRevision === revision) showShareFeedback('copyFailed');
  }
}

function paintShareFeedback(): void {
  const key = shareFeedback === 'idle' ? 'result.share' : `result.${shareFeedback}` as const;
  $('#btnShare').textContent = t('game', key);
}

function resetShareFeedback(): void {
  if (shareFeedbackTimer !== null) clearTimeout(shareFeedbackTimer);
  shareFeedbackTimer = null;
  shareFeedback = 'idle';
}

function showShareFeedback(feedback: Exclude<ShareFeedback, 'idle'>): void {
  resetShareFeedback();
  shareFeedback = feedback;
  paintShareFeedback();
  shareFeedbackTimer = setTimeout(() => {
    shareFeedbackTimer = null;
    shareFeedback = 'idle';
    paintShareFeedback();
  }, 1500);
}

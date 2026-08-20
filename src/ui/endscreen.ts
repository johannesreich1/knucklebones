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
import { tap } from './input.ts';
import { Sfx, vibrate } from './audio.ts';
import { fireworks } from './fx.ts';

export interface EndAction { label: string; run: () => void }

export interface EndSpec {
  outcome: 'win' | 'lose' | 'draw';
  title: string;                 // VICTORY / DEFEAT / PLAYER 2 WINS / DEAD HEAT
  sub: string;                   // the one-line reason
  you: { score: number; label: string };
  them: { score: number; label: string };
  meta?: string;                 // HTML for the context line (session record, points chip…)
  again?: EndAction;             // the primary action; absent hides it
  alt?: EndAction;               // the secondary; absent hides it
  home?: EndAction;              // the quiet way out; absent hides it
  share?: string;                // text to share; absent hides the share link
  /* how long the board keeps the last move before the screen arrives. Local
     play holds for its celebration beat; a ranked match has already had one. */
  delay?: number;
}

/* The live spec IS the wiring: the buttons are bound once, and every press
   asks the current spec what it means. That is what lets one screen serve
   flows whose "Play again" means completely different things. */
let live: EndSpec | null = null;
let shareText = '';

export function bindEnd(): void {
  const act = (a?: EndAction) => { Sfx.tap(); a?.run(); };
  tap($('#btnAgain'), () => act(live?.again));
  tap($('#btnMenu2'), () => act(live?.alt));
  tap($('#btnEndHome'), () => act(live?.home));
  tap($('#btnShare'), () => { Sfx.tap(); void shareResult(); });
}

export function showEnd(spec: EndSpec): void {
  live = spec;
  const t = $('#endTitle');
  t.textContent = spec.title;
  t.className = spec.outcome;
  // the SCREEN wears the outcome too: the entrance differs by it, and CSS
  // cannot ask a child which way this game went
  const ov = $('#ovEnd');
  ov.classList.remove('win', 'lose', 'draw', 'settled');
  ov.classList.add(spec.outcome);
  $('#endSub').textContent = spec.sub;
  $('#endYou').textContent = String(spec.you.score);
  $('#endCpu').textContent = String(spec.them.score);
  $('#endYouLbl').textContent = spec.you.label;
  $('#endCpuLbl').textContent = spec.them.label;
  setMeta(spec.meta ?? '');
  label('#btnAgain', spec.again);
  label('#btnMenu2', spec.alt);
  label('#btnEndHome', spec.home);
  shareText = spec.share ?? '';
  const sh = $('#btnShare') as HTMLButtonElement;
  sh.hidden = !spec.share;
  sh.textContent = 'Share result';
  setTimeout(() => {
    show('#ovEnd');
    // restart the entrance: a class that is already there animates nothing
    replay(ov, 'enter');
    // the rise is clipped while it travels; once it lands, the clip (and the
    // glow it would otherwise crop into a box) can come back
    t.addEventListener('animationend', () => ov.classList.add('settled'), { once: true });
    if (spec.outcome === 'win') {
      // into the screen's OWN layer: #fx sits below every overlay, so a
      // celebration drawn there would have burst behind this very screen
      fireworks(['#28e8ff', '#ffd166', '#8dffcf', '#fff'], $('#endFx'));
      vibrate([20, 50, 20, 50, 60]);
    }
  }, spec.delay ?? 0);
}

/* the context line can arrive LATE — ranked paints a points chip from cache and
   corrects it when the profile and ladder come back */
export function setMeta(html: string): void {
  const m = $('#endMeta');
  m.innerHTML = html;
  m.hidden = !html;
}

export function closeEnd(): void { hide('#ovEnd'); live = null; }

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
  const b = $('#btnShare');
  const url = location.origin + location.pathname;
  try {
    if (navigator.share) { await navigator.share({ text: shareText, url }); return; }
    await navigator.clipboard.writeText(shareText + ' ' + url);
    b.textContent = 'Copied!';
  } catch { b.textContent = 'Copy failed'; }
  setTimeout(() => { b.textContent = 'Share result'; }, 1500);
}

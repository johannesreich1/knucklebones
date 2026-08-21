// The mode dial: before a match, the game hunts for the rules it will play by.
//
// ONE dial, two callers. Ranked opens it on the server's pick; OFFLINE opens it
// when the player chose RANDOM. It therefore lives in ui/ with its CSS in
// main.css — the offline game must never pull in the online chunk to see it.
//
// Pure theatre aimed at a server-decided result — the odds live in the weighted
// server pick (core/modes.ts), never here. The dial draws every mode as an equal
// node on a ring, so the hunt is honest even though its answer is not random.
// Built from the MODES registry: a new mode becomes a new node for free.
//
// The one rule this screen obeys is that it must not SPOIL ITSELF. Everything
// that could name the answer early is withheld until the comet stops:
//   · every node flares as the comet crosses it, and the winner is exactly as
//     dark as the rest until it is found,
//   · the centre is empty while hunting (a sonar pulse in nobody's colour) and
//     blooms the found mode on landing,
//   · the name and the blurb below stay blank until the same moment.
import { MODES, type ModeSpec } from '../core/modes.ts';
import { modeIcon, modeHue } from './modeicons.ts';
import { paintAvatar } from './avatar.ts';
import { $, show, hide } from './dom.ts';
import { Sfx } from './audio.ts';
import { REDUCED } from './fx.ts';

const N = MODES.length;
const SEG = 360 / N;
/* node k sits k*SEG clockwise from 12 o'clock, and the comet's bright head sits
   at its own rotation — so "the comet is on node k" is simply rotation ≡ k*SEG */
const hue = (i: number) => modeHue(MODES[i].id);
const mod360 = (d: number) => ((d % 360) + 360) % 360;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Must match .dnode's resting opacity in online.css: a flare ends exactly on it
   so the node settles back without a step. */
const DIM = 0.28;

/* one side of the versus line — the .dav slot is filled by paintAvatar after
   the innerHTML write, so the avatar has exactly one renderer (ui/avatar.ts) */
function sideHtml(p: DialSide, cls: 'me' | 'foe'): string {
  const rating = p.rating != null ? `<span class="rt">${p.rating}</span>` : '';
  return `<span class="dside ${cls}"><span class="dav"></span>` +
         `<span class="dnm">${esc(p.name)}</span>${rating}</span>`;
}
/* Both ratings are shown; the DIFFERENCE between them is not. It is arithmetic
   the player can do if they care, and printing it turns a duel into a forecast. */
function versus(me: DialSide, foe: DialSide): string {
  return sideHtml(me, 'me') + '<span class="dvs">VS</span>' + sideHtml(foe, 'foe');
}
const esc = (t: string): string => t.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/* The node ring, as markup — the ONE description of where a mode sits on the
   dial and what colour it wears. Pure, so the design build imports it too
   (design/build.mjs, {{dialnodes}}): a card can never draw a ring the app
   does not build. `found` is the card's slot — at runtime the app lights the
   winner itself, but a still needs it baked in. */
export const dialNodes = (found?: string): string => MODES.map((m, i) =>
  `<i class="dnode${m.id === found ? ' on' : ''}" data-mode="${m.id}"`
  + ` style="--a:${(i * SEG).toFixed(2)}deg;color:${modeHue(m.id)}">${modeIcon(m.id, 24)}</i>`).join('');

let built = false;
function build(): void {
  if (built) return;
  built = true;
  document.body.insertAdjacentHTML('beforeend', `
<div class="ov" id="ovWheel">
  <div class="dwho" id="wheelWho"></div>
  <div class="wtitle">GAME MODE</div>
  <div class="dial" id="wheelDial">
    <i class="dring"></i>
    <i class="dcomet" id="wheelComet"><i class="dtrail"></i><i class="dhead"></i></i>
    ${dialNodes()}
    <div class="dcore"><i class="dsonar"></i><i class="dfound" id="wheelFound"></i></div>
  </div>
  <div class="wname" id="wheelName">&nbsp;</div>
  <div class="wblurb" id="wheelBlurb">&nbsp;</div>
  <div class="dhold" id="wheelHold"><b id="wheelCount">&nbsp;</b><span id="wheelHint">&nbsp;</span></div>
</div>`);
}

/* The comet's deceleration, in one place: the compositor animates with it and
   the frame loop below evaluates it, so the light and the flare it causes can
   never drift apart. */
const EASE: readonly [number, number, number, number] = [0.1, 0.62, 0.05, 1];
const CSS_EASE = `cubic-bezier(${EASE.join(',')})`;

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

/* Who else has to agree before the countdown can be cut short.
   The dial itself knows nothing about opponents or networks: OFFLINE passes
   nothing and one tap starts the game, ranked passes a peer backed by the
   match's realtime channel. Whatever happens, the countdown still expires on
   its own — an unheard peer costs a few seconds, never the game. */
/** a player on the versus line — ranked fills both, offline leaves them out */
export interface DialSide { name: string; rating?: number | null; avatar?: string | null }

export interface DialPeer {
  announce(): void;                        // tell the other side I am ready
  onPeer(cb: () => void): () => void;      // ...and hear when they are
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

/* Where the comet came to rest last time. It sets off from there, so the arc is
   never identical even when the server picks the same mode twice running. */
let restingAt = 0;

/* hunt, land on the server's pick, linger on the name — resolves when done */
export async function spinDial(spec: ModeSpec,
  opts?: { peer?: DialPeer; me?: DialSide; foe?: DialSide }): Promise<void> {
  build();
  const i = Math.max(0, MODES.findIndex((m) => m.id === spec.id));
  const ov = $('#ovWheel');
  const comet = $('#wheelComet') as HTMLElement;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('#wheelDial .dnode'));

  // the hunting state: nothing named, nothing lit, nothing in the middle
  /* A ranked match is a comparison, so the screen shows the comparison: both
     players, both ratings — each wearing the profile avatar they chose, the
     same face the leaderboard and the face-off card show for them. */
  const who = $('#wheelWho');
  who.innerHTML = opts?.foe && opts?.me ? versus(opts.me, opts.foe) : '';
  if (opts?.foe && opts?.me) {
    paintAvatar(who.querySelector('.dside.me .dav') as HTMLElement, opts.me.avatar, 44);
    paintAvatar(who.querySelector('.dside.foe .dav') as HTMLElement, opts.foe.avatar, 44);
  }
  ov.classList.remove('landed', 'ready');
  ov.classList.add('hunting');
  nodes.forEach((n) => n.classList.remove('on'));
  $('#wheelName').innerHTML = '&nbsp;';
  $('#wheelBlurb').innerHTML = '&nbsp;';
  const found = $('#wheelFound') as HTMLElement;
  found.innerHTML = modeIcon(spec.id, 40);
  found.style.color = hue(i);
  show('#ovWheel');

  const from = restingAt;
  const target = i * SEG;
  /* Two things vary so no two hunts read alike — how far it travels (4-6 whole
     laps) and where it starts. Only the ending is fixed: the server decided
     that before this screen appeared. */
  const laps = 4 + Math.floor(Math.random() * 3);
  const sweep = laps * 360 + mod360(target - from);
  restingAt = target;
  // a longer sweep runs proportionally longer, so every hunt decelerates at the
  // same rate — one fixed duration would make the long ones frantic
  const ms = Math.max(2400, Math.min(4600, sweep / 0.62));

  if (REDUCED) {
    comet.style.transform = `rotate(${target}deg)`;
  } else {
    const run = comet.animate(
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
      for (let k = 0; k < N; k++) {
        const a = k * SEG;
        if (Math.floor((at - a) / 360) > Math.floor((prev - a) / 360)) flare(nodes[k]);
      }
      prev = at;
      if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await run.finished;
  }

  // found: the node stays lit, the centre blooms, the name arrives
  ov.classList.remove('hunting');
  ov.classList.add('landed');
  /* the comet's FINAL crossing is the landing itself, and its flare may fire
     on this very frame — one beat for it to land, then cut it, so the winner
     holds the flare's full light instead of fading and snapping back */
  if (!REDUCED) await new Promise(requestAnimationFrame);
  nodes[i]?.getAnimations().forEach((a) => a.cancel());
  nodes[i]?.classList.add('on');
  Sfx.place();
  const name = $('#wheelName') as HTMLElement;
  name.innerHTML = `${modeIcon(spec.id, 17)} ${spec.name}`;
  name.style.color = hue(i);
  $('#wheelBlurb').textContent = spec.blurb;
  await hold(ov, opts?.peer);
  hide('#ovWheel');
}

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

let built = false;
function build(): void {
  if (built) return;
  built = true;
  const nodes = MODES.map((m, i) =>
    `<i class="dnode" data-mode="${m.id}" style="--a:${(i * SEG).toFixed(2)}deg;color:${modeHue(m.id)}">${modeIcon(m.id, 24)}</i>`).join('');
  document.body.insertAdjacentHTML('beforeend', `
<div class="ov" id="ovWheel">
  <div class="dwho" id="wheelWho"></div>
  <div class="wtitle">GAME MODE</div>
  <div class="dial" id="wheelDial">
    <i class="dring"></i>
    <i class="dcomet" id="wheelComet"><i class="dtrail"></i><i class="dhead"></i></i>
    ${nodes}
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
  if (REDUCED) return;
  el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.14 }, { opacity: DIM }],
    { duration: 480, easing: 'ease-out' });
}

/* Who else has to agree before the countdown can be cut short.
   The dial itself knows nothing about opponents or networks: OFFLINE passes
   nothing and one tap starts the game, ranked passes a peer backed by the
   match's realtime channel. Whatever happens, the countdown still expires on
   its own — an unheard peer costs a few seconds, never the game. */
/** who you are about to play — ranked fills this, offline leaves it out */
export interface DialFoe { name: string; rating?: number | null }

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
export async function spinDial(spec: ModeSpec, opts?: { peer?: DialPeer; foe?: DialFoe }): Promise<void> {
  build();
  const i = Math.max(0, MODES.findIndex((m) => m.id === spec.id));
  const ov = $('#ovWheel');
  const comet = $('#wheelComet') as HTMLElement;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('#wheelDial .dnode'));

  // the hunting state: nothing named, nothing lit, nothing in the middle
  const who = $('#wheelWho');
  who.innerHTML = opts?.foe
    ? `Opponent <b></b>${opts.foe.rating != null ? ' · <span class="rt"></span>' : ''}`
    : '';
  if (opts?.foe) {
    (who.querySelector('b') as HTMLElement).textContent = opts.foe.name;
    const rt = who.querySelector('.rt') as HTMLElement | null;
    if (rt) rt.textContent = String(opts.foe.rating);
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
  nodes[i]?.classList.add('on');
  Sfx.place();
  const name = $('#wheelName') as HTMLElement;
  name.innerHTML = `${modeIcon(spec.id, 17)} ${spec.name}`;
  name.style.color = hue(i);
  $('#wheelBlurb').textContent = spec.blurb;
  await hold(ov, opts?.peer);
  hide('#ovWheel');
}

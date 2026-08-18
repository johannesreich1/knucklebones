// The mode wheel: pure theater aimed at a server-decided result. The wheel
// draws every mode as an EQUAL segment; the odds live in the weighted server
// pick (modes.ts), not in segment sizes — so the spin is aimed, never random.
// Built from the MODES registry: a new mode becomes a new segment for free.
import './online.css';   // the wheel's styles live with the online chunk's
import { MODES, type ModeSpec } from '../core/modes.ts';
import { modeIcon, modeHue } from '../ui/modeicons.ts';
import { $, show, hide } from '../ui/dom.ts';
import { Sfx } from '../ui/audio.ts';

const SEG = 360 / MODES.length;
/* segment accents come from the shared per-mode hue map (ui/modeicons.ts) */
const hue = (i: number) => modeHue(MODES[i].id);

let built = false;
function build(): void {
  if (built) return;
  built = true;
  const stops = MODES.map((_, i) =>
    `${hue(i)}3a ${i * SEG}deg, ${hue(i)}3a ${(i + 1) * SEG}deg`).join(', ');
  const seams = MODES.map((_, i) =>
    `<div class="wseam" style="transform:rotate(${i * SEG}deg)"></div>`).join('');
  // labels stay uniform: the landing rotation always brings the WINNING
  // segment to the pointer in this exact orientation — upright, every time
  const labels = MODES.map((m, i) =>
    `<div class="wlabel" style="transform:rotate(${i * SEG + SEG / 2}deg)"><span style="color:${hue(i)}">${modeIcon(m.id, 15)}<br>${m.name.split(' ').join('<br>')}</span></div>`).join('');
  document.body.insertAdjacentHTML('beforeend', `
<div class="ov" id="ovWheel">
  <div class="wtitle">GAME MODE</div>
  <div class="wheelwrap">
    <div class="wpin"></div>
    <div class="wdisc" id="wheelDisc" style="background:conic-gradient(${stops})">${seams}${labels}</div>
    <div class="whub"></div>
  </div>
  <div class="wname" id="wheelName">&nbsp;</div>
  <div class="wblurb" id="wheelBlurb">&nbsp;</div>
</div>`);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mod360 = (d: number) => ((d % 360) + 360) % 360;
/* Where the disc came to rest last time, 0-360. The wheel spins ON from there,
   so the arc is never identical even when the server picks the same mode twice
   in a row. */
let restingAt = 0;

/* spin, land on the server's pick, linger on the name — resolves when done */
export async function spinWheel(spec: ModeSpec): Promise<void> {
  build();
  const i = Math.max(0, MODES.findIndex((m) => m.id === spec.id));
  const disc = $('#wheelDisc') as HTMLElement;
  const name = $('#wheelName') as HTMLElement;
  name.textContent = ' ';
  $('#wheelBlurb').textContent = ' ';
  disc.style.transition = 'none';
  disc.style.transform = `rotate(${restingAt}deg)`;   // resume, never snap back to zero
  show('#ovWheel');
  void disc.offsetWidth;                       // commit the start angle before spinning
  /* Three things vary, so no two spins read alike: where it STARTS (wherever
     the last match left it), how FAR it travels (4-7 whole turns), and where in
     the winning segment it SETTLES. Only the segment is fixed — the server
     already decided that, and the wheel is aimed at it, never at random. */
  const jitter = (Math.random() - 0.5) * (SEG - 20);   // inside the segment, never on a seam
  const land = mod360(360 - (i * SEG + SEG / 2 + jitter));
  const turns = 4 + Math.floor(Math.random() * 4);
  const sweep = turns * 360 + mod360(land - restingAt);
  const target = restingAt + sweep;
  restingAt = land;
  /* A longer sweep gets proportionally longer, so every spin decelerates at the
     same rate: one fixed duration would make the long ones frantic and the
     short ones limp. */
  const secs = Math.max(2.4, Math.min(5, sweep / 620));
  disc.style.transition = `transform ${secs}s cubic-bezier(.12,.67,.06,1)`;
  disc.style.transform = `rotate(${target}deg)`;
  await pause(secs * 1000 + 60);
  Sfx.place();
  name.innerHTML = `${modeIcon(spec.id, 17)} ${spec.name}`;
  name.style.color = hue(i);
  $('#wheelBlurb').textContent = spec.blurb;
  await pause(2600);               // linger — the result must be READABLE, not a flash
  hide('#ovWheel');
}

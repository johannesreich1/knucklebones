// The mode wheel: pure theater aimed at a server-decided result. The wheel
// draws every mode as an EQUAL segment; the odds live in the weighted server
// pick (modes.ts), not in segment sizes — so the spin is aimed, never random.
// Built from the MODES registry: a new mode becomes a new segment for free.
import './online.css';   // the wheel's styles live with the online chunk's
import { MODES, type ModeSpec } from '../core/modes.ts';
import { modeIcon } from '../ui/modeicons.ts';
import { $, show, hide } from '../ui/dom.ts';
import { Sfx } from '../ui/audio.ts';

const SEG = 360 / MODES.length;
/* segment accents: classic neutral, then the game's own palette — the m3
   destruction orange for SINGLE STRIKE, money green for BOUNTY */
const HUES = ['#8ea3c0', '#28e8ff', '#ff2fa0', '#ffd166', '#ff8a3d', '#7ee787'];
const hue = (i: number) => HUES[i % HUES.length];

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

/* spin, land on the server's pick, linger on the name — resolves when done */
export async function spinWheel(spec: ModeSpec): Promise<void> {
  build();
  const i = Math.max(0, MODES.findIndex((m) => m.id === spec.id));
  const disc = $('#wheelDisc') as HTMLElement;
  const name = $('#wheelName') as HTMLElement;
  name.textContent = ' ';
  $('#wheelBlurb').textContent = ' ';
  disc.style.transition = 'none';
  disc.style.transform = 'rotate(0deg)';
  show('#ovWheel');
  void disc.offsetWidth;                       // commit the reset before spinning
  const jitter = (Math.random() - 0.5) * (SEG - 26);   // land inside the segment, never on a seam
  const target = 5 * 360 + (360 - (i * SEG + SEG / 2 + jitter));
  disc.style.transition = 'transform 3.4s cubic-bezier(.12,.67,.06,1)';
  disc.style.transform = `rotate(${target}deg)`;
  await pause(3450);
  Sfx.place();
  name.innerHTML = `${modeIcon(spec.id, 17)} ${spec.name}`;
  name.style.color = hue(i);
  $('#wheelBlurb').textContent = spec.blurb;
  await pause(2600);               // linger — the result must be READABLE, not a flash
  hide('#ovWheel');
}

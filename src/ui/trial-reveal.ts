// One simultaneous reveal beat for Rune Trial's two mandatory private choices.
// The server has already made the assignments public before this theatre runs;
// this is presentation only and never participates in rules or settlement.
import type { SpellSpec } from '../core/spells.ts';
import { spellCopy, t } from '../i18n/index.ts';
import { Sfx, vibrate } from './audio.ts';
import { appRoot } from './embed.ts';
import { REDUCED } from './fx.ts';
import { modeIcon } from './modeicons.ts';
import { runeCardFaces } from './runedeal.ts';
import { spellHue } from './spellicons.ts';
import type { Beat } from './reveal-types.ts';

export interface TrialRevealSide {
  readonly spell: SpellSpec;
  readonly name: () => string;
  readonly hue: string;
}

const esc = (value: string): string => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

const runeName = (side: TrialRevealSide): string => spellCopy(side.spell.id).name;

function sideMarkup(side: TrialRevealSide, index: number): string {
  const id = side.spell.id;
  return `<div class="trial-reveal__side" data-side="${index}">`
    + `<small class="trial-reveal__owner" style="--c:${side.hue};color:${side.hue}">`
    + `<span class="dot"></span><span class="nm">${esc(side.name())}</span></small>`
    + `<div class="rdealt trial-reveal__card" data-rune="${id}"`
    + ` style="color:${spellHue(id)}">`
    + `${runeCardFaces(side.spell)}</div></div>`;
}

async function flip(card: HTMLElement): Promise<void> {
  if (REDUCED) {
    card.classList.add('up');
    return;
  }
  const first = card.animate([
    { transform: 'perspective(900px) rotateY(0deg)' },
    { transform: 'perspective(900px) rotateY(90deg)' },
  ], { duration: 240, easing: 'ease-in', fill: 'both' });
  await first.finished;
  card.classList.add('up');
  const second = card.animate([
    { transform: 'perspective(900px) rotateY(-90deg)' },
    { transform: 'perspective(900px) rotateY(0deg)' },
  ], { duration: 280, easing: 'ease-out', fill: 'both' });
  await second.finished;
  card.style.transform = '';
}

function pairBlurb(sides: readonly [TrialRevealSide, TrialRevealSide]): string {
  return t('game', 'runeTrial.revealPair', {
    playerOne: sides[0].name(),
    runeOne: runeName(sides[0]),
    playerTwo: sides[1].name(),
    runeTwo: runeName(sides[1]),
  });
}

export function trialRuneRevealBeat(
  sides: readonly [TrialRevealSide, TrialRevealSide],
): Beat {
  return {
    get label() { return t('game', 'reveal.trialRunes'); },
    /* Kept for assistive tech and for any surface that quotes a beat, but the
       shell no longer prints them: see `bare`. */
    get name() { return t('game', 'runeTrial.revealed'); },
    get blurb() { return pairBlurb(sides); },
    bare: true,
    hue: '#b18cff',
    icon: modeIcon('rune_trial', 17),
    cls: 'trial-revealing',
    stage: `<div class="trial-reveal">${sideMarkup(sides[0], 0)}${sideMarkup(sides[1], 1)}</div>`,
    repaintStage(stage) {
      stage.querySelectorAll<HTMLElement>('.trial-reveal__side').forEach((element, index) => {
        const side = sides[index];
        if (!side) return;
        const owner = element.querySelector<HTMLElement>('.trial-reveal__owner .nm');
        const label = element.querySelector<HTMLElement>('.rlbl');
        if (owner) owner.textContent = side.name();
        if (label) label.textContent = runeName(side);
      });
    },
    async run(settle) {
      const cards = Array.from(appRoot().querySelectorAll<HTMLElement>(
        '#wheelStage .trial-reveal__card',
      ));
      cards.forEach((card) => { card.style.opacity = '1'; });
      if (!REDUCED) await new Promise<void>((resolve) => setTimeout(resolve, 220));
      Sfx.place();
      await Promise.all(cards.map(flip));
      settle();
      vibrate([12, 35, 18]);
    },
  };
}

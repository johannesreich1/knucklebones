// One simultaneous reveal beat for the two ranked rune seats. Rune Trial
// supplies two mandatory private choices; ordinary ranked supplies the two
// immutable match-row snapshots, either of which may honestly be NONE. The
// server has already made the assignments public before this theatre runs;
// this is presentation only and never participates in rules or settlement.
import type { SpellSpec } from '../core/spells.ts';
import { spellCopy, t } from '../i18n/index.ts';
import { Sfx, vibrate } from './audio.ts';
import { appRoot } from './embed.ts';
import { REDUCED } from './fx.ts';
import { modeIcon } from './modeicons.ts';
import { runeCardFaces } from './runedeal.ts';
import { spellHue, spellIcon } from './spellicons.ts';
import type { Beat } from './reveal-types.ts';

export interface RankedRuneRevealSide {
  readonly spell: SpellSpec | null;
  readonly name: () => string;
  readonly hue: string;
}

export interface TrialRevealSide extends RankedRuneRevealSide {
  readonly spell: SpellSpec;
}

const esc = (value: string): string => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

const runeId = (side: RankedRuneRevealSide): string => side.spell?.id ?? 'none';
const runeName = (side: RankedRuneRevealSide): string => side.spell
  ? spellCopy(side.spell.id).name
  : t('game', 'runes.none.name');

function emptyRuneCardFaces(): string {
  const id = 'none';
  return `<i class="rback">${spellIcon(id, 20)}</i>`
    + `<i class="rface">${spellIcon(id, 44)}`
    + `<span class="rlbl">${esc(t('game', 'runes.none.name'))}</span></i>`;
}

function sideMarkup(side: RankedRuneRevealSide, index: number): string {
  const id = runeId(side);
  return `<div class="trial-reveal__side" data-side="${index}">`
    + `<small class="trial-reveal__owner" style="--c:${side.hue};color:${side.hue}">`
    + `<span class="dot"></span><span class="nm">${esc(side.name())}</span></small>`
    + `<div class="rdealt trial-reveal__card" data-rune="${id}"`
    + ` style="color:${spellHue(id)}">`
    + `${side.spell ? runeCardFaces(side.spell) : emptyRuneCardFaces()}</div></div>`;
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

function pairBlurb(
  sides: readonly [RankedRuneRevealSide, RankedRuneRevealSide],
  key: 'runeTrial.revealPair' | 'rankedRunes.revealPair',
): string {
  return t('game', key, {
    playerOne: sides[0].name(),
    runeOne: runeName(sides[0]),
    playerTwo: sides[1].name(),
    runeTwo: runeName(sides[1]),
  });
}

function rankedRuneRevealBeat(
  sides: readonly [RankedRuneRevealSide, RankedRuneRevealSide],
  kind: 'trial' | 'standard',
): Beat {
  const trial = kind === 'trial';
  return {
    get label() { return t('game', trial ? 'reveal.trialRunes' : 'reveal.rankedRunes'); },
    /* Kept for assistive tech and for any surface that quotes a beat, but the
       shell no longer prints them: see `bare`. */
    get name() { return t('game', trial ? 'runeTrial.revealed' : 'rankedRunes.revealed'); },
    get blurb() {
      return pairBlurb(sides, trial ? 'runeTrial.revealPair' : 'rankedRunes.revealPair');
    },
    bare: true,
    hue: '#b18cff',
    icon: modeIcon(trial ? 'rune_trial' : 'classic', 17),
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

export function trialRuneRevealBeat(
  sides: readonly [TrialRevealSide, TrialRevealSide],
): Beat {
  return rankedRuneRevealBeat(sides, 'trial');
}

export function standardRuneRevealBeat(
  sides: readonly [RankedRuneRevealSide, RankedRuneRevealSide],
): Beat {
  return rankedRuneRevealBeat(sides, 'standard');
}

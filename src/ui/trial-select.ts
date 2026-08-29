// Shared Rune Trial choice surface. Local play drives it once per private seat;
// ranked play can drive the same one-choice seam after receiving an offer from
// the server. The controller never decides an offer, observes another choice,
// or grants a rune.
import { spellById, type SpellSpec } from '../core/spells.ts';
import { formatNumber, runeTrialCopy, spellCopy, subscribeLocale, t } from '../i18n/index.ts';
import { Sfx } from './audio.ts';
import { appRoot } from './embed.ts';
import { hide, show } from './dom.ts';
import { runeCardFaces } from './runedeal.ts';
import { versus } from './reveal-answer.ts';
import { paintAvatar } from './avatar.ts';
import type { DialSide } from './reveal-types.ts';
import { spellHue } from './spellicons.ts';

export interface TrialChoicePlayer {
  readonly name: () => string;
  readonly hue?: string;
}

export interface TrialRuneChoiceSpec {
  readonly offer: readonly SpellSpec[];
  readonly player: TrialChoicePlayer;
  readonly title?: () => string;
  readonly prompt?: () => string;
  /* When the server will choose for this player, as an ISO stamp. Ranked deals
     one with the offer; local play has no authority to enforce a deadline and
     passes nothing, so the lane stays hidden rather than counting down to an
     event that will not happen. */
  readonly deadline?: () => string | null;
  /* Who is playing whom. This screen opens ON TOP of a reveal that is already
     showing this line and paints its own opaque ground over it, so without this
     the pairing simply vanishes for the length of the choice. Built by
     revealPairing() so the two screens cannot disagree. */
  readonly versus?: { readonly me: DialSide; readonly foe: DialSide };
}

export interface TrialHandoffSpec {
  readonly player: TrialChoicePlayer;
  readonly title?: () => string;
  readonly prompt?: () => string;
}

type Active = { repaint: () => void; cancel: () => void };
let active: Active | null = null;
let built = false;

const esc = (value: string): string => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

function build(): void {
  if (built) return;
  built = true;
  appRoot().insertAdjacentHTML('beforeend', `
<div class="ov trial-select" id="ovTrialSelect" role="dialog" aria-modal="true"
  aria-labelledby="trialSelectTitle" aria-describedby="trialSelectPrompt">
  <div class="dwho trial-select__who" id="trialSelectWho" hidden></div>
  <div class="trial-select__eyebrow" id="trialSelectOwner"></div>
  <h2 class="trial-select__title" id="trialSelectTitle"></h2>
  <p class="trial-select__prompt" id="trialSelectPrompt"></p>
  <div class="trial-select__cards" id="trialSelectCards"></div>
  <button type="button" class="btn primary trial-select__ready" id="trialSelectReady" hidden></button>
  <div class="trial-select__clock" id="trialSelectClock" hidden>
    <b id="trialSelectCount"></b><span id="trialSelectClockHint"></span></div>
</div>`);
}

function clear(): void {
  if (!built) return;
  hide('#ovTrialSelect');
  const cards = appRoot().querySelector<HTMLElement>('#trialSelectCards');
  if (cards) cards.innerHTML = '';
  active = null;
}

function assertOffer(offer: readonly SpellSpec[]): void {
  if (offer.length !== 3 || new Set(offer.map(({ id }) => id)).size !== 3
      || offer.some(({ id }) => spellById(id) === null)) {
    throw new RangeError('Rune Trial selection requires exactly three distinct registered runes.');
  }
}

/** Resolve one private choice. Hiding and clearing happen before the answer is returned. */
export function requestTrialRuneChoice(spec: TrialRuneChoiceSpec): Promise<string | null> {
  if (active) throw new Error('A Rune Trial selection is already active.');
  assertOffer(spec.offer);
  build();
  const root = appRoot();
  const overlay = root.querySelector<HTMLElement>('#ovTrialSelect')!;
  const owner = root.querySelector<HTMLElement>('#trialSelectOwner')!;
  const title = root.querySelector<HTMLElement>('#trialSelectTitle')!;
  const prompt = root.querySelector<HTMLElement>('#trialSelectPrompt')!;
  const cards = root.querySelector<HTMLElement>('#trialSelectCards')!;
  const ready = root.querySelector<HTMLButtonElement>('#trialSelectReady')!;
  overlay.classList.remove('handoff');
  ready.hidden = true;
  cards.hidden = false;
  cards.setAttribute('role', 'group');
  cards.innerHTML = spec.offer.map((rune) => {
    const copy = spellCopy(rune.id);
    return `<button type="button" class="rdealt up trial-select__card" data-rune="${rune.id}"`
      + ` style="color:${spellHue(rune.id)}" aria-label="${esc(`${copy.name} — ${copy.blurb}`)}">`
      + `${runeCardFaces(rune)}</button>`;
  }).join('');

  const repaint = (): void => {
    owner.textContent = spec.player.name();
    owner.style.color = spec.player.hue ?? '';
    title.textContent = spec.title?.() ?? runeTrialCopy().name;
    prompt.textContent = spec.prompt?.() ?? t('game', 'runeTrial.chooseFor', {
      player: spec.player.name(),
    });
    cards.querySelectorAll<HTMLButtonElement>('button[data-rune]').forEach((button) => {
      const id = button.dataset.rune!;
      const copy = spellCopy(id);
      button.setAttribute('aria-label', `${copy.name} — ${copy.blurb}`);
      const label = button.querySelector<HTMLElement>('.rlbl');
      if (label) label.textContent = copy.name;
    });
    paintClock();
  };

  /* THE CLOCK IS A READOUT, NOT AN AUTHORITY. Expiry belongs to the server —
     it stamped the deadline and it resolves a missing choice — and ranked
     already races it in trial-offer.ts. If this counted the pick out itself
     the two would disagree the moment one of them was slow, so at zero it
     simply stops at zero and waits to be told. */
  /* The avatar slot is filled AFTER the innerHTML write, exactly as the reveal
     does it, so avatars keep one renderer (ui/avatar.ts). */
  const who = root.querySelector<HTMLElement>('#trialSelectWho')!;
  who.hidden = !spec.versus;
  if (spec.versus) {
    who.innerHTML = versus(spec.versus.me, spec.versus.foe);
    paintAvatar(who.querySelector('.dside.me .dav') as HTMLElement, spec.versus.me.avatar, 44);
    paintAvatar(who.querySelector('.dside.foe .dav') as HTMLElement, spec.versus.foe.avatar, 44);
  }

  const clock = root.querySelector<HTMLElement>('#trialSelectClock')!;
  const clockCount = root.querySelector<HTMLElement>('#trialSelectCount')!;
  const clockHint = root.querySelector<HTMLElement>('#trialSelectClockHint')!;
  const endsAt = Date.parse(spec.deadline?.() ?? '');
  const counting = Number.isFinite(endsAt);
  clock.hidden = !counting;
  const paintClock = (): void => {
    if (!counting) return;
    clockCount.textContent = formatNumber(
      Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    clockHint.textContent = t('game', 'runeTrial.pickClock');
  };

  return new Promise<string | null>((resolve) => {
    let settled = false;
    let ticker = 0;
    if (counting) {
      paintClock();
      ticker = setInterval(paintClock, 250) as unknown as number;
    }
    const finish = (choice: string | null): void => {
      if (settled) return;
      settled = true;
      clearInterval(ticker);
      clear();
      resolve(choice);
    };
    active = { repaint, cancel: () => finish(null) };
    cards.querySelectorAll<HTMLButtonElement>('button[data-rune]').forEach((button) => {
      button.addEventListener('click', () => {
        if (settled || button.disabled) return;
        cards.querySelectorAll<HTMLButtonElement>('button').forEach((candidate) => { candidate.disabled = true; });
        Sfx.tap();
        finish(button.dataset.rune ?? null);
      });
    });
    repaint();
    show('#ovTrialSelect');
    cards.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  });
}

/** A secrecy handoff between local choices; no prior card remains mounted. */
export function awaitTrialHandoff(spec: TrialHandoffSpec): Promise<boolean> {
  if (active) throw new Error('A Rune Trial selection is already active.');
  build();
  const root = appRoot();
  const overlay = root.querySelector<HTMLElement>('#ovTrialSelect')!;
  const owner = root.querySelector<HTMLElement>('#trialSelectOwner')!;
  const title = root.querySelector<HTMLElement>('#trialSelectTitle')!;
  const prompt = root.querySelector<HTMLElement>('#trialSelectPrompt')!;
  const cards = root.querySelector<HTMLElement>('#trialSelectCards')!;
  const ready = root.querySelector<HTMLButtonElement>('#trialSelectReady')!;
  overlay.classList.add('handoff');
  cards.innerHTML = '';
  cards.hidden = true;
  ready.hidden = false;

  const repaint = (): void => {
    owner.textContent = spec.player.name();
    owner.style.color = spec.player.hue ?? '';
    title.textContent = spec.title?.() ?? t('game', 'pass.passPhone');
    prompt.textContent = spec.prompt?.() ?? t('game', 'pass.tapReady');
    ready.textContent = t('game', 'pass.tapReady');
  };

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (readyToPick: boolean): void => {
      if (settled) return;
      settled = true;
      clear();
      resolve(readyToPick);
    };
    active = { repaint, cancel: () => finish(false) };
    ready.onclick = () => { Sfx.tap(); finish(true); };
    repaint();
    show('#ovTrialSelect');
    ready.focus({ preventScroll: true });
  });
}

export function cancelTrialSelection(): void {
  active?.cancel();
}

subscribeLocale(() => active?.repaint());

/* Presentation hook, the same idiom as __kbResult in online/screens/ui.ts: the
   RANKED choice sheet cannot otherwise be reached from a test — it needs a live
   match, a dealt offer and a server deadline — so the one shape that actually
   ships (pairing above, cards centred, clock below) had no way to be measured.
   Opens the sheet and resolves like a real pick. */
if (typeof window !== 'undefined') {
  (window as any).__kbTrialPick = (
    runes: readonly string[],
    rest: Omit<TrialRuneChoiceSpec, 'offer'>,
  ): Promise<string | null> => requestTrialRuneChoice({
    ...rest,
    /* Ids in, specs out: a caller across the page boundary cannot hand over a
       live SpellSpec, and the registry is the only thing that should build one. */
    offer: runes.map((id) => spellById(id)).filter((spell): spell is SpellSpec => !!spell),
  });
}

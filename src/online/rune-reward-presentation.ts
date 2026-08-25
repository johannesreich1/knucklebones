// One presentation model for a first rune unlock. A ranked result consumes it
// through EndFeature; a reward recovered on entry/profile consumes the same
// copy in the shared sheet. Neither surface may acknowledge until its reward
// has completed the visual entrance and still owns the current navigation.
import { spellById, type SpellSpec } from '../core/spells.ts';
import { spellCopy, t } from '../i18n/index.ts';
import { Sfx } from '../ui/audio.ts';
import type { EndFeature } from '../ui/endscreen.ts';
import { showSheet, type Sheet } from '../ui/sheet.ts';
import { spellHue, spellIcon } from '../ui/spellicons.ts';
import { rootElementFromPoint } from '../ui/query.ts';
import {
  acknowledgeRuneReward,
  type PlayerRuneRow,
  type RuneCollectionRefresh,
} from './rune-collection.ts';

export interface RuneRewardPresentation {
  readonly accountId: string;
  readonly row: PlayerRuneRow;
  readonly rune: SpellSpec;
}

export interface RuneRewardSheetPorts {
  owns(): boolean;
  onContinue(): void;
  onTry(runeId: string): boolean;
}

export interface RuneRewardSheet {
  close(): void;
}

export interface RuneRewardAcknowledgement {
  /** An explicit reward CTA is proof of presentation even during its entrance. */
  acknowledge(): Promise<boolean> | null;
  /** Navigation/dismissal without a CTA keeps the durable reward unseen. */
  cancel(): void;
}

export function firstUnseenRuneReward(
  collection: RuneCollectionRefresh,
): RuneRewardPresentation | null {
  if (!collection.verified || !collection.accountId) return null;
  for (const row of collection.unseen) {
    const rune = spellById(row.rune_id);
    if (rune) return { accountId: collection.accountId, row, rune };
  }
  return null;
}

function copyFor(reward: RuneRewardPresentation) {
  const copy = spellCopy(reward.rune.id);
  return {
    kicker: t('online', 'result.newRune'),
    title: copy.name,
    body: copy.blurb,
    tryIt: t('online', 'result.tryIt'),
    continue: t('common', 'actions.continue'),
  };
}

export function runeRewardFeature(
  reward: RuneRewardPresentation,
  onTry: () => void,
): EndFeature {
  const copy = copyFor(reward);
  return {
    className: 'rune-reward',
    hue: spellHue(reward.rune.id),
    icon: spellIcon(reward.rune.id, 24),
    kicker: copy.kicker,
    title: copy.title,
    body: copy.body,
    action: { label: copy.tryIt, run: onTry },
  };
}

function visiblyPresented(element: HTMLElement): boolean {
  if (!element.isConnected || element.hidden) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const onScreen = rect.width > 0 && rect.height > 0
    && rect.bottom > 0 && rect.top < window.innerHeight
    && rect.right > 0 && rect.left < window.innerWidth;
  if (!onScreen || style.display === 'none' || style.visibility === 'hidden'
      || Number(style.opacity) < .98) return false;
  const animations = typeof element.getAnimations === 'function'
    ? element.getAnimations().filter(({ playState }) =>
      playState === 'running')
    : [];
  if (animations.length) return false;
  /* Geometry and opacity alone cannot tell whether another route or modal is
     covering the reward. Require its visual centre to own hit-testing too, so
     a result card underneath Profile/face-off remains durably unseen. Once the
     temporary cover leaves, the same watcher may complete normally. */
  const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
  const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
  const hit = rootElementFromPoint(x, y);
  return !!hit && element.contains(hit);
}

/**
 * A hidden/delayed reward remains unseen. requestAnimationFrame also pauses in
 * a hidden page, which is exactly the contract: background time is not a
 * player-visible presentation.
 */
export function acknowledgeRuneRewardWhenPresented(
  reward: RuneRewardPresentation,
  element: HTMLElement,
  owns: () => boolean,
): RuneRewardAcknowledgement {
  let active = true;
  let submission: Promise<boolean> | null = null;
  let frame = 0;
  const acknowledge = (): Promise<boolean> | null => {
    if (submission) return submission;
    if (!active) return null;
    active = false;
    if (frame) cancelAnimationFrame(frame);
    submission = acknowledgeRuneReward(reward.accountId, reward.rune.id);
    return submission;
  };
  const check = (): void => {
    if (!active || !owns() || !element.isConnected) return;
    if (!visiblyPresented(element)) {
      frame = requestAnimationFrame(check);
      return;
    }
    acknowledge();
  };
  frame = requestAnimationFrame(check);
  return {
    acknowledge,
    cancel(): void {
      active = false;
      if (frame) cancelAnimationFrame(frame);
    },
  };
}

function rewardSheetContent(reward: RuneRewardPresentation): {
  content: HTMLElement;
  tryButton: HTMLButtonElement;
  continueButton: HTMLButtonElement;
  repaint: () => void;
} {
  const content = document.createElement('div');
  content.className = 'rune-reward-sheet__content';
  content.innerHTML = `<small class="rune-reward-sheet__kicker"></small>
    <i class="rune-reward-sheet__icon" aria-hidden="true"></i>
    <h2 class="rune-reward-sheet__title"></h2>
    <p class="rune-reward-sheet__body"></p>
    <button type="button" class="btn primary rune-reward-sheet__try"></button>
    <button type="button" class="btn soft small rune-reward-sheet__continue"></button>`;
  const tryButton = content.querySelector<HTMLButtonElement>('.rune-reward-sheet__try')!;
  const continueButton = content.querySelector<HTMLButtonElement>('.rune-reward-sheet__continue')!;
  const repaint = (): void => {
    const copy = copyFor(reward);
    content.querySelector<HTMLElement>('.rune-reward-sheet__kicker')!.textContent = copy.kicker;
    content.querySelector<HTMLElement>('.rune-reward-sheet__icon')!.innerHTML =
      spellIcon(reward.rune.id, 34);
    content.querySelector<HTMLElement>('.rune-reward-sheet__title')!.textContent = copy.title;
    content.querySelector<HTMLElement>('.rune-reward-sheet__body')!.textContent = copy.body;
    tryButton.textContent = copy.tryIt;
    continueButton.textContent = copy.continue;
  };
  repaint();
  return { content, tryButton, continueButton, repaint };
}

export function showRuneRewardSheet(
  reward: RuneRewardPresentation,
  ports: RuneRewardSheetPorts,
): RuneRewardSheet {
  const view = rewardSheetContent(reward);
  let settled = false;
  let acknowledgement: RuneRewardAcknowledgement = {
    acknowledge: () => null,
    cancel: () => undefined,
  };
  let sheet!: Sheet;

  const choose = (action: () => void): void => {
    if (settled || !ports.owns()) return;
    acknowledgement.acknowledge();
    settled = true;
    sheet.close(false);
    action();
  };
  const continueFlow = (): void => ports.onContinue();
  view.tryButton.addEventListener('click', () => {
    Sfx.tap();
    choose(() => { if (!ports.onTry(reward.rune.id)) continueFlow(); });
  });
  view.continueButton.addEventListener('click', () => {
    Sfx.tap();
    choose(continueFlow);
  });

  const dismissed = (): void => {
    if (settled) return;
    settled = true;
    acknowledgement.cancel();
    if (ports.owns()) continueFlow();
  };
  sheet = showSheet({
    content: view.content,
    interactive: true,
    cls: 'rune-reward-sheet',
    tint: spellHue(reward.rune.id),
    label: () => `${t('online', 'result.newRune')}: ${spellCopy(reward.rune.id).name}`,
    repaintLocale: view.repaint,
    onDismiss: dismissed,
    onClose: dismissed,
  });
  acknowledgement = acknowledgeRuneRewardWhenPresented(
    reward,
    sheet.card,
    () => !settled && ports.owns(),
  );
  return {
    close(): void {
      if (!settled) settled = true;
      acknowledgement.cancel();
      sheet.close(false);
    },
  };
}

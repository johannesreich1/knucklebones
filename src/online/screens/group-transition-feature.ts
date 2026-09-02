import { RUNE_TRIAL_FORMAT, rankedOutcomeById } from '../../core/ranked-outcomes.ts';
import { modeCopy, runeTrialCopy, t } from '../../i18n/index.ts';
import { modeHue, modeIcon } from '../../ui/modeicons.ts';
import type { GroupTransitionSlide } from './group-transition-model.ts';

type FeatureSlide = Exclude<GroupTransitionSlide, { readonly kind: 'group' }>;

interface FeaturePresentation {
  readonly hue: string;
  readonly kicker: string;
  readonly title: string;
  readonly copy: string;
  readonly icon: string;
  readonly equipment?: boolean;
}

const WEEKLY_ICON = `<svg class="mico" viewBox="0 0 48 48" width="46" height="46" aria-hidden="true">
  <rect x="7" y="10" width="34" height="31" rx="7" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M7 19h34M16 6v8M32 6v8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  <path d="m17 30 5 5 10-11" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const NEON_MEDAL_ICON = `<svg class="mico" viewBox="0 0 48 48" width="46" height="46" aria-hidden="true">
  <path d="m14 5 10 16L34 5h7L29 24H19L7 5h7Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
  <circle cx="24" cy="31" r="11" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="m24 25 1.8 3.7 4.1.6-3 2.8.8 4-3.7-2-3.7 2 .8-4-3-2.8 4.1-.6L24 25Z" fill="currentColor"/>
</svg>`;

function presentation(slide: FeatureSlide): FeaturePresentation {
  if (slide.kind === 'outcome') {
    const outcome = rankedOutcomeById(slide.outcomeId);
    const trial = outcome.id === RUNE_TRIAL_FORMAT;
    const copy = trial ? runeTrialCopy() : modeCopy(outcome.id);
    const hue = modeHue(trial ? RUNE_TRIAL_FORMAT : outcome.id);
    return {
      hue,
      kicker: t('online', 'groupTransition.newMode'),
      title: copy.name,
      copy: copy.blurb,
      icon: modeIcon(trial ? RUNE_TRIAL_FORMAT : outcome.id, 46),
    };
  }
  if (slide.kind === 'rune-seat') {
    return {
      hue: modeHue(RUNE_TRIAL_FORMAT),
      kicker: t('online', 'groupTransition.whatChanges'),
      title: t('online', 'groupTransition.runesUnlockedTitle'),
      copy: t('online', 'groupTransition.runesUnlockedBody'),
      icon: modeIcon(RUNE_TRIAL_FORMAT, 46),
      equipment: true,
    };
  }
  if (slide.kind === 'weekly-access') {
    return {
      hue: 'var(--g-obsidian)',
      kicker: t('online', 'groupTransition.newAccess'),
      title: t('online', 'groupTransition.weeklyUnlockedTitle'),
      copy: t('online', 'groupTransition.weeklyUnlockedBody'),
      icon: WEEKLY_ICON,
    };
  }
  return {
    hue: 'var(--g-neon)',
    kicker: t('online', 'groupTransition.rewardEarned'),
    title: t('online', 'groupTransition.neonMedalTitle'),
    copy: t('online', 'groupTransition.neonMedalBody'),
    icon: NEON_MEDAL_ICON,
  };
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Group transition feature requires ${selector}`);
  return found;
}

export function paintGroupTransitionFeature(
  deck: HTMLElement,
  body: HTMLElement,
  kicker: HTMLElement,
  slide: FeatureSlide,
): void {
  const feature = presentation(slide);
  deck.className = `gt-deck gt-feature-deck${feature.equipment ? ' gt-equipment-deck' : ''}`;
  deck.style.setProperty('--gt-tier', feature.hue);
  deck.style.setProperty('--gt-old', feature.hue);
  kicker.hidden = false;
  kicker.textContent = feature.kicker;
  body.className = 'gt-body gt-feature-body';
  body.innerHTML = `<span class="gt-feature-icon" aria-hidden="true"></span><h2 id="gtTitle"></h2><p id="gtCopy"></p>`;
  const icon = required<HTMLElement>(body, '.gt-feature-icon');
  icon.style.setProperty('--gt-accent', feature.hue);
  icon.innerHTML = feature.icon;
  required<HTMLElement>(body, '#gtTitle').textContent = feature.title;
  required<HTMLElement>(body, '#gtCopy').textContent = feature.copy;
}

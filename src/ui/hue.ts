// Settings hue labels are localized at the UI boundary. The hue ids remain
// stable CSS/persistence values; only their accessible names enter catalogs.
import { t, type LocaleKey } from '../i18n/index.ts';

const HUE_KEYS = {
  cy: 'hues.cyan',
  mg: 'hues.magenta',
  gold: 'hues.gold',
  green: 'hues.green',
  violet: 'hues.violet',
  orange: 'hues.orange',
  blue: 'hues.blue',
} as const satisfies Record<string, LocaleKey<'settings'>>;

export function hueLabel(id: string): string {
  const key = HUE_KEYS[id as keyof typeof HUE_KEYS];
  if (!key) throw new TypeError(`Unknown duel hue id: ${id}`);
  return t('settings', key);
}

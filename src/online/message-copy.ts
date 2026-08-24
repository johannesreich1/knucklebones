// Preserve the catalog provenance of messages that cross an async API seam as
// plain strings. Screens can repaint an already-visible response after a
// languagechange without repeating the provider/database operation that made
// it. Unknown text never leaks through; it becomes the localized generic
// fallback.
import { t, type LocaleKey, type TranslationValues } from '../i18n/index.ts';

interface MessageSource {
  readonly key: LocaleKey<'online'>;
  readonly values: TranslationValues;
}

const sources = new Map<string, MessageSource>();

export function onlineMessage(
  key: LocaleKey<'online'>,
  values: TranslationValues = {},
): string {
  const text = t('online', key, values);
  sources.set(text, { key, values: { ...values } });
  return text;
}

export function repaintOnlineMessage(previous: string): string {
  const source = sources.get(previous);
  return source
    ? onlineMessage(source.key, source.values)
    : onlineMessage('errors.generic');
}

import type { LocaleKey } from '../i18n/index.ts';

export interface OneTap {
  id: string;
  labelKey: LocaleKey<'online'>;
  label: string;
  available(): boolean;
  restore(): Promise<string | null>;
  attach(): Promise<string | null>;
}

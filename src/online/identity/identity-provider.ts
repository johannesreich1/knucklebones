import type { LocaleKey } from '../../i18n/index.ts';

/** A restore provider may temporarily replace AUTH with its own confirmation.
 * This callback hands the settled answer back to AUTH so it can reclaim the
 * one shared sheet before the provider continues. */
export interface OneTapRestoreLifecycle {
  nestedSheetSettled(accepted: boolean): void;
}

export interface OneTap {
  id: string;
  labelKey: LocaleKey<'online'>;
  label: string;
  available(): boolean;
  restore(lifecycle?: OneTapRestoreLifecycle): Promise<string | null>;
  attach(): Promise<string | null>;
}

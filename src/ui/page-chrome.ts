// The one page-level Back component. Screens provide identity/accessibility
// slots only; the Duel Brackets drawing and navigation marker live here.
import { chromeIcon } from './chromeicons.ts';

export interface PageBackButtonSpec {
  readonly id?: string;
  readonly label: string;
  readonly translateLabel?: boolean;
  readonly attributes?: Readonly<Record<string, string | true | undefined>>;
}

function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function pageBackButton(spec: PageBackButtonSpec): string {
  const slots = Object.entries(spec.attributes ?? {}).flatMap(([name, value]) => {
    if (value === undefined) return [];
    return [value === true ? name : `${name}="${attribute(value)}"`];
  });
  if (spec.id) slots.unshift(`id="${attribute(spec.id)}"`);
  if (spec.translateLabel !== false) {
    slots.push('data-i18n-attr="aria-label=common:actions.back"');
  }
  return `<button type="button" class="ico page-back" data-page-back ${slots.join(' ')} `
    + `aria-label="${attribute(spec.label)}">${chromeIcon('back', 30)}</button>`;
}

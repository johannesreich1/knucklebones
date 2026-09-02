// Pure die-face markup shared by the browser factory and the design-card
// compiler. Keeping the 3x3 anatomy here means a new face treatment cannot
// drift between what players see and what the design library reviews.
const PIPS: Record<number, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
const FACE_CELLS = 9;

/** Fresh canonical pip cells for renderers that do not consume HTML markup. */
export function diePipCells(value: number): readonly number[] {
  return [...(PIPS[value] ?? [])];
}

export interface DiePipDiff {
  shared: readonly number[];
  removed: readonly number[];
  added: readonly number[];
}

/* The face map has one owner. The NUDGE morph (flow/spell-effects/nudge.ts)
   asks which cells changed instead of growing its own remembered version of a
   die face (the wrap from six to one is where that drift is easiest to miss).
   Returned arrays are fresh so callers may decorate them safely. */
export function diePipDiff(from: number, to: number): DiePipDiff {
  const before = new Set(diePipCells(from));
  const after = new Set(diePipCells(to));
  return {
    shared: [...before].filter((cell) => after.has(cell)),
    removed: [...before].filter((cell) => !after.has(cell)),
    added: [...after].filter((cell) => !before.has(cell)),
  };
}

const escapeAttribute = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

export const escapeMarkupText = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

export interface DieMarkupOptions {
  classes: string;
  size?: number;
  inlineStyle?: string;
  role?: string;
  ariaLabel?: string;
  /** Optional static localization hook consumed by the app-owned DOM translator. */
  dataI18nAttr?: string;
  dataValue?: boolean;
}

export function dieMarkup(value: number, options: DieMarkupOptions): string {
  const on = new Set(PIPS[value] ?? []);
  const pips = Array.from({ length: FACE_CELLS }, (_, index) =>
    `<span class="pip${on.has(index) ? ' on' : ''}" aria-hidden="true"></span>`).join('');
  const declarations = [
    options.size ? `width:${options.size}px;height:${options.size}px;--cell:${options.size}px` : '',
    options.inlineStyle?.replace(/^\s*;+/, '') ?? '',
  ].filter(Boolean).join(';');
  const attributes = [
    `class="${escapeAttribute(`die ${options.classes}`.trim())}"`,
    options.dataValue ? `data-v="${value}"` : '',
    options.role ? `role="${escapeAttribute(options.role)}"` : '',
    options.ariaLabel ? `aria-label="${escapeAttribute(options.ariaLabel)}"` : '',
    options.dataI18nAttr ? `data-i18n-attr="${escapeAttribute(options.dataI18nAttr)}"` : '',
    declarations ? `style="${escapeAttribute(declarations)}"` : '',
  ].filter(Boolean).join(' ');
  return `<div ${attributes}>${pips}<b class="num" aria-hidden="true">${value}</b></div>`;
}

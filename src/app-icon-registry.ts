// The launcher icon's one registry. The app icon is the split die (design
// study 56b, chosen 2026-09-02): one six-face die whose left pip column wears
// one duel hue and whose right column wears the other, cut on a seam. The
// default icon is fixed cyan-and-magenta and never follows the player; a
// device may opt into the icon rendered in its own Settings pair instead,
// which is why every ORDERED pair of distinct duel hues is a pre-bundled
// alternate. Pure vocabulary: the native bridge, the asset generator, the
// Settings control and the tests all read this file and nothing else.
import { HUE_IDS } from './state.ts';

export type DuelHue = typeof HUE_IDS[number];

export interface IconPair {
  /** "your colour": the left pip column. */
  readonly p1: DuelHue;
  /** "opponent colour": the right pip column. */
  readonly p2: DuelHue;
}

/** The launch mark's ink, as a fraction of the storyboard's square canvas.
 *  tools/splash.mjs RENDERS to this and src/ui/boot-handoff.ts ANIMATES from
 *  it, so the webview's first frame can reproduce the frame the OS just showed.
 *  Two copies of this number would drift silently — the mark would start the
 *  boot handoff at the wrong size and nothing would fail, it would just look
 *  slightly wrong. 0.24 of the canvas, less the icon's 15% pad on both sides. */
export const SPLASH_MARK_FRACTION = 0.24 * (1 - 0.15 * 2);

/** The compiled primary icon: cyan for you, magenta for them. */
export const DEFAULT_ICON_PAIR: IconPair = Object.freeze({ p1: 'cy', p2: 'mg' });

/* The two seats never share a hue (Settings, the local store, the account
   preference parser and the database all refuse it), so the registry is the
   7 × 6 ordered pairs of distinct hues: 42 icons, one of them primary. */
export const ICON_PAIRS: readonly IconPair[] = Object.freeze(
  HUE_IDS.flatMap((p1) => HUE_IDS.filter((p2) => p2 !== p1)
    .map((p2) => Object.freeze({ p1, p2 } as IconPair))),
);

export type PairIconName = `split-${DuelHue}-${DuelHue}`;
export type AlternateAppIcon = Exclude<PairIconName, 'split-cy-mg'>;
/** Capacitor's cross-platform bridge spells the native null/default as primary. */
export type AppIconId = 'primary' | AlternateAppIcon;

export const pairIconName = (pair: IconPair): PairIconName => `split-${pair.p1}-${pair.p2}`;

export const samePair = (left: IconPair, right: IconPair): boolean =>
  left.p1 === right.p1 && left.p2 === right.p2;

/** The pair the player actually SEES: colour-blind mode pins cyan-vs-gold
 * over the stored picks (ui/hues.ts), and the icon follows the eye. */
export function displayedIconPair(p1: string, p2: string, colorblind: boolean): IconPair {
  if (colorblind) return { p1: 'cy', p2: 'gold' };
  const known = (hue: string): hue is DuelHue => (HUE_IDS as readonly string[]).includes(hue);
  if (!known(p1) || !known(p2) || p1 === p2) return DEFAULT_ICON_PAIR;
  return { p1, p2 };
}

/** The bundled alternate for a pair, or null for the compiled primary. */
export function alternateAppIconForPair(pair: IconPair): AlternateAppIcon | null {
  if (samePair(pair, DEFAULT_ICON_PAIR)) return null;
  return pairIconName(pair) as AlternateAppIcon;
}

export function appIconIdForPair(pair: IconPair): AppIconId {
  return alternateAppIconForPair(pair) ?? 'primary';
}

/** Strict recognition for the native reconciliation boundary. */
export function iconPairFromId(id: unknown): IconPair | null {
  if (id === 'primary') return DEFAULT_ICON_PAIR;
  if (typeof id !== 'string') return null;
  const match = /^split-([a-z]+)-([a-z]+)$/.exec(id);
  if (!match) return null;
  const pair = ICON_PAIRS.find((entry) => entry.p1 === match[1] && entry.p2 === match[2]);
  return pair ?? null;
}

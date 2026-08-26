// Persistence: stats and preferences. (Mid-game saves were removed by design
// 2026-08-18 — offline games are quick; abandoning one simply ends it.)
// Storage is unavailable in some embeds (sandboxed iframes, private modes).
// Every access is guarded: the game simply forgets between sessions there.
import { S, DIFFS, MODES, TIMERS, SEATS, HUE_IDS, oneOf } from './state.ts';
import { spellById, RANDOM_DUAL_SPELL, RANDOM_SPELL } from './core/spells.ts';
import { isLanguageOverride, setLanguageOverride } from './i18n/index.ts';

const RUNE_TRIAL_PICK = -2;

function localModePick(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= RUNE_TRIAL_PICK && Number(value) <= 6
    ? Number(value) : fallback;
}

function spellPick(value: unknown, fallback: string): string {
  return value === '' || value === RANDOM_SPELL || value === RANDOM_DUAL_SPELL || spellById(value as string)
    ? String(value) : fallback;
}

const Store = {
  KEY: 'knucklebones.v1',
  read(): Record<string, unknown> {
    try { return JSON.parse(localStorage.getItem(Store.KEY)!) || {}; } catch { return {}; }
  },
  write(o: object): void {
    try { localStorage.setItem(Store.KEY, JSON.stringify(o)); } catch { /* forgetful host */ }
  }
};

export function saveStats(): void {
  Store.write({ wins: S.wins, losses: S.losses, draws: S.draws,
                p1: S.p1, p2: S.p2, ties: S.ties,
                best: S.best, diff: S.diff, mode: S.mode, sound: S.sound,
                localeOverride: S.localeOverride,
                numerals: S.numerals, timer: S.timer, seat: S.seat, tutDone: S.tutDone, played: S.played,
                localMode: S.localMode, spell: S.spell,
                localChoices: {
                  cpu: { ...S.localChoices.cpu },
                  duo: { ...S.localChoices.duo },
                },
                p1Hue: S.p1Hue, p2Hue: S.p2Hue, colorblind: S.colorblind,
                reducedMotion: S.reducedMotion });
}

export function loadStats(): void {
  const d = Store.read() as Record<string, any>;
  S.wins = d.wins | 0; S.losses = d.losses | 0; S.draws = d.draws | 0;
  S.p1 = d.p1 | 0; S.p2 = d.p2 | 0; S.ties = d.ties | 0; S.best = d.best | 0;
  S.diff = oneOf(DIFFS, d.diff, S.diff);
  S.mode = oneOf(MODES, d.mode, S.mode);
  S.timer = oneOf(TIMERS, d.timer, S.timer);
  S.seat = oneOf(SEATS, d.seat, S.seat);
  if (isLanguageOverride(d.localeOverride)) S.localeOverride = d.localeOverride;
  setLanguageOverride(S.localeOverride);
  if (typeof d.sound === 'boolean') S.sound = d.sound;
  if (typeof d.numerals === 'boolean') S.numerals = d.numerals;
  S.p1Hue = oneOf(HUE_IDS, d.p1Hue, S.p1Hue);
  S.p2Hue = oneOf(HUE_IDS, d.p2Hue, S.p2Hue);
  // the pair must stay a pair — a clashing store falls back to the classic foe
  if (S.p1Hue === S.p2Hue) S.p2Hue = S.p1Hue === 'mg' ? 'cy' : 'mg';
  if (typeof d.colorblind === 'boolean') S.colorblind = d.colorblind;
  if (typeof d.reducedMotion === 'boolean') S.reducedMotion = d.reducedMotion;
  // Legacy builds stored one setup for both contexts. Start both new slots
  // from that validated value, then let a complete per-context slot override.
  const legacyMode = localModePick(d.localMode, S.localMode);
  const legacySpell = spellPick(d.spell, S.spell);
  S.localChoices = {
    cpu: { localMode: legacyMode, spell: legacySpell },
    duo: { localMode: legacyMode, spell: legacySpell },
  };
  if (d.localChoices && typeof d.localChoices === 'object') {
    for (const mode of MODES) {
      const choice = d.localChoices[mode];
      if (!choice || typeof choice !== 'object') continue;
      S.localChoices[mode] = {
        localMode: localModePick(choice.localMode, S.localChoices[mode].localMode),
        spell: spellPick(choice.spell, S.localChoices[mode].spell),
      };
    }
  }
  S.localMode = S.localChoices[S.mode].localMode;
  S.spell = S.localChoices[S.mode].spell;
  if (typeof d.tutDone === 'boolean') S.tutDone = d.tutDone;
  if (typeof d.played === 'boolean') S.played = d.played;
  // a player with a record from before this flag existed has obviously played
  if (S.wins + S.losses + S.draws + S.p1 + S.p2 + S.ties > 0) S.played = true;
}

/* one-time hygiene: earlier builds stored an in-progress game here */
try { localStorage.removeItem('knucklebones.game.v1'); } catch { /* forgetful host */ }

// Persistence: stats and preferences. (Mid-game saves were removed by design
// 2026-08-18 — offline games are quick; abandoning one simply ends it.)
// Storage is unavailable in some embeds (sandboxed iframes, private modes).
// Every access is guarded: the game simply forgets between sessions there.
import { S, DIFFS, MODES, TIMERS, SEATS, HUE_IDS, oneOf } from './state.ts';
import { spellById } from './core/spells.ts';

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
                numerals: S.numerals, timer: S.timer, seat: S.seat, tutDone: S.tutDone, played: S.played,
                localMode: S.localMode, spell: S.spell,
                p1Hue: S.p1Hue, p2Hue: S.p2Hue, colorblind: S.colorblind });
}

export function loadStats(): void {
  const d = Store.read() as Record<string, any>;
  S.wins = d.wins | 0; S.losses = d.losses | 0; S.draws = d.draws | 0;
  S.p1 = d.p1 | 0; S.p2 = d.p2 | 0; S.ties = d.ties | 0; S.best = d.best | 0;
  S.diff = oneOf(DIFFS, d.diff, S.diff);
  S.mode = oneOf(MODES, d.mode, S.mode);
  S.timer = oneOf(TIMERS, d.timer, S.timer);
  S.seat = oneOf(SEATS, d.seat, S.seat);
  if (typeof d.sound === 'boolean') S.sound = d.sound;
  if (typeof d.numerals === 'boolean') S.numerals = d.numerals;
  S.p1Hue = oneOf(HUE_IDS, d.p1Hue, S.p1Hue);
  S.p2Hue = oneOf(HUE_IDS, d.p2Hue, S.p2Hue);
  // the pair must stay a pair — a clashing store falls back to the classic foe
  if (S.p1Hue === S.p2Hue) S.p2Hue = S.p1Hue === 'mg' ? 'cy' : 'mg';
  if (typeof d.colorblind === 'boolean') S.colorblind = d.colorblind;
  // '' is NONE; any other value must still be a spell this build knows about
  if (d.spell === '' || spellById(d.spell)) S.spell = d.spell;
  if (typeof d.tutDone === 'boolean') S.tutDone = d.tutDone;
  if (typeof d.played === 'boolean') S.played = d.played;
  // a player with a record from before this flag existed has obviously played
  if (S.wins + S.losses + S.draws + S.p1 + S.p2 + S.ties > 0) S.played = true;
  if (Number.isInteger(d.localMode) && d.localMode >= -1 && d.localMode <= 6) S.localMode = d.localMode;
}

/* one-time hygiene: earlier builds stored an in-progress game here */
try { localStorage.removeItem('knucklebones.game.v1'); } catch { /* forgetful host */ }

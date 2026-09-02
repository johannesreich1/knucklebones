// The Home identity chip paints from the last online profile cached locally.
// It deliberately knows nothing about Supabase: boot can render it without
// loading the lazy online chunk, while online screens can repaint it after a
// profile or standing changes.
import { fillPlate } from './plate.ts';
import { appRoot } from './embed.ts';
import { t } from '../i18n/index.ts';
import { readProfileCache } from '../profile-cache.ts';
import { ladderRingLayersMarkup } from './ladder-ring.ts';
import { cachedLadderCurveVersion } from '../progression-status-cache.ts';

export function refreshHomeChip(): void {
  const chip = appRoot().querySelector<HTMLElement>('#homeChip');
  if (!chip) return;
  // A forgetful host reads as nobody cached, which paints the anonymous state.
  const profile = readProfileCache();
  if (profile?.nickname) {
    /* A cached rating may already be server-remapped while this build has not
       yet verified which floors own it. Keep the identity/avatar useful, but
       withhold points and group until boot has persisted an actual curve. */
    const rating = cachedLadderCurveVersion() === null ? null : profile.rating ?? 0;
    // The identity plate renders the same ladder row at chip size. Rank and
    // apex ride the cache from the last standing that reached the client.
    fillPlate(chip, {
      name: profile.nickname,
      avatar: profile.avatar ?? null,
      points: rating,
      rank: typeof profile.rank === 'number' ? profile.rank : null,
      apex: !!profile.apex,
      chev: true,
    });
    return;
  }
  chip.classList.add('anon');
  chip.innerHTML = `<span class="ringwrap mini">${ladderRingLayersMarkup()}</span>`
    + t('game', 'home.notSignedIn');
}

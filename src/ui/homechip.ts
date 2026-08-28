// The Home identity chip paints from the last online profile cached locally.
// It deliberately knows nothing about Supabase: boot can render it without
// loading the lazy online chunk, while online screens can repaint it after a
// profile or standing changes.
import { fillPlate } from './plate.ts';
import { appRoot } from './embed.ts';
import { t } from '../i18n/index.ts';
import { readProfileCache } from '../profile-cache.ts';

export function refreshHomeChip(): void {
  const chip = appRoot().querySelector<HTMLElement>('#homeChip');
  if (!chip) return;
  // A forgetful host reads as nobody cached, which paints the anonymous state.
  const profile = readProfileCache();
  if (profile?.nickname) {
    // The identity plate renders the same ladder row at chip size. Rank and
    // apex ride the cache from the last standing that reached the client.
    fillPlate(chip, {
      name: profile.nickname,
      avatar: profile.avatar ?? null,
      points: profile.rating ?? 0,
      rank: typeof profile.rank === 'number' ? profile.rank : null,
      apex: !!profile.apex,
      chev: true,
    });
    return;
  }
  chip.classList.add('anon');
  chip.innerHTML = '<span class="ringwrap mini"><i class="lring"></i></span>'
    + t('game', 'home.notSignedIn');
}

// The Home identity chip paints from the last online profile cached locally.
// It deliberately knows nothing about Supabase: boot can render it without
// loading the lazy online chunk, while online screens can repaint it after a
// profile or standing changes.
import { fillPlate } from './plate.ts';
import { appRoot } from './embed.ts';

interface CachedHomeProfile {
  nickname?: string;
  avatar?: string | null;
  rating?: number;
  rank?: number;
  apex?: boolean;
}

const PROFILE_CACHE = 'knucklebones.online.profile';

export function refreshHomeChip(): void {
  const chip = appRoot().querySelector<HTMLElement>('#homeChip');
  if (!chip) return;
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_CACHE) || 'null') as CachedHomeProfile | null;
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
  } catch { /* forgetful host: paint the anonymous state below */ }
  chip.classList.add('anon');
  chip.innerHTML = '<span class="ringwrap mini"><i class="lring"></i></span>NOT SIGNED IN';
}

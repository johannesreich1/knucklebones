// WHAT ELSE WEARS "YOUR COLOUR". The duel pair repaints the table for free:
// every surface that shows it reads --p1/--p2 from the root, so a Settings
// change recolours them with no JavaScript at all. Two things cannot follow
// that way and are this module's whole job.
//
//   the launcher icon — a pre-rendered native asset, so the device has to be
//     asked to select a different one (native/app-icon.ts);
//   the profile avatar — painted with a RAW hue stamped inline (ui/avatar.ts)
//     so an avatar can hold a colour of its own, which means it keeps the old
//     pips until something repaints it, and it is a server row besides.
//
// Writing that row without repainting is exactly what made a colour change
// look like it had done nothing (reported from a device, 2026-09-03), so the
// repaint belongs here beside the write rather than at either call site.
import { S } from '../state.ts';
import { readProfileCache } from '../profile-cache.ts';
import { syncAppIconColours } from '../native/app-icon.ts';
import { refreshHomeChip } from '../ui/homechip.ts';

/* A colour change that could not reach the server is not lost: re-attempt it
   the moment the device says it is back, once, and let the ordinary path
   decide again whether anything is actually out of step. */
let retryArmed = false;
function retryWhenOnline(): void {
  if (retryArmed || typeof addEventListener !== 'function') return;
  retryArmed = true;
  const retry = (): void => {
    removeEventListener('online', retry);
    retryArmed = false;
    followSettingsColours();
  };
  addEventListener('online', retry);
}

/** Carry the current pair to the launcher and the avatar. The avatar write
 * needs the online chunk, so it is only asked for when a profile is cached —
 * a signed-out device has no avatar to keep true. */
export function followSettingsColours(): void {
  void syncAppIconColours(S);
  if (!readProfileCache()?.accountId) return;
  void import('../online/identity/profile.ts')
    .then(({ alignAvatarHue }) => alignAvatarHue())
    .then((alignment) => {
      if (alignment === 'aligned') refreshHomeChip();
      else if (alignment === 'failed') retryWhenOnline();
    })
    .catch(() => retryWhenOnline());
}

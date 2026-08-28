// HOME'S DOORS INTO THE LAZY ONLINE CHUNK.
//
// Three controls lead to online — RANKED, the ladder, and the identity chip —
// and all three want the same two things: the chunk in hand, and no loading
// die between the tap and the destination. That is this module's whole job, so
// the doors, the module promise and the die live together rather than as three
// near-copies inside the menu bindings.
//
// The die here belongs to the DOWNLOAD alone. Once openOnline has the screen
// it owns what the player waits behind — the queue's searching state for a
// returning player, its own centred die otherwise — and this one gets out of
// the way. Holding it any longer is what put a spinner on top of a search.
import { Sfx } from '../ui/audio.ts';
import { $, hide, show } from '../ui/dom.ts';
import { loaderWait } from '../ui/loader.ts';
import { tap } from '../ui/tap.ts';

/* The Home-side names for the lazy chunk's entry views. Kept structural rather
   than imported so Home's bindings never pull the online module in eagerly;
   openOnline's own OnlineView checks the pairing at the call site below. */
type OnlineDoorView = 'play' | 'ladder' | 'account';
type OnlineChunk = typeof import('../online/screens/ui.ts');

/** Cross-flow actions online borrows from local play; injected, never imported. */
export interface OnlineDoorPorts {
  startTutorial: () => void;
}

export function bindOnlineDoors(ports: OnlineDoorPorts): void {
  let onlineBusy = false;
  /* One module promise for the whole session. Touching an online control starts
     the chunk before the tap completes, so the load die is usually skipped
     entirely; a player who never reaches for online never pays for it. */
  let onlineChunk: Promise<OnlineChunk> | null = null;
  const warmOnline = (): Promise<OnlineChunk> => {
    /* A chunk that failed to load must not outlive its attempt: caching the
       failure would replay one dropped request for the rest of the session and
       lock the player out of online entirely. Forgetting it means the next
       touch simply asks again.
       A dropped chunk does not necessarily REJECT. bindStaleChunkRecovery
       (boot/platform.ts) cancels vite's preloadError event, and a cancelled one
       resolves the import with UNDEFINED rather than rethrowing — so a plain
       .catch() would sail past the very failure it is here to forget, and cache
       a module with no openOnline on it. Check what actually arrived. */
    onlineChunk ??= import('../online/screens/ui.ts').then((online) => {
      if (typeof online?.openOnline !== 'function') throw new Error('online chunk unavailable');
      return online;
    }).catch((error: unknown) => {
      onlineChunk = null;
      throw error;
    });
    return onlineChunk;
  };

  const goOnline = (view: OnlineDoorView): void => {
    Sfx.unlock();
    Sfx.tap();
    if (onlineBusy) return;
    onlineBusy = true;
    /* Hold the die back one frame: a warmed chunk resolves within it, and the
       destination paints without a die flashing between Home and the queue. */
    let handedOff = false;
    const pending = warmOnline();
    requestAnimationFrame(() => {
      if (handedOff) return;
      const loading = $('#ovLoad');
      if (!loading.firstChild) loading.appendChild(loaderWait(56));
      show('#ovLoad');
    });
    void pending.then((online) => {
      /* The die and the guard both belong to the DOWNLOAD, not to the session
         that follows. openOnline establishes its own destination before it can
         yield, so both are handed over here.
         Holding them until the returned promise settles was wrong twice over:
         for play it does not settle until the player LEAVES the queue, so the
         eager die sat on top of the search, and Home's online controls stayed
         dead afterwards — cancelling a search and immediately asking for
         another did nothing at all. Past this point re-entry is openOnline's
         own entryRevision to arbitrate, which is what it is for. */
      handedOff = true;
      onlineBusy = false;
      hide('#ovLoad');
      return online.openOnline(view, ports);
    })
      /* A refused entry leaves Home standing and rearms below; it is not an
         unhandled rejection for the page to trip over. */
      .catch(() => undefined)
      .finally(() => { handedOff = true; onlineBusy = false; hide('#ovLoad'); });
  };

  /* ONE list of doors. Each warms the chunk the moment it is touched and opens
     on release, so the warm set and the open set cannot drift apart. */
  const door = (selector: string, view: OnlineDoorView): void => {
    const control = $(selector);
    // best-effort: the tap that follows owns both the retry and the failure
    control.addEventListener('pointerdown', () => { void warmOnline().catch(() => undefined); },
      { passive: true });
    tap(control, () => goOnline(view));
  };
  door('#btnOnline', 'play');
  door('#btnBoardHome', 'ladder');
  door('#homeChip', 'account');
}

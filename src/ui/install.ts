// The install affordance: a quiet "Install app" link in the home footer.
// Chrome-family browsers fire beforeinstallprompt — we stash the event and
// prompt on tap. iOS Safari has no prompt API, so the tap opens a short
// Share → Add to Home Screen explainer instead. Running standalone (already
// installed), embedded, or from file:// the link simply never appears.
import { $, show, hide } from './dom.ts';
import { Sfx } from './audio.ts';
import { isEmbed } from './embed.ts';
import { tap } from './input.ts';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: InstallPromptEvent | null = null;

const isStandalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches
  || (navigator as unknown as { standalone?: boolean }).standalone === true;

/* iOS Safari proper — the in-app browsers and iOS Chrome/Firefox/Edge can't
   add to the home screen, so they get nothing rather than a dead-end hint */
const isIosSafari = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent)
  && !/crios|fxios|edgios|instagram|fbav/i.test(navigator.userAgent);

export function initInstall(): void {
  if (isEmbed() || isStandalone() || !location.protocol.startsWith('http')) return;
  const btn = $('#btnInstall') as HTMLButtonElement;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => { deferred = null; btn.hidden = true; });
  if (isIosSafari()) btn.hidden = false;

  tap(btn, async () => {
    Sfx.tap();
    if (deferred) {
      const p = deferred;
      deferred = null;              // a stashed event can only prompt once
      btn.hidden = true;            // declined? Chrome re-fires on a later visit
      await p.prompt();
    } else {
      show('#ovInstall');           // iOS: explain the Share-menu route
    }
  });
  tap($('#btnCloseInstall'), () => { Sfx.tap(); hide('#ovInstall'); });
}

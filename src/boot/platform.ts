// Viewport/device guards, stale-chunk recovery, and standalone PWA setup.
import { $ } from '../ui/dom.ts';
import { isEmbed } from '../ui/embed.ts';
import { fit } from '../ui/layout.ts';
import { bindSwipeBack } from '../ui/swipeback.ts';

export function bindPlatform(root: HTMLElement): void {
  let fitFrame = 0;
  const scheduleFit = (): void => {
    if (fitFrame) return;
    fitFrame = requestAnimationFrame(() => {
      fitFrame = 0;
      fit();
    });
  };
  window.addEventListener('resize', scheduleFit);
  window.addEventListener('orientationchange', () => setTimeout(scheduleFit, 120));
  if (window.ResizeObserver) new ResizeObserver(scheduleFit).observe($('#app'));

  if (isEmbed()) {
    root.addEventListener('contextmenu', (event) => event.preventDefault());
  } else {
    // iOS Safari ignores user-scalable=no. Preserve single-finger scrolling.
    document.addEventListener('gesturestart', (event) => event.preventDefault());
    document.addEventListener('gesturechange', (event) => event.preventDefault());
    document.addEventListener('touchmove', (event) => {
      if (event.touches.length > 1) event.preventDefault();
    }, { passive: false });
    document.addEventListener('dblclick', (event) => event.preventDefault(), { passive: false });
    bindSwipeBack();
  }

  bindStaleChunkRecovery();
  registerServiceWorker();
}

/* Reload once when an old cached page references a chunk a newer deploy
   removed. The session flag prevents a loop when the network is the problem. */
function bindStaleChunkRecovery(): void {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    try {
      if (sessionStorage.getItem('kb.chunkReload')) return;
      sessionStorage.setItem('kb.chunkReload', '1');
    } catch { /* forgetful host */ }
    location.reload();
  });
  setTimeout(() => {
    try { sessionStorage.removeItem('kb.chunkReload'); } catch { /* forgetful host */ }
  }, 15000);
}

function registerServiceWorker(): void {
  if (isEmbed() || !('serviceWorker' in navigator)
      || !location.protocol.startsWith('http') || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((registration) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => undefined);
      });
    }).catch(() => undefined);
  });
}

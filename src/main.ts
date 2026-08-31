// Entry: the standalone page / hosted PWA / native webview build.
import './styles/page.css';
import './styles/main.css';
import { MARKUP } from './markup.ts';
import { boot } from './boot.ts';
import { releaseNativeSplashAfter } from './boot/native-splash.ts';
import { hooks } from './test-hooks.ts';
import { bindLocaleRoot, bindSystemLanguageChanges, setLanguageOverride } from './i18n/index.ts';
import { loadStats } from './persist.ts';
import { S } from './state.ts';
import { appRoot } from './ui/embed.ts';

const PORTRAIT_GATE_MARKUP = `<aside class="portrait-gate" role="status" aria-live="polite"
  data-modal-background-exempt>
  <i aria-hidden="true"></i>
  <b data-i18n="common:app.portraitOnly">PORTRAIT ONLY</b>
  <p data-i18n="common:app.rotatePortrait">Rotate your device upright to keep playing.</p>
</aside>`;

releaseNativeSplashAfter(() => {
  loadStats();
  setLanguageOverride(S.localeOverride);
  const root = appRoot();
  const platform = (globalThis as typeof globalThis & {
    Capacitor?: { getPlatform?(): string };
  }).Capacitor?.getPlatform?.();
  const nativeShell = platform === 'ios' || platform === 'android';
  const mobileBrowser = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mobileTouch = mobileBrowser && matchMedia('(any-pointer:coarse)').matches;
  root.classList.toggle('portrait-locked', nativeShell || mobileTouch);
  root.insertAdjacentHTML('afterbegin', PORTRAIT_GATE_MARKUP + MARKUP);
  bindLocaleRoot(root, 'document');
  bindSystemLanguageChanges();
  boot(false);
  (window as any).__kb = hooks();
});

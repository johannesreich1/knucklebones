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

releaseNativeSplashAfter(() => {
  loadStats();
  setLanguageOverride(S.localeOverride);
  const root = appRoot();
  root.insertAdjacentHTML('afterbegin', MARKUP);
  bindLocaleRoot(root, 'document');
  bindSystemLanguageChanges();
  boot(false);
  (window as any).__kb = hooks();
});

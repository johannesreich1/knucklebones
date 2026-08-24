// Entry: the standalone page / hosted PWA / native webview build.
import './styles/page.css';
import './styles/main.css';
import { MARKUP } from './markup.ts';
import { boot } from './boot.ts';
import { releaseNativeSplashAfter } from './boot/native-splash.ts';
import { hooks } from './hooks.ts';
import { appRoot } from './ui/embed.ts';

appRoot().insertAdjacentHTML('afterbegin', MARKUP);
releaseNativeSplashAfter(() => {
  boot(false);
  (window as any).__kb = hooks();
});

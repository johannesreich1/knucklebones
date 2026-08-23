// Entry: the standalone page / hosted PWA / native webview build.
import './styles/page.css';
import './styles/main.css';
import { MARKUP } from './markup.ts';
import { boot } from './boot.ts';
import { hooks } from './hooks.ts';
import { appRoot } from './ui/embed.ts';

appRoot().insertAdjacentHTML('afterbegin', MARKUP);
boot(false);
(window as any).__kb = hooks();

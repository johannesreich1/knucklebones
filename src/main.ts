// Entry: the standalone page / hosted PWA / native webview build.
import './styles/page.css';
import './styles/main.css';
import { MARKUP } from './markup';
import { boot } from './boot';
import { hooks } from './hooks';

document.body.insertAdjacentHTML('afterbegin', MARKUP);
boot(false);
(window as any).__kb = hooks();

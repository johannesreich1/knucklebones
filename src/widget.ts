// Entry: the embeddable widget. Same game, same markup — the differences from
// the standalone page are the EMBED branches in app.ts and the CSS overrides
// in widget-embed.css. Nothing is patched after the fact.
import './styles/main.css';
import './styles/widget-embed.css';
import { MARKUP } from './markup';
import { boot, hooks } from './app';

document.getElementById('kbroot')!.insertAdjacentHTML('afterbegin', MARKUP);
boot(true);
(window as any).__kb = hooks();

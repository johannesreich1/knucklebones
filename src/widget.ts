// Entry: the embeddable widget. Same game, same markup — the differences from
// the standalone page are the isEmbed() branches owned by ui/embed.ts and the
// CSS overrides in widget-embed.css. Nothing is patched after the fact.
import './styles/main.css';
import './styles/widget-embed.css';
import { MARKUP } from './markup.ts';
import { boot } from './boot.ts';
import { hooks } from './test-hooks.ts';
import { bindLocaleRoot, bindSystemLanguageChanges, setLanguageOverride } from './i18n/index.ts';
import { loadStats } from './persist.ts';
import { S } from './state.ts';
import { appRoot } from './ui/embed.ts';

loadStats();
setLanguageOverride(S.localeOverride);
const root = appRoot();
root.insertAdjacentHTML('afterbegin', MARKUP);
bindLocaleRoot(root, 'widget');
bindSystemLanguageChanges();
boot(true);
(window as any).__kb = hooks();

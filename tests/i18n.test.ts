import assert from 'node:assert/strict';
import { AI, ME } from '../src/core/rules.ts';
import {
  LOCALE_REGISTRY,
  SUPPORTED_LOCALES,
  bindSystemLanguageChanges,
  effectiveLocale,
  formatDate,
  formatNumber,
  formatRelativeTime,
  isLanguageOverride,
  ladderGroupCompactName,
  ladderGroupCopy,
  ladderGroupName,
  localeLanguageTag,
  languageOverride,
  localeSelfName,
  modeCopy,
  navigatorLanguageTags,
  normalizeLanguageTag,
  outOfTimeCopy,
  refreshSystemLocale,
  resolveLocale,
  resolveSystemLocale,
  setLanguageOverride,
  spellCopy,
  subscribeLocale,
  t,
  text,
  trustedStaticRich,
} from '../src/i18n/index.ts';
import { onlineMessage, repaintOnlineMessage } from '../src/online/message-copy.ts';
import { reconnectingCopy } from '../src/online/play-copy.ts';
import { claimPlayerNames, nameOf } from '../src/ui/identity.ts';

assert.deepEqual(SUPPORTED_LOCALES, LOCALE_REGISTRY.map(({ id }) => id));
assert.deepEqual(LOCALE_REGISTRY, [
  { id: 'en', languageTag: 'en', selfName: 'English' },
  { id: 'pt', languageTag: 'pt-BR', selfName: 'Português (Brasil)' },
  { id: 'es', languageTag: 'es', selfName: 'Español' },
  { id: 'de', languageTag: 'de', selfName: 'Deutsch' },
  { id: 'fr', languageTag: 'fr', selfName: 'Français' },
  { id: 'it', languageTag: 'it', selfName: 'Italiano' },
]);
assert.equal(localeSelfName('fr'), 'Français');
assert.equal(localeLanguageTag('pt'), 'pt-BR');
assert.equal(normalizeLanguageTag(' DE_at '), 'de');
assert.deepEqual(
  navigatorLanguageTags({ languages: ['es-MX', 'de-AT', 'es-MX'], language: 'fr-FR' }),
  ['es-MX', 'de-AT', 'fr-FR'],
);
assert.equal(resolveSystemLocale(['es-MX', 'de-AT', 'fr-FR']), 'es');
assert.equal(resolveSystemLocale(['fr-FR']), 'fr');
assert.equal(resolveSystemLocale(['en-GB']), 'en');
assert.equal(resolveSystemLocale(['en-US']), 'en');
assert.equal(resolveSystemLocale(['pt-BR']), 'pt');
assert.equal(resolveSystemLocale(['pt-PT']), 'pt');
assert.equal(resolveSystemLocale(['it-CH']), 'it');
assert.equal(resolveSystemLocale(['nl-NL']), 'en');
assert.equal(resolveLocale('fr', ['de-DE']), 'fr');
assert.equal(resolveLocale(null, ['de-DE']), 'de');
assert.equal(isLanguageOverride(null), true);
assert.equal(isLanguageOverride('en'), true);
assert.equal(isLanguageOverride('pt'), true);
assert.equal(isLanguageOverride('es'), true);
assert.equal(isLanguageOverride('it'), true);
assert.equal(isLanguageOverride('system'), false);
assert.equal(isLanguageOverride('en-GB'), false);

setLanguageOverride(null, ['en-US']);
const changes: string[] = [];
const unsubscribe = subscribeLocale((change) => {
  changes.push(`${change.previousOverride ?? 'auto'}:${change.previousLocale}`
    + `>${change.override ?? 'auto'}:${change.locale}`);
});
assert.equal(setLanguageOverride('de')?.locale, 'de');
assert.equal(languageOverride(), 'de');
assert.equal(effectiveLocale(), 'de');
assert.equal(t('settings', 'language'), 'Sprache');
assert.equal(t('online', 'profile.fullHistory'), 'Spielverlauf');
assert.match(t('game', 'runes.ariaAvailable', {
  player: 'DU', name: 'SCHUBS', blurb: 'Test', count: 2,
}), /2 Einsätze/u);
assert.equal(setLanguageOverride('de'), null, 'reapplying an identical override is a no-op');
assert.equal(setLanguageOverride(null, ['fr-FR'])?.locale, 'fr');
assert.equal(t('common', 'record.wins', { count: 1 }), '1 victoire');
assert.equal(t('common', 'record.wins', { count: 2 }), '2 victoires');
assert.equal(refreshSystemLocale(['de-DE'])?.locale, 'de');
assert.equal(changes.length, 3);
unsubscribe();

const target = { textContent: null as string | null };
assert.equal(text(target, 'settings', 'language'), 'Sprache');
assert.equal(target.textContent, 'Sprache');
assert.match(trustedStaticRich('learn', 'rules.goal.body'), /<b>/u);
assert.throws(() => trustedStaticRich('common', 'build'), /must be static/u);

const numberOptions = { minimumFractionDigits: 1 } as const;
const dateOptions = { dateStyle: 'medium', timeZone: 'UTC' } as const;
for (const { id, languageTag } of LOCALE_REGISTRY) {
  setLanguageOverride(id);
  assert.equal(formatNumber(1234.5, numberOptions),
    new Intl.NumberFormat(languageTag, numberOptions).format(1234.5));
  assert.equal(formatDate(Date.UTC(2026, 7, 24), dateOptions),
    new Intl.DateTimeFormat(languageTag, dateOptions).format(Date.UTC(2026, 7, 24)));
  assert.equal(formatRelativeTime(-1, 'day'),
    new Intl.RelativeTimeFormat(languageTag).format(-1, 'day'));
}

setLanguageOverride('pt');
assert.equal(t('settings', 'language'), 'Idioma');
setLanguageOverride('es');
assert.equal(t('game', 'practice.gameMode'), 'Modo de juego');
setLanguageOverride('it');
assert.equal(t('online', 'profile.ladderPoints'), 'Punti classifica');
setLanguageOverride('de');

assert.equal(modeCopy('random').name, 'ZUFALL');
assert.equal(spellCopy('none').name, 'KEINE');
assert.equal(spellCopy('random2').name, 'ZUFALL ×2');
const timedOut = outOfTimeCopy(3);
assert.equal(timedOut.visible(), 'Zeit — Sp. 3');
assert.equal(timedOut.accessible(), 'Zeit abgelaufen — Spalte 3');
assert.equal(reconnectingCopy.visible(), 'Verbinden …');
assert.equal(reconnectingCopy.accessible(), 'Neu verbinden …');
setLanguageOverride('pt');
assert.equal(timedOut.visible(), 'Tempo — col. 3', 'compact status copy was not locale-live');
assert.equal(timedOut.accessible(), 'Tempo esgotado — coluna 3');
assert.equal(reconnectingCopy.visible(), 'Conectando…');
assert.equal(reconnectingCopy.accessible(), 'Reconectando…');
setLanguageOverride('de');
assert.equal(ladderGroupName('obsidian'), 'OBSIDIAN');
assert.deepEqual(ladderGroupCopy('stone'), { name: 'STEIN', compactName: 'STEIN' });
assert.equal(ladderGroupCompactName('ivory'), 'ELFENBEIN');
assert.throws(() => modeCopy('missing'), /Unknown mode id/u);
assert.throws(() => spellCopy('missing'), /Unknown spell id/u);

const releaseRankedNames = claimPlayerNames((who) => who === ME ? 'Alice' : 'Bob');
assert.equal(nameOf(ME), 'Alice');
assert.equal(nameOf(AI), 'Bob');
setLanguageOverride('fr');
assert.equal(nameOf(ME), 'Alice', 'locale switching replaced a server-owned ranked name');
assert.equal(nameOf(AI), 'Bob', 'locale switching replaced the opponent ranked name');
releaseRankedNames();

setLanguageOverride('en');
const invalidCredentials = onlineMessage('errors.invalidCredentials');
setLanguageOverride('de');
assert.equal(
  repaintOnlineMessage(invalidCredentials),
  t('online', 'errors.invalidCredentials'),
  'an already-visible provider error did not repaint from its catalog source',
);
assert.equal(
  repaintOnlineMessage('untrusted provider text'),
  t('online', 'errors.generic'),
  'unknown provider text leaked instead of using the localized fallback',
);

const events: string[] = [];
let systemTags: readonly string[] = ['fr-FR'];
let languageChange: EventListener | null = null;
const fakeLanguageTarget = {
  addEventListener: (name: string, listener: EventListenerOrEventListenerObject) => {
    events.push(`add:${name}`);
    languageChange = listener as EventListener;
  },
  removeEventListener: (name: string, listener: EventListenerOrEventListenerObject) => {
    events.push(`remove:${name}`);
    assert.equal(listener, languageChange);
  },
};
setLanguageOverride(null, ['en-US']);
const unbind = bindSystemLanguageChanges(
  fakeLanguageTarget as unknown as EventTarget,
  () => systemTags,
);
languageChange?.(new Event('languagechange'));
assert.equal(effectiveLocale(), 'fr', 'languagechange did not refresh an automatic locale');
setLanguageOverride('de');
systemTags = ['en-US'];
languageChange?.(new Event('languagechange'));
assert.equal(effectiveLocale(), 'de', 'languagechange overrode an explicit preference');
unbind();
assert.deepEqual(events, ['add:languagechange', 'remove:languagechange']);

setLanguageOverride(null, ['en-US']);
console.log(JSON.stringify({ problems: [] }));

// One typed composition root shared by the standalone and widget entries.
import { AI, ME } from './core/rules.ts';
import { cancelPass, endGame, place, sayChoose, armTimer } from './flow/game.ts';
import { configureMenu, syncSettingsUI } from './flow/menu.ts';
import { castArmed, configureSpellFlow, renderSpells } from './flow/spells.ts';
import { configureInput } from './ui/input.ts';
import { appRoot, setEmbed } from './ui/embed.ts';
import { $, stampBuild, watchPagedScroll } from './ui/dom.ts';
import { makeDie } from './ui/die.ts';
import { repaintBagLocale } from './ui/bag.ts';
import { buildBoards } from './ui/game/board.ts';
import { repaintScoreLocale } from './ui/game/scores.ts';
import { updateRecord } from './ui/game/hud.ts';
import { applySides, repaintTurnLocale } from './ui/game/turn-state.ts';
import { fit } from './ui/layout.ts';
import { refreshHomeChip } from './ui/homechip.ts';
import { repaintEndLocale } from './ui/endscreen.ts';
import { bindBoardInput, bindKeyboard } from './boot/input-bindings.ts';
import { bindMenus } from './boot/menu-bindings.ts';
import { bindPlatform } from './boot/platform.ts';
import { subscribeLocale } from './i18n/index.ts';
import { repaintPassLocale } from './flow/pass-card.ts';
import { userPreferencesRevision } from './preferences.ts';

export function boot(embed: boolean): void {
  configureInput({ place, castArmed });
  configureMenu({ cancelPass, renderSpells });
  configureSpellFlow({
    onChoice: sayChoose,
    onCastComplete: () => { sayChoose(); armTimer(); },
    onGameOver: endGame,
  });

  setEmbed(embed);
  const root = appRoot();
  stampBuild();
  buildBoards();
  fit();
  applySides();
  watchPagedScroll();
  updateRecord();
  syncSettingsUI();

  const duel = $('#homeDuel');
  duel.insertBefore(makeDie(5, ME), duel.firstChild);
  duel.appendChild(makeDie(3, AI));
  refreshHomeChip();

  bindBoardInput();
  bindMenus(root);
  bindKeyboard(root);
  bindPlatform(root);
  subscribeLocale(() => {
    stampBuild();
    syncSettingsUI();
    repaintTurnLocale();
    repaintScoreLocale();
    repaintBagLocale();
    repaintPassLocale();
    repaintEndLocale();
    updateRecord();
    refreshHomeChip();
  });
  // Standalone/PWA/native accounts get their private Settings row after the
  // offline-first paint. Widgets neither own nor synchronize host preferences.
  // Capture before the lazy import can yield to a Settings tap: that tap must
  // count as newer than this hydration even if the online chunk has not loaded.
  const startupPreferenceRevision = userPreferencesRevision();
  if (!embed) void import('./online/preferences.ts').then(({ syncAccountPreferences }) =>
    syncAccountPreferences(startupPreferenceRevision));
}

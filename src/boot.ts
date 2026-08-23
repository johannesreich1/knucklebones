// One typed composition root shared by the standalone and widget entries.
import { AI, ME } from './core/rules.ts';
import { loadStats } from './persist.ts';
import { cancelPass, endGame, place, sayChoose, armTimer } from './flow/game.ts';
import { configureMenu, syncSettingsUI } from './flow/menu.ts';
import { castArmed, configureSpellFlow, renderSpells } from './flow/spells.ts';
import { configureInput } from './ui/input.ts';
import { appRoot, setEmbed } from './ui/embed.ts';
import { $, stampBuild, watchPagedScroll } from './ui/dom.ts';
import { makeDie } from './ui/die.ts';
import { buildBoards } from './ui/game/board.ts';
import { updateRecord } from './ui/game/hud.ts';
import { applySides } from './ui/game/turn-state.ts';
import { fit } from './ui/layout.ts';
import { refreshHomeChip } from './ui/homechip.ts';
import { bindBoardInput, bindKeyboard } from './boot/input-bindings.ts';
import { bindMenus } from './boot/menu-bindings.ts';
import { bindPlatform } from './boot/platform.ts';

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
  loadStats();
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
}

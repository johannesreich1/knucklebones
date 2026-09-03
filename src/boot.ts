// One typed composition root shared by the standalone and widget entries.
import { endGame, place, sayChoose, armTimer } from './flow/game.ts';
import { configureMenu, syncSettingsUI } from './flow/menu.ts';
import { castArmed, configureSpellFlow, renderSpells } from './flow/spells.ts';
import { configureInput } from './ui/input.ts';
import { appRoot, setEmbed } from './ui/embed.ts';
import { stampBuild, watchPagedScroll } from './ui/dom.ts';
import { playBootHandoff } from './ui/boot-handoff.ts';
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
import { bindLegalPages } from './ui/legal.ts';
import { subscribeLocale } from './i18n/index.ts';
import { cancelPass, repaintPassLocale } from './flow/pass-card.ts';
import { userPreferencesRevision } from './preferences.ts';
import { S } from './state.ts';
import {
  appIconAvailable,
  appIconColoursEnabled,
  resetAppIcon,
  syncAppIconColours,
} from './native/app-icon.ts';
import { initializeGameCenter } from './native/game-center.ts';
import { bindPageMotion } from './ui/page-motion.ts';

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

  /* The hero used to be assembled here: two makeDie() calls either side of a
     gold VS. The mark is one object and ships in the markup, so there is
     nothing left to build — it takes its hues from the page like any other
     element. */
  refreshHomeChip();

  /* The launch screen hands off to Home here (design 15b / A2). Not in the
     widget: it has no launch screen to continue from, so there would be
     nothing for the mark to arrive out of. */
  if (!embed) {
    const mark = root.querySelector('#homeMark .splitmark');
    if (mark instanceof HTMLElement) playBootHandoff(root, mark);
  }

  if (!embed) {
    /* The coloured launcher is an explicit device choice. While enabled, the
       icon follows the Settings pair loadStats() already restored; while
       disabled, native boot restores primary — which also retires the
       profile-driven icons of 2026-09-02 without exposing anything on web. */
    if (!appIconColoursEnabled() && appIconAvailable()) {
      void resetAppIcon();
    } else {
      void syncAppIconColours(S);
    }
    // GameKit owns device-level authentication and may already be signed in.
    // Start it after the first Home paint, without waiting and without
    // importing Supabase; widgets and non-iOS platforms resolve to a no-op.
    void initializeGameCenter();
  }

  bindBoardInput();
  bindPageMotion(root);
  bindMenus(root);
  bindLegalPages(root);
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
  // Standalone/PWA/native accounts get their private Settings row and fresh
  // profile avatar after the offline-first paint. Widgets own neither.
  // Capture before the lazy import can yield to a Settings tap: that tap must
  // count as newer than this hydration even if the online chunk has not loaded.
  const startupPreferenceRevision = userPreferencesRevision();
  if (!embed) void Promise.all([
    import('./online/preferences.ts'),
    import('./online/identity/profile.ts'),
    import('./online/identity/session.ts'),
    import('./online/api/ranked-curve-verification.ts'),
  ]).then(async ([
    { syncAccountPreferences },
    { myProfile },
    { currentUser },
    { refreshVerifiedRankedCurveVersion },
  ]) => {
    const preferences = syncAccountPreferences(startupPreferenceRevision);
    /* Never let a freshly read/remapped profile rating outrun the contract
       which classifies it. Signed-out boot stays fully offline; an authenticated
       boot first tries the exact account status, then the public scalar needed
       for old-server v1 compatibility. Unknown keeps the cached chip's points
       hidden and is retried by the next online entry. */
    const user = await currentUser();
    if (!user) {
      await preferences;
      return;
    }
    const curveVersion = await refreshVerifiedRankedCurveVersion();
    await preferences;
    if (curveVersion === null) return;
    await myProfile();
    refreshHomeChip();
  }).catch(() => undefined);
}

// Static markup injected by every entry point: one source for page and widget
// (the old build derived its copy from the page via regex). The screens live
// beside this file in ./markup/; what stays here is the menu the app opens on
// and the order every screen is interpolated in — sibling order is a contract,
// because ui/layout.ts keys off it and back-navigation closes the LAST visible
// room, so #ovLoad stays final.
import { BOARD_MARKUP } from './markup/board.ts';
import { LEARN_MARKUP } from './markup/learn.ts';
import {
  LEGAL_HOME_NAV_MARKUP,
  LEGAL_MARKUP,
  LEGAL_SETTINGS_NAV_MARKUP,
} from './markup/legal.ts';
import { OVERLAY_CARDS_MARKUP } from './markup/overlay-cards.ts';
import { RESULT_MARKUP } from './markup/result.ts';
import { chromeIcon } from './ui/chromeicons.ts';
import { pageBackButton } from './ui/page-chrome.ts';

export const MARKUP = `${BOARD_MARKUP}

<!-- HOME: online-first. The duel is the hero, PLAY ONLINE the one primary
     action; local play sits behind the quiet PRACTICE strip. -->
<div class="ov on" id="ovStart">
  <div class="hero">
    <div class="eyebrow" data-i18n="common:app.edition">Neon Edition</div>
    <h1>KNUCKLEBONES</h1>
    <div class="duel" id="homeDuel"><span class="vs" data-i18n="common:versus">VS</span></div>
    <div class="sub2" data-i18n="common:app.tagline">Ranked dice duels</div>
  </div>
  <div class="homestack">
    <!-- the plate IS the account: ring, avatar, name and points, docked on the
         button that moves them (design 13d). boot's refreshHomeChip fills it. -->
    <button class="pplate anon" id="homeChip">NOT SIGNED IN</button>
    <button class="btn primary play-cta" id="btnOnline"><span class="btn-leading-icon" data-icon="play" aria-hidden="true">${chromeIcon('play', 25)}</span><span class="btn-label" data-i18n="game:home.playRanked">Play ranked match</span></button>
    <button class="btn weekly-cta" id="btnWeekly" hidden><span aria-hidden="true">✦</span><span class="btn-label" id="weeklyHomeLabel"></span></button>
    <div class="hrow">
      <button class="btn" id="btnBoardHome" data-i18n="game:home.ladder">Ladder</button>
      <button class="btn" id="btnSettingsHome" data-i18n="game:home.settings">Settings</button>
    </div>
  </div>
  <div class="quiet">
    <div class="cap" data-i18n="game:home.practiceOffline">Practice offline</div>
    <div class="hrow">
      <button class="btn" id="btnVsCpu" data-i18n="game:home.versusAi">VS AI</button>
      <button class="btn" id="btnDuoHome" data-i18n="game:home.twoPlayers">2 players</button>
      <button class="btn" id="btnLearn" data-i18n="game:home.howToPlay">How to play</button>
    </div>
  </div>
  <!-- everything teachable moved behind HOW TO PLAY, so the foot carries only
       what the law requires — and it sits at the very bottom, where nobody
       looks for it and nobody has to. -->
  ${LEGAL_HOME_NAV_MARKUP || '<div class="viewfoot"></div>'}
</div>

<!-- OFFLINE: the local-play configuration (was the old title screen).
     A page below Home: Duel Brackets goes back, the bottom holds only actions. -->
<div class="ov paged" id="ovPractice">
  <div class="shead">
    ${pageBackButton({ id: 'btnPracticeBack', label: 'Back' })}
    <span class="ttl" data-i18n="game:practice.title">OFFLINE</span><span class="pad"></span>
  </div>
  <div class="pbody">
    <div class="card">
      <div class="lbl" data-i18n="game:practice.mode">Mode</div>
      <div class="seg" id="modeSeg">
        <button data-m="cpu" class="on" data-i18n="game:practice.versusAi">VS AI</button>
        <button data-m="duo" data-i18n="game:practice.twoPlayers">2 PLAYERS</button>
      </div>
    </div>
    <!-- ONE slot, two occupants: whichever of these the Mode above calls for.
         Both wear label + segment and nothing else, so switching changes what
         this card SAYS and never where the cards below it sit. Neither carries
         a note any more (user call): VS AI / 2 PLAYERS, EASY / NORMAL / HARD
         and PASS PHONE / FACE TO FACE are each two words that already say what
         they do, and the explanations only pushed the Play button down. -->
    <div class="card" id="diffCard">
      <div class="lbl" data-i18n="game:practice.aiLevel">AI level</div>
      <div class="seg" id="diffSeg">
        <button data-d="easy" data-i18n="game:practice.easy">EASY</button>
        <button data-d="medium" data-i18n="game:practice.normal">NORMAL</button>
        <button data-d="hard" class="on" data-i18n="game:practice.hard">HARD</button>
      </div>
    </div>
    <div class="card" id="seatCard" hidden>
      <div class="lbl" data-i18n="game:practice.sitting">Sitting</div>
      <div class="seg" id="seatSeg">
        <button data-seat="pass" data-i18n="game:practice.passPhone">PASS PHONE</button>
        <button data-seat="face" data-i18n="game:practice.faceToFace">FACE TO FACE</button>
      </div>
    </div>
    <div class="card">
      <div class="lbl" data-i18n="game:practice.gameMode">Game mode</div>
      <div class="modepick" id="modePick"></div>
      <div class="tiny note" id="modePickInfo"></div>
    </div>
    <div class="card" id="spellCard">
      <div class="lbl" data-i18n="game:practice.rune">Rune</div>
      <div class="choice-field"><div class="modepick" id="spellPick"></div>
        <div class="choice-lock" id="spellPickLock" role="note" hidden><span class="hues-lock__icon" aria-hidden="true"><span class="hues-lock__shackle"></span></span><span id="spellPickLockCopy"></span></div></div>
      <div class="tiny note" id="spellPickInfo"></div>
    </div>
    <!-- Two-player-only card lands at the end, so the sheet grows without reshuffling. -->
    <div class="card" id="timerCard" hidden>
      <div class="lbl" data-i18n="game:practice.turnTimer">Turn timer</div>
      <div class="seg" id="timerSeg">
        <button data-t="10" class="on">10 <span data-i18n="common:units.secondShort">SEC</span></button>
        <button data-t="20">20 <span data-i18n="common:units.secondShort">SEC</span></button>
        <button data-t="0" data-i18n="common:states.off">OFF</button>
      </div>
    </div>
    <!-- the commitment, pinned: whatever the sheet above it grows to, the way
         OUT of it is always in the same place under your thumb -->
    <div class="playbar">
      <button class="btn primary" id="btnPlay">Play</button>
      <div class="tiny" data-i18n="game:practice.ratingNote">Offline play never touches your online rating</div>
    </div>
  </div>
</div>

${LEGAL_MARKUP}

${LEARN_MARKUP}

${OVERLAY_CARDS_MARKUP}

<!-- SETTINGS: a page below Home like OFFLINE — Duel Brackets goes back, toggles apply instantly -->

<div class="ov paged" id="ovSettings">
  <div class="shead">
    ${pageBackButton({ id: 'btnSettingsBack', label: 'Back' })}
    <span class="ttl" data-i18n="settings:title">SETTINGS</span><span class="pad"></span>
  </div>
  <div class="pbody">
    <div class="card">
      <div class="lbl" id="languageLabel" data-i18n="settings:language">Language</div>
      <div class="language-picker" id="languagePicker" role="group" aria-labelledby="languageLabel">
        <button type="button" id="languagePrevious" data-language-step="-1"
          data-i18n-attr="aria-label=settings:previousLanguage" aria-label="Previous language">‹</button>
        <span class="language-picker__value" id="languageValue" aria-live="polite" aria-atomic="true">English</span>
        <button type="button" id="languageNext" data-language-step="1"
          data-i18n-attr="aria-label=settings:nextLanguage" aria-label="Next language">›</button>
      </div>
    </div>
    <!-- the duel pickers: swatch strips built by boot/menu-bindings.ts from DUELHUES
         (state.ts), one implementation, two slots. A colour belongs to one
         player only — each strip renders the other side's pick disabled. -->
    <div class="card">
      <div class="lbl" data-i18n="settings:yourColour">Your colour</div>
      <div class="hues" id="p1Pick"></div>
    </div>
    <div class="card">
      <div class="lbl" data-i18n="settings:opponentColour">Opponent colour</div>
      <div class="hues" id="p2Pick"></div>
    </div>
    <div class="card">
      <div class="lbl" data-i18n="settings:sound">Sound</div>
      <div class="seg" id="sndSeg">
        <button data-s="1" data-i18n="common:states.on">ON</button>
        <button data-s="0" data-i18n="common:states.off">OFF</button>
      </div>
    </div>
    <div class="card" id="appIconCard" hidden>
      <div class="lbl" data-i18n="settings:profileAppIcon">Use profile die as app icon</div>
      <div class="seg" id="appIconSeg">
        <button data-ai="1" data-i18n="common:states.on">ON</button>
        <button data-ai="0" data-i18n="common:states.off">OFF</button>
      </div>
    </div>
    <h2 class="setsection" id="accessibilityHeading" data-i18n="settings:accessibility">Accessibility</h2>
    <div class="card">
      <div class="lbl" data-i18n="settings:diceFaces">Dice faces</div>
      <div class="seg" id="faceSeg">
        <button data-f="nums" data-i18n="settings:numbers">NUMBERS</button>
        <button data-f="pips" data-i18n="settings:pips">PIPS</button>
      </div>
    </div>
    <div class="card">
      <div class="lbl" data-i18n="settings:colourBlindMode">Colour blind mode</div>
      <div class="seg" id="cbSeg">
        <button data-b="1" data-i18n="common:states.on">ON</button>
        <button data-b="0" data-i18n="common:states.off">OFF</button>
      </div>
    </div>
    <div class="card">
      <div class="lbl" data-i18n="settings:reducedMotion">Reduced motion</div>
      <div class="seg" id="motionSeg">
        <button data-rm="1" data-i18n="common:states.on">ON</button>
        <button data-rm="0" data-i18n="common:states.off">OFF</button>
      </div>
    </div>
  </div>
  <!-- deploy truth lives here now: the screen you open when something looks
       wrong is the screen that should tell you WHICH build is wrong -->
  <div class="viewfoot settings-foot">
    ${LEGAL_SETTINGS_NAV_MARKUP}
    <div class="tiny" id="buildTag">build dev</div>
  </div>
</div>

${RESULT_MARKUP}

<div class="ov" id="ovLoad" aria-live="polite"></div>`;

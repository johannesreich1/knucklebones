import { chromeIcon } from '../ui/chromeicons.ts';
import { spellIcon } from '../ui/spellicons.ts';
/* THE DUEL SURFACE: background, HUD, coach line, the three-section table and
   the fx/flash layers over it. One region, painted by every driver there is —
   ui/game/*, flow/game.ts and the online play controller fill these ids rather
   than each shipping a board of its own, which is what keeps the local and the
   ranked duel from drifting apart. It is also the only screen that speaks the
   icon families, so they are imported here and not beside the menu screens. */
export const BOARD_MARKUP = `<div id="bg"></div><div id="vig"></div>

<div id="app">
  <div class="hud">
    <!-- filled by ui/game/hud.ts updateRecord(): a chip per thing in play -->
    <div class="rec" id="rec"></div>
    <div class="sp"></div>
    <!-- the game's ONE control: settings (quit lives inside the sheet) -->
    <button class="ico" id="btnLeave" data-i18n-attr="aria-label=game:board.leaveGame"
      aria-label="Leave game">${chromeIcon('leave', 15)}</button>
  </div>

  <div id="coach" hidden>
    <div class="cmsg" id="coachMsg" aria-live="polite"></div>
    <div class="chint" id="coachHint" data-i18n="game:tutorial.continueHint">Tap to continue</div>
  </div>

  <div class="table" id="tableEl">
    <!-- far side of the table -->
    <section class="side top" id="sideTop" data-owner="0">
      <div class="plate" id="plateTop">
        <span class="who"><span class="player-id"><span class="dot"></span><span class="nm" id="nameTop">AI</span>
        <span class="tag" id="tagTop">HARD</span></span><span class="rune-tag" id="runeTagTop"></span></span>
        <span class="sp"></span>
        <span class="pright"><span class="wpt" id="wptTop" hidden>\n        ${spellIcon('ward', 11)}<b>+0</b></span><span class="bty" id="btyTop" hidden></span>\n        <span class="tot" id="totTop">0</span></span>
      </div>
      <div class="boardwrap"><div class="board" id="topBoard"></div></div>
      <div class="cols" id="topCols"></div>
    </section>

    <!-- CENTER -->
    <section class="center">
      <div class="stagerow">
        <div id="dieStage" role="img" data-i18n-attr="aria-label=game:board.noDie"
          aria-label="No die rolled yet"></div>
        <!-- LIMITED mode only: the bag beside the die in play -->
        <div class="bag" id="bagStack" hidden>
          <span class="pile" aria-hidden="true"></span>
          <b class="bn" id="bagNum" data-i18n-attr="aria-label=game:board.diceInBag"
            aria-label="Dice left in the bag">0</b>
        </div>
        <!-- SPELLS: one rail, one persistent card hand per dealt seat. -->
        <div class="spells" id="spellBar"></div>
      </div>
      <div class="status" id="status" role="status" aria-live="polite"
        data-i18n="game:board.tapPlay">Tap play to start</div>
      <div class="timer" id="timerWrap" aria-hidden="true">
        <span class="track"><span class="bar" id="timerBar"></span></span><b id="timerNum"></b>
      </div>
    </section>

    <!-- near side of the table (always whoever is holding the phone) -->
    <section class="side bot" id="sideBot" data-owner="1">
      <div class="cols" id="botCols"></div>
      <div class="boardwrap"><div class="board" id="botBoard"></div></div>
      <div class="plate" id="plateBot">
        <span class="who"><span class="player-id"><span class="dot"></span><span class="nm" id="nameBot">YOU</span>
        <span class="tag" id="tagBot" hidden></span></span><span class="rune-tag" id="runeTagBot"></span></span>
        <span class="sp"></span>
        <span class="pright"><span class="wpt" id="wptBot" hidden>\n        ${spellIcon('ward', 11)}<b>+0</b></span><span class="bty" id="btyBot" hidden></span>\n        <span class="tot" id="totBot">0</span></span>
      </div>
    </section>
  </div>
</div>

<div id="fx"></div>
<div class="flash" id="flash"></div>`;

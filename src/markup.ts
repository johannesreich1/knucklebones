// The app's static markup, injected at boot by each entry point.
// Single source of truth for standalone page and widget alike (the old build
// derived the widget's copy from the page via regex — this is that, deleted).
import { chromeIcon } from './ui/chromeicons.ts';
import { learnPageMarkup } from './ui/learn-page.ts';
import { spellIcon } from './ui/spellicons.ts';
import { LEGAL_HOME_NAV_MARKUP, LEGAL_MARKUP, LEGAL_SETTINGS_NAV_MARKUP } from './markup/legal.ts';

const RULES_PAGE = learnPageMarkup({
  id: 'ovRules',
  title: 'RULES',
  titleKey: 'rules.title',
  body: `<div class="rules">
    <h3 data-i18n="learn:rules.goal.heading">Goal</h3>
    <p data-i18n-rich="learn:rules.goal.body">Fill your 3×3 grid with dice. When <b>either</b> grid is full the game ends — highest total wins.</p>
    <h3 data-i18n="learn:rules.placing.heading">Placing</h3>
    <p data-i18n-rich="learn:rules.placing.body">You roll a die, then tap one of <b>your</b> columns to drop it in. You cannot choose the roll, only where it lands.</p>
    <h3 data-i18n="learn:rules.multipliers.heading">Column multipliers</h3>
    <p data-i18n-rich="learn:rules.multipliers.body">Matching dice in the same column multiply. Two 4s in a column = <b>4×2×2 = 16</b>, not 8. Three 4s = <b>4×3×3 = 36</b>.</p>
    <h3 style="color:var(--mg)" data-i18n="learn:rules.destruction.heading">Destruction</h3>
    <p data-i18n-rich="learn:rules.destruction.body">Place a die and <span class="k">every matching die in the opponent's facing column is destroyed</span>. Columns line up vertically — your left column faces their left column.</p>
    <h3 data-i18n="learn:rules.reading.heading">Reading the board</h3>
    <p data-i18n-rich="learn:rules.reading.body">The chips beside each column show its running score, and <b>×2</b>/<b>×3</b> marks a multiplied stack. Working out the best placement is the game — but the <b>tutorial</b> plays a guided round with point previews on every column.</p>
    <h3 style="color:#b18cff" data-i18n="learn:rules.runes.heading">Runes</h3>
    <p data-i18n-rich="learn:rules.runes.body">Offline games can deal a <b>rune</b> beside the die in play — six to choose from where you set up an offline game, right under the game mode. <b>None</b> is the default; named picks and <b>random</b> give both players matching runes, while <b>random 2</b> shuffles twice and gives them different ones. One card per player stays visible. A player-colour edge marks its owner, and the active hand moves to the front every turn. Press a rune that acts on your die to cast it immediately; drag or tap a column-targeting rune onto one of the columns that light up. A cast is not a move, so your die still lands afterwards. The full roster lives under <b>HOW TO PLAY → RUNES</b>. Ranked matches never use them.</p>
    <h3 data-i18n="learn:rules.twoPlayers.heading">Two players</h3>
    <p data-i18n-rich="learn:rules.twoPlayers.body">Pick <b>2 PLAYERS</b> to share one phone, then choose how you sit. <b>Pass phone</b>: a pass card appears between turns and the grids swap so whoever is playing is on the bottom. <b>Face to face</b>: lay the phone flat between you — the top half is turned for Player 2, turns switch on their own, and the bright half with the rotating centre die shows who's up.</p>
  </div>`,
});

export const MARKUP = `<div id="bg"></div><div id="vig"></div>

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
<div class="flash" id="flash"></div>



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
    <button class="btn primary" id="btnOnline" data-i18n="game:home.playRanked">Play ranked match</button>
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
     A page below Home: ‹ goes back, the bottom holds only actions. -->
<div class="ov paged" id="ovPractice">
  <div class="shead">
    <button class="ico" id="btnPracticeBack" data-i18n-attr="aria-label=common:actions.back"
      aria-label="Back">‹</button>
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
    <div class="card">
      <div class="lbl" data-i18n="game:practice.rune">Rune</div>
      <div class="modepick" id="spellPick"></div>
      <div class="tiny note" id="spellPickInfo"></div>
    </div>
    <!-- the one card only two-player play has: it lands at the END, so the
         sheet GROWS rather than shuffling what is already on screen -->
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

<!-- LEARN: the one door to everything teachable. Four rows rather than four
     links scattered across the home screen and the settings sheet. -->
<div class="ov paged" id="ovLearn">
  <div class="shead">
    <button class="ico" id="btnLearnBack" data-i18n-attr="aria-label=common:actions.back"
      aria-label="Back">‹</button>
    <span class="ttl" data-i18n="learn:hub.title">HOW TO PLAY</span><span class="pad"></span>
  </div>
  <div class="pbody">
    <div class="learnlist">
      <button class="learnrow" id="btnLearnTut">
        <span class="lname" data-i18n="learn:hub.tutorial">Tutorial</span>
        <span class="lblurb" data-i18n="learn:hub.tutorialBlurb">A guided first game — five lessons, played not read</span>
      </button>
      <button class="learnrow" id="btnLearnRules">
        <span class="lname" data-i18n="learn:hub.rules">The rules</span>
        <span class="lblurb" data-i18n="learn:hub.rulesBlurb">Scoring, destruction and how a game ends</span>
      </button>
      <button class="learnrow" id="btnLearnModes">
        <span class="lname" data-i18n="learn:hub.modes">Game modes</span>
        <span class="lblurb" data-i18n="learn:hub.modesBlurb">Every mode the dial can land on, and what it changes</span>
      </button>
      <button class="learnrow" id="btnLearnSpells">
        <span class="lname" data-i18n="learn:hub.runes">Runes</span>
        <span class="lblurb" data-i18n="learn:hub.runesBlurb">Every power, its targets and how many casts you get</span>
      </button>
    </div>
  </div>
</div>

<!-- RULES: one instance of the same Learn-detail page Game Modes and Spells use. -->
${RULES_PAGE}

<!-- HAND-OFF -->
<div class="ov" id="ovPass">
  <div class="glow"></div>
  <div class="swapicon">⇅</div>
  <div class="who" id="passWho">PLAYER 2</div>
  <div class="hint" data-i18n="game:pass.passPhone">Pass the phone</div>
  <div class="mini"><b class="a" id="passP1">0</b><span>—</span><b class="b" id="passP2">0</b></div>
  <div class="tapline" data-i18n="game:pass.tapReady">Tap anywhere when ready</div>
</div>

<!-- SETTINGS: a page below Home like OFFLINE — ‹ goes back, toggles apply instantly -->

<div class="ov paged" id="ovSettings">
  <div class="shead">
    <button class="ico" id="btnSettingsBack" data-i18n-attr="aria-label=common:actions.back"
      aria-label="Back">‹</button>
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

<!-- END — the ONE result screen, local and ranked alike (ui/endscreen.ts).
     Everything that differs between the two is a slot the caller fills: the
     meta line carries tutorial completion or a points chip + ladder spot, and each
     action's label, visibility and handler come from the spec. -->
<div class="ov" id="ovEnd">
  <i class="fwlayer" id="endFx" aria-hidden="true"></i>
  <i class="shock" id="endShock" aria-hidden="true"></i>
  <!-- VICTORY lands, DEFEAT rises: the wrapper clips only for the rise, and
       the sweep bar only runs with it (design studies A and F) -->
  <div class="titlewrap">
    <div class="titleclip"><h1 id="endTitle">VICTORY</h1></div>
    <i class="sweep" aria-hidden="true"></i>
  </div>
  <div class="sub" id="endSub">You out-rolled the machine</div>
  <div class="scoreline">
    <span class="sc"><span class="you" id="endYou">0</span><em id="endYouLbl">You</em></span>
    <span class="vs" data-i18n="common:versus">VS</span>
    <span class="sc"><span class="cpu" id="endCpu">0</span><em id="endCpuLbl">AI</em></span>
  </div>
  <!-- who played, as plates (design 36f) — ranked fills this, local leaves it hidden -->
  <div class="endplates" id="endPlates" hidden></div>
  <div class="endmeta" id="endMeta"></div>
  <!-- share sits WITH the thing it shares (user call): right under the two
       plates, centered with them — not down in
       the action stack. The stack keeps its own anchor: #btnAgain's auto
       margin, so the cluster stays centered between title and actions. -->
  <button class="linkbtn" id="btnShare" hidden>Share result</button>
  <button class="btn primary" id="btnAgain">Next duel</button>
  <!-- ONE quiet way on, and a real button rather than a text link (user call)
       — in the small cut, because a way out shouldn't stand as tall as NEXT
       DUEL. What it says and where it goes come from the spec: Home after a
       ranked match, the setup screen after a local one. -->
  <button class="btn small" id="btnEndQuiet">Home</button>
</div>

<div class="ov" id="ovLoad" aria-live="polite"></div>`;

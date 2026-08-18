// The app's static markup, injected at boot by each entry point.
// Single source of truth for standalone page and widget alike (the old build
// derived the widget's copy from the page via regex — this is that, deleted).
export const MARKUP = `<div id="bg"></div><div id="vig"></div>

<div id="app">
  <div class="hud">
    <div class="rec" id="rec">W <b>0</b> · L <i>0</i></div>
    <div class="sp"></div>
    <button class="ico" id="btnSettings" aria-label="Settings" style="font-size:15px">⚙</button>
    <button class="ico" id="btnMenu" aria-label="Leave game">✕</button>
  </div>

  <div id="coach" hidden>
    <div class="cmsg" id="coachMsg" aria-live="polite"></div>
    <div class="chint" id="coachHint">Tap to continue</div>
  </div>

  <div class="table" id="tableEl">
    <!-- far side of the table -->
    <section class="side top" id="sideTop" data-owner="0">
      <div class="plate" id="plateTop">
        <span class="dot"></span><span class="nm" id="nameTop">CPU</span>
        <span class="tag" id="tagTop">HARD</span>
        <span class="sp"></span><span class="bty" id="btyTop" hidden></span><span class="tot" id="totTop">0</span>
      </div>
      <div class="boardwrap"><div class="board" id="topBoard"></div></div>
      <div class="cols" id="topCols"></div>
    </section>

    <!-- CENTER -->
    <section class="center">
      <div id="dieStage" role="img" aria-label="No die rolled yet"></div>
      <div class="status" id="status" role="status" aria-live="polite">Tap play to start</div>
      <div class="timer" id="timerWrap" aria-hidden="true">
        <span class="track"><span class="bar" id="timerBar"></span></span><b id="timerNum"></b>
      </div>
    </section>

    <!-- near side of the table (always whoever is holding the phone) -->
    <section class="side bot" id="sideBot" data-owner="1">
      <div class="cols" id="botCols"></div>
      <div class="boardwrap"><div class="board" id="botBoard"></div></div>
      <div class="plate" id="plateBot">
        <span class="dot"></span><span class="nm" id="nameBot">YOU</span>
        <span class="tag" id="tagBot" hidden></span>
        <span class="sp"></span><span class="bty" id="btyBot" hidden></span><span class="tot" id="totBot">0</span>
      </div>
    </section>
  </div>
</div>

<div id="fx"></div>
<div class="flash" id="flash"></div>



<!-- HOME: online-first. The duel is the hero, PLAY ONLINE the one primary
     action; local play sits behind the quiet PRACTICE strip. -->
<div class="ov on" id="ovStart">
  <div class="idchip anon" id="homeChip">NOT SIGNED IN</div>
  <div class="hero">
    <div class="eyebrow">Neon Edition</div>
    <h1>KNUCKLEBONES</h1>
    <div class="duel" id="homeDuel"><span class="vs">VS</span></div>
    <div class="sub2">Ranked dice duels</div>
  </div>
  <div class="homestack">
    <button class="btn primary" id="btnOnline">Play online</button>
    <div class="hrow">
      <button class="btn" id="btnBoardHome">Leaderboard</button>
      <button class="btn" id="btnAccountHome">Account</button>
    </div>
  </div>
  <div class="quiet">
    <div class="cap">Practice offline</div>
    <div class="hrow">
      <button class="btn" id="btnVsCpu">VS CPU</button>
      <button class="btn" id="btnDuoHome">2 players</button>
      <button class="btn" id="btnTutHome">Tutorial</button>
    </div>
  </div>
  <div class="homefoot">
    <button class="linkbtn" id="btnHow">How to play</button>
    <button class="linkbtn" id="btnModes">Game modes</button>
    <button class="linkbtn" id="btnInstall" hidden>Install app</button>
    <div class="tiny" id="buildTag" style="opacity:.55">build dev</div>
  </div>
</div>

<!-- PRACTICE: the local-play configuration (was the old title screen).
     A page below Home: ‹ goes back, the bottom holds only actions. -->
<div class="ov paged" id="ovPractice">
  <div class="shead">
    <button class="ico" id="btnPracticeBack" aria-label="Back">‹</button>
    <span class="ttl">PRACTICE</span><span class="pad"></span>
  </div>
  <div class="pbody">
    <div class="card">
      <div class="lbl">Mode</div>
      <div class="seg" id="modeSeg">
        <button data-m="cpu" class="on">VS CPU</button>
        <button data-m="duo">2 PLAYERS</button>
      </div>
    </div>
    <div class="card" id="diffCard">
      <div class="lbl">CPU level</div>
      <div class="seg" id="diffSeg">
        <button data-d="easy">EASY</button>
        <button data-d="medium">NORMAL</button>
        <button data-d="hard" class="on">HARD</button>
      </div>
    </div>
    <div class="card" id="seatCard" hidden>
      <div class="lbl">Sitting</div>
      <div class="seg" id="seatSeg">
        <button data-seat="pass">PASS PHONE</button>
        <button data-seat="face">FACE TO FACE</button>
      </div>
    </div>
    <div class="card" id="timerCard" hidden>
      <div class="lbl">Turn timer</div>
      <div class="seg" id="timerSeg">
        <button data-t="10" class="on">10 SEC</button>
        <button data-t="20">20 SEC</button>
        <button data-t="0">OFF</button>
      </div>
    </div>
    <div class="tiny" id="duoNote" hidden>One phone, passed back and forth</div>
    <div class="tiny" id="statLine" hidden></div>
    <button class="btn primary" id="btnResume" hidden>Resume game</button>
    <button class="btn primary" id="btnPlay">Play</button>
    <button class="tut-tease" id="btnTut"><span class="tx"><span class="t1">TUTORIAL</span><span class="t2">A guided first game — five minutes</span></span></button>
    <div class="tiny">Practice never touches your online rating</div>
  </div>
</div>

<!-- RULES: a reading sheet — ✕ up top, one GOT IT at the bottom -->
<div class="ov paged" id="ovRules">
  <div class="shead">
    <span class="pad"></span><span class="ttl">HOW TO PLAY</span>
    <button class="ico" id="btnCloseRules" aria-label="Close">✕</button>
  </div>
  <div class="pbody">
  <div class="rules">
    <h3>Goal</h3>
    <p>Fill your 3×3 grid with dice. When <b>either</b> grid is full the game ends — highest total wins.</p>
    <h3>Placing</h3>
    <p>You roll a die, then tap one of <b>your</b> columns to drop it in. You can't choose the roll, only where it lands.</p>
    <h3>Column multipliers</h3>
    <p>Matching dice in the same column multiply. Two 4s in a column = <b>4×2×2 = 16</b>, not 8. Three 4s = <b>4×3×3 = 36</b>.</p>
    <h3 style="color:var(--mg)">Destruction</h3>
    <p>Place a die and <span class="k">every matching die in the opponent's facing column is destroyed</span>. Columns line up vertically — your left column faces their left column.</p>
    <h3>Reading the board</h3>
    <p>The chips beside each column show its running score, and <b>×2</b>/<b>×3</b> marks a multiplied stack. Working out the best placement is the game — but the <b>tutorial</b> plays a guided round with point previews on every column.</p>
    <h3>Two players</h3>
    <p>Pick <b>2 PLAYERS</b> to share one phone, then choose how you sit. <b>Pass phone</b>: a pass card appears between turns and the grids swap so whoever is playing is on the bottom. <b>Face to face</b>: lay the phone flat between you — the top half is turned for Player 2, turns switch on their own, and the bright half with the rotating centre die shows who's up.</p>
  </div>
  <button class="btn primary" id="btnRulesOk">Got it</button>
  </div>
</div>

<!-- INSTALL (iOS hint — Chrome-family installs straight from the footer link) -->
<div class="ov paged" id="ovInstall">
  <div class="shead">
    <span class="pad"></span><span class="ttl">INSTALL</span>
    <button class="ico" id="btnCloseInstall" aria-label="Close">✕</button>
  </div>
  <div class="pbody">
    <div class="appface" id="installFace"></div>
    <div class="rules" style="max-width:330px;text-align:center">
      <p>Put the game on your home screen — it opens fullscreen and keeps working offline.</p>
      <p>Tap the <b>Share</b> icon in Safari's toolbar, then <b>Add to Home Screen</b>.</p>
    </div>
    <button class="btn primary" id="btnInstallOk">Got it</button>
  </div>
</div>

<!-- HAND-OFF -->
<div class="ov" id="ovPass">
  <div class="glow"></div>
  <div class="swapicon">⇅</div>
  <div class="who" id="passWho">PLAYER 2</div>
  <div class="hint">Pass the phone</div>
  <div class="mini"><b class="a" id="passP1">0</b><span>—</span><b class="b" id="passP2">0</b></div>
  <div class="tapline">Tap anywhere when ready</div>
  <button class="ico" id="passQuit" aria-label="Leave game">✕</button>
</div>

<!-- SETTINGS: a sheet over live context — ✕ closes, toggles apply instantly -->
<div class="ov paged" id="ovSettings">
  <div class="shead">
    <span class="pad"></span><span class="ttl">SETTINGS</span>
    <button class="ico" id="btnCloseSettings" aria-label="Close">✕</button>
  </div>
  <div class="pbody">
    <div class="card">
      <div class="lbl">Sound</div>
      <div class="seg" id="sndSeg">
        <button data-s="1">ON</button>
        <button data-s="0">OFF</button>
      </div>
    </div>
    <div class="card">
      <div class="lbl">Dice faces</div>
      <div class="seg" id="faceSeg">
        <button data-f="pips">PIPS</button>
        <button data-f="nums">NUMBERS</button>
      </div>
    </div>
    <button class="btn" id="btnHow2">How to play</button>
    <div class="tiny">Changes apply the moment you tap them</div>
  </div>
</div>

<!-- END -->
<div class="ov" id="ovEnd">
  <h1 id="endTitle">VICTORY</h1>
  <div class="sub" id="endSub">You out-rolled the machine</div>
  <div class="scoreline">
    <span class="sc"><span class="you" id="endYou">0</span><em id="endYouLbl">You</em></span>
    <span class="vs">VS</span>
    <span class="sc"><span class="cpu" id="endCpu">0</span><em id="endCpuLbl">CPU</em></span>
  </div>
  <div class="tiny" id="endRec">SESSION 0–0</div>
  <button class="btn primary" id="btnAgain">Play again</button>
  <button class="btn" id="btnMenu2">Change difficulty</button>
  <button class="linkbtn" id="btnEndHome">Home</button>
</div>`;

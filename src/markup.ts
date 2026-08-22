// The app's static markup, injected at boot by each entry point.
// Single source of truth for standalone page and widget alike (the old build
// derived the widget's copy from the page via regex — this is that, deleted).
import { chromeIcon } from './ui/chromeicons.ts';

export const MARKUP = `<div id="bg"></div><div id="vig"></div>

<div id="app">
  <div class="hud">
    <div class="rec" id="rec">W <b>0</b> · L <i>0</i></div>
    <div class="sp"></div>
    <!-- the game's ONE control: settings (quit lives inside the sheet) -->
    <button class="ico" id="btnLeave" aria-label="Leave game">${chromeIcon('leave', 15)}</button>
  </div>

  <div id="coach" hidden>
    <div class="cmsg" id="coachMsg" aria-live="polite"></div>
    <div class="chint" id="coachHint">Tap to continue</div>
  </div>

  <div class="table" id="tableEl">
    <!-- far side of the table -->
    <section class="side top" id="sideTop" data-owner="0">
      <div class="plate" id="plateTop">
        <span class="who"><span class="dot"></span><span class="nm" id="nameTop">AI</span>
        <span class="tag" id="tagTop">HARD</span></span>
        <span class="sp"></span>
        <span class="pright"><span class="runeslot"></span>
        <span class="bty" id="btyTop" hidden></span><span class="tot" id="totTop">0</span></span>
      </div>
      <div class="boardwrap"><div class="board" id="topBoard"></div></div>
      <div class="cols" id="topCols"></div>
    </section>

    <!-- CENTER -->
    <section class="center">
      <div class="stagerow">
        <div id="dieStage" role="img" aria-label="No die rolled yet"></div>
        <!-- LIMITED mode only: the bag beside the die in play -->
        <div class="bag" id="bagStack" hidden>
          <span class="pile" aria-hidden="true"></span>
          <b class="bn" id="bagNum" aria-label="Dice left in the bag">0</b>
        </div>
        <!-- SPELLS: the rune you can actually cast, opposite the bag. The
             OTHER player's sits small and inert in their nameplate. -->
        <div class="spells" id="spellBar"></div>
      </div>
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
        <span class="who"><span class="dot"></span><span class="nm" id="nameBot">YOU</span>
        <span class="tag" id="tagBot" hidden></span></span>
        <span class="sp"></span>
        <span class="pright"><span class="runeslot"></span>
        <span class="bty" id="btyBot" hidden></span><span class="tot" id="totBot">0</span></span>
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
    <div class="eyebrow">Neon Edition</div>
    <h1>KNUCKLEBONES</h1>
    <div class="duel" id="homeDuel"><span class="vs">VS</span></div>
    <div class="sub2">Ranked dice duels</div>
  </div>
  <div class="homestack">
    <!-- the plate IS the account: ring, avatar, name and points, docked on the
         button that moves them (design 13d). boot's refreshHomeChip fills it. -->
    <button class="pplate anon" id="homeChip">NOT SIGNED IN</button>
    <button class="btn primary" id="btnOnline">Play ranked match</button>
    <div class="hrow">
      <button class="btn" id="btnBoardHome">Ladder</button>
      <button class="btn" id="btnSettingsHome">Settings</button>
    </div>
  </div>
  <div class="quiet">
    <div class="cap">Practice offline</div>
    <div class="hrow">
      <button class="btn" id="btnVsCpu">VS AI</button>
      <button class="btn" id="btnDuoHome">2 players</button>
      <button class="btn" id="btnLearn">How to play</button>
    </div>
  </div>
  <!-- everything teachable moved behind HOW TO PLAY, so the foot carries only
       what the law requires — and it sits at the very bottom, where nobody
       looks for it and nobody has to. -->
  <div class="viewfoot">
    <button class="linkbtn" id="btnImprint">Impressum</button>
    <button class="linkbtn" id="btnPrivacy">Privacy</button>
  </div>
</div>

<!-- OFFLINE: the local-play configuration (was the old title screen).
     A page below Home: ‹ goes back, the bottom holds only actions. -->
<div class="ov paged" id="ovPractice">
  <div class="shead">
    <button class="ico" id="btnPracticeBack" aria-label="Back">‹</button>
    <span class="ttl">OFFLINE</span><span class="pad"></span>
  </div>
  <div class="pbody">
    <div class="card">
      <div class="lbl">Mode</div>
      <div class="seg" id="modeSeg">
        <button data-m="cpu" class="on">VS AI</button>
        <button data-m="duo">2 PLAYERS</button>
      </div>
    </div>
    <!-- ONE slot, two occupants: whichever of these the Mode above calls for.
         Both wear label + segment + note, so switching changes what this card
         SAYS and never where the cards below it sit. Each note also explains
         the choice it sits under — the seating note used to live at the far
         bottom of the sheet, describing a control three cards away. -->
    <div class="card" id="diffCard">
      <div class="lbl">AI level</div>
      <div class="seg" id="diffSeg">
        <button data-d="easy">EASY</button>
        <button data-d="medium">NORMAL</button>
        <button data-d="hard" class="on">HARD</button>
      </div>
      <!-- deliberately empty: the AI level says what it is and nothing more
           (user call). Kept so this card keeps the seat card's height. -->
      <div class="tiny note" id="diffNote"></div>
    </div>
    <div class="card" id="seatCard" hidden>
      <div class="lbl">Sitting</div>
      <div class="seg" id="seatSeg">
        <button data-seat="pass">PASS PHONE</button>
        <button data-seat="face">FACE TO FACE</button>
      </div>
      <div class="tiny note" id="duoNote"></div>
    </div>
    <div class="card">
      <div class="lbl">Game mode</div>
      <div class="modepick" id="modePick"></div>
      <div class="tiny note" id="modePickInfo"></div>
    </div>
    <div class="card">
      <div class="lbl">Spell</div>
      <div class="modepick" id="spellPick"></div>
      <div class="tiny note" id="spellPickInfo"></div>
    </div>
    <!-- the one card only two-player play has: it lands at the END, so the
         sheet GROWS rather than shuffling what is already on screen -->
    <div class="card" id="timerCard" hidden>
      <div class="lbl">Turn timer</div>
      <div class="seg" id="timerSeg">
        <button data-t="10" class="on">10 SEC</button>
        <button data-t="20">20 SEC</button>
        <button data-t="0">OFF</button>
      </div>
    </div>
    <div class="tiny" id="statLine" hidden></div>
    <!-- the commitment, pinned: whatever the sheet above it grows to, the way
         OUT of it is always in the same place under your thumb -->
    <div class="playbar">
      <button class="btn primary" id="btnPlay">Play</button>
      <div class="tiny">Offline play never touches your online rating</div>
    </div>
  </div>
</div>

<!-- LEGAL. Two reading sheets, same component as the rules screen. Everything
     factual here was verified against the code, not templated: ONE outbound
     host, no analytics, no third-party scripts, four functional localStorage
     keys. Anything in [BRACKETS] is Johannes's to fill and nobody else's. -->
<div class="ov paged" id="ovImprint">
  <div class="shead">
    <span class="pad"></span><span class="ttl">IMPRESSUM</span>
    <button class="ico" id="btnCloseImprint" aria-label="Close">✕</button>
  </div>
  <div class="pbody">
  <div class="rules">
    <h3>Angaben gemäß § 5 DDG</h3>
    <p>[COMPANY / NAME]<br>[STREET]<br>[POSTCODE CITY]<br>[COUNTRY]</p>
    <h3>Contact</h3>
    <p>Email: [EMAIL]<br>Phone: [PHONE, optional]</p>
    <h3>Represented by</h3>
    <p>[MANAGING DIRECTOR / SOLE TRADER NAME]</p>
    <h3>Register</h3>
    <p>[REGISTER COURT AND NUMBER, if registered]<br>VAT ID under § 27a UStG: [VAT ID, if held]</p>
    <h3>Responsible for content</h3>
    <p>[NAME, ADDRESS] — under § 18 Abs. 2 MStV.</p>
    <h3>Dispute resolution</h3>
    <p>The European Commission provides a platform for online dispute resolution at
       <b>ec.europa.eu/consumers/odr</b>. We are neither obliged nor willing to take part in
       dispute resolution proceedings before a consumer arbitration board.</p>
    <button class="btn primary" id="btnCloseImprint2">Got it</button>
  </div>
  </div>
</div>

<div class="ov paged" id="ovPrivacy">
  <div class="shead">
    <span class="pad"></span><span class="ttl">PRIVACY</span>
    <button class="ico" id="btnClosePrivacy" aria-label="Close">✕</button>
  </div>
  <div class="pbody">
  <div class="rules">
    <h3>Who is responsible</h3>
    <p>[COMPANY / NAME], [ADDRESS], [EMAIL]. See the Impressum for full details.</p>
    <h3>What this game stores</h3>
    <p>Playing offline stores nothing about you anywhere but on your own device. The moment
       you play <b>ranked</b>, an account is created — silently, as a guest — and from then on
       we hold: an account identifier, a nickname (generated for you, or the one you claim
       once yourself), your rating, and a record of the matches you played. If you attach an
       email address to keep the account, we hold that too.</p>
    <h3>What leaves your device</h3>
    <p>Exactly one service receives your data: <b>Supabase</b> (EU region), which stores accounts
       and matches on our behalf. The app itself is delivered by <b>Cloudflare Pages</b>. Both
       process your IP address in the course of doing that. There is <b>no analytics, no
       advertising, no tracking of any kind</b>, and no third-party scripts run in this app.</p>
    <h3>Cookies</h3>
    <p>None. The game keeps four values in your browser's local storage — your session, a cached
       copy of your own profile, your settings and your local statistics. All four are strictly
       necessary for the game to work, so no consent banner is required and none is shown.</p>
    <h3>Why we may do this</h3>
    <p>To provide the game you asked for (Art. 6(1)(b) GDPR) and to keep the service from being
       abused, e.g. rate limits on account creation (Art. 6(1)(f) GDPR).</p>
    <h3>How long</h3>
    <p>For as long as the account exists. <b>You can delete it at any time</b> — Account →
       Delete account removes your profile, your matches and your rating outright. Guest accounts
       that never played a match are cleared automatically after 30 days.</p>
    <h3>Your rights</h3>
    <p>You may request access, correction, erasure, restriction, portability, and object to
       processing. Write to [EMAIL]. You may also complain to a supervisory authority —
       for us that is [SUPERVISORY AUTHORITY].</p>
    <button class="btn primary" id="btnClosePrivacy2">Got it</button>
  </div>
  </div>
</div>

<!-- LEARN: the one door to everything teachable. Four rows rather than four
     links scattered across the home screen and the settings sheet. -->
<div class="ov paged" id="ovLearn">
  <div class="shead">
    <button class="ico" id="btnLearnBack" aria-label="Back">‹</button>
    <span class="ttl">HOW TO PLAY</span><span class="pad"></span>
  </div>
  <div class="pbody">
    <div class="learnlist">
      <button class="learnrow" id="btnLearnTut">
        <span class="lname">Tutorial</span>
        <span class="lblurb">A guided first game — five lessons, played not read</span>
      </button>
      <button class="learnrow" id="btnLearnRules">
        <span class="lname">The rules</span>
        <span class="lblurb">Scoring, destruction and how a game ends</span>
      </button>
      <button class="learnrow" id="btnLearnModes">
        <span class="lname">Game modes</span>
        <span class="lblurb">Every mode the dial can land on, and what it changes</span>
      </button>
      <button class="learnrow" id="btnLearnSpells">
        <span class="lname">Spells</span>
        <span class="lblurb">The optional rune you can bring to an offline game</span>
      </button>
    </div>
  </div>
</div>

<!-- RULES: a reading sheet — fixed ✕ bar, the text scrolls, GOT IT at its end -->
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
    <h3 style="color:#b18cff">Spells</h3>
    <p>Offline games deal both players the same <b>rune</b>, beside the die in play — five to choose from where you set up an offline game, right under the game mode (<b>none</b> by default, or <b>random</b> to have one drawn for you). A rune that acts on your die casts the moment you press it; one that aims at a column is dragged or tapped onto it, and only the columns it can actually reach light up. A cast is not a move, so your die still lands afterwards. The full roster lives under <b>HOW TO PLAY → SPELLS</b>. Ranked matches never use them.</p>
    <h3>Two players</h3>
    <p>Pick <b>2 PLAYERS</b> to share one phone, then choose how you sit. <b>Pass phone</b>: a pass card appears between turns and the grids swap so whoever is playing is on the bottom. <b>Face to face</b>: lay the phone flat between you — the top half is turned for Player 2, turns switch on their own, and the bright half with the rotating centre die shows who's up.</p>
  </div>
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

<!-- SETTINGS: a page below Home like OFFLINE — ‹ goes back, toggles apply instantly -->

<div class="ov paged" id="ovSettings">
  <div class="shead">
    <button class="ico" id="btnSettingsBack" aria-label="Back">‹</button>
    <span class="ttl">SETTINGS</span><span class="pad"></span>
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
    <!-- the duel pickers: swatch strips built by boot.ts from DUELHUES
         (state.ts), one implementation, two slots. A colour belongs to one
         player only — each strip renders the other side's pick disabled. -->
    <div class="card">
      <div class="lbl">Your colour</div>
      <div class="hues" id="p1Pick"></div>
    </div>
    <div class="card">
      <div class="lbl">Opponent colour</div>
      <div class="hues" id="p2Pick"></div>
      <!-- explains the lock while colour blind mode owns the pair; hidden
           otherwise, and the disabled swatches point at it (aria-describedby) -->
      <div class="tiny" id="colNote" hidden>Colour blind mode picks the colours</div>
    </div>
    <div class="card">
      <div class="lbl">Colour blind mode</div>
      <div class="seg" id="cbSeg">
        <button data-b="1">ON</button>
        <button data-b="0">OFF</button>
      </div>
      <div class="tiny">Locks the duel to cyan vs gold — a pair red-green colour vision tells apart</div>
    </div>
    <div class="tiny">Changes apply the moment you tap them</div>
  </div>
  <!-- deploy truth lives here now: the screen you open when something looks
       wrong is the screen that should tell you WHICH build is wrong -->
  <div class="viewfoot"><div class="tiny" id="buildTag">build dev</div></div>
</div>

<!-- END — the ONE result screen, local and ranked alike (ui/endscreen.ts).
     Everything that differs between the two is a slot the caller fills: the
     meta line carries a session record or a points chip + ladder spot, and each
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
    <span class="vs">VS</span>
    <span class="sc"><span class="cpu" id="endCpu">0</span><em id="endCpuLbl">AI</em></span>
  </div>
  <!-- who played, as plates (design 36f) — ranked fills this, local leaves it hidden -->
  <div class="endplates" id="endPlates" hidden></div>
  <div class="endmeta" id="endMeta"></div>
  <!-- share sits WITH the thing it shares (user call): right under the two
       plates (and local play's record line), centered with them — not down in
       the action stack. The stack keeps its own anchor: #btnAgain's auto
       margin, so the cluster stays centered between title and actions. -->
  <button class="linkbtn" id="btnShare" hidden>Share result</button>
  <button class="btn primary" id="btnAgain">Next duel</button>
  <button class="btn" id="btnMenu2">Change difficulty</button>
  <!-- a real secondary button, not a text link (user call) — the small cut:
       a way out shouldn't stand as tall as NEXT DUEL -->
  <button class="btn small" id="btnEndHome">Home</button>
</div>

<div class="ov" id="ovLoad" aria-live="polite"></div>`;

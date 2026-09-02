import { learnPageMarkup } from '../ui/learn-page.ts';
import { pageBackButton } from '../ui/page-chrome.ts';
/* HOW TO PLAY: the hub of four rows, and the one static detail page it opens.
   RULES is composed through the same learnPageMarkup factory Game Modes and
   Runes build at runtime, and ships WITH the hub in DOM order — input-bindings
   closes the last visible room, so the page has to sit after the row that
   opened it. */
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
    <p data-i18n-rich="learn:rules.runes.body">A <b>rune</b> grants limited powers during a duel. Local multiplayer always has all six; games versus AI only offer runes you have collected. Ordinary ranked uses each player’s equipped rune after that player has reached SILVER once; a player who has never reached SILVER or leaves the seat empty has no rune. From IVORY, <b>Rune Ritual</b> deals both players the same three-rune offer; each secretly picks one, both choices reveal together, and equipment is ignored. Only Rune Ritual pauses before the duel to choose and reveal runes. Win that ranked duel to add your chosen rune to your collection. One card per player stays visible. Press a rune that acts on your die to cast it immediately; drag or tap a column-targeting rune onto one of the columns that light up. A cast is not a move, so your die still lands afterwards. The full roster lives under <b>HOW TO PLAY → RUNES</b>.</p>
    <h3 data-i18n="learn:rules.twoPlayers.heading">Two players</h3>
    <p data-i18n-rich="learn:rules.twoPlayers.body">Pick <b>2 PLAYERS</b> to share one phone, then choose how you sit. <b>Pass phone</b>: a pass card appears between turns and the grids swap so whoever is playing is on the bottom. <b>Face to face</b>: lay the phone flat between you — the top half is turned for Player 2, turns switch on their own, and the bright half with the rotating centre die shows who's up.</p>
  </div>`,
});

export const LEARN_MARKUP = `<!-- LEARN: the one door to everything teachable. Four rows rather than four
     links scattered across the home screen and the settings sheet. -->
<div class="ov paged" id="ovLearn">
  <div class="shead">
    ${pageBackButton({ id: 'btnLearnBack', label: 'Back' })}
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
${RULES_PAGE}`;

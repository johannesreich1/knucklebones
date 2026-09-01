import { chromeIcon } from '../ui/chromeicons.ts';

/* Its own module because ui/endscreen.ts is this skeleton's one driver, and
   markup.ts is left holding the menu screens and the order every screen
   sits in. What the slots below are FOR is the comment that ships with them. */
export const RESULT_MARKUP = `<!-- END — the ONE result screen, local and ranked alike (ui/endscreen.ts).
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
  <!-- Typed result feature/reward slot. The whole card is the control: it
       opens the entry that describes what the card names. -->
  <button type="button" class="endfeature" id="endFeature" aria-haspopup="dialog" hidden></button>
  <div class="endmeta" id="endMeta"></div>
  <!-- share sits WITH the thing it shares (user call): right under the two
       plates, centered with them — not down in
       the action stack. The stack keeps its own anchor: #btnAgain's auto
       margin, so the cluster stays centered between title and actions. -->
  <button class="linkbtn" id="btnShare" hidden>Share result</button>
  <button class="btn primary" id="btnAgain"><span class="btn-leading-icon" data-icon="play" aria-hidden="true" hidden>${chromeIcon('play', 25)}</span><span class="btn-label">Next duel</span></button>
  <!-- ONE quiet way on, and a real button rather than a text link (user call)
       — in the small cut, because a way out shouldn't stand as tall as NEXT
       DUEL. What it says and where it goes come from the spec: Home after a
       ranked match, the setup screen after a local one. -->
  <button class="btn small" id="btnEndQuiet">Home</button>
</div>`;

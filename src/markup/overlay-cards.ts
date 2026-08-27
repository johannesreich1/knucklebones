/* The full-screen tap-to-dismiss cards. Both interrupt the board with one
   message and one instruction, wear the same .ov skeleton (glow, icon, who,
   hint, tapline), and are dismissed by tapping anywhere — so they belong
   together rather than scattered through the page markup.

   They differ in what a tap MEANS. The hand-off card gates the game: play does
   not resume until the next player acknowledges it. The away warning gates
   nothing at all — the turn clock keeps running underneath, and letting it run
   out again is precisely what forfeits the match. */
export const OVERLAY_CARDS_MARKUP = `
<!-- AWAY WARNING: the turn clock has already played this player's last covered
     turn, and the next one it plays ends the match instead. -->
<div class="ov" id="ovAway">
  <div class="glow"></div>
  <div class="awayicon">⏳</div>
  <div class="who" data-i18n="online:play.awayWarnTitle">STILL THERE?</div>
  <div class="hint" data-i18n="online:play.awayWarnBody">Miss one more turn and you forfeit</div>
  <div class="tapline" data-i18n="online:play.awayWarnDismiss">Tap anywhere to keep playing</div>
</div>

<!-- HAND-OFF -->
<div class="ov" id="ovPass">
  <div class="glow"></div>
  <div class="swapicon">⇅</div>
  <div class="who" id="passWho">PLAYER 2</div>
  <div class="hint" data-i18n="game:pass.passPhone">Pass the phone</div>
  <div class="mini"><b class="a" id="passP1">0</b><span>—</span><b class="b" id="passP2">0</b></div>
  <div class="tapline" data-i18n="game:pass.tapReady">Tap anywhere when ready</div>
</div>
`;

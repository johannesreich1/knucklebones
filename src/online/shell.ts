import { ME, AI } from '../core/rules.ts';
import { $, hide, settleGlass } from '../ui/dom.ts';
import { makeDie } from '../ui/die.ts';
import { appRoot } from '../ui/embed.ts';

const OVERLAY = `
<div class="ov paged" id="ovOnline">
  <div class="shead">
    <button class="ico" id="btnOnlineBack" aria-label="Back">‹</button>
    <span class="ttl" id="onTitle">ONLINE</span><span class="pad"></span>
  </div>

  <!-- the paged view's scrolling body (styles/main.css .ov.paged): the panels
       are its content, so ONLINE pins its ‹ and fades its top edge exactly
       like every other titled page — no rules of its own. -->
  <div class="pbody">
  <div class="panel" id="onAuth" hidden>
    <div class="lbl" id="onAuthLead" style="text-align:center"></div>
    <div class="oneTap" id="onOneTap"></div>
    <input id="onEmail" type="email" autocomplete="email" placeholder="email">
    <input id="onPass" type="password" autocomplete="current-password" placeholder="password (8+)">
    <div class="err" id="onAuthErr"></div>
    <div class="acts" id="onAuthActs"></div>
    <button class="btn ghost" id="btnAuthSwap" hidden></button>
    <div class="tiny" id="onAuthTiny"></div>
  </div>

  <div class="panel online-queue" id="onQueue" hidden>
    <div class="qdice" id="qDice"></div>
    <div class="qmsg">Looking for an opponent</div>
    <div class="qtime" id="qTime">0:00</div>
    <div class="qsub" id="qSub">&nbsp;</div>
    <button class="btn" id="btnQueueCancel">Cancel</button>
  </div>

  <div class="panel" id="onBoard" hidden>
    <!-- no subheading: the season is nobody's business while there is only
         one (user call) — the shead already says LADDER -->
    <div class="lb neonscroll" id="onBoardList"></div>
  </div>

  <div class="panel" id="onAccount" hidden>
    <!-- The ring is ONE continuous fill: how far through the current GROUP you
         are. It moves on every match, which is the whole feedback loop now that
         divisions are gone (docs/LADDER.md §5). --p is the fill, --pk the
         season peak; .haspeak says the peak is worth drawing at all. -->
    <div class="ringwrap" id="accRing" style="--p:0;--pk:0">
      <i class="lring"></i><i class="lpeak"></i>
      <button class="avwrap" id="btnAvatar" aria-label="Change avatar">
        <span id="accDie"></span><span class="avedit">✎</span>
      </button>
      <!-- the group name sits IN the ring's bottom opening. The 90deg gap was
           already there to keep the ring from closing; giving it the rank makes
           the ring self-describing instead of merely open. -->
      <span class="gname" id="accGroup">STONE</span>
    </div>
    <!-- the name the ring crowns. Until it is claimed this is the minted
         placeholder; after the claim it is the one line the old edit-field
         used to be, minus the ability to edit -->
    <div class="accname" id="accName"></div>
    <!-- the points are a DOOR: the number names your place on the ladder, so
         tapping it opens the ladder — same pattern as the identity chip and
         the match-history row, where the fact leads to the list behind it -->
    <button class="ptv" id="btnLadder" aria-label="Open the ladder">
      <b id="accPoints">0</b><span>Ladder points</span>
    </button>
    <div class="facts">
      <div class="fact"><b id="accRank">–</b><span>Rank</span></div>
      <div class="fact"><b id="accStreak">0</b><span>Best streak</span></div>
      <div class="fact pk"><b id="accPeak">0</b><span>Peak</span></div>
    </div>
    <button class="histrow" id="btnHistory">Full match history <b id="accGames">–</b></button>
    <!-- the last few matches inline (user call): as many of the newest 0–3 as
         the space above the pinned foot actually holds on this device. The
         rows are showHistory's own (histRow) — one implementation. -->
    <div class="lb minihist" id="accRecent" hidden></div>
    <div class="accsince" id="accSince"></div>
    <!-- the ONE-TIME name claim: it wears the guestbox shape because it is the
         same kind of thing — a boxed offer on the profile — and it exists only
         while the name is still the minted placeholder. Once named_at is
         stamped (migration 0026) the card is gone for good, not disabled.
         It leads the guest card (user call): naming yourself comes before
         deciding where the account lives. -->
    <div class="guestbox namebox" id="accClaim" hidden>
      <b>CLAIM YOUR NAME</b>
      <p>One name per account — set once and kept for good. 3–16 letters, digits or underscores.</p>
      <!-- no maxlength: a silent cap eats keystrokes mid-word; the claim
           button answers over-long names with the limit instead -->
      <input id="onNick" autocomplete="off" spellcheck="false" autocapitalize="off">
      <div class="err" id="onNickErr"></div>
      <button class="btn primary" id="btnClaim">Claim name</button>
    </div>
    <div class="guestbox" id="accGuest" hidden>
      <b>GUEST</b>
      <p>This account lives on this device only. Delete the app and the rating goes with it.</p>
      <button class="btn primary" id="btnKeepAcc">Keep it forever</button>
      <button class="btn ghost" id="btnHaveAcc">I already have an account</button>
    </div>
    <div class="err" id="onAccErr"></div>
    <!-- the foot is PINNED (user call): sign out and the delete footnote sit
         at the very bottom whatever the device leaves free, and the mini
         history above fills what remains. One wrapper so the pin holds
         whether or not Sign out is hidden (guests). -->
    <div class="accfoot">
      <button class="btn" id="btnSignOut">Sign out</button>
      <!-- deleting is a FOOTNOTE, not an action to advertise: the same linkbtn
           row as home's legal links. The red lives on the confirm ask-card,
           where the player is actually deciding. Sign out stays the panel's
           last real button, always directly above it. -->
      <div class="viewfoot">
        <button class="linkbtn" id="btnDeleteAcc">Delete account</button>
      </div>
    </div>
  </div>

  <div class="panel" id="onAvatar" hidden>
    <div class="lbl" style="text-align:center">Pick a face and a colour</div>
    <div class="avpreview" id="avPreview"></div>
    <div class="avgrid" id="avFaces"></div>
    <div class="avgrid hues" id="avHues"></div>
    <div class="err" id="onAvErr"></div>
    <button class="btn primary" id="btnAvatarSave">Save</button>
  </div>

  <div class="panel" id="onHistory" hidden>
    <!-- the win/loss tally heads the LIST it summarises, rather than sitting on
         the profile as a fourth tile competing with the rank and the streak -->
    <div class="htotal" id="onHistoryTotal">&nbsp;</div>
    <div class="lb neonscroll" id="onHistoryList"></div>
  </div>
  </div>

</div>`;

const PANELS = {
  onAuth: { title: 'SIGN IN', back: true },
  onQueue: { title: 'MATCHMAKING', back: false },
  onBoard: { title: 'LADDER', back: true },
  onAccount: { title: 'PROFILE', back: true },
  onAvatar: { title: 'AVATAR', back: true },
  onHistory: { title: 'MATCH HISTORY', back: true },
} as const;

export type OnlinePanel = keyof typeof PANELS;

export function installOnlineShell(): void {
  appRoot().insertAdjacentHTML('beforeend', OVERLAY);
  const dice = $('#qDice');
  dice.appendChild(makeDie(2, ME));
  dice.appendChild(makeDie(6, AI));
}

export function showOnlinePanel(which: OnlinePanel): void {
  hide('#ovLoad');
  for (const id of Object.keys(PANELS)) $('#' + id).hidden = id !== which;
  $('#ovOnline').classList.toggle('listview', which === 'onBoard' || which === 'onHistory');
  $('#onTitle').textContent = PANELS[which].title;
  ($('#btnOnlineBack') as HTMLElement).style.visibility = PANELS[which].back ? 'visible' : 'hidden';
  settleGlass('#ovOnline');
}

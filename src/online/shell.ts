import { ME, AI } from '../core/rules.ts';
import {
  subscribeLocale,
  t,
  translateDom,
  type LocaleKey,
} from '../i18n/index.ts';
import { $, hide, settleGlass } from '../ui/dom.ts';
import { makeDie } from '../ui/die.ts';
import { appRoot } from '../ui/embed.ts';
import { loaderWait } from '../ui/loader.ts';

const OVERLAY = `
<div class="ov paged" id="ovOnline">
  <div class="shead">
    <button class="ico" id="btnOnlineBack" aria-label="Back"
      data-i18n-attr="aria-label=common:actions.back">‹</button>
    <span class="ttl" id="onTitle">ONLINE</span><span class="pad"></span>
  </div>

  <!-- the paged view's scrolling body (styles/main.css .ov.paged): the panels
       are its content, so ONLINE pins its ‹ and fades its top edge exactly
       like every other titled page — no rules of its own. -->
  <div class="pbody">
  <!-- One blocking wait for data-backed panels that reveal atomically. Keeping
       it as a sibling, rather than placing a loader inside each panel's
       content, makes the die centre against the VIEW and keeps half-painted
       rows/cards out of sight until their owner can reveal them. -->
  <div class="panel" id="onLoading" hidden aria-live="polite"></div>

  <div class="panel" id="onAuth" hidden>
    <div class="lbl" id="onAuthLead" style="text-align:center"></div>
    <div class="oneTap" id="onOneTap"></div>
    <input id="onEmail" type="email" autocomplete="email" placeholder="email"
      data-i18n-attr="placeholder=online:auth.emailPlaceholder">
    <input id="onPass" type="password" autocomplete="current-password" placeholder="password (8+)"
      data-i18n-attr="placeholder=online:auth.passwordPlaceholder">
    <div class="err" id="onAuthErr"></div>
    <div class="acts" id="onAuthActs"></div>
    <button class="btn ghost" id="btnAuthSwap" hidden></button>
    <div class="tiny" id="onAuthTiny"></div>
  </div>

  <div class="panel online-queue" id="onQueue" hidden>
    <div class="qdice" id="qDice"></div>
    <div class="qmsg" data-i18n="online:matchmaking.looking">Looking for an opponent</div>
    <div class="qtime" id="qTime">0:00</div>
    <div class="qsub" id="qSub">&nbsp;</div>
    <button class="btn" id="btnQueueCancel" data-i18n="online:matchmaking.cancel">Cancel matchmaking</button>
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
      <button class="avwrap" id="btnAvatar" aria-label="Change avatar"
        data-i18n-attr="aria-label=online:profile.changeAvatar">
        <span id="accDie"></span><span class="avedit">✎</span>
      </button>
      <!-- the group name sits IN the ring's bottom opening. The 90deg gap was
           already there to keep the ring from closing; giving it the rank makes
           the ring self-describing instead of merely open. -->
      <span class="gname" id="accGroup"></span>
    </div>
    <!-- the name the ring crowns. Until it is claimed this is the minted
         placeholder; after the claim it is the one line the old edit-field
         used to be, minus the ability to edit -->
    <div class="accname" id="accName"></div>
    <!-- the points are a DOOR: the number names your place on the ladder, so
         tapping it opens the ladder — same pattern as the identity chip and
         the match-history row, where the fact leads to the list behind it -->
    <button class="ptv" id="btnLadder" aria-label="Open the ladder"
      data-i18n-attr="aria-label=online:profile.openLadder">
      <b id="accPoints">0</b><span data-i18n="online:profile.ladderPoints">Ladder points</span>
    </button>
    <div class="facts">
      <div class="fact"><b id="accRank">–</b><span data-i18n="online:profile.rank">RANK</span></div>
      <div class="fact"><b id="accStreak">0</b><span data-i18n="online:profile.bestStreak">BEST STREAK</span></div>
      <div class="fact pk"><b id="accPeak">0</b><span data-i18n="online:profile.peak">PEAK</span></div>
    </div>
    <button class="histrow" id="btnHistory"><span data-i18n="online:profile.fullHistory">Full match history</span> <b id="accGames">–</b></button>
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
      <b data-i18n="online:profile.claimTitle">CLAIM YOUR NAME</b>
      <p data-i18n="online:profile.claimDetail">One name per account — set once and kept for good. 3–16 letters, digits or underscores.</p>
      <!-- no maxlength: a silent cap eats keystrokes mid-word; the claim
           button answers over-long names with the limit instead -->
      <input id="onNick" autocomplete="off" spellcheck="false" autocapitalize="off">
      <div class="err" id="onNickErr"></div>
      <button class="btn primary" id="btnClaim" data-i18n="online:profile.claimName">Claim name</button>
    </div>
    <div class="guestbox" id="accGuest" hidden>
      <b data-i18n="common:people.guest">GUEST</b>
      <p data-i18n="online:profile.guestDetail">This account lives on this device only. Delete the app and the rating goes with it.</p>
      <button class="btn primary" id="btnKeepAcc" data-i18n="online:profile.keepForever">Keep it forever</button>
      <button class="btn ghost" id="btnHaveAcc" data-i18n="online:auth.alreadyHaveAccount">I already have an account</button>
    </div>
    <div class="err" id="onAccErr"></div>
    <!-- the foot is PINNED (user call): sign out and the delete footnote sit
         at the very bottom whatever the device leaves free, and the mini
         history above fills what remains. One wrapper so the pin holds
         whether or not Sign out is hidden (guests). -->
    <div class="accfoot">
      <button class="btn" id="btnSignOut" data-i18n="online:profile.signOut">Sign out</button>
      <!-- deleting is a FOOTNOTE, not an action to advertise: the same linkbtn
           row as home's legal links. The red lives on the confirm ask-card,
           where the player is actually deciding. Sign out stays the panel's
           last real button, always directly above it. -->
      <div class="viewfoot">
        <button class="linkbtn" id="btnDeleteAcc" data-i18n="online:profile.deleteAccount">Delete account</button>
      </div>
    </div>
  </div>

  <div class="panel" id="onAvatar" hidden>
    <div class="lbl" style="text-align:center" data-i18n="online:avatar.instruction">Pick a face and a colour</div>
    <div class="avpreview" id="avPreview"></div>
    <div class="avgrid" id="avFaces"></div>
    <div class="avgrid hues" id="avHues"></div>
    <div class="err" id="onAvErr"></div>
    <button class="btn primary" id="btnAvatarSave" data-i18n="online:avatar.save">Save</button>
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
  onAuth: { title: 'panels.signIn', back: true },
  onQueue: { title: 'panels.matchmaking', back: false },
  onBoard: { title: 'panels.ladder', back: true },
  onAccount: { title: 'panels.profile', back: true },
  onAvatar: { title: 'panels.avatar', back: true },
  onHistory: { title: 'panels.matchHistory', back: true },
} as const;

export type OnlinePanel = keyof typeof PANELS;
let activeTitle: LocaleKey<'online'> | null = null;
let activePanel: OnlinePanel | null = null;
let loadingFor: OnlinePanel | null = null;
let localeBound = false;

function paintPanelTitle(): void {
  if (activeTitle) $('#onTitle').textContent = t('online', activeTitle);
}

function paintOnlineShell(): void {
  const overlay = document.getElementById('ovOnline');
  if (overlay) translateDom(overlay);
  paintPanelTitle();
}

export function setOnlinePanelTitle(title: LocaleKey<'online'>): void {
  activeTitle = title;
  paintPanelTitle();
}

export function installOnlineShell(): void {
  appRoot().insertAdjacentHTML('beforeend', OVERLAY);
  translateDom($('#ovOnline'));
  if (!localeBound) {
    localeBound = true;
    subscribeLocale(paintOnlineShell);
  }
  const dice = $('#qDice');
  dice.appendChild(makeDie(2, ME));
  dice.appendChild(makeDie(6, AI));
  $('#onLoading').appendChild(loaderWait(56));
}

export function showOnlinePanel(which: OnlinePanel): void {
  activePanel = which;
  loadingFor = null;
  activeTitle = PANELS[which].title;
  hide('#ovLoad');
  $('#onLoading').hidden = true;
  for (const id of Object.keys(PANELS)) $('#' + id).hidden = id !== which;
  $('#ovOnline').classList.toggle('listview', which === 'onBoard' || which === 'onHistory');
  paintPanelTitle();
  ($('#btnOnlineBack') as HTMLElement).style.visibility = PANELS[which].back ? 'visible' : 'hidden';
  settleGlass('#ovOnline');
}

/** Hold one complete online view behind the shared, view-centred loading die. */
export function showOnlineLoading(which: OnlinePanel): void {
  activePanel = null;
  loadingFor = which;
  activeTitle = PANELS[which].title;
  hide('#ovLoad');
  for (const id of Object.keys(PANELS)) $('#' + id).hidden = true;
  $('#onLoading').hidden = false;
  $('#ovOnline').classList.remove('listview');
  paintPanelTitle();
  ($('#btnOnlineBack') as HTMLElement).style.visibility = PANELS[which].back ? 'visible' : 'hidden';
  settleGlass('#ovOnline');
}

/** Async painters may finish after Back or another panel has won the view. */
export function isOnlinePanelCurrent(which: OnlinePanel): boolean {
  return !!document.getElementById('ovOnline')?.classList.contains('on')
    && (activePanel === which || loadingFor === which);
}

// The online overlay: auth, matchmaking, ladder, account, match result.
// Injects its own markup on first open — the offline game never carries this
// DOM. Navigation model (design: 00-navigation): Home IS the online menu, so
// every deep link lands straight on its panel, one shared ‹ header goes back
// to Home, and matchmaking's only exit is Cancel (which truly leaves the
// queue). Match play itself lives in play.ts and hooks in via startQueue.
import './online.css';
import { ME, AI } from '../core/rules.ts';
import { $, show, hide } from '../ui/dom.ts';
import { loaderDie, loaderWait } from '../ui/loader.ts';
import { showEnd, setMeta, closeEnd } from '../ui/endscreen.ts';
import { Sfx } from '../ui/audio.ts';
import { makeDie } from '../ui/die.ts';
import { rankName, groupFill, peakState, inApex, boardGroup } from '../core/ladder.ts';
import { ask } from '../ui/askcard.ts';
import { REDUCED } from '../ui/fx.ts';
import { recordHtml } from '../ui/record.ts';
import { AV_HUES, DEFAULT_AVATAR, parseAvatar, paintAvatar } from '../ui/avatar.ts';
import { signUp, signIn, signOut, currentUser, ensureIdentity, attachEmail,
         myProfile, myRecord, claimName, leaderboard, deleteAccount, join, readyPeer,
         myLadder, myStanding, matchHistory, setAvatar, bestStreak, playerCard,
         type LeaderboardRow, type Ladder } from './session.ts';
import { availableTaps } from './identity.ts';
import { enterMatch, setFinishHandler, type FinishReport } from './play.ts';
import { spinDial } from '../ui/modedial.ts';
import { isNewcomer, offerTutorial } from '../ui/firstrun.ts';
import { S } from '../state.ts';
import { newGame } from '../flow/game.ts';
import { modeById } from '../core/modes.ts';
import { refreshHomeChip } from '../boot.ts';
import { saveStats } from '../persist.ts';

const OVERLAY = `
<div class="ov paged" id="ovOnline">
  <div class="shead">
    <button class="ico" id="btnOnlineBack" aria-label="Back">‹</button>
    <span class="ttl" id="onTitle">ONLINE</span><span class="pad"></span>
  </div>

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

  <div class="panel" id="onQueue" hidden>
    <div class="qdice" id="qDice"></div>
    <div class="qmsg">Looking for an opponent</div>
    <div class="qtime" id="qTime">0:00</div>
    <div class="qsub" id="qSub">&nbsp;</div>
    <button class="btn" id="btnQueueCancel">Cancel</button>
  </div>

  <div class="panel" id="onBoard" hidden>
    <div class="lbl" style="text-align:center">Season 1 · Ladder points</div>
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
    <button class="histrow" id="btnHistory">Match history <b id="accGames">–</b></button>
    <div class="accsince" id="accSince"></div>
    <div class="guestbox" id="accGuest" hidden>
      <b>GUEST</b>
      <p>This account lives on this device only. Delete the app and the rating goes with it.</p>
      <button class="btn primary" id="btnKeepAcc">Keep it forever</button>
      <button class="btn ghost" id="btnHaveAcc">I already have an account</button>
    </div>
    <!-- the ONE-TIME name claim: it wears the guestbox shape because it is the
         same kind of thing — a boxed offer on the profile — and it exists only
         while the name is still the minted placeholder. Once named_at is
         stamped (migration 0026) the card is gone for good, not disabled. -->
    <div class="guestbox namebox" id="accClaim" hidden>
      <b>CLAIM YOUR NAME</b>
      <p>One name per account — set once and kept for good. 3–16 letters, digits or underscores.</p>
      <input id="onNick" maxlength="16" autocomplete="off" spellcheck="false" autocapitalize="off">
      <div class="err" id="onNickErr"></div>
      <button class="btn primary" id="btnClaim">Claim name</button>
    </div>
    <div class="err" id="onAccErr"></div>
    <button class="btn" id="btnSignOut">Sign out</button>
    <div class="danger">
      <button class="btn" id="btnDeleteAcc">Delete account</button>
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

</div>`;

/* one shared header: each panel names itself; the ‹ hides where Cancel (or an
   explicit action) is the only sane exit. The result of a match is NOT a panel
   here — it is the game's one result screen (ui/endscreen), the same one local
   play ends on. */
const PANELS = {
  onAuth: { title: 'SIGN IN', back: true },
  onQueue: { title: 'MATCHMAKING', back: false },
  onBoard: { title: 'LADDER', back: true },
  onAccount: { title: 'PROFILE', back: true },
  onAvatar: { title: 'AVATAR', back: true },
  onHistory: { title: 'MATCH HISTORY', back: true },
} as const;
type Panel = keyof typeof PANELS;

function panel(which: Panel): void {
  // the boot loader (#ovLoad) covered the chunk download and the identity
  // round-trip; the first real panel is what relieves it
  hide('#ovLoad');
  for (const id of Object.keys(PANELS)) $('#' + id).hidden = id !== which;
  // the ladder is a LIST, not a form: it takes the whole screen under a fixed
  // subheading. Every other panel stays a centred column.
  $('#ovOnline').classList.toggle('listview', which === 'onBoard' || which === 'onHistory');
  $('#onTitle').textContent = PANELS[which].title;
  ($('#btnOnlineBack') as HTMLElement).style.visibility = PANELS[which].back ? 'visible' : 'hidden';
}

/* ---- the identity panel ----
   One panel, two jobs: ATTACHING an identity to the guest you already are, and
   RESTORING the account you made somewhere else. They share every pixel — the
   same inputs, the same error line, the same one-tap providers — and differ
   only in what the buttons do and where they land you afterwards. Two specs of
   one screen, never two screens. */
type AuthMode = 'attach' | 'restore';
interface AuthSpec {
  title: string;
  lead: string;
  tiny: string;
  /* null means "it worked, move on"; a string is shown and the player stays put
     — which is also how "check your email" reports itself, honestly */
  acts: { label: string; primary?: boolean; run: (email: string, pass: string) => Promise<string | null> }[];
  swap?: { label: string; to: AuthMode };
  after: () => Promise<void>;
}
const AUTH: Record<AuthMode, AuthSpec> = {
  attach: {
    title: 'KEEP ACCOUNT',
    lead: 'Add an email and this account survives a reinstall',
    tiny: 'Same account, same rating, same record —<br>you just gain a way back into it.',
    acts: [{ label: 'Keep this account', primary: true, run: attachEmail }],
    swap: { label: 'I already have an account', to: 'restore' },
    after: async () => { await showAccount(); },
  },
  restore: {
    title: 'SIGN IN',
    lead: 'Play ranked, climb the ladder',
    tiny: 'New accounts get a nickname like BoldRaven482 —<br>claim your own once in Account',
    acts: [
      { label: 'Sign in', primary: true, run: signIn },
      { label: 'Create account', run: async (e, p) => {
          const { error, live } = await signUp(e, p);
          if (error) return error;
          return live ? null : 'Account created — check your email to confirm, then sign in.';
        } },
    ],
    after: async () => { await entered(); },
  },
};

/* one continuation for every way a session can start: warm the chip and go
   wherever the tap was headed */
async function entered(): Promise<void> {
  const v = pendingView; pendingView = null;
  await myProfile();           // warms the home-chip cache
  refreshHomeChip();
  await route(v ?? 'play');
}

function authPanel(mode: AuthMode): void {
  const spec = AUTH[mode];
  panel('onAuth');
  $('#onTitle').textContent = spec.title;
  $('#onAuthLead').textContent = spec.lead;
  $('#onAuthTiny').innerHTML = spec.tiny;
  $('#onAuthErr').textContent = '';
  const acts = $('#onAuthActs');
  acts.innerHTML = '';
  const creds = () => [($('#onEmail') as HTMLInputElement).value.trim(),
                       ($('#onPass') as HTMLInputElement).value] as const;
  for (const a of spec.acts) {
    const b = document.createElement('button');
    b.className = 'btn' + (a.primary ? ' primary' : '');
    b.textContent = a.label;
    b.addEventListener('click', async () => {
      Sfx.tap();
      $('#onAuthErr').textContent = '';
      b.disabled = true;
      const msg = await a.run(...creds());
      b.disabled = false;
      if (msg) { $('#onAuthErr').textContent = msg; return; }
      await spec.after();
    });
    acts.appendChild(b);
  }
  const swap = $('#btnAuthSwap') as HTMLButtonElement;
  swap.hidden = !spec.swap;
  if (spec.swap) { swap.textContent = spec.swap.label; swap.onclick = () => { Sfx.tap(); authPanel(spec.swap!.to); }; }
  oneTapRow(mode);
}

/* whatever this device can do without typing. `mode` names the method to call
   because the registry's two verbs ARE the panel's two jobs — attach on a guest,
   restore on a fresh install. */
function oneTapRow(mode: AuthMode): void {
  const row = $('#onOneTap');
  row.innerHTML = '';
  for (const m of availableTaps()) {
    const b = document.createElement('button');
    b.className = 'btn tap ' + m.id;
    b.textContent = m.label;
    b.addEventListener('click', async () => {
      Sfx.tap();
      $('#onAuthErr').textContent = '';
      b.disabled = true;
      const msg = await m[mode]();
      b.disabled = false;
      if (msg) { $('#onAuthErr').textContent = msg; return; }
      await AUTH[mode].after();
    });
    row.appendChild(b);
  }
}

/* every way home funnels through here — leaving the queue included, so a
   dismissed overlay can never yank the player back into a match */
function goHome(): void {
  stopQueue();
  hide('#ovOnline');
  show('#ovStart');
}

/* ---- matchmaking: poll join; the clock and the widening message are honest */
let queueAbort = false;
let qTick: ReturnType<typeof setInterval> | null = null;
function stopQueue(): void {
  queueAbort = true;
  if (qTick) { clearInterval(qTick); qTick = null; }
}
async function startQueue(): Promise<void> {
  /* The offer comes BEFORE matchmaking, never after: nobody wants a tutorial
     pitched at them while a real opponent waits on a five-second countdown. */
  if (isNewcomer() && await offerTutorial()) {
    goHome();
    newGame({ tutorial: true });
    return;
  }
  panel('onQueue');
  queueAbort = false;
  const started = Date.now();
  $('#qTime').textContent = '0:00';
  $('#qSub').innerHTML = '&nbsp;';
  if (qTick) clearInterval(qTick);
  qTick = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    $('#qTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    if (s >= 7) $('#qSub').textContent = 'Inviting anyone available…';
  }, 250);
  while (!queueAbort) {
    const waited = Date.now() - started;
    const res = await join(waited > 7000);
    if (queueAbort) break;
    if (res?.status === 'matched') {
      stopQueue();
      // fresh match: the wheel reveal (aimed at the server's stored pick);
      // rejoining skips the show — the mode was revealed when the match began
      if (!res.rejoined) {
        hide('#ovOnline');
        // res.you is MY seat; the opponent is the other one
        const mine = res.you === 1 ? 'p1' : 'p2';
        const theirs = mine === 'p1' ? 'p2' : 'p1';
        /* both sides come from the join response — pvp-join hands over name,
           rating and chosen avatar for the pair, so the versus line shows the
           same faces the leaderboard does, mine included and never stale */
        const side = (seat: 'p1' | 'p2') => ({
          name: res.names[seat], rating: res.names.ratings?.[seat] ?? null,
          avatar: res.names.avatars?.[seat] ?? null });
        await spinDial(modeById(res.match.modifier), {
          me: side(mine), foe: side(theirs),
          peer: readyPeer(res.match.id),
        });
      }
      await enterMatch(res);
      return;
    }
    await new Promise(r => setTimeout(r, 2500));
  }
  stopQueue();
}

/* ---- ladder ---- */
const esc = (s: string) => s.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const pts = (n: number): string => n.toLocaleString('en');

/* the distance to me, signed: magenta above, cyan below — the duel palette
   doing the talking. A distance is all it may name: what a match would PAY is
   never previewed anywhere, because it depends on the opponent. */
const gapHtml = (d: number): string =>
  d > 0 ? `<span class="gap"><b>+${pts(d)}</b> on you</span>`
  : d < 0 ? `<span class="gap"><b class="down">−${pts(-d)}</b> behind</span>`
  : `<span class="gap">level with you</span>`;

/* The board (design 33g): ONE continuous scroll from the apex to the floor.
   Groups are horizons — labelled boundaries where the material changes — and
   for a signed-in player every row states its distance to THEM, the list
   opening centred on their row: the race you are in is against the players a
   few dozen points either side, so that is where the screen opens. Signed out
   (the board is public and must cost the reader nothing) rows state the
   record, and no row is yours. */
async function showBoard(): Promise<void> {
  panel('onBoard');
  const list = $('#onBoardList');
  // the wait wears the loading die (ui/loader.ts), centred — no bare text
  list.innerHTML = '';
  const lw = loaderWait(44);
  lw.classList.add('lbload');
  list.appendChild(lw);
  const [rows, me, lad] = await Promise.all([leaderboard(50), myProfile(), myLadder()]);
  list.innerHTML = rows.length ? '' : '<div class="row">No ranked games yet — be the first!</div>';
  /* which horizon may claim "your group": my row's if I am on the board, my
     points' otherwise — a signed-in player low on games still lives somewhere */
  const myRow = me ? rows.find((r) => r.nickname === me.nickname) ?? null : null;
  const myG = myRow ? boardGroup(myRow.points, myRow.apex) : lad ? boardGroup(lad.points, false) : null;
  let horizon = '';
  let meEl: HTMLElement | null = null;
  for (const r of rows) {
    const g = boardGroup(r.points, r.apex);
    if (g.id !== horizon) {
      horizon = g.id;
      const h = document.createElement('div');
      h.className = 'ghor' + (g.id === 'neon' ? ' apex' : '');
      h.style.setProperty('--gc', `var(--g-${g.id})`);
      const sub = g.id === 'neon' ? 'top 1% of the season'
        : g.floor === 0 ? 'the floor is 0'
        : `${pts(g.floor)} and up`;
      h.innerHTML = `<span class="gn">${g.name}</span>` +
        `<span class="gf">${sub}${lad && myG === g ? ' · your group' : ''}</span>`;
      list.appendChild(h);
    }
    const isMe = !!me && r.nickname === me.nickname;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lrow' + (isMe ? ' me' : '');
    b.style.setProperty('--gc', `var(--g-${g.id})`);
    /* the row's text is spans a screen reader would run together — name the
       button as the sentence it means */
    b.setAttribute('aria-label', isMe
      ? `${r.nickname} — you, rank ${r.rank}, ${g.name}. Open your profile`
      : `${r.nickname}, rank ${r.rank}, ${g.name}, ${pts(r.points)} points. Compare`);
    if (isMe) {
      const state = r.apex ? 'top 1%' : `${Math.round(groupFill(r.points) * 100)}% through`;
      b.innerHTML = `<span class="av"></span><span class="nmwrap"><span class="nm">${esc(r.nickname)}</span>` +
        `<span class="mesub"><b>${g.name}</b> · ${state} · ${recordHtml(r.wins, r.losses)}</span></span>` +
        `<span class="ptcol"><span class="pt2">${pts(r.points)}</span><span class="rk2">Rank #${r.rank}</span></span>`;
      meEl = b;
    } else {
      const mid = lad ? gapHtml(r.points - lad.points)
        : `<span class="ws">${recordHtml(r.wins, r.losses)}</span>`;
      b.innerHTML = `<span class="rank">${r.rank}</span><span class="av"></span>` +
        `<span class="nm">${esc(r.nickname)}</span>${mid}<span class="rt">${pts(r.points)}</span>`;
    }
    paintAvatar(b.querySelector('.av') as HTMLElement, r.avatar, isMe ? 34 : 24);
    b.addEventListener('click', () => {
      Sfx.tap();
      /* my own row is the door to my profile — a face-off against yourself
         answers nothing */
      if (isMe) { void showAccount(); return; }
      showFaceoff(r, me && lad ? { name: me.nickname, avatar: me.avatar ?? null, lad } : null);
    });
    list.appendChild(b);
  }
  meEl?.scrollIntoView({ block: 'center' });
}

/* ---- the face-off (design 33e): the tapped player dealt against YOU, stat
   for stat — their column gold, yours cyan. The card paints instantly from
   what the board row already carries; the streak (the one fact with its own
   RPC) and my exact rank land as they arrive. With no ranked self to compare
   the card is one column, labels leading. */
interface MySide { name: string; avatar: string | null; lad: Ladder }
function showFaceoff(r: LeaderboardRow, mine: MySide | null): void {
  const g = boardGroup(r.points, r.apex);
  const mg = mine ? boardGroup(mine.lad.points, false) : null;
  const mGames = mine ? mine.lad.wins + mine.lad.losses + mine.lad.draws : 0;
  const rate = (w: number, games: number): string => (games ? Math.round((w / games) * 100) + '%' : '–');
  const stat = (k: string, a: string, b?: string | false | null): string =>
    `<div class="fost"><span class="a">${a}</span><span class="k">${k}</span>` +
    (mine ? `<span class="b">${b || '–'}</span>` : '') + '</div>';
  const ov = document.createElement('div');
  ov.className = 'faceoff' + (mine ? '' : ' solo');
  ov.innerHTML = `<div class="focard" role="dialog" aria-modal="true" tabindex="-1" aria-label="${esc(r.nickname)}">
    <div class="focols dice-static">
      <div class="focol" style="--gc:var(--g-${g.id})">
        <span class="av"></span><span class="fnm">${esc(r.nickname)}</span>
        <span class="fgp">${g.name} · #${r.rank}</span>
      </div>` + (mine ? `
      <span class="fovs">VS</span>
      <div class="focol you" style="--gc:var(--g-${mg!.id})">
        <span class="av"></span><span class="fnm">${esc(mine.name)}</span>
        <span class="fgp">${mg!.name}</span>
      </div>` : '') + `
    </div>
    <div class="fostats">
      ${stat('Points', pts(r.points), mine && pts(mine.lad.points))}
      ${stat('Record', recordHtml(r.wins, r.losses), mine && recordHtml(mine.lad.wins, mine.lad.losses))}
      ${stat('Best streak', '<span class="fostreak">–</span>', mine && '<span class="mystreak">–</span>')}
      ${stat('Peak', pts(r.peak), mine && pts(mine.lad.peak))}
      ${stat('Win rate', rate(r.wins, r.games), mine && rate(mine.lad.wins, mGames))}
    </div>` +
    (mine ? `<div class="fogap">${
      r.points === mine.lad.points ? 'Level with you'
        : `<b>${pts(Math.abs(r.points - mine.lad.points))} points</b> between you`}</div>` : '') +
    '<button class="btn foexit">Close</button></div>';
  const close = (): void => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', (e) => { if (e.target === ov) { Sfx.tap(); close(); } });
  (ov.querySelector('.foexit') as HTMLButtonElement).addEventListener('click', () => { Sfx.tap(); close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  // the streak cells carry the loading die until their RPCs answer — the
  // card paints instantly from row data, so these are its only true waits
  for (const sel of mine ? ['.fostreak', '.mystreak'] : ['.fostreak']) {
    (ov.querySelector(sel) as HTMLElement).replaceChildren(loaderDie(16));
  }
  paintAvatar(ov.querySelector('.focol .av') as HTMLElement, r.avatar, 46);
  if (mine) paintAvatar(ov.querySelector('.focol.you .av') as HTMLElement, mine.avatar, 46);
  (ov.querySelector('.focard') as HTMLElement).focus();
  /* The late facts land TOGETHER. Three RPCs answer at three speeds, and on a
     fast network the drizzle of separate arrivals — their streak, my streak,
     my rank — read as flicker. The card waits for the slowest and paints once;
     an answer that beats the loader's grace (ldreveal, styles/main.css) means
     no wait was ever visible at all. */
  void Promise.all([playerCard(r.nickname),
    mine ? bestStreak() : null, mine ? myStanding() : null,
  ]).then(([pc, streak, st]) => {
    const el = ov.querySelector('.fostreak');
    if (el) el.textContent = pc ? String(pc.streak) : '–';   // never leave the die spinning over nothing
    if (!mine) return;
    const ms = ov.querySelector('.mystreak');
    if (ms && streak != null) ms.textContent = String(streak);
    const gp = ov.querySelector('.focol.you .fgp');
    if (gp && st) gp.textContent += ` · #${st.rank}`;
  });
}

/* The ring sweeps up to its value when the screen opens. It is not decoration:
   group promotions are 37 to ~120 games apart, so this fill is the ladder's
   only continuous feedback, and a number that is simply THERE on arrival never
   reads as progress. Tweened in JS rather than by a CSS transition because a
   conic-gradient's angle stop does not interpolate reliably across engines.
   It tweens from wherever the ring IS — the caller decides whether a sweep
   starts empty (opening the screen) or continues (fresh data landing) — and a
   second call simply takes the ring over mid-flight. */
const ringRun = new WeakMap<HTMLElement, number>();
function fillRing(ring: HTMLElement, to: number): void {
  const run = (ringRun.get(ring) ?? 0) + 1;
  ringRun.set(ring, run);
  const from = parseFloat(ring.style.getPropertyValue('--p')) || 0;
  if (REDUCED || Math.abs(to - from) < 0.002) { ring.style.setProperty('--p', String(to)); return; }
  const t0 = performance.now(), DUR = 850;
  const step = (now: number): void => {
    if (ringRun.get(ring) !== run) return;   // a newer sweep owns the ring now
    const t = Math.min(1, (now - t0) / DUR);
    ring.style.setProperty('--p', String(from + (to - from) * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---- the profile ---- */
async function showAccount(): Promise<void> {
  panel('onAccount');
  $('#onAccErr').textContent = '';
  /* The ring's choreography, BEFORE any await. The element still wears last
     visit's fill, so left alone it showed stale progress for as long as the
     network took, then jumped to zero and re-swept — a flicker the player read
     as a reset. Empty it synchronously and start the sweep at once from the
     same cache the home plate paints; the fresh row then tweens from wherever
     the sweep has reached, which for an unchanged score is no motion at all. */
  const ring = $('#accRing') as HTMLElement;
  ring.classList.remove('haspeak');
  ring.style.setProperty('--p', '0');
  try {
    const cached = JSON.parse(localStorage.getItem('knucklebones.online.profile') ?? 'null')?.rating;
    if (typeof cached === 'number') {
      fillRing(ring, groupFill(cached));
      $('#accPoints').textContent = cached.toLocaleString('en');
      $('#accGroup').textContent = rankName(cached);
    }
  } catch { /* forgetful host — the fresh row below paints everything anyway */ }
  const [p, who] = await Promise.all([myProfile(), currentUser()]);
  refreshHomeChip();
  /* a guest is offered the way up; "Sign out" is hidden from them because for
     an account with no identity it does not sign out, it throws away */
  $('#accGuest').hidden = !who?.guest;
  ($('#btnSignOut') as HTMLElement).hidden = !!who?.guest;
  $('#accName').textContent = p?.nickname ?? '';
  /* the claim card shows only while the name is still the minted placeholder;
     with no profile row there is nothing to claim against */
  const claim = $('#accClaim');
  claim.hidden = !p || !!p.named_at;
  if (!claim.hidden) {
    /* the placeholder is the name you keep by never claiming */
    ($('#onNick') as HTMLInputElement).placeholder = p!.nickname;
    $('#onNickErr').textContent = '';
  }
  paintAvatar($('#accDie'), p?.avatar ?? DEFAULT_AVATAR);
  /* "Member since" is a claim about an account that will still be there — a
     guest's lives on this device only, so the line would be a promise nobody
     made. Hidden for them until they keep it. */
  $('#accSince').textContent = (!who?.guest && p?.created_at)
    ? 'Member since ' + new Date(p.created_at).toLocaleDateString('en', { month: 'long', year: 'numeric' })
    : '';

  /* the ladder, painted from core/ladder.ts so the client cannot disagree with
     the server about what a number means */
  const [lad, st, streak] = await Promise.all([myLadder(), myStanding(), bestStreak()]);
  const pts = lad?.points ?? 0, peak = lad?.peak ?? 0;
  $('#accPoints').textContent = pts.toLocaleString('en');
  $('#accGroup').textContent = rankName(pts);
  $('#accPeak').textContent = peak.toLocaleString('en');
  const games = lad ? lad.wins + lad.losses + lad.draws : 0;
  $('#accGames').textContent = games ? `${games} games ›` : 'none yet ›';
  const apex = st ? inApex(pts, st.rank, st.population) : false;
  $('#accRank').textContent = st && games ? (apex ? 'NEON' : '#' + st.rank) : '–';
  $('#accStreak').textContent = String(streak);

  /* One continuous fill, and the peak notch in its three states (LADDER.md §5):
     at your position it is redundant, ahead it sits where it really is, and in
     a HIGHER group it pins to the far right — your best is beyond this ring. */
  const ps = peakState(pts, peak);
  fillRing(ring, groupFill(pts));
  ring.classList.toggle('haspeak', ps.kind !== 'at');
  if (ps.kind === 'ahead') ring.style.setProperty('--pk', String(ps.fill));
  if (ps.kind === 'above') ring.style.setProperty('--pk', '1');
}

/* ---- the avatar picker ---- */
let avPick = DEFAULT_AVATAR;
async function showAvatar(): Promise<void> {
  panel('onAvatar');
  $('#onAvErr').textContent = '';
  // first open: the grids don't exist until the profile answers — the
  // preview slot carries the wait (paintAvatar clears it when data lands)
  const pv = $('#avPreview');
  if (!pv.firstChild) pv.appendChild(loaderDie(40));
  const p = await myProfile();
  avPick = p?.avatar ?? DEFAULT_AVATAR;
  const draw = (): void => {
    const cur = parseAvatar(avPick);
    paintAvatar($('#avPreview'), avPick, 86);
    $('#avFaces').querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', +(b as HTMLElement).dataset.face! === cur.face));
    $('#avHues').querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', (b as HTMLElement).dataset.hue === cur.hue));
  };
  if (!$('#avFaces').firstChild) {
    for (let f = 1; f <= 6; f++) {
      const b = document.createElement('button');
      b.dataset.face = String(f);
      b.appendChild(makeDie(f, ME));
      b.addEventListener('click', () => {
        Sfx.tap(); avPick = `die:${f}:${parseAvatar(avPick).hue}`; draw();
      });
      $('#avFaces').appendChild(b);
    }
    for (const hue of Object.keys(AV_HUES)) {
      const b = document.createElement('button');
      b.dataset.hue = hue;
      b.className = 'hue';
      b.style.setProperty('--h', AV_HUES[hue]);
      b.addEventListener('click', () => {
        Sfx.tap(); avPick = `die:${parseAvatar(avPick).face}:${hue}`; draw();
      });
      $('#avHues').appendChild(b);
    }
  }
  draw();
}

/* ---- match history: what each match ACTUALLY paid ---- */
async function showHistory(): Promise<void> {
  panel('onHistory');
  /* header and list speak the SAME season now (migration 0025): the tally
     comes from season_ratings and the RPC scopes its rows to match. The Elo
     era was retired into season 0 at the cutover, not deleted — myRecord()
     counts lifetime, and the difference is named at the foot of the list so
     a hundred old matches read as history, never as a leak or a loss. */
  // the loading die goes up BEFORE the first fetch and holds through both —
  // the bare 'Loading…' text row this replaces only covered the second half
  const list = $('#onHistoryList');
  list.innerHTML = '';
  const hw = loaderWait(36);
  hw.classList.add('lbload');
  list.appendChild(hw);
  const [lad, life] = await Promise.all([myLadder(), myRecord()]);
  $('#onHistoryTotal').innerHTML = lad
    ? recordHtml(lad.wins, lad.losses) + (lad.draws ? ` · ${lad.draws}D` : '')
    : '&nbsp;';
  const rows = await matchHistory();
  const seasonGames = lad ? lad.wins + lad.losses + lad.draws : 0;
  const lifeGames = life ? life.wins + life.losses + life.draws : 0;
  const retired = Math.max(0, lifeGames - seasonGames);
  list.innerHTML = rows.length ? '' : '<div class="row">No ranked matches this season.</div>';
  for (const r of rows) {
    const div = document.createElement('div');
    div.className = 'row hrow ' + r.result;
    const when = r.when ? new Date(r.when).toLocaleDateString('en', { day: 'numeric', month: 'short' }) : '';
    const sign = r.delta > 0 ? '+' : '';
    div.innerHTML =
      `<span class="hres">${r.result === 'win' ? 'W' : r.result === 'loss' ? 'L' : 'D'}</span>` +
      `<span class="nm">${esc(r.opponent)}</span>` +
      `<span class="hsc">${r.mine}–${r.theirs}</span>` +
      `<span class="hd">${sign}${r.delta}</span>` +
      `<span class="hwhen">${when}</span>`;
    list.appendChild(div);
  }
  if (retired > 0) {
    const div = document.createElement('div');
    div.className = 'hretired';
    div.textContent = `Pre-season · ${retired} ${retired === 1 ? 'match' : 'matches'} · kept, not counted`;
    list.appendChild(div);
  }
}

/* ---- match result: the SAME screen local play ends on (ui/endscreen), filled
   with what ranked has to add — what the match PAID and where it leaves you.
   That number is the only honest points figure in the app: nothing is ever
   previewed before a match, because what one is worth depends on the opponent.
   Everything paints INSTANTLY: the chip uses the cached points plus the known
   delta, and the fresh fetches merely correct and append. ---- */
async function showResult(r: FinishReport): Promise<void> {
  hide('#ovOnline');
  const title = r.draw ? 'DEAD HEAT' : r.won ? 'VICTORY' : 'DEFEAT';
  const deltaTxt = r.delta != null ? ` · ${r.delta >= 0 ? '+' : ''}${r.delta} points` : '';
  /* the context line, as HTML — the one thing ranked shows that local play
     does not. Rebuilt whenever a better number arrives. */
  const metaHtml = (points: number | null, rank: number | null, group: string | null) =>
    (r.delta == null ? '' :
      `<span class="elochip${r.delta < 0 ? ' down' : ''}">${r.delta >= 0 ? '+' : ''}${r.delta}` +
      ` <small>PTS${points != null ? ' · ' + points.toLocaleString('en') : ''}</small></span>`) +
    (group ? `<span class="rrank">${group}${rank != null ? ` · <b>#${rank}</b>` : ''}</span>`
           : rank != null ? `<span class="rrank">Ladder: <b>#${rank}</b></span>` : '');
  let cachedRating: number | null = null;
  try {
    const c = JSON.parse(localStorage.getItem('knucklebones.online.profile') ?? 'null');
    if (typeof c?.rating === 'number' && r.delta != null) cachedRating = c.rating + r.delta;
  } catch { /* forgetful host */ }
  showEnd({
    outcome: r.draw ? 'draw' : r.won ? 'win' : 'lose',
    title,
    sub: r.forfeit ? (r.won ? r.opp + ' forfeited' : 'Match forfeited')
       : r.draw ? 'Down to the last die'
       : r.won ? 'You out-rolled ' + r.opp : r.opp + ' takes it',
    you:  { score: r.my, label: 'You' },
    them: { score: r.their, label: r.opp },
    meta: metaHtml(cachedRating, null, cachedRating != null ? rankName(cachedRating) : null),
    again: { label: 'Next duel', run: () => { closeEnd(); show('#ovOnline'); void route('play'); } },
    home:  { label: 'Home', run: () => { closeEnd(); goHome(); } },
    share: `${title} ${r.my}–${r.their} vs ${r.opp}${deltaTxt} — Knucklebones, ranked dice duels`,
  });
  /* the standing RPC knows the rank directly — no scanning a leaderboard page
     for your own nickname, which silently found nothing past rank 50 */
  const [p, st] = await Promise.all([myProfile(), myStanding()]);
  refreshHomeChip();
  const pts = st?.points ?? p?.rating ?? cachedRating;
  setMeta(metaHtml(pts, st?.rank ?? null, pts != null ? rankName(pts) : null));
}

let bound = false;
function bind(): void {
  if (bound) return;
  bound = true;
  document.body.insertAdjacentHTML('beforeend', OVERLAY);
  const qd = $('#qDice');
  qd.appendChild(makeDie(2, ME));
  qd.appendChild(makeDie(6, AI));

  /* ‹ climbs ONE level: the avatar picker and the history list are opened FROM
     the profile, so they return to it rather than dropping the player home. */
  $('#btnOnlineBack').addEventListener('click', () => {
    Sfx.tap();
    const sub = !$('#onAvatar').hidden || !$('#onHistory').hidden;
    if (sub) void showAccount(); else goHome();
  });

  $('#btnKeepAcc').addEventListener('click', () => { Sfx.tap(); authPanel('attach'); });
  $('#btnHaveAcc').addEventListener('click', () => { Sfx.tap(); authPanel('restore'); });

  $('#btnClaim').addEventListener('click', async () => {
    Sfx.tap();
    const name = ($('#onNick') as HTMLInputElement).value.trim();
    /* checked here so an empty tap answers instantly; the server's CHECK
       constraint remains the authority */
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      $('#onNickErr').textContent = '3–16 letters, digits or underscores.';
      return;
    }
    /* deliberate, but not a warning: the body copy carries the forever-ness,
       and the claim is the answer the player came here to give — so it wears
       the primary look and "Not yet" goes quiet (user call). */
    const go = await ask({
      head: `Play as ${name}?`,
      body: 'A name is claimed once and kept for good. It cannot be edited or claimed again later.',
      confirm: 'Claim it',
      cancel: 'Not yet',
      loud: true,
    });
    if (!go) return;
    const btn = $('#btnClaim') as HTMLButtonElement;
    btn.disabled = true;
    const err = await claimName(name);
    if (err) { btn.disabled = false; $('#onNickErr').textContent = err; return; }
    /* retire the card and seat the headline NOW — a slow refresh must not
       leave an enabled button offering a second claim of a spent right */
    $('#accClaim').hidden = true;
    $('#accName').textContent = name;
    btn.disabled = false;
    await showAccount();
    /* a guest just chained a forever-name to a device-only account — that
       contradiction is the invitation. Same shared ask-card, same way up
       as KEEP IT FOREVER. */
    const who = await currentUser();
    if (who?.guest) {
      const up = await ask({
        head: `Keep ${name} forever?`,
        body: 'Your account lives on this device only — and the name you just claimed lives with it. '
          + 'Add an email and both survive anything.',
        confirm: 'Create account',
        cancel: 'Not now',
        loud: true, // an invitation: the yes wears the primary look
      });
      if (up) authPanel('attach');
    }
  });
  $('#btnSignOut').addEventListener('click', async () => { Sfx.tap(); await signOut(); refreshHomeChip(); authPanel('restore'); });
  $('#btnAvatar').addEventListener('click', () => { Sfx.tap(); void showAvatar(); });
  $('#btnHistory').addEventListener('click', () => { Sfx.tap(); void showHistory(); });
  $('#btnLadder').addEventListener('click', () => { Sfx.tap(); void showBoard(); });
  $('#btnAvatarSave').addEventListener('click', async () => {
    Sfx.tap();
    const err = await setAvatar(avPick);
    if (err) { $('#onAvErr').textContent = err; return; }
    await showAccount();
  });

  /* Deletion goes through the SAME ask-card the HUD's quit uses (ui/askcard),
     with the checkbox guard turned on. It used to be a two-tap arm on the
     button itself, which asks for a second tap in the very place the first one
     landed — the one gesture a mis-tap repeats for free. A tick is a different
     act in a different place, which is what an irreversible answer deserves. */
  $('#btnDeleteAcc').addEventListener('click', async () => {
    Sfx.tap();
    const go = await ask({
      head: 'Delete your account?',
      body: 'Your profile, your matches and your ladder points are removed from the '
        + 'server. There is no undo, and nothing can be restored afterwards.',
      confirm: 'Delete everything',
      cancel: 'Keep my account',
      danger: true,
      check: 'I understand this cannot be undone',
    });
    if (!go) return;
    const err = await deleteAccount();
    if (err) { $('#onAccErr').textContent = err; return; }
    refreshHomeChip();
    authPanel('restore');
  });

  $('#btnQueueCancel').addEventListener('click', () => { Sfx.tap(); goHome(); });

  // a finished match lands on the Result screen, not on a menu
  setFinishHandler((r) => { S.played = true; saveStats(); void showResult(r); });
}

/* entry point, dynamically imported from boot. The home's buttons deep-link:
   'play' goes straight into matchmaking, 'board'/'account' to their panels —
   there is no intermediate online menu; Home is the menu. */
export type OnlineView = 'play' | 'board' | 'account';
let pendingView: OnlineView | null = null;

async function route(view: OnlineView): Promise<void> {
  if (view === 'board') return showBoard();
  if (view === 'account') return showAccount();
  return startQueue();
}

export async function openOnline(view: OnlineView = 'play'): Promise<void> {
  bind();
  show('#ovOnline');
  // the ladder is public (its RPC is granted to anon) — reading it must not
  // cost the reader an account
  if (view === 'board') { pendingView = null; return showBoard(); }
  /* everything else needs a player, so BE one: a first-timer becomes a guest
     here and never sees a form. Only a project with anonymous sign-ins switched
     off falls through to the panel — which is exactly how this behaved before
     guests existed, so the fallback is the old, working path. */
  const who = await ensureIdentity();
  if (who) { pendingView = null; return route(view); }
  pendingView = view;
  authPanel('restore');
}

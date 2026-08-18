// The online overlay: auth, matchmaking, ladder, account, match result.
// Injects its own markup on first open — the offline game never carries this
// DOM. Navigation model (design: 00-navigation): Home IS the online menu, so
// every deep link lands straight on its panel, one shared ‹ header goes back
// to Home, and matchmaking's only exit is Cancel (which truly leaves the
// queue). Match play itself lives in play.ts and hooks in via startQueue.
import './online.css';
import { ME, AI } from '../core/rules.ts';
import { $, show, hide } from '../ui/dom.ts';
import { Sfx } from '../ui/audio.ts';
import { makeDie } from '../ui/die.ts';
import { signUp, signIn, signOut, currentUser, myProfile, myRecord, rename, leaderboard, deleteAccount, join } from './session.ts';
import { enterMatch, setFinishHandler, type FinishReport } from './play.ts';
import { spinWheel } from './wheel.ts';
import { modeById } from '../core/modes.ts';
import { refreshHomeChip } from '../boot.ts';

const OVERLAY = `
<div class="ov paged" id="ovOnline">
  <div class="shead">
    <button class="ico" id="btnOnlineBack" aria-label="Back">‹</button>
    <span class="ttl" id="onTitle">ONLINE</span><span class="pad"></span>
  </div>

  <div class="panel" id="onAuth" hidden>
    <div class="lbl" style="text-align:center">Play ranked, climb the ladder</div>
    <input id="onEmail" type="email" autocomplete="email" placeholder="email">
    <input id="onPass" type="password" autocomplete="current-password" placeholder="password (8+)">
    <div class="err" id="onAuthErr"></div>
    <button class="btn primary" id="btnSignIn">Sign in</button>
    <button class="btn" id="btnSignUp">Create account</button>
    <div class="tiny">New accounts get a nickname like BoldRaven482 —<br>change it any time in Account</div>
  </div>

  <div class="panel" id="onQueue" hidden>
    <div class="qdice" id="qDice"></div>
    <div class="qmsg">Looking for an opponent</div>
    <div class="qtime" id="qTime">0:00</div>
    <div class="qsub" id="qSub">&nbsp;</div>
    <button class="btn" id="btnQueueCancel">Cancel</button>
  </div>

  <div class="panel" id="onBoard" hidden>
    <div class="lbl" style="text-align:center">Season 1 · Elo rating</div>
    <div class="lb neonscroll" id="onBoardList"></div>
  </div>

  <div class="panel" id="onAccount" hidden>
    <div class="acard">
      <div class="awho"><span id="accDie"></span><span class="meta"><span class="nm" id="accName"></span><span class="sub" id="accSince"></span></span></div>
      <div class="statrow"><span>RATING</span><b id="accRating">–</b></div>
      <div class="statrow"><span>RECORD</span><b class="rec2" id="accRecord">–</b></div>
    </div>
    <div class="lbl">Nickname</div>
    <input id="onNick" maxlength="16" autocomplete="off">
    <div class="err" id="onAccErr"></div>
    <button class="btn" id="btnRename">Save name</button>
    <button class="btn" id="btnSignOut">Sign out</button>
    <div class="danger">
      <button class="btn" id="btnDeleteAcc">Delete account</button>
      <div class="dnote">Two taps. Removes your profile, matches and rating — permanently.</div>
    </div>
  </div>

  <div class="panel" id="onResult" hidden>
    <div class="rtitle" id="rTitle"></div>
    <div class="rsub" id="rSub"></div>
    <div class="rline">
      <span class="sc"><span class="you" id="rMy">0</span><em>You</em></span>
      <span class="vs">VS</span>
      <span class="sc"><span class="cpu" id="rTheir">0</span><em id="rOpp"></em></span>
    </div>
    <div class="elochip" id="rElo" hidden></div>
    <div class="rrank" id="rRank" hidden></div>
    <button class="btn primary" id="btnResultAgain">Play again</button>
    <button class="btn" id="btnResultHome">Home</button>
    <button class="linkbtn" id="btnShare">Share result</button>
  </div>
</div>`;

/* one shared header: each panel names itself; the ‹ hides where Cancel (or an
   explicit action) is the only sane exit, and the Result panel is chromeless */
const PANELS = {
  onAuth: { title: 'SIGN IN', back: true },
  onQueue: { title: 'MATCHMAKING', back: false },
  onBoard: { title: 'LADDER', back: true },
  onAccount: { title: 'ACCOUNT', back: true },
  onResult: { title: '', back: false },
} as const;
type Panel = keyof typeof PANELS;

function panel(which: Panel): void {
  for (const id of Object.keys(PANELS)) $('#' + id).hidden = id !== which;
  // the ladder is a LIST, not a form: it takes the whole screen under a fixed
  // subheading. Every other panel stays a centred column.
  $('#ovOnline').classList.toggle('listview', which === 'onBoard');
  $('#onTitle').textContent = PANELS[which].title;
  ($('#btnOnlineBack') as HTMLElement).style.visibility = PANELS[which].back ? 'visible' : 'hidden';
  (document.querySelector('#ovOnline .shead') as HTMLElement).style.visibility =
    which === 'onResult' ? 'hidden' : 'visible';
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
      if (!res.rejoined) { hide('#ovOnline'); await spinWheel(modeById(res.match.modifier)); }
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

async function showBoard(): Promise<void> {
  panel('onBoard');
  const list = $('#onBoardList');
  // the wait wears the game's own bouncing dice, centred — no bare text
  list.innerHTML = '<div class="lbload"><div class="qdice" aria-hidden="true"></div><div class="qmsg">Loading</div></div>';
  (list.querySelector('.qdice') as HTMLElement).append(makeDie(3, ME), makeDie(5, AI));
  const [rows, me] = await Promise.all([leaderboard(50), myProfile()]);
  list.innerHTML = rows.length ? '' : '<div class="row">No ranked games yet — be the first!</div>';
  rows.forEach((r, i) => {
    const div = document.createElement('div');
    div.className = 'row' + (i < 3 ? ' top' : '') + (me && r.nickname === me.nickname ? ' me' : '');
    div.innerHTML = `<span class="rank">${i + 1}</span><span class="nm">${esc(r.nickname)}</span>` +
      `<span class="ws">${r.wins}W/${r.games}</span><span class="rt">${r.rating}</span>`;
    list.appendChild(div);
  });
}

/* ---- account ---- */
async function showAccount(): Promise<void> {
  panel('onAccount');
  $('#onAccErr').textContent = '';
  const dieSlot = $('#accDie');
  if (!dieSlot.firstChild) dieSlot.appendChild(makeDie(5, ME));
  const p = await myProfile();
  refreshHomeChip();
  ($('#onNick') as HTMLInputElement).value = p?.nickname ?? '';
  $('#accName').textContent = p?.nickname ?? '';
  $('#accRating').textContent = p ? String(p.rating) : '–';
  $('#accSince').textContent = p?.created_at
    ? 'since ' + new Date(p.created_at).toLocaleDateString('en', { month: 'short', year: 'numeric' })
    : '';
  const rec = await myRecord();
  $('#accRecord').textContent = rec ? `${rec.wins}W – ${rec.losses}L` : '–';
}

/* ---- match result (design 23): scores, the Elo delta, the ladder spot.
   Everything paints INSTANTLY — the chip uses the cached rating plus the
   known delta, and the fresh profile/ladder fetches (in parallel) merely
   correct and append. No pop-in, no perceived lag. ---- */
let shareText = '';
async function showResult(r: FinishReport): Promise<void> {
  show('#ovOnline');
  panel('onResult');
  const t = $('#rTitle');
  t.textContent = r.draw ? 'DEAD HEAT' : r.won ? 'VICTORY' : 'DEFEAT';
  t.className = 'rtitle ' + (r.draw ? 'draw' : r.won ? 'win' : 'lose');
  $('#rSub').textContent = r.forfeit
    ? (r.won ? r.opp + ' forfeited' : 'Match forfeited')
    : (r.draw ? 'Down to the last die' : r.won ? 'You out-rolled ' + r.opp : r.opp + ' takes it');
  $('#rMy').textContent = String(r.my);
  $('#rTheir').textContent = String(r.their);
  $('#rOpp').textContent = r.opp;
  const deltaTxt = r.delta != null ? ` · ${r.delta >= 0 ? '+' : ''}${r.delta} Elo` : '';
  shareText = `${t.textContent} ${r.my}–${r.their} vs ${r.opp}${deltaTxt} — Knucklebones, ranked dice duels`;
  ($('#btnShare') as HTMLElement).textContent = 'Share result';
  const elo = $('#rElo') as HTMLElement, rank = $('#rRank') as HTMLElement;
  rank.hidden = true;
  elo.classList.toggle('down', (r.delta ?? 0) < 0);
  const chip = (rating: number | null) => {
    if (r.delta == null) { elo.hidden = true; return; }
    elo.innerHTML = `${r.delta >= 0 ? '+' : ''}${r.delta} <small>ELO${rating != null ? ' · ' + rating : ''}</small>`;
    elo.hidden = false;
  };
  let cachedRating: number | null = null;
  try {
    const c = JSON.parse(localStorage.getItem('knucklebones.online.profile') ?? 'null');
    if (typeof c?.rating === 'number' && r.delta != null) cachedRating = c.rating + r.delta;
  } catch { /* forgetful host */ }
  chip(cachedRating);
  const [p, rows] = await Promise.all([myProfile(), leaderboard(50)]);
  refreshHomeChip();
  chip(p?.rating ?? cachedRating);
  const i = p ? rows.findIndex((x) => x.nickname === p.nickname) : -1;
  if (i >= 0) { rank.innerHTML = `Ladder: <b>#${i + 1}</b>`; rank.hidden = false; }
}

let bound = false;
function bind(): void {
  if (bound) return;
  bound = true;
  document.body.insertAdjacentHTML('beforeend', OVERLAY);
  const qd = $('#qDice');
  qd.appendChild(makeDie(2, ME));
  qd.appendChild(makeDie(6, AI));

  $('#btnOnlineBack').addEventListener('click', () => { Sfx.tap(); goHome(); });

  const authErr = (m: string | null) => { $('#onAuthErr').textContent = m ?? ''; };
  const creds = () => [($('#onEmail') as HTMLInputElement).value.trim(),
                       ($('#onPass') as HTMLInputElement).value] as const;
  /* one continuation for every way a session can start: warm the chip and go
     wherever the tap was headed */
  const entered = async () => {
    const v = pendingView; pendingView = null;
    await myProfile();           // warms the home-chip cache
    refreshHomeChip();
    await route(v ?? 'play');
  };
  $('#btnSignIn').addEventListener('click', async () => {
    Sfx.tap(); authErr(null);
    const err = await signIn(...creds());
    if (err) return authErr(err);
    await entered();
  });
  $('#btnSignUp').addEventListener('click', async () => {
    Sfx.tap(); authErr(null);
    const { error, live } = await signUp(...creds());
    if (error) return authErr(error);
    // confirmation optional: play now, confirm later. Only when the project
    // demands a confirmed address does the inbox become the next step.
    if (live) return entered();
    authErr('Account created — check your email to confirm, then sign in.');
  });

  $('#btnRename').addEventListener('click', async () => {
    Sfx.tap();
    const err = await rename(($('#onNick') as HTMLInputElement).value.trim());
    $('#onAccErr').textContent = err ?? 'Saved.';
    if (!err) {
      const p = await myProfile();
      refreshHomeChip();
      $('#accName').textContent = p?.nickname ?? '';
    }
  });
  $('#btnSignOut').addEventListener('click', async () => { Sfx.tap(); await signOut(); refreshHomeChip(); panel('onAuth'); });

  let armed = 0;
  $('#btnDeleteAcc').addEventListener('click', async () => {
    Sfx.tap();
    const b = $('#btnDeleteAcc');
    if (Date.now() - armed < 3000) {
      const err = await deleteAccount();
      if (err) { $('#onAccErr').textContent = err; return; }
      b.textContent = 'Delete account'; armed = 0;
      refreshHomeChip();
      panel('onAuth');
    } else {
      armed = Date.now(); b.textContent = 'Tap again to delete EVERYTHING';
      setTimeout(() => { if (armed && Date.now() - armed >= 2900) { b.textContent = 'Delete account'; armed = 0; } }, 3000);
    }
  });

  $('#btnQueueCancel').addEventListener('click', () => { Sfx.tap(); goHome(); });
  $('#btnResultAgain').addEventListener('click', () => { Sfx.tap(); void startQueue(); });
  $('#btnResultHome').addEventListener('click', () => { Sfx.tap(); goHome(); });
  $('#btnShare').addEventListener('click', async () => {
    Sfx.tap();
    const b = $('#btnShare');
    try {
      if (navigator.share) await navigator.share({ text: shareText, url: location.origin });
      else {
        await navigator.clipboard.writeText(shareText + ' ' + location.origin);
        b.textContent = 'Copied!';
        setTimeout(() => { b.textContent = 'Share result'; }, 1500);
      }
    } catch { /* share sheet dismissed */ }
  });

  // a finished match lands on the Result screen, not on a menu
  setFinishHandler((r) => { void showResult(r); });
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
  if (await currentUser()) { pendingView = null; await route(view); }
  else { pendingView = view; panel('onAuth'); }
}

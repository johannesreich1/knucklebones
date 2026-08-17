// The online overlay: auth, menu, leaderboard, account. Injects its own
// markup on first open — the offline game never carries this DOM. Match play
// itself (queue + live board) is the next slice and hooks in at btnPlayOnline.
import './online.css';
import { $, show, hide } from '../ui/dom.ts';
import { Sfx } from '../ui/audio.ts';
import { signUp, signIn, signOut, currentUser, myProfile, rename, leaderboard, deleteAccount, join } from './session.ts';
import { enterMatch, setFinishHandler } from './play.ts';
import { spinWheel } from './wheel.ts';
import { modeById } from '../core/modes.ts';
import { refreshHomeChip } from '../boot.ts';

const OVERLAY = `
<div class="ov" id="ovOnline">
  <h1 style="font-size:20px">ONLINE</h1>

  <div class="panel" id="onAuth" hidden>
    <div class="lbl">Sign in or create account</div>
    <input id="onEmail" type="email" autocomplete="email" placeholder="email">
    <input id="onPass" type="password" autocomplete="current-password" placeholder="password (8+)">
    <div class="err" id="onAuthErr"></div>
    <button class="btn primary" id="btnSignIn">Sign in</button>
    <button class="btn" id="btnSignUp">Create account</button>
  </div>

  <div class="panel" id="onMenu" hidden>
    <div class="who" id="onWho"></div>
    <button class="btn primary" id="btnPlayOnline">Play online</button>
    <button class="btn" id="btnLeaderboard">Leaderboard</button>
    <button class="btn" id="btnAccount">Account</button>
  </div>

  <div class="panel" id="onQueue" hidden>
    <div class="lbl">Matchmaking</div>
    <div class="who" id="onQueueMsg">Looking for an opponent…</div>
    <button class="btn" id="btnQueueCancel">Cancel</button>
  </div>

  <div class="panel" id="onBoard" hidden>
    <div class="lbl">Elo ladder</div>
    <div class="lb" id="onBoardList"></div>
    <button class="btn" id="btnBoardBack">Back</button>
  </div>

  <div class="panel" id="onAccount" hidden>
    <div class="lbl">Nickname</div>
    <input id="onNick" maxlength="16" autocomplete="off">
    <div class="err" id="onAccErr"></div>
    <button class="btn" id="btnRename">Save name</button>
    <button class="btn" id="btnSignOut">Sign out</button>
    <button class="btn" id="btnDeleteAcc">Delete account</button>
    <button class="btn" id="btnAccBack">Back</button>
  </div>

  <button class="btn" id="btnOnlineClose">Close</button>
</div>`;

const esc = (s: string) => s.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function panel(which: 'onAuth' | 'onMenu' | 'onQueue' | 'onBoard' | 'onAccount'): void {
  for (const id of ['onAuth', 'onMenu', 'onQueue', 'onBoard', 'onAccount']) $('#' + id).hidden = id !== which;
}

async function showMenu(): Promise<void> {
  const p = await myProfile();
  refreshHomeChip();
  $('#onWho').innerHTML = p
    ? `Signed in as <b>${esc(p.nickname)}</b> · <span class="rt">${p.rating}</span>`
    : 'Signed in';
  panel('onMenu');
}

async function showBoard(): Promise<void> {
  panel('onBoard');
  const list = $('#onBoardList');
  list.textContent = 'Loading…';
  const [rows, me] = await Promise.all([leaderboard(50), myProfile()]);
  list.innerHTML = rows.length ? '' : '<div class="row">No ranked games yet — be the first!</div>';
  rows.forEach((r, i) => {
    const div = document.createElement('div');
    div.className = 'row' + (me && r.nickname === me.nickname ? ' me' : '');
    div.innerHTML = `<span class="rank">${i + 1}</span><span class="nm">${esc(r.nickname)}</span>` +
      `<span class="ws">${r.wins}W/${r.games}</span><span class="rt">${r.rating}</span>`;
    list.appendChild(div);
  });
}

/* matchmaking: poll join; offer the bot pool once the wait gets boring */
let queueAbort = false;
async function startQueue(): Promise<void> {
  panel('onQueue');
  queueAbort = false;
  const started = Date.now();
  while (!queueAbort) {
    const waited = Date.now() - started;
    $('#onQueueMsg').textContent = waited > 7000
      ? 'Looking for an opponent… inviting anyone available'
      : 'Looking for an opponent…';
    const res = await join(waited > 7000);
    if (queueAbort) break;
    if (res?.status === 'matched') {
      // fresh match: the wheel reveal (aimed at the server's stored pick);
      // rejoining skips the show — the mode was revealed when the match began
      if (!res.rejoined) { hide('#ovOnline'); await spinWheel(modeById(res.match.modifier)); }
      await enterMatch(res);
      return;
    }
    await new Promise(r => setTimeout(r, 2500));
  }
}

async function showAccount(): Promise<void> {
  const p = await myProfile();
  ($('#onNick') as HTMLInputElement).value = p?.nickname ?? '';
  $('#onAccErr').textContent = '';
  panel('onAccount');
}

let bound = false;
function bind(): void {
  if (bound) return;
  bound = true;
  document.body.insertAdjacentHTML('beforeend', OVERLAY);

  const authErr = (m: string | null) => { $('#onAuthErr').textContent = m ?? ''; };
  $('#btnSignIn').addEventListener('click', async () => {
    Sfx.tap(); authErr(null);
    const err = await signIn(($('#onEmail') as HTMLInputElement).value.trim(), ($('#onPass') as HTMLInputElement).value);
    if (err) return authErr(err);
    const v = pendingView; pendingView = null;
    await myProfile();           // warms the home-chip cache
    refreshHomeChip();
    await route(v);
  });
  $('#btnSignUp').addEventListener('click', async () => {
    Sfx.tap(); authErr(null);
    const err = await signUp(($('#onEmail') as HTMLInputElement).value.trim(), ($('#onPass') as HTMLInputElement).value);
    authErr(err ?? 'Account created — check your email to confirm, then sign in.');
  });

  $('#btnLeaderboard').addEventListener('click', () => { Sfx.tap(); void showBoard(); });
  $('#btnBoardBack').addEventListener('click', () => { Sfx.tap(); void showMenu(); });

  $('#btnAccount').addEventListener('click', () => { Sfx.tap(); void showAccount(); });
  $('#btnAccBack').addEventListener('click', () => { Sfx.tap(); void showMenu(); });
  $('#btnRename').addEventListener('click', async () => {
    Sfx.tap();
    const err = await rename(($('#onNick') as HTMLInputElement).value.trim());
    $('#onAccErr').textContent = err ?? 'Saved.';
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

  $('#btnPlayOnline').addEventListener('click', () => { Sfx.tap(); void startQueue(); });
  $('#btnQueueCancel').addEventListener('click', () => { Sfx.tap(); queueAbort = true; void showMenu(); });

  // back from a finished match: reopen the overlay on the menu with the result
  setFinishHandler((summary) => {
    show('#ovOnline');
    void showMenu().then(() => { $('#onWho').innerHTML = esc(summary) + '<br>' + $('#onWho').innerHTML; });
  });

  $('#btnOnlineClose').addEventListener('click', () => { Sfx.tap(); hide('#ovOnline'); });
}

/* entry point, dynamically imported from boot. The home's buttons deep-link:
   'play' goes straight into matchmaking, 'board'/'account' to their panels. */
export type OnlineView = 'play' | 'board' | 'account';
let pendingView: OnlineView | null = null;

async function route(view: OnlineView | null): Promise<void> {
  if (view === 'play') return startQueue();
  if (view === 'board') return showBoard();
  if (view === 'account') return showAccount();
  return showMenu();
}

export async function openOnline(view?: OnlineView): Promise<void> {
  bind();
  show('#ovOnline');
  if (await currentUser()) { pendingView = null; await route(view ?? null); }
  else { pendingView = view ?? null; panel('onAuth'); }
}

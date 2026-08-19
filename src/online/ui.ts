// The online overlay: auth, matchmaking, ladder, account, match result.
// Injects its own markup on first open — the offline game never carries this
// DOM. Navigation model (design: 00-navigation): Home IS the online menu, so
// every deep link lands straight on its panel, one shared ‹ header goes back
// to Home, and matchmaking's only exit is Cancel (which truly leaves the
// queue). Match play itself lives in play.ts and hooks in via startQueue.
import './online.css';
import { ME, AI } from '../core/rules.ts';
import { $, show, hide } from '../ui/dom.ts';
import { showEnd, setMeta, closeEnd } from '../ui/endscreen.ts';
import { Sfx } from '../ui/audio.ts';
import { makeDie } from '../ui/die.ts';
import { signUp, signIn, signOut, currentUser, ensureIdentity, attachEmail,
         myProfile, myRecord, rename, leaderboard, deleteAccount, join, readyPeer } from './session.ts';
import { availableTaps } from './identity.ts';
import { enterMatch, setFinishHandler, type FinishReport } from './play.ts';
import { spinDial } from '../ui/modedial.ts';
import { modeById } from '../core/modes.ts';
import { refreshHomeChip } from '../boot.ts';

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
    <div class="lbl" style="text-align:center">Season 1 · Elo rating</div>
    <div class="lb neonscroll" id="onBoardList"></div>
  </div>

  <div class="panel" id="onAccount" hidden>
    <div class="acard">
      <div class="awho"><span id="accDie"></span><span class="meta"><span class="nm" id="accName"></span><span class="sub" id="accSince"></span></span></div>
      <div class="statrow"><span>RATING</span><b id="accRating">–</b></div>
      <div class="statrow"><span>RECORD</span><b class="rec2" id="accRecord">–</b></div>
    </div>
    <div class="guestbox" id="accGuest" hidden>
      <b>GUEST</b>
      <p>This account lives on this device only. Delete the app and the rating goes with it.</p>
      <button class="btn primary" id="btnKeepAcc">Keep it forever</button>
      <button class="btn ghost" id="btnHaveAcc">I already have an account</button>
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

</div>`;

/* one shared header: each panel names itself; the ‹ hides where Cancel (or an
   explicit action) is the only sane exit. The result of a match is NOT a panel
   here — it is the game's one result screen (ui/endscreen), the same one local
   play ends on. */
const PANELS = {
  onAuth: { title: 'SIGN IN', back: true },
  onQueue: { title: 'MATCHMAKING', back: false },
  onBoard: { title: 'LADDER', back: true },
  onAccount: { title: 'ACCOUNT', back: true },
} as const;
type Panel = keyof typeof PANELS;

function panel(which: Panel): void {
  for (const id of Object.keys(PANELS)) $('#' + id).hidden = id !== which;
  // the ladder is a LIST, not a form: it takes the whole screen under a fixed
  // subheading. Every other panel stays a centred column.
  $('#ovOnline').classList.toggle('listview', which === 'onBoard');
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
    tiny: 'New accounts get a nickname like BoldRaven482 —<br>change it any time in Account',
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
        await spinDial(modeById(res.match.modifier), {
          foe: { name: res.names[theirs], rating: res.names.ratings?.[theirs] ?? null },
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
  const [p, who] = await Promise.all([myProfile(), currentUser()]);
  refreshHomeChip();
  /* a guest is offered the way up; "Sign out" is hidden from them because for
     an account with no identity it does not sign out, it throws away */
  $('#accGuest').hidden = !who?.guest;
  ($('#btnSignOut') as HTMLElement).hidden = !!who?.guest;
  ($('#onNick') as HTMLInputElement).value = p?.nickname ?? '';
  $('#accName').textContent = p?.nickname ?? '';
  $('#accRating').textContent = p ? String(p.rating) : '–';
  $('#accSince').textContent = p?.created_at
    ? 'since ' + new Date(p.created_at).toLocaleDateString('en', { month: 'short', year: 'numeric' })
    : '';
  const rec = await myRecord();
  $('#accRecord').textContent = rec ? `${rec.wins}W – ${rec.losses}L` : '–';
}

/* ---- match result: the SAME screen local play ends on (ui/endscreen), filled
   with what ranked has to add — the Elo delta and the ladder spot. Everything
   paints INSTANTLY: the chip uses the cached rating plus the known delta, and
   the fresh profile/ladder fetches (in parallel) merely correct and append. ---- */
async function showResult(r: FinishReport): Promise<void> {
  hide('#ovOnline');
  const title = r.draw ? 'DEAD HEAT' : r.won ? 'VICTORY' : 'DEFEAT';
  const deltaTxt = r.delta != null ? ` · ${r.delta >= 0 ? '+' : ''}${r.delta} Elo` : '';
  /* the context line, as HTML — the one thing ranked shows that local play
     does not. Rebuilt whenever a better number arrives. */
  const metaHtml = (rating: number | null, rank: number | null) =>
    (r.delta == null ? '' :
      `<span class="elochip${r.delta < 0 ? ' down' : ''}">${r.delta >= 0 ? '+' : ''}${r.delta}` +
      ` <small>ELO${rating != null ? ' · ' + rating : ''}</small></span>`) +
    (rank != null ? `<span class="rrank">Ladder: <b>#${rank}</b></span>` : '');
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
    meta: metaHtml(cachedRating, null),
    again: { label: 'Play again', run: () => { closeEnd(); show('#ovOnline'); void route('play'); } },
    home:  { label: 'Home', run: () => { closeEnd(); goHome(); } },
    share: `${title} ${r.my}–${r.their} vs ${r.opp}${deltaTxt} — Knucklebones, ranked dice duels`,
  });
  const [p, rows] = await Promise.all([myProfile(), leaderboard(50)]);
  refreshHomeChip();
  const i = p ? rows.findIndex((x) => x.nickname === p.nickname) : -1;
  setMeta(metaHtml(p?.rating ?? cachedRating, i >= 0 ? i + 1 : null));
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

  $('#btnKeepAcc').addEventListener('click', () => { Sfx.tap(); authPanel('attach'); });
  $('#btnHaveAcc').addEventListener('click', () => { Sfx.tap(); authPanel('restore'); });

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
  $('#btnSignOut').addEventListener('click', async () => { Sfx.tap(); await signOut(); refreshHomeChip(); authPanel('restore'); });

  let armed = 0;
  $('#btnDeleteAcc').addEventListener('click', async () => {
    Sfx.tap();
    const b = $('#btnDeleteAcc');
    if (Date.now() - armed < 3000) {
      const err = await deleteAccount();
      if (err) { $('#onAccErr').textContent = err; return; }
      b.textContent = 'Delete account'; armed = 0;
      refreshHomeChip();
      authPanel('restore');
    } else {
      armed = Date.now(); b.textContent = 'Tap again to delete EVERYTHING';
      setTimeout(() => { if (armed && Date.now() - armed >= 2900) { b.textContent = 'Delete account'; armed = 0; } }, 3000);
    }
  });

  $('#btnQueueCancel').addEventListener('click', () => { Sfx.tap(); goHome(); });

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

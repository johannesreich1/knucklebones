// Lazy online composition and navigation. Screen markup/rendering lives with
// its owner; this module owns only the shared overlay stack and route ports.
import './online.css';
import { Sfx } from '../ui/audio.ts';
import { $, hide, show } from '../ui/dom.ts';
import { closeEnd, replayPlates } from '../ui/endscreen.ts';
import { refreshHomeChip } from '../ui/homechip.ts';
import { S } from '../state.ts';
import { saveStats } from '../persist.ts';
import { createAccountScreen } from './account-screen.ts';
import {
  showAuth,
  setSessionless,
  type AuthMode,
  type AuthOrigin,
} from './auth-screen.ts';
import { createAvatarScreen } from './avatar-screen.ts';
import { showHistory } from './history-screen.ts';
import { createLadderScreen } from './ladder-screen.ts';
import { createQueueScreen } from './queue-screen.ts';
import { createResultScreen } from './result-screen.ts';
import { ensureIdentity, myProfile } from './session.ts';
import { syncAccountPreferences } from './preferences.ts';
import { refreshRuneCollection } from './rune-collection.ts';
import { installOnlineShell, showOnlineLoading, type OnlinePanel } from './shell.ts';
import { setFinishHandler, type FinishReport } from './play.ts';

export type OnlineView = 'play' | 'board' | 'account';
export interface OnlinePorts {
  startTutorial: () => void;
  tryRune: (runeId: string, onBackToRanked: () => void) => boolean;
}

let bound = false;
let pendingView: OnlineView | null = null;
let entryRevision = 0;
let exitOnline: () => void = goHome;
let onlinePorts: OnlinePorts | null = null;

const queue = createQueueScreen({
  goHome,
  startTutorial: () => {
    if (!onlinePorts) throw new Error('online flow was opened without composition ports');
    onlinePorts.startTutorial();
  },
});
const ladder = createLadderScreen({
  showAccount,
  getExit: () => exitOnline,
  setExit: (next) => { exitOnline = next; },
});
const avatar = createAvatarScreen(showAccount);
const account = createAccountScreen({
  showAuth: showAuthPanel,
  showAvatar: avatar.show,
  showBoard: ladder.show,
  showHistory,
});
const result = createResultScreen({
  goHome,
  nextDuel,
  openProfile: openProfileFromResult,
  tryRune: (runeId, report) => {
    onlinePorts?.tryRune(runeId, () => { void result.show(report); });
  },
});

function showAuthPanel(mode: AuthMode, origin: AuthOrigin): void {
  if (origin === 'home') {
    /* Every Home-origin auth flow has no current session (initial fallback,
       sign-out, or deletion). Its attach step is registration copy, never the
       guest-only "keep this account" copy. */
    setSessionless(true);
    hide('#ovOnline');
    show('#ovStart');
  }
  showAuth(mode, { entered, showAccount, dismiss: dismissAuth }, origin);
}

function dismissAuth(origin: AuthOrigin): void {
  if (origin === 'account') return;
  pendingView = null;
  goHome();
}

function focusOnlineTitle(): void {
  $('#onTitle').focus({ preventScroll: true });
}

function showAccount(): Promise<void> {
  const showing = account.show();
  focusOnlineTitle();
  return showing;
}

function goHome(): void {
  entryRevision++;
  queue.stop();
  closeEnd();
  hide('#ovOnline');
  show('#ovStart');
  exitOnline = goHome;
}

function openProfileFromResult(): void {
  exitOnline = () => {
    hide('#ovOnline');
    replayPlates();
  };
  show('#ovOnline');
  void route('account');
}

function nextDuel(): void {
  closeEnd();
  show('#ovOnline');
  void route('play');
}

async function route(view: OnlineView): Promise<void> {
  if (view === 'board') return ladder.show();
  if (view === 'account') return account.show();
  return queue.start();
}

function loadingPanel(view: OnlineView | null): OnlinePanel {
  if (view === 'account') return 'onAccount';
  if (view === 'board') return 'onBoard';
  return 'onQueue';
}

async function entered(): Promise<void> {
  const revision = ++entryRevision;
  const view = pendingView;
  pendingView = null;
  showOnlineLoading(loadingPanel(view));
  show('#ovOnline');
  focusOnlineTitle();
  await Promise.all([myProfile(), refreshRuneCollection()]);
  if (revision !== entryRevision || !$('#ovOnline').classList.contains('on')) return;
  await syncAccountPreferences();
  if (revision !== entryRevision || !$('#ovOnline').classList.contains('on')) return;
  refreshHomeChip();
  await route(view ?? 'play');
}

function bind(): void {
  if (bound) return;
  bound = true;
  installOnlineShell();
  $('#btnOnlineBack').addEventListener('click', () => {
    Sfx.tap();
    const subpanel = !$('#onAvatar').hidden || !$('#onHistory').hidden;
    if (subpanel) void account.show();
    else exitOnline();
  });
  account.bind();
  avatar.bind();
  queue.bind();
  setFinishHandler((report) => {
    S.played = true;
    saveStats();
    void result.show(report);
  });
}

if (typeof window !== 'undefined') {
  (window as any).__kbResult = (report: FinishReport): void => {
    bind();
    void result.show(report);
  };
}

export async function openOnline(view: OnlineView, ports: OnlinePorts): Promise<void> {
  onlinePorts = ports;
  bind();
  exitOnline = goHome;
  if (view === 'board') {
    show('#ovOnline');
    pendingView = null;
    return ladder.show();
  }
  const user = await ensureIdentity();
  setSessionless(!user);
  if (user) {
    /* Mount one complete destination state before exposing the lazy overlay.
       Account preference hydration may take a network turn; showing the
       overlay first left every panel hidden (and the title at ONLINE), so that
       empty shell painted above the eager chunk loader for a visible flash.
       Ladder already establishes its wait synchronously before yielding. */
    showOnlineLoading(loadingPanel(view));
    show('#ovOnline');
    pendingView = null;
    await Promise.all([
      syncAccountPreferences(),
      refreshRuneCollection(user.id),
    ]);
    return route(view);
  }
  pendingView = view;
  showAuthPanel('restore', 'home');
}

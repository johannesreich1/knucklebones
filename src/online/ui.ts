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
import { showAuth, setSessionless, type AuthMode } from './auth-screen.ts';
import { createAvatarScreen } from './avatar-screen.ts';
import { showHistory } from './history-screen.ts';
import { createLadderScreen } from './ladder-screen.ts';
import { createQueueScreen } from './queue-screen.ts';
import { createResultScreen } from './result-screen.ts';
import { ensureIdentity, myProfile } from './session.ts';
import { installOnlineShell } from './shell.ts';
import { setFinishHandler, type FinishReport } from './play.ts';

export type OnlineView = 'play' | 'board' | 'account';

let bound = false;
let pendingView: OnlineView | null = null;
let exitOnline: () => void = goHome;

const queue = createQueueScreen(goHome);
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
});

function showAuthPanel(mode: AuthMode): void {
  showAuth(mode, { entered, showAccount });
}

function showAccount(): Promise<void> {
  return account.show();
}

function goHome(): void {
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

async function entered(): Promise<void> {
  const view = pendingView;
  pendingView = null;
  await myProfile();
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

export async function openOnline(view: OnlineView = 'play'): Promise<void> {
  bind();
  exitOnline = goHome;
  show('#ovOnline');
  if (view === 'board') {
    pendingView = null;
    return ladder.show();
  }
  const user = await ensureIdentity();
  setSessionless(!user);
  if (user) {
    pendingView = null;
    return route(view);
  }
  pendingView = view;
  showAuthPanel('restore');
}

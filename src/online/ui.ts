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
import {
  refreshRuneCollection,
  runeCollectionMatchesActiveAccount,
  type RuneCollectionRefresh,
} from './rune-collection.ts';
import {
  firstUnseenRuneReward,
  showRuneRewardSheet,
  type RuneRewardSheet,
} from './rune-reward-presentation.ts';
import {
  installOnlineShell,
  isOnlinePanelCurrent,
  showOnlineLoading,
  type OnlinePanel,
} from './shell.ts';
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
let activeRuneReward: RuneRewardSheet | null = null;

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
  presentRuneReward: presentAccountRuneReward,
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

async function showAccount(): Promise<void> {
  const showing = account.show();
  focusOnlineTitle();
  await showing;
}

function closeRuneReward(): void {
  const active = activeRuneReward;
  activeRuneReward = null;
  active?.close();
}

function presentRuneReward(
  collection: RuneCollectionRefresh,
  owns: () => boolean,
  onContinue: () => void,
  onBackFromTryout: () => void,
): boolean {
  const reward = firstUnseenRuneReward(collection);
  const ports = onlinePorts;
  if (!reward || !ports || !owns()) return false;
  closeRuneReward();
  let presentation!: RuneRewardSheet;
  const release = (): void => {
    if (activeRuneReward === presentation) activeRuneReward = null;
  };
  presentation = showRuneRewardSheet(reward, {
    owns: () => activeRuneReward === presentation && owns(),
    onContinue: () => { release(); onContinue(); },
    onTry: (runeId) => {
      release();
      return ports.tryRune(runeId, onBackFromTryout);
    },
  });
  activeRuneReward = presentation;
  return true;
}

function presentAccountRuneReward(
  collection: RuneCollectionRefresh,
  ownsAccount: () => boolean,
): void {
  const revision = entryRevision;
  const stillCurrent = (): boolean => revision === entryRevision && ownsAccount();
  void presentRuneReward(
    collection,
    stillCurrent,
    () => undefined, // the fully painted profile is already under the sheet
    () => {
      if (revision !== entryRevision) return;
      show('#ovOnline');
      void account.show();
    },
  );
}

function goHome(): void {
  entryRevision++;
  closeRuneReward();
  queue.stop();
  closeEnd();
  hide('#ovOnline');
  show('#ovStart');
  exitOnline = goHome;
}

function openProfileFromResult(onReturn: () => void): void {
  entryRevision++;
  closeRuneReward();
  exitOnline = () => {
    exitOnline = goHome;
    hide('#ovOnline');
    replayPlates();
    onReturn();
  };
  show('#ovOnline');
  void route('account');
}

function nextDuel(): void {
  const revision = ++entryRevision;
  exitOnline = goHome;
  closeRuneReward();
  closeEnd();
  showOnlineLoading('onQueue');
  show('#ovOnline');
  focusOnlineTitle();
  /* A result request can still be in flight, and a visible reward can still be
     inside its entrance. Verify durable unseen rows again before matchmaking;
     queueing never starts behind a reward that Next Duel just covered. */
  void refreshRuneCollection().then(async (collection) => {
    if (revision !== entryRevision || !$('#ovOnline').classList.contains('on')) return;
    const ownsCollection = await runeCollectionMatchesActiveAccount(collection);
    if (!ownsCollection || revision !== entryRevision
        || !$('#ovOnline').classList.contains('on')) return;
    await routeWithRuneReward('play', collection, revision);
  }).catch(() => {
    if (revision === entryRevision && $('#ovOnline').classList.contains('on')) {
      void route('play');
    }
  });
}

async function route(view: OnlineView): Promise<void> {
  if (view === 'board') return ladder.show();
  if (view === 'account') {
    await account.show();
    return;
  }
  return queue.start();
}

async function routeWithRuneReward(
  view: OnlineView,
  collection: RuneCollectionRefresh,
  revision: number,
): Promise<void> {
  /* Account paints one coherent profile first and presents from its own fresh
     collection response. Queue/reconnect must not begin behind a modal reward,
     so those destinations wait until Continue or the borrowed tryout returns. */
  if (view === 'account') {
    const refreshed = await account.show();
    /* Account normally presents its own freshest collection. If that second
       refresh failed after entry already verified an unseen row, keep the
       verified discovery instead of silently throwing it away. */
    if (revision === entryRevision && !activeRuneReward
        && refreshed && !refreshed.verified && refreshed.accountId
        && refreshed.accountId.toLowerCase() === collection.accountId?.toLowerCase()) {
      presentAccountRuneReward(collection, () => isOnlinePanelCurrent('onAccount'));
    }
    return;
  }
  const current = (): boolean => revision === entryRevision
    && $('#ovOnline').classList.contains('on');
  const resume = (): void => {
    if (revision !== entryRevision) return;
    show('#ovOnline');
    void route(view);
  };
  if (presentRuneReward(collection, current, resume, resume)) return;
  await route(view);
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
  const [, collection] = await Promise.all([myProfile(), refreshRuneCollection()]);
  if (revision !== entryRevision || !$('#ovOnline').classList.contains('on')) return;
  await syncAccountPreferences();
  if (revision !== entryRevision || !$('#ovOnline').classList.contains('on')) return;
  const ownsCollection = await runeCollectionMatchesActiveAccount(collection);
  if (!ownsCollection || revision !== entryRevision
      || !$('#ovOnline').classList.contains('on')) return;
  refreshHomeChip();
  await routeWithRuneReward(view ?? 'play', collection, revision);
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
  const revision = ++entryRevision;
  closeRuneReward();
  exitOnline = goHome;
  if (view === 'board') {
    show('#ovOnline');
    pendingView = null;
    return ladder.show();
  }
  const user = await ensureIdentity();
  if (revision !== entryRevision) return;
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
    const [, collection] = await Promise.all([
      syncAccountPreferences(),
      refreshRuneCollection(user.id),
    ]);
    if (revision !== entryRevision || !$('#ovOnline').classList.contains('on')) return;
    if (collection.accountId?.toLowerCase() !== user.id.toLowerCase()) return;
    const ownsCollection = await runeCollectionMatchesActiveAccount(collection);
    if (!ownsCollection || revision !== entryRevision
        || !$('#ovOnline').classList.contains('on')) return;
    return routeWithRuneReward(view, collection, revision);
  }
  pendingView = view;
  showAuthPanel('restore', 'home');
}

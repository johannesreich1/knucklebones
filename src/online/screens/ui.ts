// Lazy online composition and navigation. Screen markup/rendering lives with
// its owner; this module owns only the shared overlay stack and route ports.
import '../online.css';
import { Sfx } from '../../ui/audio.ts';
import { $, byId, hide, show } from '../../ui/dom.ts';
import { closeEnd } from '../../ui/endscreen.ts';
import { isNewcomer } from '../../ui/firstrun.ts';
import { refreshHomeChip } from '../../ui/homechip.ts';
import { S } from '../../state.ts';
import { saveStats } from '../../persist.ts';
import { createAccountScreen, type AccountShowOptions } from './account-screen.ts';
import { showAuth, setSessionless, type AuthMode, type AuthOrigin } from './auth-screen.ts';
import { createAvatarScreen } from './avatar-screen.ts';
import { showHistory } from './history-screen.ts';
import { createLadderScreen } from './ladder-screen.ts';
import { createQueueScreen } from './queue-screen.ts';
import { createResultScreen } from './result-screen.ts';
import { ensureIdentity } from '../identity/session.ts';
import { myProfile } from '../identity/profile.ts';
import { syncAccountPreferences } from '../preferences.ts';
import {
  refreshRuneCollection,
  runeCollectionMatchesActiveAccount,
  type RuneCollectionRefresh,
} from '../runes/rune-collection.ts';
import { refreshRankedProgressionStatus } from '../api/progression-status-api.ts';
import {
  activeWeeklyChallenge,
  readProgressionStatusSnapshot,
} from '../../progression-status-cache.ts';
import { verifyRankedEntryContract } from './ranked-entry-contract.ts';
import {
  installOnlineShell,
  showOnlineLoading,
} from './shell.ts';
import { setFinishHandler, type FinishReport } from '../play/play.ts';
import { createEntryRuneRewardPresenter } from './entry-rune-reward.ts';
import { createEntryRuneRewardRouter } from './entry-rune-route.ts';
import { createEntryRecovery } from './entry-recovery.ts';
import {
  createResultEntry,
  type OnlineView,
} from './result-entry.ts';

export type { OnlineView } from './result-entry.ts';
export interface OnlinePorts {
  startTutorial: () => void;
}

let bound = false;
let pendingView: OnlineView | null = null;
let entryRevision = 0;
let accountRouteRevision = 0;
let exitOnline: () => void = goHome;
let onlinePorts: OnlinePorts | null = null;
const runeReward = createEntryRuneRewardPresenter();
const routeWithRuneReward = createEntryRuneRewardRouter(runeReward, {
  currentRevision: (revision) => revision === entryRevision,
  ownsOverlay: (revision) => revision === entryRevision
    && $('#ovOnline').classList.contains('on'),
  routeAccount,
  route,
});
const { presentConnectionIssue, handleIdentityFailure } =
  createEntryRecovery<OnlineView, OnlinePorts>({
    retryContext: () => onlinePorts,
    goHome: () => { pendingView = null; goHome(); },
    opener: (view) => byId(view === 'ladder' ? 'btnBoardHome'
      : view === 'account' ? 'homeChip'
        : view === 'weekly' ? 'btnWeekly' : 'btnOnline'),
    retry: (view, ports) => { void openOnline(view, ports); },
    restore: (view, sessionless) => {
      pendingView = view;
      showAuthPanel('restore', 'home', null, sessionless);
    },
  });

const queue = createQueueScreen({
  goHome,
  connectionUnavailable: (entryKind) => presentConnectionIssue(
    entryKind === 'weekly' ? 'weekly' : 'play',
  ),
  updateRequired: (entryKind) => presentConnectionIssue(
    entryKind === 'weekly' ? 'weekly' : 'play', 'updateRequired',
  ),
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
  showLadder: ladder.show,
  showHistory,
  presentRuneReward: presentAccountRuneReward,
});
const resultEntry = createResultEntry<AccountShowOptions>({
  incrementRevision: () => ++entryRevision,
  isCurrent: (revision) => revision === entryRevision
    && $('#ovOnline').classList.contains('on'),
  closeRuneReward: () => runeReward.close(),
  setExit: (next) => { exitOnline = next; },
  goHome,
  showEntryWait,
  focusOnlineTitle,
  route,
  routeWithRuneReward,
  handleIdentityFailure,
  presentConnectionIssue,
});
const result = createResultScreen({
  goHome,
  nextDuel: resultEntry.nextDuel,
  openProfile: (onReturn: () => void, options?: AccountShowOptions) =>
    resultEntry.openFromResult('account', onReturn, options),
  openLadder: (onReturn: () => void) =>
    resultEntry.openFromResult('ladder', onReturn),
});

function showAuthPanel(
  mode: AuthMode,
  origin: AuthOrigin,
  notice: string | null = null,
  sessionless = origin === 'home',
): void {
  if (origin === 'home') {
    /* A Home-origin auth flow is either definitively sessionless (initial
       fallback, sign-out, deletion) or a verified provider mismatch asking
       the player to restore another account. A temporary failure never reaches
       this branch. A play entry may already be painting its searching queue;
       that search ends here, clock included. */
    setSessionless(sessionless);
    /* Account may itself be a cover over a ranked result. Home-origin auth
       retires that whole route: leaving the result mounted would expose it to
       assistive technology after the auth sheet restores its inert snapshot. */
    goHome();
  }
  showAuth(mode, { entered, showAccount, dismiss: dismissAuth }, origin, notice);
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
  const showing = routeAccount();
  focusOnlineTitle();
  await showing;
}

async function routeAccount(options?: AccountShowOptions): Promise<void> {
  const routeRevision = ++accountRouteRevision;
  const navigationRevision = entryRevision;
  const routeExit = exitOnline;
  const shown = await account.show(options).catch(() => null);
  if (shown) return;
  /* Back may already have used the result-cover closure and replaced the
     mutable exit slot with Home. A late abandoned Account load must not invoke
     that newer meaning (or cancel a newer Account route) a second time. */
  if (routeRevision !== accountRouteRevision || navigationRevision !== entryRevision
      || routeExit !== exitOnline) return;
  options?.runeGuide?.cancel();
  routeExit();
}

function presentAccountRuneReward(
  collection: RuneCollectionRefresh,
  ownsAccount: () => boolean,
  onContinue: () => void = () => undefined,
  actionLabel?: () => string,
  deferAcknowledgement = false,
): boolean {
  const revision = entryRevision;
  const stillCurrent = (): boolean => revision === entryRevision && ownsAccount();
  // the fully painted profile is already under the sheet
  return runeReward.present(
    collection,
    stillCurrent,
    onContinue,
    actionLabel,
    deferAcknowledgement,
  );
}

function goHome(): void {
  entryRevision++;
  runeReward.close();
  queue.stop();
  closeEnd();
  $('#ovEnd').inert = false;
  hide('#ovOnline');
  show('#ovStart');
  exitOnline = goHome;
}

async function route(view: OnlineView, accountOptions?: AccountShowOptions): Promise<void> {
  if (navigator.onLine === false) {
    presentConnectionIssue(view, 'offline');
    return;
  }
  if (view === 'ladder') return ladder.show();
  if (view === 'account') return routeAccount(accountOptions);
  if (view === 'weekly' && !activeWeeklyChallenge(readProgressionStatusSnapshot())) {
    presentConnectionIssue(view);
    return;
  }
  const identity = await ensureIdentity();
  if (identity.kind !== 'authenticated') {
    handleIdentityFailure(view, identity);
    return;
  }
  return queue.start(view === 'weekly' ? 'weekly' : 'ordinary');
}

function showEntryWait(view: OnlineView | null): void {
  if (view === 'account') return showOnlineLoading('onAccount');
  if (view === 'ladder') return showOnlineLoading('onLadder');
  /* Play paints its real destination at once: the queue's searching state
     shows nothing account-derived, so it need not wait for identity. Only
     newcomers keep the die — the tutorial offer may still route them away. */
  if (isNewcomer()) return showOnlineLoading('onQueue');
  queue.showSearching(view === 'weekly' ? 'weekly' : 'ordinary');
}

async function entered(): Promise<void> {
  const revision = ++entryRevision;
  const view = pendingView;
  pendingView = null;
  showEntryWait(view);
  show('#ovOnline');
  focusOnlineTitle();
  const [, collection, progression] = await Promise.all([
    myProfile(), refreshRuneCollection(), refreshRankedProgressionStatus(),
  ]);
  if (revision !== entryRevision || !$('#ovOnline').classList.contains('on')) return;
  await syncAccountPreferences();
  if (revision !== entryRevision || !$('#ovOnline').classList.contains('on')) return;
  const ownsCollection = await runeCollectionMatchesActiveAccount(collection);
  if (!ownsCollection || revision !== entryRevision
      || !$('#ovOnline').classList.contains('on')) return;
  const entryView = view ?? 'play';
  if (!await verifyRankedEntryContract(entryView, progression)) {
    if (revision !== entryRevision || !$('#ovOnline').classList.contains('on')) return;
    presentConnectionIssue(entryView);
    return;
  }
  showEntryWait(view);
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
    if (subpanel) void routeAccount();
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
  if (navigator.onLine === false) {
    presentConnectionIssue(view, 'offline');
    return;
  }
  const revision = ++entryRevision;
  runeReward.close();
  exitOnline = goHome;
  if (view === 'ladder') {
    show('#ovOnline');
    pendingView = null;
    return ladder.show();
  }
  /* The online overlay is reused, so its last panel may still be fading out
     when Home opens it again. Establish the new destination — play's searching
     queue, or a held loading die — before identity or Game Center can yield;
     otherwise a retained Ladder can paint during that wait. */
  pendingView = null;
  showEntryWait(view);
  show('#ovOnline');
  const identity = await ensureIdentity();
  if (revision !== entryRevision) return;
  if (identity.kind !== 'authenticated') {
    handleIdentityFailure(view, identity);
    return;
  }
  const user = identity.user;
  setSessionless(false);
  {
    /* Hydration stays behind the current hold — the searching queue for play,
       the die otherwise; partial account data never paints either way. */
    const [, collection, , progression] = await Promise.all([
      syncAccountPreferences(),
      refreshRuneCollection(user.id), myProfile(), refreshRankedProgressionStatus(),
    ]);
    if (revision !== entryRevision || !$('#ovOnline').classList.contains('on')) return;
    if (collection.accountId?.toLowerCase() !== user.id.toLowerCase()) return;
    const ownsCollection = await runeCollectionMatchesActiveAccount(collection);
    if (!ownsCollection || revision !== entryRevision
        || !$('#ovOnline').classList.contains('on')) return;
    if (!await verifyRankedEntryContract(view, progression)) {
      if (revision !== entryRevision || !$('#ovOnline').classList.contains('on')) return;
      presentConnectionIssue(view);
      return;
    }
    showEntryWait(view);
    return routeWithRuneReward(view, collection, revision);
  }
}

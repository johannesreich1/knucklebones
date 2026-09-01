// Lazy online composition and navigation. Screen markup/rendering lives with
// its owner; this module owns only the shared overlay stack and route ports.
import '../online.css';
import { t } from '../../i18n/index.ts';
import { Sfx } from '../../ui/audio.ts';
import { $, hide, show } from '../../ui/dom.ts';
import { closeEnd } from '../../ui/endscreen.ts';
import { replayPlates } from '../../ui/endscreen-plates.ts';
import { isNewcomer } from '../../ui/firstrun.ts';
import { refreshHomeChip } from '../../ui/homechip.ts';
import { S } from '../../state.ts';
import { saveStats } from '../../persist.ts';
import { createAccountScreen, type AccountShowOptions } from './account-screen.ts';
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
import { ensureIdentity } from '../identity/session.ts';
import { myProfile } from '../identity/profile.ts';
import { syncAccountPreferences } from '../preferences.ts';
import {
  refreshRuneCollection,
  runeCollectionMatchesActiveAccount,
  type RuneCollectionRefresh,
} from '../runes/rune-collection.ts';
import {
  firstCollectedRuneReward,
} from '../runes/rune-reward-presentation.ts';
import {
  installOnlineShell,
  showOnlineLoading,
} from './shell.ts';
import { setFinishHandler, type FinishReport } from '../play/play.ts';
import { createEntryRuneRewardPresenter } from './entry-rune-reward.ts';

export type OnlineView = 'play' | 'ladder' | 'account';
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
  showLadder: ladder.show,
  showHistory,
  presentRuneReward: presentAccountRuneReward,
});
const result = createResultScreen({
  goHome,
  nextDuel,
  openProfile: (onReturn: () => void, options?: AccountShowOptions) =>
    openFromResult('account', onReturn, options),
  openLadder: (onReturn: () => void) => openFromResult('ladder', onReturn),
});

function showAuthPanel(mode: AuthMode, origin: AuthOrigin, notice: string | null = null): void {
  if (origin === 'home') {
    /* Every Home-origin auth flow has no current session (initial fallback,
       sign-out, or deletion). Its attach step is registration copy, never the
       guest-only "keep this account" copy. A play entry may already be
       painting its searching queue; that search ends here, clock included. */
    setSessionless(true);
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

/* ONE DOOR OUT OF THE FINISH SCREEN, TWO DESTINATIONS. The result is COVERED
   rather than closed (#ovEnd stays up behind #ovOnline), so returning is a
   one-shot closure in the single `exitOnline` slot that puts the slot back,
   uncovers, and replays the plates' theatre. The player's own row opens the
   LADDER and the rank pill on it opens the PROFILE; both come back HERE.
   Written once with the view as its only parameter — two near-copies of this
   closure is exactly how a return target comes to differ between two doors. */
function openFromResult(
  view: OnlineView,
  onReturn: () => void,
  accountOptions?: AccountShowOptions,
): void {
  entryRevision++;
  runeReward.close();
  $('#ovEnd').inert = true;
  exitOnline = () => {
    exitOnline = goHome;
    hide('#ovOnline');
    $('#ovEnd').inert = false;
    replayPlates();
    onReturn();
  };
  show('#ovOnline');
  void route(view, accountOptions);
}

function nextDuel(): void {
  const revision = ++entryRevision;
  exitOnline = goHome;
  runeReward.close();
  closeEnd();
  showEntryWait('play');
  show('#ovOnline');
  focusOnlineTitle();
  /* A result request can still be in flight, and a visible reward can still be
     inside its entrance. Verify durable unseen rows again before matchmaking;
     queueing never starts behind a reward that Next Duel just covered. The
     searching queue holds that wait exactly as a fresh entry does. */
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

async function route(view: OnlineView, accountOptions?: AccountShowOptions): Promise<void> {
  if (view === 'ladder') return ladder.show();
  if (view === 'account') return routeAccount(accountOptions);
  const user = await ensureIdentity();
  if (!user) {
    pendingView = 'play';
    showAuthPanel('restore', 'home');
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
     collection response. Entry's verified collection is a fail-closed backup
     only when that immediate second read is unavailable. */
  if (view === 'account') {
    await routeAccount({ verifiedRuneFallback: collection });
    return;
  }
  const current = (): boolean => revision === entryRevision
    && $('#ovOnline').classList.contains('on');
  const firstRune = firstCollectedRuneReward(collection);
  const firstRuneGuide: AccountShowOptions = {
    runeGuide: { complete: () => undefined, cancel: () => undefined },
    ...(firstRune ? { expectedAccountId: firstRune.accountId } : {}),
    ...(firstRune ? { deferredRuneReward: firstRune } : {}),
  };
  const resume = (): void => {
    if (revision !== entryRevision) return;
    show('#ovOnline');
    void route(firstRune ? 'account' : view, firstRune ? firstRuneGuide : undefined);
  };
  if (runeReward.present(
    collection,
    current,
    resume,
    firstRune ? () => t('online', 'profile.equipRune') : undefined,
    !!firstRune,
  )) return;
  await route(view);
}

function showEntryWait(view: OnlineView | null): void {
  if (view === 'account') return showOnlineLoading('onAccount');
  if (view === 'ladder') return showOnlineLoading('onLadder');
  /* Play paints its real destination at once: the queue's searching state
     shows nothing account-derived, so it need not wait for identity. Only
     newcomers keep the die — the tutorial offer may still route them away. */
  if (isNewcomer()) return showOnlineLoading('onQueue');
  queue.showSearching();
}

async function entered(): Promise<void> {
  const revision = ++entryRevision;
  const view = pendingView;
  pendingView = null;
  showEntryWait(view);
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
  const user = await ensureIdentity();
  if (revision !== entryRevision) return;
  setSessionless(!user);
  if (user) {
    /* Hydration stays behind the current hold — the searching queue for play,
       the die otherwise; partial account data never paints either way. */
    const [, collection] = await Promise.all([
      syncAccountPreferences(),
      refreshRuneCollection(user.id), myProfile(),
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

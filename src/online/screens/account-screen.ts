import { boardGroup, groupFill, inApex, peakState } from '../../core/ladder.ts';
import {
  formatDate,
  formatNumber,
  ladderGroupName,
  subscribeLocale,
  t,
} from '../../i18n/index.ts';
import { ask } from '../../ui/askcard.ts';
import { Sfx } from '../../ui/audio.ts';
import { DEFAULT_AVATAR, paintAvatar } from '../../ui/avatar.ts';
import { $, byId } from '../../ui/dom.ts';
import { refreshHomeChip } from '../../ui/homechip.ts';
import {
  bestStreak,
  matchHistory,
  myLadder,
  myStanding,
} from '../api/ladder-api.ts';
import {
  cacheStanding,
  claimName,
  currentUser,
  identityStatus,
  myProfile,
  signOut,
} from '../identity/session.ts';
import { historyRow } from './history-screen.ts';
import { repaintOnlineMessage } from '../message-copy.ts';
import {
  refreshRuneCollection,
  runeCollectionMatchesActiveAccount,
  type RuneCollectionRefresh,
} from '../runes/rune-collection.ts';
import { fillAccountRing } from './account-ring.ts';
import { bindAccountRuneSheets, paintAccountRunes } from './account-runes.ts';
import { isOnlinePanelCurrent, showOnlineLoading, showOnlinePanel } from './shell.ts';
import type { AuthMode, AuthOrigin } from './auth-screen.ts';
import type { Ladder, Standing } from '../api/ladder-api.ts';
import type { IdentityStatus, Me, Profile } from '../identity/session.ts';
import { paintAccountProviders } from './account-provider-view.ts';
import { bindAccountAppleRepair } from './account-apple-repair.ts';
import { bindAccountDelete } from './account-delete-flow.ts';

interface AccountPorts {
  showAuth(mode: AuthMode, origin: AuthOrigin, notice?: string | null): void;
  showAvatar(): Promise<void>;
  showLadder(): Promise<void>;
  showHistory(): Promise<void>;
  presentRuneReward(collection: RuneCollectionRefresh, owns: () => boolean): void;
}

export interface AccountScreen {
  bind(): void;
  show(): Promise<RuneCollectionRefresh | null>;
}

export function createAccountScreen(ports: AccountPorts): AccountScreen {
  let lastAccount: {
    profile: Profile | null;
    user: Me | null;
    ladder: Ladder | null;
    standing: Standing | null;
    streak: number;
    identity: IdentityStatus | null;
    runes: readonly string[];
    runeRows: RuneCollectionRefresh['rows'];
  } | null = null;
  let lastRecent: Awaited<ReturnType<typeof matchHistory>> = [];
  let pendingCachedRating: number | null = null;
  let nickError: (() => string) | null = null;
  let accountError: (() => string) | null = null;
  let showRevision = 0;

  const clearNickError = (): void => {
    nickError = null;
    $('#onNickErr').textContent = '';
  };
  const showNickError = (render: () => string): void => {
    nickError = render;
    $('#onNickErr').textContent = render();
  };
  const clearAccountError = (): void => {
    accountError = null;
    $('#onAccErr').textContent = '';
  };
  const showAccountError = (render: () => string): void => {
    accountError = render;
    $('#onAccErr').textContent = render();
  };
  const paintGroup = (points: number, apex = false): void => {
    /* The profile and ladder speak the same league language. In particular,
       NEON is positional and a high-points non-apex player stays OBSIDIAN. */
    const group = boardGroup(points, apex);
    const label = $('#accGroup') as HTMLElement;
    label.textContent = ladderGroupName(group.id);
    label.style.setProperty('--gc', `var(--g-${group.id})`);
  };
  const rankText = (standing: Standing | null, games: number, apex: boolean): string =>
    standing && games ? (apex ? ladderGroupName('neon') : '#' + formatNumber(standing.rank)) : '–';

  const paintRecent = (): void => {
    const recent = $('#accRecent');
    recent.innerHTML = '';
    for (const row of lastRecent.slice(0, 3)) recent.appendChild(historyRow(row));
    recent.hidden = !recent.childElementCount;
    /* Trim against the box that OWNS the scroll: the rows may only fill the
       gap, never be the reason the profile starts scrolling. Since the
       paged-view refactor that owner is the shared .pbody — the panel itself
       is a flex child that grows with its content, so measuring the panel
       could never see the overflow and the trim silently stopped trimming. */
    const scroller = $('#onAccount').closest('.pbody') ?? $('#onAccount');
    while (recent.lastChild && scroller.scrollHeight > scroller.clientHeight + 1) {
      recent.removeChild(recent.lastChild);
    }
    recent.hidden = !recent.childElementCount;
  };

  const paintAccount = (): void => {
    if (!lastAccount) return;
    const { profile, user, ladder, standing, streak, identity, runes, runeRows } = lastAccount;
    $('#accSince').textContent = !user?.guest && profile?.created_at
      ? t('online', 'profile.memberSince', {
        date: formatDate(new Date(profile.created_at), { month: 'long', year: 'numeric' }),
      })
      : '';
    const points = ladder?.points ?? 0;
    const peak = ladder?.peak ?? 0;
    const games = ladder ? ladder.wins + ladder.losses + ladder.draws : 0;
    const apex = standing ? inApex(points, standing.rank, standing.population) : false;
    $('#accPoints').textContent = formatNumber(points);
    paintGroup(points, apex);
    $('#accPeak').textContent = formatNumber(peak);
    $('#accGames').textContent = games
      ? t('online', 'profile.gamesLink', { count: games, formatted: formatNumber(games) })
      : t('online', 'profile.noneYet');
    $('#accRank').textContent = rankText(standing, games, apex);
    $('#accStreak').textContent = formatNumber(streak);
    paintAccountProviders(user, identity);
    paintAccountRunes(runes, runeRows);
    paintRecent();
  };

  subscribeLocale(() => {
    const panel = byId('onAccount');
    if (!panel || panel.hidden) return;
    if (lastAccount) paintAccount();
    else if (pendingCachedRating !== null) {
      $('#accPoints').textContent = formatNumber(pendingCachedRating);
      paintGroup(pendingCachedRating);
    }
    if (nickError) $('#onNickErr').textContent = nickError();
    if (accountError) $('#onAccErr').textContent = accountError();
  });

  async function show(): Promise<RuneCollectionRefresh | null> {
    const run = ++showRevision;
    const ownsRun = (): boolean => run === showRevision && isOnlinePanelCurrent('onAccount');
    showOnlineLoading('onAccount');
    lastAccount = null;
    pendingCachedRating = null;
    lastRecent = [];
    clearAccountError();
    clearNickError();
    $('#accSince').textContent = '';
    $('#accPoints').textContent = formatNumber(0);
    paintGroup(0);
    $('#accPeak').textContent = formatNumber(0);
    $('#accGames').textContent = t('online', 'profile.noneYet');
    $('#accRank').textContent = '–';
    $('#accStreak').textContent = formatNumber(0);
    $('#accName').textContent = '';
    $('#accGuest').hidden = true;
    $('#accProviders').hidden = true;
    ($('#btnSignOut') as HTMLElement).hidden = true;
    $('#accClaim').hidden = true;
    paintAvatar($('#accDie'), DEFAULT_AVATAR);
    paintAccountRunes([]);
    paintRecent();
    const ring = $('#accRing') as HTMLElement;
    ring.classList.remove('haspeak');
    ring.style.setProperty('--p', '0');
    try {
      const cached = JSON.parse(localStorage.getItem('knucklebones.online.profile') ?? 'null')?.rating;
      if (typeof cached === 'number') {
        pendingCachedRating = cached;
        fillAccountRing(ring, groupFill(cached));
        $('#accPoints').textContent = formatNumber(cached);
        paintGroup(cached);
      }
    } catch { /* forgetful host — the fresh row below paints everything anyway */ }
    /* Nothing on the profile is useful half-painted. Fetch every independent
       answer together while the shared die holds the view, then reveal one
       coherent card (recent matches included) in a single rendering turn. */
    const [profile, user, ladder, standing, streak, recent, identity, runeCollection]
      = await Promise.all([
      myProfile(),
      currentUser(),
      myLadder(),
      myStanding(),
      bestStreak(),
      matchHistory(3),
      identityStatus(),
      refreshRuneCollection(),
    ]);
    const collectionAccountId = runeCollection.accountId?.toLowerCase() ?? null;
    if (!ownsRun() || !collectionAccountId
        || user?.id.toLowerCase() !== collectionAccountId
        || (profile && profile.id.toLowerCase() !== collectionAccountId)) return null;
    const ownsCollection = await runeCollectionMatchesActiveAccount(runeCollection);
    if (!ownsCollection || !ownsRun()) return null;
    refreshHomeChip();
    $('#accGuest').hidden = !user?.guest;
    ($('#btnSignOut') as HTMLElement).hidden = !!user?.guest;
    $('#accName').textContent = profile?.nickname ?? '';
    const claim = $('#accClaim');
    claim.hidden = !profile || !!profile.named_at;
    if (!claim.hidden) {
      ($('#onNick') as HTMLInputElement).placeholder = profile!.nickname;
      clearNickError();
    }
    paintAvatar($('#accDie'), profile?.avatar ?? DEFAULT_AVATAR);
    const points = ladder?.points ?? 0;
    const peak = ladder?.peak ?? 0;
    const apex = standing ? inApex(points, standing.rank, standing.population) : false;
    lastAccount = {
      profile,
      user,
      ladder,
      standing,
      streak,
      identity,
      runes: runeCollection.collected,
      runeRows: runeCollection.rows,
    };
    lastRecent = recent;
    pendingCachedRating = null;
    paintAccount();
    cacheStanding(standing?.rank ?? null, apex);
    refreshHomeChip();

    const peakPosition = peakState(points, peak);
    fillAccountRing(ring, groupFill(points));
    ring.classList.toggle('haspeak', peakPosition.kind !== 'at');
    if (peakPosition.kind === 'ahead') ring.style.setProperty('--pk', String(peakPosition.fill));
    if (peakPosition.kind === 'above') ring.style.setProperty('--pk', '1');
    showOnlinePanel('onAccount');
    /* The hidden panel has no measurable viewport, so trim the already-loaded
       recent rows once, immediately after the atomic reveal. */
    paintRecent();
    ports.presentRuneReward(runeCollection, ownsRun);
    return runeCollection;
  }

  function bind(): void {
    bindAccountRuneSheets();
    $('#btnKeepAcc').addEventListener('click', () => {
      Sfx.tap();
      ports.showAuth('attach', 'account');
    });
    $('#btnHaveAcc').addEventListener('click', () => {
      Sfx.tap();
      ports.showAuth('restore', 'account');
    });
    bindAccountAppleRepair({
      clearError: clearAccountError,
      showError: showAccountError,
      refresh: show,
    });
    $('#btnClaim').addEventListener('click', async () => {
      Sfx.tap();
      clearNickError();
      const name = ($('#onNick') as HTMLInputElement).value.trim();
      if (name.length > 16) {
        showNickError(() => t('online', 'profile.nameTooLong', {
          count: formatNumber(name.length),
        }));
        return;
      }
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
        showNickError(() => t('online', 'profile.nameInvalid'));
        return;
      }
      const confirmed = await ask({
        head: () => t('online', 'profile.claimQuestion', { name }),
        body: () => t('online', 'profile.claimWarning'),
        confirm: () => t('online', 'profile.claimIt'),
        cancel: () => t('online', 'profile.notYet'),
        loud: true,
        restoreFocus: $('#btnClaim'),
      });
      if (!confirmed) return;
      const button = $('#btnClaim') as HTMLButtonElement;
      button.disabled = true;
      const error = await claimName(name);
      if (error) {
        button.disabled = false;
        const returned = error;
        showNickError(() => repaintOnlineMessage(returned));
        return;
      }
      clearNickError();
      $('#accClaim').hidden = true;
      $('#accName').textContent = name;
      button.disabled = false;
      await show();
      const user = await currentUser();
      if (user?.guest) {
        const upgrade = await ask({
          head: () => t('online', 'profile.keepNameTitle', { name }),
          body: () => t('online', 'profile.keepNameDetail'),
          confirm: () => t('online', 'auth.createAction'),
          cancel: () => t('online', 'profile.notNow'),
          loud: true,
          restoreFocus: $('#btnKeepAcc'),
        });
        if (upgrade) ports.showAuth('attach', 'account');
      }
    });
    $('#btnSignOut').addEventListener('click', async () => {
      Sfx.tap();
      await signOut();
      refreshHomeChip();
      ports.showAuth('restore', 'home');
    });
    $('#btnAvatar').addEventListener('click', () => {
      Sfx.tap();
      void ports.showAvatar();
    });
    $('#btnHistory').addEventListener('click', () => {
      Sfx.tap();
      void ports.showHistory();
    });
    const openLadder = (): void => {
      Sfx.tap();
      void ports.showLadder();
    };
    $('#btnLadder').addEventListener('click', openLadder);
    $('#btnRank').addEventListener('click', openLadder);
    bindAccountDelete({
      clearError: clearAccountError,
      showError: showAccountError,
      showAuth: ports.showAuth,
    });
  }

  return { bind, show };
}

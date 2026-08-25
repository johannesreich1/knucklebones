import { boardGroup, groupFill, inApex, peakState } from '../core/ladder.ts';
import {
  formatDate,
  formatNumber,
  ladderGroupName,
  subscribeLocale,
  t,
} from '../i18n/index.ts';
import { ask } from '../ui/askcard.ts';
import { Sfx } from '../ui/audio.ts';
import { DEFAULT_AVATAR, paintAvatar } from '../ui/avatar.ts';
import { $ } from '../ui/dom.ts';
import { refreshHomeChip } from '../ui/homechip.ts';
import {
  bestStreak,
  matchHistory,
  myLadder,
  myStanding,
} from './ladder-api.ts';
import {
  cacheStanding,
  claimName,
  currentUser,
  deleteAccount,
  myProfile,
  signOut,
} from './session.ts';
import { historyRow } from './history-screen.ts';
import { repaintOnlineMessage } from './message-copy.ts';
import { refreshRuneCollection } from './rune-collection.ts';
import { fillAccountRing } from './account-ring.ts';
import { paintAccountRunes } from './account-runes.ts';
import { isOnlinePanelCurrent, showOnlineLoading, showOnlinePanel } from './shell.ts';
import type { AuthMode, AuthOrigin } from './auth-screen.ts';
import type { Ladder, Standing } from './ladder-api.ts';
import type { Me, Profile } from './session.ts';

interface AccountPorts {
  showAuth(mode: AuthMode, origin: AuthOrigin): void;
  showAvatar(): Promise<void>;
  showBoard(): Promise<void>;
  showHistory(): Promise<void>;
}

export interface AccountScreen {
  bind(): void;
  show(): Promise<void>;
}

export function createAccountScreen(ports: AccountPorts): AccountScreen {
  let lastAccount: {
    profile: Profile | null;
    user: Me | null;
    ladder: Ladder | null;
    standing: Standing | null;
    streak: number;
    runes: readonly string[];
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
    const account = $('#onAccount');
    while (recent.lastChild && account.scrollHeight > account.clientHeight + 1) {
      recent.removeChild(recent.lastChild);
    }
    recent.hidden = !recent.childElementCount;
  };

  const paintAccount = (): void => {
    if (!lastAccount) return;
    const { profile, user, ladder, standing, streak, runes } = lastAccount;
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
    paintAccountRunes(runes);
    paintRecent();
  };

  subscribeLocale(() => {
    const panel = document.getElementById('onAccount');
    if (!panel || panel.hidden) return;
    if (lastAccount) paintAccount();
    else if (pendingCachedRating !== null) {
      $('#accPoints').textContent = formatNumber(pendingCachedRating);
      paintGroup(pendingCachedRating);
    }
    if (nickError) $('#onNickErr').textContent = nickError();
    if (accountError) $('#onAccErr').textContent = accountError();
  });

  async function show(): Promise<void> {
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
    const [profile, user, ladder, standing, streak, recent, runeCollection] = await Promise.all([
      myProfile(),
      currentUser(),
      myLadder(),
      myStanding(),
      bestStreak(),
      matchHistory(3),
      refreshRuneCollection(),
    ]);
    if (!ownsRun()) return;
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
    const games = ladder ? ladder.wins + ladder.losses + ladder.draws : 0;
    const apex = standing ? inApex(points, standing.rank, standing.population) : false;
    lastAccount = { profile, user, ladder, standing, streak, runes: runeCollection.collected };
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
  }

  function bind(): void {
    $('#btnKeepAcc').addEventListener('click', () => {
      Sfx.tap();
      ports.showAuth('attach', 'account');
    });
    $('#btnHaveAcc').addEventListener('click', () => {
      Sfx.tap();
      ports.showAuth('restore', 'account');
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
      void ports.showBoard();
    };
    $('#btnLadder').addEventListener('click', openLadder);
    $('#btnRank').addEventListener('click', openLadder);
    $('#btnDeleteAcc').addEventListener('click', async () => {
      Sfx.tap();
      clearAccountError();
      const confirmed = await ask({
        head: () => t('online', 'profile.deleteTitle'),
        body: () => t('online', 'profile.deleteDetail'),
        confirm: () => t('online', 'profile.deleteEverything'),
        cancel: () => t('online', 'profile.keepAccount'),
        danger: true,
        check: () => t('online', 'profile.deleteCheck'),
        restoreFocus: $('#btnDeleteAcc'),
      });
      if (!confirmed) return;
      const error = await deleteAccount();
      if (error) {
        const returned = error;
        showAccountError(() => repaintOnlineMessage(returned));
        return;
      }
      clearAccountError();
      refreshHomeChip();
      ports.showAuth('restore', 'home');
    });
  }

  return { bind, show };
}

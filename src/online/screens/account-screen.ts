import {
  currentGroupFill,
  currentGroupRingFill,
  currentGroupRingPeakState,
  currentInApex,
} from '../../ladder-presentation.ts';
import {
  formatDate,
  formatNumber,
  subscribeLocale,
  t,
} from '../../i18n/index.ts';
import { DEFAULT_AVATAR, paintAvatar } from '../../ui/avatar.ts';
import { $, byId } from '../../ui/dom.ts';
import { refreshHomeChip } from '../../ui/homechip.ts';
import {
  bestStreak,
  matchHistory,
  myLadder,
  myStanding,
} from '../api/ladder-api.ts';
import { refreshVerifiedRankedCurveVersion } from '../api/ranked-curve-verification.ts';
import { currentUser, identityStatus } from '../identity/session.ts';
import { myProfile } from '../identity/profile.ts';
import { cacheStanding, readProfileCache } from '../../profile-cache.ts';
import { cachedLadderCurveVersion } from '../../progression-status-cache.ts';
import { historyRow } from './history-screen.ts';
import {
  acknowledgeRuneReward,
  refreshRuneCollection,
  runeCollectionMatchesActiveAccount,
  type RuneCollectionRefresh,
} from '../runes/rune-collection.ts';
import {
  firstCollectedRuneReward,
  type RuneRewardPresentation,
} from '../runes/rune-reward-presentation.ts';
import { fillAccountRing } from './account-ring.ts';
import { paintAccountRunes, paintEquippedSeat } from './account-runes.ts';
import { isOnlinePanelCurrent, showOnlineLoading, showOnlinePanel } from './shell.ts';
import type { AuthMode, AuthOrigin } from './auth-screen.ts';
import type { Ladder, Standing } from '../api/ladder-api.ts';
import type { IdentityStatus, Me } from '../identity/session.ts';
import type { Profile } from '../identity/profile.ts';
import { paintAccountProviders } from './account-provider-view.ts';
import { bindAccountScreen } from './account-bindings.ts';
import {
  cancelAccountRuneGuide,
  repaintAccountRuneGuide,
  startAccountRuneGuide,
  type AccountRuneGuideRequest,
} from './account-rune-guide.ts';
import {
  accountProgressionSnapshot,
  paintAccountAchievements,
} from './account-achievements.ts';
import { accountRankText, paintAccountGroup } from './account-ladder.ts';

interface AccountPorts {
  showAuth(mode: AuthMode, origin: AuthOrigin, notice?: string | null): void;
  showAvatar(): Promise<void>;
  showLadder(): Promise<void>;
  showHistory(): Promise<void>;
  presentRuneReward(
    collection: RuneCollectionRefresh,
    owns: () => boolean,
    onContinue?: () => void,
    actionLabel?: () => string,
    deferAcknowledgement?: boolean,
  ): boolean;
}

export interface AccountShowOptions {
  readonly runeGuide?: AccountRuneGuideRequest;
  /** A result-origin guide belongs to the account that owned that result. */
  readonly expectedAccountId?: string;
  /** The same first-rune sheet already handed this player to Profile. Keep
      that durable row unseen and do not deal a duplicate sheet here. */
  readonly deferredRuneReward?: RuneRewardPresentation;
  /** Entry already verified this collection; use it only if Profile's own
      immediately-following refresh is transiently unavailable. */
  readonly verifiedRuneFallback?: RuneCollectionRefresh;
}

export interface AccountScreen {
  bind(): void;
  show(options?: AccountShowOptions): Promise<RuneCollectionRefresh | null>;
}

export function createAccountScreen(ports: AccountPorts): AccountScreen {
  let lastAccount: {
    profile: Profile | null;
    user: Me | null;
    ladder: Ladder | null;
    standing: Standing | null;
    streak: number;
    identity: IdentityStatus | null;
    progression: ReturnType<typeof accountProgressionSnapshot>;
    runes: readonly string[];
    runeRows: RuneCollectionRefresh['rows'];
  } | null = null;
  let lastRecent: Awaited<ReturnType<typeof matchHistory>> = [];
  let pendingCachedRating: number | null = null;
  let nickError: (() => string) | null = null;
  let showRevision = 0;

  /* The profile's ONE remaining inline error line, and it is the only kind
     that belongs inline: nickname validation answers a field the player is
     still typing in, directly beneath it. Everything the ACCOUNT ACCESS box
     can refuse — a provider link, a deletion — is dealt as a warning card
     instead (account-problem-sheet.ts), because that answer arrived from
     somewhere else and has to be READ, not noticed. */
  const clearNickError = (): void => {
    nickError = null;
    $('#onNickErr').textContent = '';
  };
  const showNickError = (render: () => string): void => {
    nickError = render;
    $('#onNickErr').textContent = render();
  };
  /* THREE, NEWEST FIRST, ON EVERY DEVICE (user call 2026-08-28). The strip used
     to paint three rows and then remove them one at a time while the shared
     .pbody overflowed, which made the section's length a property of the
     hardware. It is a section with a heading now: it either states the three
     newest duels or — for a player who has none — is not there at all. Where
     the profile no longer fits, the .pbody scrolls, exactly as it already does
     for a short device. matchHistory answers newest-first, so appending in
     order puts the latest duel on top. */
  const paintRecent = (): void => {
    const recent = $('#accRecent');
    recent.innerHTML = '';
    for (const row of lastRecent.slice(0, 3)) recent.appendChild(historyRow(row));
    $('#accRecentBox').hidden = !recent.childElementCount;
  };

  const paintAccount = (): void => {
    if (!lastAccount) return;
    const {
      profile,
      user,
      ladder,
      standing,
      streak,
      identity,
      progression,
      runes,
      runeRows,
    } = lastAccount;
    $('#accSince').textContent = !user?.guest && profile?.created_at
      ? t('online', 'profile.memberSince', {
        date: formatDate(new Date(profile.created_at), { month: 'long', year: 'numeric' }),
      })
      : '';
    const points = ladder?.points ?? 0;
    const peak = ladder?.peak ?? 0;
    const games = ladder ? ladder.wins + ladder.losses + ladder.draws : 0;
    const apex = standing ? currentInApex(points, standing.rank, standing.population) : false;
    $('#accPoints').textContent = formatNumber(points);
    paintAccountGroup(points, apex);
    $('#accPeak').textContent = formatNumber(peak);
    $('#accGames').textContent = games
      ? t('online', 'profile.gamesLink', { count: games, formatted: formatNumber(games) })
      : t('online', 'profile.noneYet');
    $('#accRank').textContent = accountRankText(standing, games);
    $('#accStreak').textContent = formatNumber(streak);
    paintAccountProviders(user, identity);
    paintAccountRunes(runes, runeRows);
    paintAccountAchievements(progression);
    /* The ring and PEAK label stay current-season. The rune seat instead uses
       the all-season SILVER fact; mutable profile rating is not evidence that
       this permanent achievement happened. */
    paintEquippedSeat(ladder?.runeSeatUnlocked ? 'silver' : null);
    paintRecent();
  };

  subscribeLocale(() => {
    const panel = byId('onAccount');
    if (!panel || panel.hidden) return;
    if (lastAccount) paintAccount();
    else if (pendingCachedRating !== null) {
      $('#accPoints').textContent = formatNumber(pendingCachedRating);
      paintAccountGroup(pendingCachedRating);
    }
    repaintAccountRuneGuide();
    if (nickError) $('#onNickErr').textContent = nickError();
  });

  async function show(options: AccountShowOptions = {}): Promise<RuneCollectionRefresh | null> {
    const run = ++showRevision;
    const ownsRun = (): boolean => run === showRevision && isOnlinePanelCurrent('onAccount');
    cancelAccountRuneGuide();
    showOnlineLoading('onAccount');
    lastAccount = null;
    pendingCachedRating = null;
    lastRecent = [];
    clearNickError();
    $('#accSince').textContent = '';
    $('#accPoints').textContent = formatNumber(0);
    paintAccountGroup(0);
    $('#accPeak').textContent = formatNumber(0);
    $('#accGames').textContent = t('online', 'profile.noneYet');
    $('#accRank').textContent = '–';
    $('#accStreak').textContent = formatNumber(0);
    $('#accName').textContent = '';
    $('#accGuest').hidden = true;
    paintAccountProviders(null, null);
    ($('#btnSignOut') as HTMLElement).hidden = true;
    $('#accClaim').hidden = true;
    paintAvatar($('#accDie'), DEFAULT_AVATAR);
    paintAccountRunes([]);
    paintAccountAchievements(null);
    paintEquippedSeat(null);
    paintRecent();
    const ring = $('#accRing') as HTMLElement;
    ring.classList.remove('haspeak');
    ring.style.setProperty('--p', '0');
    // A forgetful host simply reads as nothing cached; the fresh row below
    // paints everything anyway.
    const cached = readProfileCache()?.rating;
    if (typeof cached === 'number' && cachedLadderCurveVersion() !== null) {
      pendingCachedRating = cached;
      fillAccountRing(ring, currentGroupFill(cached));
      $('#accPoints').textContent = formatNumber(cached);
      paintAccountGroup(cached);
    }
    /* Resolve the server's curve before accepting a freshly mapped points row.
       A v2 rating may never be classified through cached v1 floors; an older
       server simply answers no status and myLadder retains its public-v1
       fallback. The shared die still holds the view throughout. */
    const curveVersion = await refreshVerifiedRankedCurveVersion();
    if (!ownsRun() || curveVersion === null) return null;
    /* Nothing on the profile is useful half-painted. Fetch every independent
       answer together, then reveal one coherent card (recent matches included)
       in a single rendering turn. */
    const [profile, user, ladder, standing, streak, recent, identity, refreshedRunes]
      = await Promise.all([
      myProfile(),
      currentUser(),
      myLadder(curveVersion),
      myStanding(),
      bestStreak(),
      matchHistory(3),
      identityStatus(),
      refreshRuneCollection(),
    ]);
    let runeCollection = refreshedRunes;
    const fallback = options.verifiedRuneFallback;
    if (!runeCollection.verified && fallback?.verified && fallback.accountId
        && user?.id.toLowerCase() === fallback.accountId.toLowerCase()
        && await runeCollectionMatchesActiveAccount(fallback)) {
      runeCollection = fallback;
    }
    const collectionAccountId = runeCollection.accountId?.toLowerCase() ?? null;
    if (!ownsRun() || !collectionAccountId || !profile
        || user?.id.toLowerCase() !== collectionAccountId
        || profile.id.toLowerCase() !== collectionAccountId) return null;
    const ownsCollection = await runeCollectionMatchesActiveAccount(runeCollection);
    if (!ownsCollection || !ownsRun()) return null;
    if (options.runeGuide && options.expectedAccountId
        && collectionAccountId !== options.expectedAccountId.toLowerCase()) return null;
    const progression = accountProgressionSnapshot(collectionAccountId);
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
    const apex = standing ? currentInApex(points, standing.rank, standing.population) : false;
    lastAccount = {
      profile,
      user,
      ladder,
      standing,
      streak,
      identity,
      progression,
      runes: runeCollection.collected,
      runeRows: runeCollection.rows,
    };
    lastRecent = recent;
    pendingCachedRating = null;
    paintAccount();
    cacheStanding(standing?.rank ?? null, apex);
    refreshHomeChip();

    const peakPosition = currentGroupRingPeakState(points, peak, apex);
    fillAccountRing(ring, currentGroupRingFill(points, apex));
    ring.classList.toggle('haspeak', peakPosition.kind !== 'at');
    if (peakPosition.kind === 'ahead') ring.style.setProperty('--pk', String(peakPosition.fill));
    if (peakPosition.kind === 'above') ring.style.setProperty('--pk', '1');
    showOnlinePanel('onAccount');
    const firstUnseenRune = firstCollectedRuneReward(runeCollection);
    const guidedReward = options.deferredRuneReward ?? firstUnseenRune;
    const requestedGuide = options.runeGuide ?? (firstUnseenRune ? {
      complete: () => undefined,
      cancel: () => undefined,
    } : undefined);
    const guideRequest = requestedGuide && guidedReward ? {
      complete: () => {
        /* The tutorial is mandatory through the real seat, not merely through
           the arrival animation. Only this tap consumes the durable reward. */
        void acknowledgeRuneReward(guidedReward.accountId, guidedReward.rune.id);
        requestedGuide.complete();
      },
      cancel: () => requestedGuide.cancel(),
    } : requestedGuide;
    const beginGuide = (): void => {
      if (!guideRequest || !ownsRun()) return;
      if (!runeCollection.collected.length) {
        guideRequest.cancel();
        return;
      }
      startAccountRuneGuide(runeCollection.collected, guideRequest);
    };
    const handedOffReward = options.deferredRuneReward
      && firstUnseenRune?.rune.id === options.deferredRuneReward.rune.id;
    const rewardShown = handedOffReward ? false : ports.presentRuneReward(
      runeCollection,
      ownsRun,
      beginGuide,
      firstUnseenRune ? () => t('online', 'profile.equipRune') : undefined,
      !!firstUnseenRune,
    );
    if (!rewardShown) beginGuide();
    return runeCollection;
  }


  const bind = (): void => bindAccountScreen({
    showAuth: ports.showAuth,
    showAvatar: () => ports.showAvatar(),
    showLadder: () => ports.showLadder(),
    showHistory: () => ports.showHistory(),
    refresh: show,
    repaint: paintAccount,
    clearNickError,
    showNickError,
  });

  return { bind, show };
}

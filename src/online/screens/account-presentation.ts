// Profile's synchronous renderer. The screen controller owns fetch/revision
// state; this module owns the one DOM presentation shared by cached and fresh
// account data.
import {
  currentBoardGroup,
  currentGroupRingFill,
  currentGroupRingPeakState,
  currentInApex,
} from '../../ladder-presentation.ts';
import type { LadderCurveVersion } from '../../progression-status-cache.ts';
import { S } from '../../state.ts';
import { accountOffers, paintAccountOffers } from './account-offers.ts';
import {
  formatDate,
  formatNumber,
  ladderGroupName,
  t,
} from '../../i18n/index.ts';
import { DEFAULT_AVATAR, paintAvatar } from '../../ui/avatar.ts';
import { $ } from '../../ui/dom.ts';
import { loaderDie } from '../../ui/loader.ts';
import type { HistoryRow, Standing } from '../api/ladder-api.ts';
import { paintAccountProviders } from './account-provider-view.ts';
import { clearAccountRing, fillAccountRing } from './account-ring.ts';
import {
  accountProgressionSnapshot,
  paintAccountAchievements,
} from './account-achievements.ts';
import { paintAccountRunes, paintEquippedSeat } from './account-runes.ts';
import type { AccountViewData, CachedAccountView } from './account-profile-cache.ts';
import { historyRow } from './history-screen.ts';

function paintGroup(points: number, apex = false, version?: LadderCurveVersion): void {
  /* The profile and ladder speak the same league language. In particular,
     NEON is positional and a high-points non-apex player stays OBSIDIAN. */
  const group = currentBoardGroup(points, apex, version);
  const label = $('#accGroup') as HTMLElement;
  const material = `var(--g-${group.id})`;
  /* COLOUR-BLIND MODE SPENDS ITS ONE GOLD ON THE LEAGUE. The seven league
     materials are stone, bone, ivory, silver, gold, obsidian and neon — four
     of them near-neutral and two of them the very hues the mode exists to
     separate, so as a set they carry no information to a player who cannot
     tell them apart. The mode already pins the displayed pair to cyan-vs-gold
     (ui/hues.ts), so the league name and its number take var(--p2) — gold in
     this mode by construction, and never a second hue to resolve.
     THE RING KEEPS ITS MATERIAL: it reports progress by how far it is filled,
     which survives any palette, and it is the one place the league's own
     colour still costs nothing. */
  const ink = S.colorblind ? 'var(--p2)' : material;
  label.textContent = ladderGroupName(group.id);
  /* THE LEAGUE'S MATERIAL IS ONE FACT ABOUT THIS SCREEN, so it lands on the
     PANEL and everything that speaks league reads the same --gc: the name in
     the ring's mouth and the points below it. It used to sit on the label
     alone, which left the points a hardcoded gold — right at GOLD and wrong at
     every other league. The ladder row's points (.lrow .rt) and the Home plate
     already read var(--gc,var(--gold)); this is the profile joining them. */
  ($('#onAccount') as HTMLElement).style.setProperty('--gc', ink);
  ($('#accRing') as HTMLElement).style.setProperty('--lr-material', material);
}

function paintRank(standing: Standing | null, games: number, pending: boolean): void {
  const value = $('#accRank');
  const button = $('#btnRank');
  const action = t('online', 'profile.openLadder');
  const label = t('online', 'profile.rank');
  if (pending) {
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', `${label}: ${t('common', 'states.loading')}. ${action}`);
    if (!value.querySelector('.ldclock')) value.replaceChildren(loaderDie(16));
    return;
  }
  button.removeAttribute('aria-busy');
  const rank = standing && games ? '#' + formatNumber(standing.rank) : '–';
  value.textContent = rank;
  button.setAttribute('aria-label', `${label}: ${rank}. ${action}`);
}

/* THREE, NEWEST FIRST, ON EVERY DEVICE (user call 2026-08-28). The strip is a
   section with a heading: it states the three newest duels or is absent. */
function paintRecent(recentRows: readonly HistoryRow[]): void {
  const recent = $('#accRecent');
  recent.innerHTML = '';
  for (const row of recentRows.slice(0, 3)) recent.appendChild(historyRow(row));
  $('#accRecentBox').hidden = !recent.childElementCount;
}

/** Repaint locale-sensitive/detail content without restarting the ring fill. */
export function paintAccountDetails(
  account: AccountViewData,
  recent: readonly HistoryRow[],
  rankPending: boolean,
): void {
  const { profile, user, ladder, standing, streak, identity, runes, runeRows, equipment } = account;
  $('#accSince').textContent = !user.guest && profile.created_at
    ? t('online', 'profile.memberSince', {
      date: formatDate(new Date(profile.created_at), { month: 'long', year: 'numeric' }),
    })
    : '';
  const points = ladder.points;
  const peak = ladder.peak;
  const games = ladder.wins + ladder.losses + ladder.draws;
  const apex = standing
    ? currentInApex(points, standing.rank, standing.population, account.curveVersion) : false;
  $('#accPoints').textContent = formatNumber(points);
  /* NEON is positional: the rank and population that confirm it arrive with
     the standing, the one fact Profile loads separately. The points already
     prove every league below it, so paint that league at once rather than the
     reset's bottom one; applyStanding() lifts an apex player to NEON. */
  paintGroup(points, apex, account.curveVersion);
  $('#accPeak').textContent = formatNumber(peak);
  $('#accGames').textContent = games
    ? t('online', 'profile.gamesLink', { count: games, formatted: formatNumber(games) })
    : t('online', 'profile.noneYet');
  paintRank(standing, games, rankPending);
  $('#accStreak').textContent = formatNumber(streak);
  paintAccountProviders(user, identity);
  paintAccountRunes(runes, runeRows);
  /* The rune seat follows the permanent historical-SILVER fact, not mutable
     current-season group presentation. */
  paintEquippedSeat(ladder.runeSeatUnlocked ? 'silver' : null, equipment, runes);
  /* The achievements module owns its own account-bound snapshot, so a cached
     Profile can never show the previous account's weekly mark or medals. */
  paintAccountAchievements(accountProgressionSnapshot(user.id));
  paintRecent(recent);
}

export function paintAccountFrame(
  account: AccountViewData,
  recent: readonly HistoryRow[],
  rankPending: boolean,
  clearNickError: () => void,
): void {
  const { profile, user, ladder, standing } = account;
  ($('#btnSignOut') as HTMLElement).hidden = user.guest;
  /* The two offers are dealt together now — they were two independent `hidden`
     writes, which is exactly how the profile came to ask both questions at
     once. account-offers.ts decides which apply and the deck pages them. */
  paintAccountOffers(accountOffers(!!profile.named_at, user.guest));
  /* THE NAME IS STATE, NOT A HEADLINE. The profile no longer prints the
     nickname under the ring (owner call): it is your own profile, and the line
     only pushed the points down. It stays addressable as panel state so
     anything asking "whose profile is on screen" still has one honest answer. */
  ($('#onAccount') as HTMLElement).dataset.accountName = profile.nickname;
  if (!profile.named_at) {
    ($('#onNick') as HTMLInputElement).placeholder = profile.nickname;
    clearNickError();
  }
  paintAvatar($('#accDie'), profile.avatar ?? DEFAULT_AVATAR);
  const apex = standing
    ? currentInApex(ladder.points, standing.rank, standing.population, account.curveVersion)
    : false;
  const ring = $('#accRing') as HTMLElement;
  /* The ring reads the same league as the label: the points-proven one now,
     the positional apex once the standing has confirmed it. */
  const peakPosition = currentGroupRingPeakState(ladder.points, ladder.peak, apex, account.curveVersion);
  fillAccountRing(ring, currentGroupRingFill(ladder.points, apex, account.curveVersion));
  ring.classList.toggle('haspeak', peakPosition.kind !== 'at');
  if (peakPosition.kind === 'ahead') ring.style.setProperty('--pk', String(peakPosition.fill));
  if (peakPosition.kind === 'above') ring.style.setProperty('--pk', '1');
  paintAccountDetails(account, recent, rankPending);
}

export function resetAccountPresentation(
  cached: CachedAccountView | null,
  clearNickError: () => void,
  /* Whether Profile is ARRIVING, rather than restating the frame it is already
     wearing. Only an arrival empties the ring, so its one sweep survives the
     further presentations a single open produces (account-screen.ts). */
  arriving = true,
): void {
  clearNickError();
  $('#accSince').textContent = '';
  $('#accPoints').textContent = formatNumber(0);
  paintGroup(0);
  $('#accPeak').textContent = formatNumber(0);
  $('#accGames').textContent = t('online', 'profile.noneYet');
  $('#accRank').textContent = '–';
  $('#accStreak').textContent = formatNumber(0);
  ($('#onAccount') as HTMLElement).dataset.accountName = '';
  paintAccountOffers([]);
  paintAccountProviders(null, null);
  ($('#btnSignOut') as HTMLElement).hidden = true;
  paintAvatar($('#accDie'), DEFAULT_AVATAR);
  paintAccountRunes([]);
  paintEquippedSeat(null, { kind: 'none' }, []);
  paintAccountAchievements(null);
  paintRecent([]);
  const ring = $('#accRing') as HTMLElement;
  ring.classList.remove('haspeak');
  if (arriving || !cached) clearAccountRing(ring);
  if (cached) paintAccountFrame(cached.account, cached.recent, true, clearNickError);
}

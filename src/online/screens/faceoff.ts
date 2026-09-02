import {
  boardGroup,
  type LadderCurveVersion,
} from '../../core/ladder.ts';
import { confirmedLadderCurveVersion } from '../../progression-status-cache.ts';
import { formatNumber, ladderGroupName, subscribeLocale, t } from '../../i18n/index.ts';
import { paintAvatar } from '../../ui/avatar.ts';
import { loaderDie } from '../../ui/loader.ts';
import { recordHtml } from '../../ui/record.ts';
import { showSheet } from '../../ui/sheet.ts';
import {
  bestStreak,
  myStanding,
  playerCard,
  type Ladder,
  type LadderRow,
} from '../api/ladder-api.ts';
import { esc, percent, pts, rank } from './format.ts';

export interface MySide {
  name: string;
  avatar: string | null;
  lad: Ladder;
  apex: boolean;
}

let paintOpenFaceoff: (() => void) | null = null;
subscribeLocale(() => { paintOpenFaceoff?.(); });

export function showFaceoff(
  row: LadderRow,
  mine: MySide | null,
  onClose?: () => void,
  curveVersion: LadderCurveVersion = confirmedLadderCurveVersion(),
): void {
  const group = boardGroup(row.points, row.apex, curveVersion);
  const myGroup = mine ? boardGroup(mine.lad.points, mine.apex, curveVersion) : null;
  const myGames = mine ? mine.lad.wins + mine.lad.losses + mine.lad.draws : 0;
  const rate = (wins: number, games: number): string => games ? percent(wins / games) : '–';
  const stat = (cls: string, theirs: string, ours?: string | false | null): string =>
    `<div class="fost ${cls}"><span class="a">${theirs}</span><span class="k"></span>`
    + (mine ? `<span class="b">${ours || '–'}</span>` : '') + '</div>';
  const { ov } = showSheet({
    cls: mine ? undefined : 'solo',
    label: row.nickname,
    body: `<div class="focols dice-static">
      <div class="focol" style="--gc:var(--g-${group.id})">
        <span class="av"></span><span class="fnm">${esc(row.nickname)}</span>
        <span class="gpill"></span>
      </div>` + (mine ? `
      <span class="fovs"></span>
      <div class="focol you" style="--gc:var(--g-${myGroup!.id})">
        <span class="av"></span><span class="fnm">${esc(mine.name)}</span>
        <span class="gpill"></span>
      </div>` : '') + `
    </div>
    <div class="fostats">
      ${stat('points', '', mine && '')}
      ${stat('record', '', mine && '')}
      ${stat('streak', '<span class="fostreak">–</span>', mine && '<span class="mystreak">–</span>')}
      ${stat('peak', '', mine && '')}
      ${stat('rate', '', mine && '')}
    </div>`,
    onClose,
  });
  let theirStreak: number | null | undefined;
  let myStreak: number | null | undefined;
  let myRank: number | null = null;
  const setPair = (selector: string, theirs: string, ours?: string): void => {
    const line = ov.querySelector(selector);
    const a = line?.querySelector('.a');
    const b = line?.querySelector('.b');
    if (a) a.innerHTML = theirs;
    if (b && ours != null) b.innerHTML = ours;
  };
  const paint = (): void => {
    if (!ov.isConnected) {
      if (paintOpenFaceoff === paint) paintOpenFaceoff = null;
      return;
    }
    (ov.querySelector('.focol:not(.you) .gpill') as HTMLElement).textContent =
      `${ladderGroupName(group.id)} · ${rank(row.rank)}`;
    const versus = ov.querySelector('.fovs');
    if (versus) versus.textContent = t('common', 'versus');
    const myPill = ov.querySelector('.focol.you .gpill');
    if (myPill && myGroup) myPill.textContent = ladderGroupName(myGroup.id)
      + (myRank == null ? '' : ` · ${rank(myRank)}`);
    const labels = {
      points: t('online', 'profile.points'),
      record: t('online', 'ladder.record'),
      streak: t('online', 'profile.bestStreak'),
      peak: t('online', 'profile.peak'),
      rate: t('online', 'ladder.winRate'),
    } as const;
    for (const [cls, label] of Object.entries(labels)) {
      const key = ov.querySelector(`.fost.${cls} .k`);
      if (key) key.textContent = label;
    }
    setPair('.fost.points', pts(row.points), mine ? pts(mine.lad.points) : undefined);
    setPair('.fost.record', recordHtml(row.wins, row.losses), mine
      ? recordHtml(mine.lad.wins, mine.lad.losses) : undefined);
    setPair('.fost.peak', pts(row.peak), mine ? pts(mine.lad.peak) : undefined);
    setPair('.fost.rate', rate(row.wins, row.games), mine
      ? rate(mine.lad.wins, myGames) : undefined);
    if (theirStreak !== undefined) {
      const value = ov.querySelector('.fostreak');
      if (value) value.textContent = theirStreak == null ? '–' : formatNumber(theirStreak);
    }
    if (myStreak !== undefined) {
      const value = ov.querySelector('.mystreak');
      if (value) value.textContent = myStreak == null ? '–' : formatNumber(myStreak);
    }
  };
  paintOpenFaceoff = paint;
  for (const selector of mine ? ['.fostreak', '.mystreak'] : ['.fostreak']) {
    (ov.querySelector(selector) as HTMLElement).replaceChildren(loaderDie(16));
  }
  paintAvatar(ov.querySelector('.focol .av') as HTMLElement, row.avatar, 46);
  if (mine) paintAvatar(ov.querySelector('.focol.you .av') as HTMLElement, mine.avatar, 46);
  paint();
  void Promise.all([
    playerCard(row.nickname),
    mine ? bestStreak() : null,
    mine ? myStanding() : null,
  ]).then(([card, streak, standing]) => {
    theirStreak = card?.streak ?? null;
    myStreak = mine ? streak : undefined;
    myRank = standing?.rank ?? null;
    paint();
  });
}

import { inApex } from '../core/ladder.ts';
import { hide } from '../ui/dom.ts';
import { showEnd, setPlates } from '../ui/endscreen.ts';
import { refreshHomeChip } from '../ui/homechip.ts';
import {
  myLadder,
  myStanding,
  playerCard,
  type PlayerCard,
} from './ladder-api.ts';
import { showFaceoff, type MySide } from './ladder-screen.ts';
import { cacheStanding, myProfile } from './session.ts';
import type { FinishReport } from './play.ts';

interface ResultPorts {
  goHome(): void;
  nextDuel(): void;
  openProfile(): void;
}

export interface ResultScreen {
  show(report: FinishReport): Promise<void>;
}

export function createResultScreen(ports: ResultPorts): ResultScreen {
  async function show(report: FinishReport): Promise<void> {
    hide('#ovOnline');
    const title = report.draw ? 'DEAD HEAT' : report.won ? 'VICTORY' : 'DEFEAT';
    const deltaText = report.delta != null
      ? ` · ${report.delta >= 0 ? '+' : ''}${report.delta} points` : '';
    let cache: {
      nickname?: string;
      rating?: number;
      avatar?: string | null;
      rank?: number;
      apex?: boolean;
    } | null = null;
    try {
      cache = JSON.parse(localStorage.getItem('knucklebones.online.profile') ?? 'null');
    } catch { /* forgetful host */ }
    const cachedRating = typeof cache?.rating === 'number' && report.delta != null
      ? cache.rating + report.delta : null;
    const plates = (
      points: number | null,
      rank: number | null,
      apex: boolean,
      foe: PlayerCard | null,
      mine: MySide | null,
    ) => [
      {
        name: cache?.nickname ?? 'You',
        avatar: cache?.avatar ?? null,
        points,
        rank,
        apex,
        delta: report.delta,
        won: report.won,
        lost: !report.won && !report.draw,
        tap: ports.openProfile,
      },
      {
        name: report.opp,
        avatar: report.oppAvatar,
        points: foe?.points ?? report.oppRating,
        rank: foe?.rank ?? null,
        apex: !!foe?.apex,
        theirs: true,
        won: !report.won && !report.draw,
        lost: report.won,
        stamp: report.won ? (report.forfeit ? 'FORFEIT' : 'BEATEN') : undefined,
        tap: foe && foe.points != null && foe.rank != null ? () => showFaceoff({
          nickname: report.opp,
          points: foe.points!,
          wins: foe.wins ?? 0,
          losses: foe.losses ?? 0,
          games: foe.games ?? 0,
          rank: foe.rank!,
          apex: foe.apex,
          avatar: report.oppAvatar,
          peak: foe.peak ?? 0,
        }, mine) : undefined,
      },
    ];
    showEnd({
      outcome: report.draw ? 'draw' : report.won ? 'win' : 'lose',
      title,
      sub: report.forfeit ? (report.won ? report.opp + ' forfeited' : 'Match forfeited')
        : report.draw ? 'Down to the last die'
        : report.won ? 'You out-rolled ' + report.opp : report.opp + ' takes it',
      you: { score: report.my, label: '' },
      them: { score: report.their, label: '' },
      plates: plates(cachedRating, cache?.rank ?? null, !!cache?.apex, null, null),
      again: { label: 'Next duel', run: ports.nextDuel },
      quiet: { label: 'Home', run: ports.goHome },
      share: `${title} ${report.my}–${report.their} vs ${report.opp}${deltaText} — Knucklebones, ranked dice duels`,
    });
    const [profile, standing, ladder, foe] = await Promise.all([
      myProfile(),
      myStanding(),
      myLadder(),
      playerCard(report.opp),
    ]);
    if (profile) {
      cache = {
        ...cache,
        nickname: profile.nickname,
        avatar: profile.avatar ?? null,
        rating: profile.rating,
      };
    }
    const points = standing?.points ?? profile?.rating ?? cachedRating;
    const apex = standing ? inApex(points ?? 0, standing.rank, standing.population) : false;
    cacheStanding(standing?.rank ?? null, apex);
    refreshHomeChip();
    const mine: MySide | null = profile && ladder
      ? { name: profile.nickname, avatar: profile.avatar ?? null, lad: ladder }
      : null;
    setPlates(plates(points, standing?.rank ?? null, apex, foe, mine));
  }

  return { show };
}

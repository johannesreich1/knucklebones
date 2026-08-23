import {
  historyPageArgs,
  leaderboardBeforePageArgs,
  leaderboardPageArgs,
} from '../src/online/ladder-api.ts';

const problems: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown) => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const first = historyPageArgs(30);
check(JSON.stringify(first) === JSON.stringify({ limit_n: 30 }),
  'the first history page must not invent a cursor', first);

const cursor = { when: '2026-08-23T12:00:00.000Z', id: '00000000-0000-4000-8000-000000000042' };
const next = historyPageArgs(30, cursor);
check(next.before_t === cursor.when && next.before_id === cursor.id,
  'history pagination must send both members of the stable cursor', next);
check(Object.keys(next).sort().join(',') === 'before_id,before_t,limit_n',
  'history pagination sent an unexpected RPC argument', next);

const ladder = leaderboardPageArgs(25, 76, 'ZestyFalcon614');
check(JSON.stringify(ladder) === JSON.stringify({
  limit_n: 25,
  from_rank: 76,
  after_nickname: 'ZestyFalcon614',
}),
  'leaderboard pagination must match the SQL RPC argument names', ladder);
check(!('after_nickname' in leaderboardPageArgs(25, 76)),
  'the first leaderboard window must include its requested rank');

const ladderBefore = leaderboardBeforePageArgs(25, 76, 'ZestyFalcon614');
check(JSON.stringify(ladderBefore) === JSON.stringify({
  limit_n: 25,
  before_rank: 76,
  before_nickname: 'ZestyFalcon614',
}),
  'reverse leaderboard pagination must send both members of the stable cursor', ladderBefore);

console.log(JSON.stringify({ problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);

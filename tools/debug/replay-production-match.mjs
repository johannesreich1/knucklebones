// Fetch and deterministically replay one production match by its opaque digest.
// The query returns no UUID, seed, nickname, email, or access token.
import { replayMatch } from './match-replay.mjs';
import { productionRead } from './production-read.mjs';

const MATCH_WITH_MOVES = `
with candidates as (
  select m.id, m.p1, m.p2, m.status, m.modifier, m.winner,
         m.p1_score, m.p2_score, m.created_at, m.finished_at,
         count(*) over ()::integer as candidate_count
    from public.matches as m
   where left(md5(m.id::text), length($1::text)) = lower($1::text)
)
select c.candidate_count,
       left(md5(c.id::text), length($1::text)) as match_key,
       c.created_at,
       c.finished_at,
       c.status,
       c.modifier,
       case when p1.is_bot then 'bot' else 'human' end as p1_kind,
       case when p2.is_bot then 'bot' else 'human' end as p2_kind,
       c.p1_score,
       c.p2_score,
       case when c.winner is null then null
            when c.winner = c.p1 then 'p1'
            when c.winner = c.p2 then 'p2'
            else 'invalid' end as winner,
       mm.idx,
       mm.who,
       mm.col,
       mm.die
  from candidates as c
  join public.profiles as p1 on p1.id = c.p1
  join public.profiles as p2 on p2.id = c.p2
  left join public.match_moves as mm on mm.match_id = c.id
 order by mm.idx nulls first;
`;

function usage(message, code = 64) {
  if (message) console.error(message);
  console.error('Usage: node --experimental-strip-types tools/debug/replay-production-match.mjs <10-32 hex match key> [--all]');
  process.exitCode = code;
}

function decode(rows) {
  if (!rows.length) throw new Error('No production match found for that key.');
  if (rows[0].candidate_count !== 1) throw new Error('Match key is ambiguous; use the longer key from the list tool.');
  const first = rows[0];
  return {
    metadata: {
      matchKey: first.match_key,
      createdAt: first.created_at,
      finishedAt: first.finished_at,
      status: first.status,
      modifier: first.modifier,
      seats: { p1: first.p1_kind, p2: first.p2_kind },
      winner: first.winner,
      p1Score: first.p1_score,
      p2Score: first.p2_score,
    },
    moves: rows.filter((row) => row.idx !== null).map((row) => ({
      idx: row.idx,
      who: row.who,
      col: row.col,
      die: row.die,
    })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return usage(null, 0);
  const key = args.find((argument) => !argument.startsWith('-'));
  const unknown = args.filter((argument) => argument !== key && argument !== '--all');
  if (!key || !/^[0-9a-f]{10,32}$/i.test(key)) return usage('Match key must be 10-32 hexadecimal characters.');
  if (unknown.length) return usage(`Unknown option: ${unknown[0]}`);

  const decoded = decode(await productionRead(MATCH_WITH_MOVES, [key.toLowerCase()]));
  const replay = replayMatch(decoded.metadata, decoded.moves);
  const all = args.includes('--all');
  const output = {
    match: replay.match,
    verification: replay.verification,
    finalBoards: replay.finalBoards,
    destructions: replay.events.filter((event) => event.destroyed > 0),
    timeline: all ? replay.events : replay.events.slice(-8),
    timelineScope: all ? 'all moves' : 'last 8 moves (pass --all for every move)',
  };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

// List recent terminal matches without exposing UUIDs, seeds, or nicknames.
// Run from the repository root with Node 24's TypeScript stripping enabled.
import { productionRead } from './production-read.mjs';

const RECENT_MATCHES = `
with recent as (
  select m.id, m.p1, m.p2, m.status, m.modifier, m.winner,
         m.p1_score, m.p2_score, m.finished_at
    from public.matches as m
   where m.finished_at is not null
   order by m.finished_at desc, m.id desc
   limit $1::integer
)
select left(md5(r.id::text), 16) as match_key,
       r.finished_at,
       to_char(r.finished_at at time zone 'Europe/Berlin',
               'YYYY-MM-DD HH24:MI:SS') as finished_at_berlin,
       r.status,
       r.modifier,
       case when p1.is_bot then 'bot' else 'human' end as p1_kind,
       case when p2.is_bot then 'bot' else 'human' end as p2_kind,
       r.p1_score,
       r.p2_score,
       case when r.winner is null then null
            when r.winner = r.p1 then 'p1'
            when r.winner = r.p2 then 'p2'
            else 'invalid' end as winner,
       (select count(*)::integer
          from public.match_moves as mm
         where mm.match_id = r.id) as move_count
  from recent as r
  join public.profiles as p1 on p1.id = r.p1
  join public.profiles as p2 on p2.id = r.p2
 order by r.finished_at desc, r.id desc;
`;

function usage(message, code = 64) {
  if (message) console.error(message);
  console.error('Usage: mise exec -- node --experimental-strip-types tools/debug/list-production-matches.mjs [1-25]');
  process.exitCode = code;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) return usage(null, 0);
  const rawLimit = process.argv[2] ?? '10';
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) return usage('Limit must be an integer from 1 to 25.');
  const rows = await productionRead(RECENT_MATCHES, [limit]);
  process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

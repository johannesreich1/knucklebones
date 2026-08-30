-- Stage 3 v1: profiles, ranked sessions, validated games, leaderboards.
-- Tables are RLS-locked; ranked writes happen ONLY inside Edge Functions
-- (service role). Leaderboards are security-definer functions so the tables
-- never need public read access.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (nickname ~ '^[A-Za-z0-9_]{3,16}$'),
  created_at timestamptz not null default now()
);
-- case-insensitive uniqueness: "Hans" cannot impersonate "hans"
create unique index profiles_nickname_lower_idx on public.profiles (lower(nickname));

alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- a ranked game starts by asking the server for a seed
create table public.ranked_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  seed text not null,
  used_at timestamptz,               -- null = still playable
  created_at timestamptz not null default now()
);
create index ranked_sessions_player_idx on public.ranked_sessions (player_id, created_at desc);
alter table public.ranked_sessions enable row level security;
-- owner may see their sessions; there are deliberately NO write policies —
-- inserts/updates happen only via Edge Functions using the service role
create policy ranked_sessions_select_own on public.ranked_sessions
  for select to authenticated using (player_id = (select auth.uid()));

-- finished ranked games; score is REPLAY-COMPUTED server-side, never client-supplied
create table public.games (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.ranked_sessions(id),
  player_id uuid not null references public.profiles(id) on delete cascade,
  moves jsonb not null,
  score int not null check (score >= 0),
  opponent_score int not null check (opponent_score >= 0),
  difficulty text not null check (difficulty in ('easy','medium','hard')),
  won boolean not null,
  created_at timestamptz not null default now()
);
create index games_score_idx on public.games (score desc);
create index games_player_idx on public.games (player_id, created_at desc);
create index games_created_idx on public.games (created_at desc);  -- weekly board
alter table public.games enable row level security;
create policy games_select_own on public.games
  for select to authenticated using (player_id = (select auth.uid()));

-- Leaderboards: definer functions with pinned search_path and explicit grants.
-- They bypass RLS BY DESIGN and expose exactly (nickname, aggregate scores).
create or replace function public.leaderboard_alltime(limit_n int default 50)
returns table (nickname text, best int, wins bigint, games bigint)
language sql security definer set search_path = '' stable
as $$
  select p.nickname, max(g.score) as best,
         count(*) filter (where g.won) as wins, count(*) as games
  from public.games g join public.profiles p on p.id = g.player_id
  group by p.nickname
  order by best desc, wins desc
  limit least(greatest(limit_n, 1), 100);
$$;

create or replace function public.leaderboard_weekly(limit_n int default 50)
returns table (nickname text, best int)
language sql security definer set search_path = '' stable
as $$
  select p.nickname, max(g.score) as best
  from public.games g join public.profiles p on p.id = g.player_id
  where g.created_at > now() - interval '7 days'
  group by p.nickname
  order by best desc
  limit least(greatest(limit_n, 1), 100);
$$;

revoke execute on function public.leaderboard_alltime(int) from public;
revoke execute on function public.leaderboard_weekly(int) from public;
grant execute on function public.leaderboard_alltime(int) to anon, authenticated;
grant execute on function public.leaderboard_weekly(int) to anon, authenticated;;

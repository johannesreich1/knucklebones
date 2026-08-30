-- PvP pivot: solo/AI games are never ranked. Ranked = online PvP only, with
-- server-side bot backfill behind generated usernames. Ladder = Elo rating;
-- bots are flagged and never listed.

-- ---- retire the solo-ranked pipeline (superseded by per-move PvP authority) ----
drop function if exists public.leaderboard_alltime(int);
drop function if exists public.leaderboard_weekly(int);
drop table if exists public.games;
drop table if exists public.ranked_sessions;

-- ---- profiles grow a rating and the bot flag ----
alter table public.profiles
  add column rating int not null default 1000,
  add column is_bot boolean not null default false;

-- ---- signup auto-nickname: every new auth user gets a profile immediately ----
-- Bots use the same generator, which is what makes them indistinguishable.
create or replace function public.generate_nickname()
returns text
language sql volatile
set search_path = ''
as $$
  select (array['Bold','Neon','Lucky','Quiet','Swift','Cosmic','Iron','Velvet',
                'Radiant','Sly','Frost','Ember','Nova','Shadow','Turbo','Zesty'])[1 + floor(random()*16)::int]
      || (array['Raven','Tiger','Dice','Fox','Comet','Wolf','Pixel','Knight',
                'Falcon','Otter','Viper','Lynx','Drake','Badger','Crow','Mole'])[1 + floor(random()*16)::int]
      || (100 + floor(random()*900)::int)::text
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  for i in 1..10 loop
    begin
      insert into public.profiles (id, nickname) values (new.id, public.generate_nickname());
      return new;
    exception when unique_violation then
      -- collision on the generated name: roll another
    end;
  end loop;
  raise exception 'could not generate a unique nickname';
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- matches: p1 = core index 1 (always starts; always the human vs a bot) ----
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  p1 uuid not null references public.profiles(id) on delete cascade,
  p2 uuid not null references public.profiles(id) on delete cascade,
  seed text not null,
  status text not null default 'active' check (status in ('active','done','forfeit')),
  turn smallint not null default 1 check (turn in (0,1)),  -- core identity to move
  winner uuid references public.profiles(id),
  p1_score int, p2_score int,
  p1_rating_delta int, p2_rating_delta int,
  last_move_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (p1 <> p2)
);
create index matches_p1_idx on public.matches (p1, created_at desc);
create index matches_p2_idx on public.matches (p2, created_at desc);
alter table public.matches enable row level security;
create policy matches_select_participant on public.matches
  for select to authenticated
  using (p1 = (select auth.uid()) or p2 = (select auth.uid()));

-- ---- match_moves: the authoritative move log, one roll per move ----
create table public.match_moves (
  match_id uuid not null references public.matches(id) on delete cascade,
  idx int not null,
  who smallint not null check (who in (0,1)),
  col smallint not null,
  created_at timestamptz not null default now(),
  primary key (match_id, idx)
);
alter table public.match_moves enable row level security;
create policy match_moves_select_participant on public.match_moves
  for select to authenticated
  using (exists (select 1 from public.matches m
                 where m.id = match_id
                   and (m.p1 = (select auth.uid()) or m.p2 = (select auth.uid()))));

-- ---- matchmaking queue: joined/left via Edge Functions only ----
create table public.matchmaking_queue (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.matchmaking_queue enable row level security;
create policy queue_select_own on public.matchmaking_queue
  for select to authenticated using (player_id = (select auth.uid()));

-- ---- realtime: participants see moves and match state as they land ----
alter publication supabase_realtime add table public.match_moves;
alter publication supabase_realtime add table public.matches;

-- ---- leaderboard: Elo ladder, bots never listed ----
create or replace function public.leaderboard(limit_n int default 50)
returns table (nickname text, rating int, wins bigint, games bigint)
language sql security definer set search_path = '' stable
as $$
  select p.nickname, p.rating,
         count(m.id) filter (where m.winner = p.id) as wins,
         count(m.id) as games
  from public.profiles p
  left join public.matches m
    on m.status in ('done','forfeit') and (m.p1 = p.id or m.p2 = p.id)
  where p.is_bot = false
  group by p.id, p.nickname, p.rating
  having count(m.id) > 0
  order by p.rating desc, wins desc
  limit least(greatest(limit_n, 1), 100);
$$;
revoke execute on function public.leaderboard(int) from public;
grant execute on function public.leaderboard(int) to anon, authenticated;

-- ---- grants (explicit; no default-privilege chain) ----
grant select on public.matches, public.match_moves, public.matchmaking_queue to authenticated;
grant all on public.matches, public.match_moves, public.matchmaking_queue to service_role;;

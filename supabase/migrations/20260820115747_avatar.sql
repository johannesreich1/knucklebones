alter table public.profiles
  add column if not exists avatar text not null default 'die:5:cy';

alter table public.profiles
  drop constraint if exists profiles_avatar_shape;
alter table public.profiles
  add constraint profiles_avatar_shape
  check (avatar ~ '^die:[1-6]:[a-z]{2,10}$');

grant update (avatar) on public.profiles to authenticated;;

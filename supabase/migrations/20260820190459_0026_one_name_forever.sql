-- ONE NAME PER ACCOUNT. Signup mints a placeholder (generate_nickname); the
-- player may replace it ONCE, and named_at records that claim. The trigger
-- refuses any later change, so the row enforces the rule and the client merely
-- reflects it — hiding the form was never going to stop a curious REST call.
-- Uniqueness and format were already law (profiles_nickname_lower_idx, the
-- CHECK on profiles.nickname); this adds only the "once".
alter table public.profiles add column named_at timestamptz;

create or replace function public.lock_nickname()
returns trigger language plpgsql as $$
begin
  if old.named_at is not null and new.nickname is distinct from old.nickname then
    raise exception 'name already set';
  end if;
  -- the stamp is the trigger's, never the client's (no column grant on
  -- named_at). Claiming your minted name spends the claim too: "set once"
  -- means one act of setting, not one change of spelling.
  new.named_at := coalesce(old.named_at, now());
  return new;
end $$;

-- fires only when nickname is in the SET list: service-side rating writes and
-- the avatar update never wake it, so bots and stats stay unstamped
create trigger profiles_lock_nickname
  before update of nickname on public.profiles
  for each row execute function public.lock_nickname();

-- trigger bodies are not API surface (0004's rule)
revoke execute on function public.lock_nickname() from public, anon, authenticated;;

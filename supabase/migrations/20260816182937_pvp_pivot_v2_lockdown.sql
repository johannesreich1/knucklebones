-- handle_new_user is a trigger body, not an API: remove it from the callable
-- surface entirely (the trigger itself is unaffected).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- generate_nickname is harmless but has no business being public API either
revoke execute on function public.generate_nickname() from public, anon, authenticated;;

-- Applied 2026-08-16 via MCP (execute_sql; data seed, not schema).
-- Bot pool: 12 service-created accounts. The signup trigger hands them the
-- same generated nicknames humans get, then they are flagged. They never log
-- in. Grow the pool by repeating with more rows.
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       'bot-' || i || '@internal.invalid', now(), now()
from generate_series(1, 12) i;

update public.profiles set is_bot = true
where id in (select id from auth.users where email like 'bot-%@internal.invalid');

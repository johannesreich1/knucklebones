# Identity gateway

The public Game Center assertion boundary. It accepts only configured browser
or Capacitor origins, applies Cloudflare's durable per-IP rate limiter, and
forwards bounded requests to `gc-auth` with a private origin header. The
Supabase function rejects direct calls without that header.

Owner rollout:

1. create the Worker from `wrangler.jsonc`;
2. set `ALLOWED_ORIGINS` to the exact comma-separated production web and native
   origins;
3. set `SUPABASE_GC_AUTH_URL` and `SUPABASE_PUBLISHABLE_KEY`;
4. create a random `GC_AUTH_ORIGIN_SECRET` as a Worker secret and set the same
   value as a `gc-auth` Edge Function secret;
5. deploy, set `VITE_IDENTITY_GATEWAY_URL` to the Worker origin at build time,
   and verify the configured rate binding before enabling the client.

Do not put the origin secret in a Vite variable or any app bundle.

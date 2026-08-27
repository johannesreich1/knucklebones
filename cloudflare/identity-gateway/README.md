# Identity gateway

The public Game Center assertion boundary. It accepts only configured browser
or Capacitor origins, applies Cloudflare's durable per-IP rate limiter, and
forwards bounded requests to `gc-auth` with a private origin header. The
Supabase function rejects direct calls without that header.

## The allowed origins are derived, not chosen

`allowedOrigin()` in `worker.ts` compares the request's `Origin` header against
the comma-separated `ALLOWED_ORIGINS` entries as **exact strings**. A wrong
scheme, a trailing slash, or a stray space is not a warning — it is a silent
403 `origin-not-allowed` for every player on that surface, with the other
surface still working. Neither entry is a judgement call; each follows from
something already in this repository:

| Surface | Origin | Derived from |
|---|---|---|
| Hosted web | `https://knucklebones-asg.pages.dev` | the Cloudflare Pages project the live site is served from. A preview deployment has a different hostname, so it is a different origin and is deliberately not allowed |
| Native app | `https://localhost` | Capacitor serves the WebView from `<scheme>://localhost`, where the scheme is `server.iosScheme` / `server.androidScheme` in `native/capacitor.config.json` |

Both schemes are `"https"` in `native/capacitor.config.json`, so the native
origin is **`https://localhost`**. It is **not** `capacitor://localhost`: that
is only Capacitor's *iOS default*, which applies while `iosScheme` is left
unset, and this repository overrides it on both platforms. Allowing
`capacitor://localhost` allow-lists an origin the shipped app never sends while
rejecting the one it does.

So the currently correct value is exactly:

```text
ALLOWED_ORIGINS=https://knucklebones-asg.pages.dev,https://localhost
```

**Changing `iosScheme` or `androidScheme` changes the origin this gateway must
allow.** Reconfigure the Worker in the same change, or the next native build
answers 403 on every Game Center exchange. `tests/identity-gateway-origins.test.ts`
fails when the config and this document disagree — but no test can read a
Cloudflare dashboard, so it pins the derivation and this documented value only.
The deployed Worker still has to be updated by hand and re-probed with an
`OPTIONS` request from each origin.

## Owner rollout

1. create the Worker from `wrangler.jsonc`;
2. set `ALLOWED_ORIGINS` to the exact value above — re-derive it from the table
   rather than copying an older note or a Capacitor tutorial;
3. set `SUPABASE_GC_AUTH_URL` and `SUPABASE_PUBLISHABLE_KEY`;
4. create a random `GC_AUTH_ORIGIN_SECRET` as a Worker secret and set the same
   value as a `gc-auth` Edge Function secret;
5. deploy, set `VITE_IDENTITY_GATEWAY_URL` to the Worker origin at build time —
   `docs/IDENTITY.md` names the deployed origin and the build environment each
   surface reads it from — and verify the configured rate binding before
   enabling the client.

Do not put the origin secret in a Vite variable or any app bundle.

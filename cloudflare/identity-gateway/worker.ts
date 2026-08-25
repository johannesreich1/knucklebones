interface RateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  GC_RATE_LIMITER: RateLimiter;
  SUPABASE_GC_AUTH_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  GC_AUTH_ORIGIN_SECRET: string;
  ALLOWED_ORIGINS: string;
}

const MAX_BODY_BYTES = 8 * 1024;
const ROUTE = '/v1/game-center';

function cors(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function response(origin: string, body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { ...cors(origin), 'Cache-Control': 'no-store' },
  });
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

async function boundedBody(request: Request): Promise<ArrayBuffer | null> {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const bytes = await request.arrayBuffer();
  return bytes.byteLength > 0 && bytes.byteLength <= MAX_BODY_BYTES ? bytes : null;
}

export async function handleIdentityRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = allowedOrigin(request, env);
  if (!origin) return response('null', { error: 'origin-not-allowed' }, 403);
  if (url.pathname !== ROUTE) return response(origin, { error: 'not-found' }, 404);
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
  if (request.method !== 'POST') return response(origin, { error: 'method-not-allowed' }, 405);
  if (request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase()
    !== 'application/json') return response(origin, { error: 'content-type' }, 415);

  const source = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await env.GC_RATE_LIMITER.limit({ key: `game-center:${source}` })).success) {
    const limited = response(origin, { error: 'rate-limited' }, 429);
    limited.headers.set('Retry-After', '60');
    return limited;
  }
  const body = await boundedBody(request);
  if (!body) return response(origin, { error: 'request-too-large' }, 413);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const authorization = request.headers.get('Authorization');
    const upstream = await fetch(env.SUPABASE_GC_AUTH_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        'X-Knucklebones-Origin': env.GC_AUTH_ORIGIN_SECRET,
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body,
    });
    const payload = await upstream.arrayBuffer();
    return new Response(payload, {
      status: upstream.status,
      headers: {
        ...cors(origin),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return response(origin, { error: 'upstream-unavailable' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export default { fetch: handleIdentityRequest };

import type { createClient, SupabaseClient, User } from "@supabase/supabase-js";

/** Headers returned by every public Edge Function, including preflight. */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, idempotency-key",
} as const;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Return an early HTTP response, or null when a POST may continue. */
export function postOnly(request: Request): Response | null {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "method-not-allowed" }, 405);
  return null;
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** The one accepted idempotency-key shape, shared by every command handler. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Caller-supplied command id: the body field wins, the header is the retry
    fallback. Returns undefined (never null) when neither was supplied, so
    callers can branch on `!== undefined` as well as on `typeof`. */
export function commandId(body: Record<string, unknown> | null, request: Request): unknown {
  return body?.command_id ?? request.headers.get("Idempotency-Key") ?? undefined;
}

/** Convert any escaped exception into the JSON+CORS error contract. Every
    failure a handler understands is already a structured json(); anything
    that still throws would otherwise reach Deno.serve as a plain-text 500
    without CORS, which a browser reads as an opaque network failure. */
export function withErrorBoundary(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      console.error("unhandled edge function error:", error);
      return json({ error: "internal" }, 500);
    }
  };
}

export type EdgeClient = SupabaseClient;
export type EdgeUser = Pick<User, "id">;
export type ClientFactory = typeof createClient;

export interface Environment {
  get(name: string): string | undefined;
}

export interface ClientDependencies {
  createClient: ClientFactory;
  env: Environment;
}

export interface AuthenticatedContext {
  user: EdgeUser;
  authed: EdgeClient;
  service(): EdgeClient;
}

export type Authenticate = (request: Request) => Promise<AuthenticatedContext | null>;

/** The shared POST prologue: preflight/method, authentication, JSON body.
    Returns the early Response whenever the request must not reach an
    operation. Functions whose contract accepts an absent or malformed body
    (join, delete) opt out of the bad-json rejection with `optionalBody`. */
export async function authenticatedPost(
  request: Request,
  authenticate: Authenticate,
  options: { optionalBody?: boolean } = {},
): Promise<{ context: AuthenticatedContext; body: Record<string, unknown> | null } | Response> {
  const early = postOnly(request);
  if (early) return early;
  const context = await authenticate(request);
  if (!context) return json({ error: "unauthorized" }, 401);
  let body: Record<string, unknown> | null = null;
  try { body = record(await request.json()); }
  catch { if (!options.optionalBody) return json({ error: "bad-json" }, 400); }
  return { context, body };
}

const value = (env: Environment, name: string): string => env.get(name)!;

export function createUserClient(request: Request, dependencies: ClientDependencies): EdgeClient {
  return dependencies.createClient(
    value(dependencies.env, "SUPABASE_URL"),
    value(dependencies.env, "SUPABASE_ANON_KEY"),
    { global: { headers: { Authorization: request.headers.get("Authorization") ?? "" } } },
  );
}

export function createServiceClient(dependencies: ClientDependencies): EdgeClient {
  return dependencies.createClient(
    value(dependencies.env, "SUPABASE_URL"),
    value(dependencies.env, "SUPABASE_SERVICE_ROLE_KEY"),
  );
}

/** Build authenticated request context without exposing Deno globals to handlers. */
export function createAuthenticator(dependencies: ClientDependencies): Authenticate {
  return async (request) => {
    const authed = createUserClient(request, dependencies);
    const { data: { user } } = await authed.auth.getUser();
    if (!user) return null;
    let service: EdgeClient | null = null;
    return {
      user,
      authed,
      service: () => service ??= createServiceClient(dependencies),
    };
  };
}

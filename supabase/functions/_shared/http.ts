import type { createClient, SupabaseClient, User } from "@supabase/supabase-js";

/** Headers returned by every public Edge Function, including preflight. */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
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

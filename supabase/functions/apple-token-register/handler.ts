import { json, postOnly, record, type Authenticate } from "../_shared/http.ts";

export interface AppleTokenRegisterDependencies {
  authenticate: Authenticate;
  register(context: NonNullable<Awaited<ReturnType<Authenticate>>>, code: string): Promise<Response>;
}

export function createAppleTokenRegisterHandler(dependencies: AppleTokenRegisterDependencies) {
  return async (request: Request): Promise<Response> => {
    const early = postOnly(request);
    if (early) return early;
    const context = await dependencies.authenticate(request);
    if (!context) return json({ error: "unauthorized" }, 401);
    const body = record(await request.json().catch(() => null));
    const code = body?.authorizationCode;
    if (typeof code !== "string") return json({ error: "bad-request" }, 400);
    return dependencies.register(context, code);
  };
}

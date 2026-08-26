import { authenticatedPost, json, type Authenticate } from "../_shared/http.ts";

export interface AppleTokenRegisterDependencies {
  authenticate: Authenticate;
  register(context: NonNullable<Awaited<ReturnType<Authenticate>>>, code: string): Promise<Response>;
}

export function createAppleTokenRegisterHandler(dependencies: AppleTokenRegisterDependencies) {
  return async (request: Request): Promise<Response> => {
    const prologue = await authenticatedPost(request, dependencies.authenticate);
    if (prologue instanceof Response) return prologue;
    const code = prologue.body?.authorizationCode;
    if (typeof code !== "string") return json({ error: "bad-request" }, 400);
    return dependencies.register(prologue.context, code);
  };
}

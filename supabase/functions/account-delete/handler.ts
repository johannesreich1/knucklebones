import { json, postOnly, type Authenticate, type AuthenticatedContext } from "../_shared/http.ts";

export type DeleteAccountOperation = (context: AuthenticatedContext) => Promise<Response>;

export interface AccountDeleteDependencies {
  authenticate: Authenticate;
  operation: DeleteAccountOperation;
}

export function createAccountDeleteHandler(dependencies: AccountDeleteDependencies) {
  return async (request: Request): Promise<Response> => {
    const early = postOnly(request);
    if (early) return early;
    const context = await dependencies.authenticate(request);
    if (!context) return json({ error: "unauthorized" }, 401);
    return dependencies.operation(context);
  };
}

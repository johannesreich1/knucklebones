import { authenticatedPost, type Authenticate, type AuthenticatedContext } from "../_shared/http.ts";

export type DeleteAccountOperation = (context: AuthenticatedContext) => Promise<Response>;

export interface AccountDeleteDependencies {
  authenticate: Authenticate;
  operation: DeleteAccountOperation;
}

export function createAccountDeleteHandler(dependencies: AccountDeleteDependencies) {
  return async (request: Request): Promise<Response> => {
    /* deletion takes no payload; a body-less POST must keep working */
    const prologue = await authenticatedPost(request, dependencies.authenticate, { optionalBody: true });
    if (prologue instanceof Response) return prologue;
    return dependencies.operation(prologue.context);
  };
}

import { settle } from "./core/ladder.ts";
import { deleteAccountWithSettlement } from "../_shared/account-deletion.ts";
import type { AuthenticatedContext } from "../_shared/http.ts";

export async function deleteAccount(context: AuthenticatedContext): Promise<Response> {
  return deleteAccountWithSettlement(context, settle);
}

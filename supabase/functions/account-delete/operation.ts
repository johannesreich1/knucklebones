import { settle } from "./core/ladder.ts";
import { deleteAccountWithSettlement } from "../_shared/account-deletion.ts";
import type { AuthenticatedContext } from "../_shared/http.ts";
import type { Environment } from "../_shared/http.ts";
import { appleClientSecret, revokeAppleRefreshToken } from "../_shared/apple.ts";

export interface AccountDeleteOperationDependencies {
  env: Environment;
  fetch: typeof fetch;
  now(): number;
}

export async function deleteAccount(
  context: AuthenticatedContext,
  dependencies: AccountDeleteOperationDependencies,
): Promise<Response> {
  const service = context.service();
  return deleteAccountWithSettlement(context, settle, {
    beforeDelete: async () => {
      const { data: owner, error: ownerError } = await service.auth.admin.getUserById(context.user.id);
      if (ownerError || !owner.user) throw new Error("identity-read-failed");
      const appleLinked = (owner.user?.identities ?? [])
        .some((identity) => identity.provider === "apple");
      const { data, error } = await service.rpc("stage_apple_revocation", {
        p_user: context.user.id,
      });
      if (error) throw new Error("apple-revocation-stage-failed");
      if (data !== null && typeof data !== "number") {
        throw new Error("apple-revocation-stage-invalid");
      }
      return { appleLinked, credentialId: data };
    },
    undoBeforeDelete: async (raw) => {
      const state = raw as { credentialId?: number | null } | null;
      if (!state?.credentialId) return;
      // The deletion failed, so the account lives on; return its staged Apple
      // credential to 'active' before the revocation cron can claim it.
      const { error } = await service.rpc("unstage_apple_revocation", {
        p_user: context.user.id,
      });
      if (error) console.error("apple revocation unstage failed:", error.message);
    },
    afterDelete: async (raw) => {
      const state = raw as { appleLinked?: boolean; credentialId?: number | null } | null;
      if (!state?.appleLinked) return { appleRevocation: "complete" };
      if (!state.credentialId) return { appleRevocation: "manual-required" };
      const { data, error } = await service.rpc("take_apple_revocation", {
        p_credential_id: state.credentialId,
      });
      const row = !error && Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
      const clientId = row?.client_id;
      const refreshToken = row?.refresh_token;
      if (typeof clientId !== "string" || typeof refreshToken !== "string") {
        return { appleRevocation: "pending" };
      }
      let result: "complete" | "terminal" | "retry" = "retry";
      try {
        const secret = await appleClientSecret(dependencies.env, clientId, dependencies.now());
        result = await revokeAppleRefreshToken(refreshToken, clientId, secret, dependencies.fetch);
      } catch (revokeError) {
        /* the scheduled retry owns transient failure */
        console.error("inline apple revocation failed:", revokeError);
      }
      await service.rpc("finish_apple_revocation", {
        p_credential_id: state.credentialId,
        p_result: result,
      });
      return {
        appleRevocation: result === "complete" ? "complete"
          : result === "terminal" ? "manual-required" : "pending",
      };
    },
  });
}

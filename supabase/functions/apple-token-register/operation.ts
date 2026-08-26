import {
  appleClientSecret, exchangeAppleAuthorizationCode, verifiedAppleSubject,
} from "../_shared/apple.ts";
import { json, type AuthenticatedContext, type Environment } from "../_shared/http.ts";

const CLIENT_ID = "com.appavaria.knucklebones";

export interface AppleRegisterDependencies {
  env: Environment;
  fetch: typeof fetch;
  now(): number;
}

export async function registerAppleToken(
  context: AuthenticatedContext,
  authorizationCode: string,
  dependencies: AppleRegisterDependencies,
): Promise<Response> {
  if (!authorizationCode || authorizationCode.length > 4096) {
    return json({ error: "bad-authorization-code" }, 400);
  }
  try {
    const secret = await appleClientSecret(dependencies.env, CLIENT_ID, dependencies.now());
    const exchanged = await exchangeAppleAuthorizationCode(
      authorizationCode, CLIENT_ID, secret, dependencies.fetch,
    );
    const subject = await verifiedAppleSubject(
      exchanged.idToken, CLIENT_ID, dependencies.fetch, dependencies.now(),
    );
    if (!subject) return json({ error: "invalid-apple-token" }, 401);

    const service = context.service();
    const { data, error } = await service.auth.admin.getUserById(context.user.id);
    if (error || !data.user) return json({ error: "identity-read-failed" }, 500);
    const ownsAppleIdentity = (data.user.identities ?? []).some((identity) =>
      identity.provider === "apple"
      && identity.identity_data?.sub === subject
    );
    if (!ownsAppleIdentity) return json({ error: "identity-mismatch" }, 409);

    const { error: storeError } = await service.rpc("store_apple_revocation_credential", {
      p_user: context.user.id,
      p_client_id: CLIENT_ID,
      p_refresh_token: exchanged.refreshToken,
    });
    if (storeError) console.error("apple credential store failed:", storeError.message);
    return storeError
      ? json({ error: "credential-store-failed" }, 500)
      : json({ registered: true });
  } catch (error) {
    console.error("apple token registration failed:", error);
    return json({ error: "apple-registration-failed" }, 502);
  }
}

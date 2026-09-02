import { callFunction } from '../api/client.ts';

export interface IdentityStatus {
  gameCenterLinked: boolean;
  appleLinked: boolean;
  appleRevocationReady: boolean;
}

export type IdentityStatusLookup =
  | { readonly ok: true; readonly accountId: string; readonly identity: IdentityStatus }
  | { readonly ok: false };

interface IdentityOwner { readonly id: string }

/** Bind an Edge Function answer to the session on both sides of its wait. */
export async function identityStatusLookupFor(
  currentUser: () => Promise<IdentityOwner | null>,
): Promise<IdentityStatusLookup> {
  const requestedUser = await currentUser();
  if (!requestedUser) return { ok: false };
  const expectedAccountId = requestedUser.id.toLowerCase();
  const result = await callFunction<IdentityStatus>(
    'identity-status', {}, { expectedAccountId },
  );
  if (result.status !== 200 || !result.data) return { ok: false };
  const activeUser = await currentUser();
  return activeUser?.id.toLowerCase() === expectedAccountId
    ? { ok: true, accountId: expectedAccountId, identity: result.data }
    : { ok: false };
}

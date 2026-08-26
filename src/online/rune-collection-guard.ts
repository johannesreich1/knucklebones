// Latest-refresh-wins guard. Account switches invalidate every older async
// collection read before it can repopulate the eager offline cache.
export interface CollectionRefreshToken {
  readonly accountId: string;
  readonly revision: number;
}

export interface CollectionRefreshOwnership {
  readonly owns: boolean;
  readonly discardRetained: boolean;
}

export function createCollectionRefreshGuard() {
  let revision = 0;
  return {
    begin(accountId: string): CollectionRefreshToken {
      return { accountId: accountId.toLowerCase(), revision: ++revision };
    },
    invalidate(): void { revision++; },
    owns(token: CollectionRefreshToken, activeAccountId: string | null): boolean {
      return token.revision === revision
        && activeAccountId?.toLowerCase() === token.accountId;
    },
    settle(
      token: CollectionRefreshToken,
      activeAccountId: string | null,
      retainedAccountId: string | null,
    ): CollectionRefreshOwnership {
      const active = activeAccountId?.toLowerCase() ?? null;
      return {
        owns: token.revision === revision && active === token.accountId,
        /* A same-account newer refresh may already have written this snapshot.
           Only an actual identity drift makes the requested account's cache
           unsafe to retain. */
        discardRetained: active !== token.accountId
          && retainedAccountId?.toLowerCase() === token.accountId,
      };
    },
  };
}

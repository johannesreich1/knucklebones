// Latest-refresh-wins guard. Account switches invalidate every older async
// collection read before it can repopulate the eager offline cache.
export interface CollectionRefreshToken {
  readonly accountId: string;
  readonly revision: number;
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
  };
}

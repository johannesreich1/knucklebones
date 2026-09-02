import type { RuneCollectionRefresh } from '../runes/rune-collection.ts';
import type { RuneRewardPresentation } from '../runes/rune-reward-presentation.ts';
import type { AuthMode, AuthOrigin } from './auth-screen.ts';
import type { AccountRuneGuideRequest } from './account-rune-guide.ts';

export interface AccountPorts {
  showAuth(
    mode: AuthMode,
    origin: AuthOrigin,
    notice?: string | null,
    expectedAccountId?: string | null,
  ): void;
  showAvatar(accountId: string): Promise<void>;
  showLadder(): Promise<void>;
  showHistory(): Promise<void>;
  presentRuneReward(
    collection: RuneCollectionRefresh,
    owns: () => boolean,
    onContinue?: () => void,
    actionLabel?: () => string,
    deferAcknowledgement?: boolean,
  ): boolean;
}

export interface AccountShowOptions {
  readonly runeGuide?: AccountRuneGuideRequest;
  /** A result-origin guide belongs to the account that owned that result. */
  readonly expectedAccountId?: string;
  /** The same first-rune sheet already handed this player to Profile. */
  readonly deferredRuneReward?: RuneRewardPresentation;
  /** A collection Entry already verified for same-turn transient fallback. */
  readonly verifiedRuneFallback?: RuneCollectionRefresh;
}

export interface AccountScreen {
  bind(): void;
  showCached(accountId: string): boolean;
  show(options?: AccountShowOptions): Promise<RuneCollectionRefresh | 'cached' | null>;
}

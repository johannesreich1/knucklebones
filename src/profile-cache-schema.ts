// Runtime-safe shapes for the two local Profile caches. This module owns no
// storage: profile-cache.ts remains the single reader/writer for both keys.

export const ACCOUNT_PROFILE_CACHE_VERSION = 2 as const;

export interface CachedStanding {
  readonly points: number;
  readonly rank: number;
  readonly population: number;
  readonly percentile: number;
}

/** Everything a screen may paint from the eager Home cache. */
export interface CachedProfile {
  /** Older unscoped entries remain readable on Home, but never merge into a
      fresh account or drive launcher-icon reconciliation. */
  accountId?: string;
  nickname?: string;
  rating?: number;
  avatar?: string | null;
  /** Null is confirmed unranked; absent means no standing has landed yet. */
  rank?: number | null;
  apex?: boolean;
}

/** One complete, account-bound rendering snapshot for Profile. */
export interface CachedAccountProfile {
  readonly version: typeof ACCOUNT_PROFILE_CACHE_VERSION;
  readonly accountId: string;
  readonly verifiedAt: number;
  readonly profile: {
    readonly id: string;
    readonly nickname: string;
    readonly rating: number;
    readonly created_at: string | null;
    readonly avatar: string | null;
    readonly named_at: string | null;
  };
  readonly user: {
    readonly id: string;
    readonly guest: boolean;
    readonly email: string | null;
  };
  readonly ladder: {
    readonly points: number;
    readonly peak: number;
    readonly wins: number;
    readonly losses: number;
    readonly draws: number;
    readonly runeSeatUnlocked: boolean;
  };
  /** Last confirmed positional presentation; null is confirmed no-standing. */
  readonly standing: CachedStanding | null;
  /** False distinguishes an unavailable first rank read from confirmed unranked. */
  readonly standingKnown: boolean;
  readonly streak: number;
  readonly recent: readonly {
    readonly id: string;
    readonly when: string;
    readonly opponent: string;
    readonly mode: string;
    readonly mine: number;
    readonly theirs: number;
    readonly delta: number;
    readonly baseDelta: number | null;
    readonly finishDelta: number | null;
    readonly scoringVersion: number;
    readonly result: 'win' | 'loss' | 'draw';
  }[];
  readonly identity: {
    readonly gameCenterLinked: boolean;
    readonly appleLinked: boolean;
    readonly appleRevocationReady: boolean;
  };
  /** Presentation copy only; rune-cache ownership remains authoritative. */
  readonly runes: readonly string[];
  readonly runeRows: readonly {
    readonly rune_id: string;
    readonly collected_at: string;
    readonly source_match_id: string | null;
    readonly seen_at: string | null;
  }[];
  readonly equipment:
    | { readonly kind: 'none' }
    | { readonly kind: 'fixed'; readonly runeId: string }
    | { readonly kind: 'random' };
}

export type AccountProfileSnapshot = Omit<
  CachedAccountProfile,
  'version' | 'verifiedAt'
>;

type RequiredFields<Shape extends object> = {
  readonly [Field in keyof Shape]-?: true;
};

function requiredFields<Shape extends object>(
  fields: RequiredFields<Shape>,
): readonly (keyof Shape)[] {
  return Object.freeze(Object.keys(fields) as (keyof Shape)[]);
}

const REQUIRED_ACCOUNT_PROFILE_FIELDS = {
  version: true, accountId: true, verifiedAt: true, profile: true, user: true,
  ladder: true, standing: true, standingKnown: true, streak: true, recent: true,
  identity: true, runes: true, runeRows: true, equipment: true,
} satisfies RequiredFields<CachedAccountProfile>;
export const ACCOUNT_PROFILE_REQUIRED_FIELDS = requiredFields<CachedAccountProfile>(
  REQUIRED_ACCOUNT_PROFILE_FIELDS,
);

/* Adding a fact to a nested rendering shape fails typecheck until its cache key
   is required too. That makes older snapshots incomplete instead of partial. */
export const ACCOUNT_PROFILE_REQUIRED_NESTED_FIELDS = Object.freeze({
  profile: requiredFields<CachedAccountProfile['profile']>({
    id: true, nickname: true, rating: true, created_at: true, avatar: true, named_at: true,
  }),
  user: requiredFields<CachedAccountProfile['user']>({ id: true, guest: true, email: true }),
  ladder: requiredFields<CachedAccountProfile['ladder']>({
    points: true, peak: true, wins: true, losses: true, draws: true, runeSeatUnlocked: true,
  }),
  standing: requiredFields<CachedStanding>({
    points: true, rank: true, population: true, percentile: true,
  }),
  identity: requiredFields<CachedAccountProfile['identity']>({
    gameCenterLinked: true, appleLinked: true, appleRevocationReady: true,
  }),
  recent: requiredFields<CachedAccountProfile['recent'][number]>({
    id: true, when: true, opponent: true, mode: true,
    mine: true, theirs: true, delta: true,
    baseDelta: true, finishDelta: true, scoringVersion: true, result: true,
  }),
  runeRows: requiredFields<CachedAccountProfile['runeRows'][number]>({
    rune_id: true, collected_at: true, source_match_id: true, seen_at: true,
  }),
});

type CachedEquipment = CachedAccountProfile['equipment'];
type EquipmentVariant<Kind extends CachedEquipment['kind']> = Extract<
  CachedEquipment,
  { readonly kind: Kind }
>;
type RequiredEquipmentFields = {
  readonly [Kind in CachedEquipment['kind']]: readonly (keyof EquipmentVariant<Kind>)[];
};

export const ACCOUNT_PROFILE_REQUIRED_EQUIPMENT_FIELDS = Object.freeze({
  none: requiredFields<EquipmentVariant<'none'>>({ kind: true }),
  random: requiredFields<EquipmentVariant<'random'>>({ kind: true }),
  fixed: requiredFields<EquipmentVariant<'fixed'>>({ kind: true, runeId: true }),
} satisfies RequiredEquipmentFields);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: Record<string, unknown>, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);
const ownsAll = (value: Record<string, unknown>, fields: readonly PropertyKey[]): boolean =>
  fields.every((field) => own(value, field));
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown, minimum = 0): value is number =>
  finite(value) && Number.isInteger(value) && value >= minimum;
const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const dateString = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullableDateString = (value: unknown): value is string | null =>
  value === null || dateString(value);
const stringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

function validProfile(
  value: unknown,
  accountId: string,
): value is CachedAccountProfile['profile'] {
  return object(value) && ownsAll(value, ACCOUNT_PROFILE_REQUIRED_NESTED_FIELDS.profile)
    && typeof value.id === 'string' && value.id.toLowerCase() === accountId
    && typeof value.nickname === 'string' && finite(value.rating)
    && nullableDateString(value.created_at) && nullableString(value.avatar)
    && nullableDateString(value.named_at);
}

function validUser(
  value: unknown,
  accountId: string,
): value is CachedAccountProfile['user'] {
  return object(value) && ownsAll(value, ACCOUNT_PROFILE_REQUIRED_NESTED_FIELDS.user)
    && typeof value.id === 'string' && value.id.toLowerCase() === accountId
    && typeof value.guest === 'boolean' && nullableString(value.email);
}

function validLadder(value: unknown): value is CachedAccountProfile['ladder'] {
  return object(value) && ownsAll(value, ACCOUNT_PROFILE_REQUIRED_NESTED_FIELDS.ladder)
    && integer(value.points) && integer(value.peak) && integer(value.wins)
    && integer(value.losses) && integer(value.draws)
    && typeof value.runeSeatUnlocked === 'boolean';
}

function validStanding(value: unknown): value is CachedAccountProfile['standing'] {
  return value === null || (object(value)
    && ownsAll(value, ACCOUNT_PROFILE_REQUIRED_NESTED_FIELDS.standing)
    && finite(value.points) && integer(value.rank, 1)
    && integer(value.population) && finite(value.percentile));
}

function validRecentRow(row: unknown): row is CachedAccountProfile['recent'][number] {
  return object(row) && ownsAll(row, ACCOUNT_PROFILE_REQUIRED_NESTED_FIELDS.recent)
    && typeof row.id === 'string' && dateString(row.when)
    && typeof row.opponent === 'string' && typeof row.mode === 'string'
    && finite(row.mine) && finite(row.theirs) && finite(row.delta)
    && (row.baseDelta === null || finite(row.baseDelta))
    && (row.finishDelta === null || finite(row.finishDelta))
    && finite(row.scoringVersion)
    && (row.result === 'win' || row.result === 'loss' || row.result === 'draw');
}

function validRecent(value: unknown): value is CachedAccountProfile['recent'] {
  return Array.isArray(value) && value.length <= 3 && value.every(validRecentRow);
}

function validIdentity(value: unknown): value is CachedAccountProfile['identity'] {
  return object(value) && ownsAll(value, ACCOUNT_PROFILE_REQUIRED_NESTED_FIELDS.identity)
    && typeof value.gameCenterLinked === 'boolean' && typeof value.appleLinked === 'boolean'
    && typeof value.appleRevocationReady === 'boolean';
}

function validRuneRow(row: unknown): row is CachedAccountProfile['runeRows'][number] {
  return object(row) && ownsAll(row, ACCOUNT_PROFILE_REQUIRED_NESTED_FIELDS.runeRows)
    && typeof row.rune_id === 'string' && dateString(row.collected_at)
    && nullableString(row.source_match_id) && nullableDateString(row.seen_at);
}

function validRuneRows(value: unknown): value is CachedAccountProfile['runeRows'] {
  return Array.isArray(value) && value.every(validRuneRow);
}

function validEquipment(
  value: unknown,
  runes: readonly string[],
): value is CachedAccountProfile['equipment'] {
  if (!object(value)) return false;
  if (value.kind === 'none' || value.kind === 'random') {
    return ownsAll(value, ACCOUNT_PROFILE_REQUIRED_EQUIPMENT_FIELDS[value.kind]);
  }
  return value.kind === 'fixed'
    && ownsAll(value, ACCOUNT_PROFILE_REQUIRED_EQUIPMENT_FIELDS.fixed)
    && typeof value.runeId === 'string' && runes.includes(value.runeId);
}

export function parseAccountProfile(value: unknown): CachedAccountProfile | null {
  if (!object(value) || !ownsAll(value, ACCOUNT_PROFILE_REQUIRED_FIELDS)
      || value.version !== ACCOUNT_PROFILE_CACHE_VERSION
      || typeof value.accountId !== 'string' || !UUID.test(value.accountId)
      || !integer(value.verifiedAt)) return null;
  const accountId = value.accountId.toLowerCase();
  if (!validProfile(value.profile, accountId) || !validUser(value.user, accountId)
      || !validLadder(value.ladder) || !validStanding(value.standing)
      || typeof value.standingKnown !== 'boolean' || !integer(value.streak)
      || !validRecent(value.recent) || !validIdentity(value.identity)
      || !stringList(value.runes) || !validRuneRows(value.runeRows)
      || !validEquipment(value.equipment, value.runes)) return null;
  return {
    version: ACCOUNT_PROFILE_CACHE_VERSION, accountId, verifiedAt: value.verifiedAt,
    profile: { ...value.profile }, user: { ...value.user }, ladder: { ...value.ladder },
    standing: value.standing ? { ...value.standing } : null,
    standingKnown: value.standingKnown, streak: value.streak,
    recent: value.recent.map((row) => ({ ...row })), identity: { ...value.identity },
    runes: [...value.runes], runeRows: value.runeRows.map((row) => ({ ...row })),
    equipment: { ...value.equipment },
  };
}

export function parseProfile(value: unknown): CachedProfile | null {
  if (!object(value)
      || (own(value, 'accountId') && typeof value.accountId !== 'string')
      || (own(value, 'nickname') && typeof value.nickname !== 'string')
      || (own(value, 'rating') && !finite(value.rating))
      || (own(value, 'avatar') && !nullableString(value.avatar))
      || (own(value, 'rank') && value.rank !== null && !integer(value.rank, 1))
      || (own(value, 'apex') && typeof value.apex !== 'boolean')) return null;
  return {
    ...(typeof value.accountId === 'string' ? { accountId: value.accountId } : {}),
    ...(typeof value.nickname === 'string' ? { nickname: value.nickname } : {}),
    ...(finite(value.rating) ? { rating: value.rating } : {}),
    ...(nullableString(value.avatar) ? { avatar: value.avatar } : {}),
    ...(value.rank === null || integer(value.rank, 1) ? { rank: value.rank } : {}),
    ...(typeof value.apex === 'boolean' ? { apex: value.apex } : {}),
  };
}

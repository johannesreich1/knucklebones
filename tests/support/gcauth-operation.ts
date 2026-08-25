import { completeGameCenterIdentity } from '../../supabase/functions/gc-auth/operation.ts';

type Check = (condition: boolean, message: string, detail?: unknown) => void;
interface FakeError { message: string }

class FakeGameCenterService {
  mapping: { team_player_id: string; user_id: string } | null = null;
  mappingError: FakeError | null = null;
  insertError: FakeError | null = null;
  raceWinner: string | null = null;
  createError: FakeError | null = null;
  deleteError: FakeError | null = null;
  updateErrors: Array<FakeError | null> = [];
  linkErrors: Array<FakeError | null> = [];
  created: Array<{ id: string; email: string }> = [];
  deleted: string[] = [];
  updated: Array<{ id: string; email: string }> = [];
  links: string[] = [];
  users = new Map<string, { email?: string; is_anonymous?: boolean }>();

  auth = { admin: {
    createUser: async ({ email }: { email: string }) => {
      if (this.createError) return { data: { user: null }, error: this.createError };
      const user = { id: `created-${this.created.length + 1}` };
      this.created.push({ id: user.id, email });
      this.users.set(user.id, { email, is_anonymous: false });
      return { data: { user }, error: null };
    },
    deleteUser: async (id: string) => {
      this.deleted.push(id);
      return { error: this.deleteError };
    },
    updateUserById: async (id: string, { email }: { email: string }) => {
      this.updated.push({ id, email });
      const error = this.updateErrors.shift() ?? null;
      if (!error) this.users.set(id, { email, is_anonymous: false });
      return { error };
    },
    getUserById: async (id: string) => {
      const user = this.users.get(id);
      return user
        ? { data: { user: { id, ...user } }, error: null }
        : { data: { user: null }, error: { message: 'missing user' } };
    },
    generateLink: async ({ email }: { email: string }) => {
      this.links.push(email);
      const error = this.linkErrors.shift() ?? null;
      return { data: { properties: error ? {} : { hashed_token: 'token' } }, error };
    },
  } };

  from(table: string) {
    if (table !== 'game_center_ids') throw new Error(`unexpected table ${table}`);
    return {
      select: (_columns: string) => {
        const query = {
          eq: (_column: string, _value: string) => query,
          maybeSingle: async () => ({ data: this.mapping, error: this.mappingError }),
        };
        return query;
      },
      insert: async (row: { team_player_id: string; user_id: string }) => {
        if (this.insertError) {
          if (this.raceWinner) this.mapping = {
            team_player_id: row.team_player_id, user_id: this.raceWinner,
          };
          return { error: this.insertError };
        }
        this.mapping = row;
        return { error: null };
      },
    };
  }
}

const identityDependencies = (service: FakeGameCenterService, callerId: string | null = null) => ({
  createClient: ((_url: string, key: string) => key === 'service-key'
    ? service
    : { auth: { getUser: async () => ({
      data: { user: callerId ? { id: callerId } : null }, error: null,
    }) } }) as never,
  env: { get: (name: string) => ({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  } as Record<string, string>)[name] },
});

/** Exercise every Game Center mapping/Auth mutation boundary independently. */
export async function runGcAuthOperationTests(check: Check, playerId: string): Promise<void> {
  const recoverCreated = new FakeGameCenterService();
  recoverCreated.updateErrors.push({ message: 'temporary auth outage' });
  const failedCreated = await completeGameCenterIdentity(
    new Request('https://edge.test'), playerId, 'sign-in', identityDependencies(recoverCreated),
  );
  check(failedCreated.status === 409 && recoverCreated.mapping?.user_id === 'created-1',
    'a failed created-user Auth update discarded its durable mapping anchor');
  check(recoverCreated.created[0]?.email.startsWith('gc-pending-')
    && recoverCreated.created[0]?.email !== recoverCreated.updated[0]?.email,
    'a provisional user reserved the deterministic Game Center email before winning the mapping');
  const retriedCreated = await completeGameCenterIdentity(
    new Request('https://edge.test'), playerId, 'sign-in', identityDependencies(recoverCreated),
  );
  check(retriedCreated.status === 200 && recoverCreated.created.length === 1
    && recoverCreated.updated.at(-1)?.id === 'created-1',
    'retry after created-user Auth failure did not resume the mapped owner idempotently');

  const recoverAttach = new FakeGameCenterService();
  recoverAttach.updateErrors.push({ message: 'attach failed' });
  recoverAttach.users.set('caller-1', { is_anonymous: true });
  const authRequest = () => new Request('https://edge.test', {
    headers: { Authorization: 'Bearer caller' },
  });
  const failedAttach = await completeGameCenterIdentity(
    authRequest(), playerId, 'attach', identityDependencies(recoverAttach, 'caller-1'),
  );
  check(failedAttach.status === 409 && recoverAttach.mapping?.user_id === 'caller-1',
    'a failed caller attach removed the mapping needed for retry');
  const retriedAttach = await completeGameCenterIdentity(
    authRequest(), playerId, 'attach', identityDependencies(recoverAttach, 'caller-1'),
  );
  check(retriedAttach.status === 200 && recoverAttach.created.length === 0
    && recoverAttach.updated.at(-1)?.id === 'caller-1',
    'retry after caller attach failure did not resume the mapped caller');

  const failedCleanup = new FakeGameCenterService();
  failedCleanup.insertError = { message: 'duplicate mapping' };
  failedCleanup.raceWinner = 'winner-1';
  failedCleanup.users.set('winner-1', { is_anonymous: true });
  failedCleanup.deleteError = { message: 'auth cleanup failed' };
  const cleanupResponse = await completeGameCenterIdentity(
    new Request('https://edge.test'), playerId, 'sign-in', identityDependencies(failedCleanup),
  );
  check(cleanupResponse.status === 500
    && (await cleanupResponse.json()).error === 'compensation-failed'
    && failedCleanup.mapping?.user_id === 'winner-1',
    'a failed losing-user cleanup was hidden or damaged the winning mapping');
  failedCleanup.insertError = null;
  failedCleanup.deleteError = null;
  const afterCleanupFailure = await completeGameCenterIdentity(
    new Request('https://edge.test'), playerId, 'sign-in', identityDependencies(failedCleanup),
  );
  check(afterCleanupFailure.status === 200
    && failedCleanup.updated.at(-1)?.id === 'winner-1'
    && failedCleanup.created[0]?.email !== failedCleanup.updated.at(-1)?.email,
    'a failed provisional-user cleanup blocked recovery of the mapped winner');

  const preserveEmail = new FakeGameCenterService();
  // Supabase can retain is_anonymous=true while an admin-linked identity is
  // transitioning. A real address is still additive account proof and must
  // never be replaced just because that metadata bit lags behind.
  preserveEmail.users.set('email-caller', { email: 'keeper@example.com', is_anonymous: true });
  const preservedResponse = await completeGameCenterIdentity(
    authRequest(), playerId, 'attach', identityDependencies(preserveEmail, 'email-caller'),
  );
  check(preservedResponse.status === 200 && preserveEmail.updated.length === 0
    && preserveEmail.links.length === 0
    && (await preservedResponse.json()).kind === 'linked',
    'Game Center attach replaced an existing account email instead of adding a proof');

  const linkedElsewhere = new FakeGameCenterService();
  linkedElsewhere.mapping = { team_player_id: playerId, user_id: 'owner-1' };
  linkedElsewhere.users.set('owner-1', { email: 'owner@example.com', is_anonymous: false });
  const conflictResponse = await completeGameCenterIdentity(
    authRequest(), playerId, 'attach', identityDependencies(linkedElsewhere, 'caller-2'),
  );
  check(conflictResponse.status === 409
    && (await conflictResponse.json()).error === 'identity-already-linked'
    && linkedElsewhere.links.length === 0,
    'an authenticated caller received a different mapped owner session');

  const readFailure = new FakeGameCenterService();
  readFailure.mappingError = { message: 'permission denied' };
  const readFailureResponse = await completeGameCenterIdentity(
    new Request('https://edge.test'), playerId, 'sign-in', identityDependencies(readFailure),
  );
  check(readFailureResponse.status === 500 && readFailure.created.length === 0
    && readFailure.updated.length === 0,
    'a mapping-read failure mutated Auth instead of failing closed');

  const assertion = new FakeGameCenterService();
  assertion.mapping = { team_player_id: playerId, user_id: 'caller-1' };
  const matched = await completeGameCenterIdentity(
    authRequest(), playerId, 'assert-current', identityDependencies(assertion, 'caller-1'),
  );
  check(matched.status === 200 && (await matched.json()).status === 'match'
    && assertion.created.length === 0 && assertion.updated.length === 0,
  'Game Center continuity assertion mutated identity state or missed the current account');

  const other = await completeGameCenterIdentity(
    authRequest(), playerId, 'assert-current', identityDependencies(assertion, 'caller-2'),
  );
  check(other.status === 200 && (await other.json()).status === 'other-account',
    'Game Center account changes were not surfaced before the next online duel');
}

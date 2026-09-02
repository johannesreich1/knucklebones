import assert from 'node:assert/strict';
import {
  EQUIPPED_RANKED_BOT_CONVERGENCE,
  EQUIPPED_RANKED_BOT_DATA,
  EQUIPPED_RANKED_HUMAN_DATA,
  EQUIPPED_RANKED_SCHEMA,
  RANKED_PROGRESSION_SCHEMA,
  RUNE_TRIAL_FUNCTIONS,
  RUNE_TRIAL_JOB,
  RUNE_TRIAL_SCHEMA,
} from '../../tools/database/production-rollout.mjs';
import {
  EQUIPPED_RANKED_COMPLETE_SCHEMA_ROW,
} from './random-rune-production-migration-cases.ts';
import {
  RANKED_PROGRESSION_V2_SCHEMA_ROW,
} from './ranked-progression-production-migration-cases.ts';

const FOUNDATION_SCHEMA = Object.freeze({
  profile_progression: true,
  match_protocol: true,
  queue_protocol: true,
  player_runes_table: true,
  match_actions_table: true,
  private_tables: true,
  indexes: true,
  policies: true,
  table_grants: true,
  private_tables_locked: true,
  realtime_publication: true,
  cron_extension: true,
});
export const FOUNDATION_FUNCTIONS = Object.freeze({
  function_contracts: true,
  function_bodies: true,
  function_grants: true,
});
const FOUNDATION_JOB = Object.freeze({ cron_job: true, cron_job_contract: true });
export const BOT_DATA = Object.freeze({
  bot_count: 200,
  bots_with_runes: 155,
  bots_equipped: 155,
  bots_with_runes_without_seat: 0,
  bots_without_runes_with_seat: 0,
  bot_seat_not_owned: 0,
  bots_random_mode: 0,
});

export function productionRead(overrides: {
  schema?: Record<string, unknown>;
  bots?: Record<string, unknown>;
  convergence?: Record<string, unknown>;
  humans?: Record<string, unknown>;
  progression?: Record<string, unknown>;
} = {}) {
  return async (query: string, parameters: unknown[] = []) => {
    assert.deepEqual(parameters, []);
    if (query === RUNE_TRIAL_SCHEMA) return [FOUNDATION_SCHEMA];
    if (query === RUNE_TRIAL_FUNCTIONS) return [FOUNDATION_FUNCTIONS];
    if (query === RUNE_TRIAL_JOB) return [FOUNDATION_JOB];
    if (query === EQUIPPED_RANKED_SCHEMA) {
      return [{ ...EQUIPPED_RANKED_COMPLETE_SCHEMA_ROW, ...overrides.schema }];
    }
    if (query === RANKED_PROGRESSION_SCHEMA) {
      return [{
        ...RANKED_PROGRESSION_V2_SCHEMA_ROW,
        ...overrides.progression,
      }];
    }
    if (query === EQUIPPED_RANKED_BOT_DATA) {
      return [{ ...BOT_DATA, ...overrides.bots }];
    }
    if (query === EQUIPPED_RANKED_BOT_CONVERGENCE) {
      return [{ bot_seat_not_canonical: 0, ...overrides.convergence }];
    }
    if (query === EQUIPPED_RANKED_HUMAN_DATA) {
      return [{
        human_count: 3,
        equipped_rune_fingerprint: '0123456789abcdef0123456789abcdef',
        ...overrides.humans,
      }];
    }
    return assert.fail('equipped-ranked audit read an unreviewed query');
  };
}

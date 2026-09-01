import assert from 'node:assert/strict';
import { SUPPORTED_LOCALES } from '../../src/i18n/locale.ts';
import {
  parseMigrationFilename,
  validateMatchCommandRetentionSchemaStage,
  validatePlayerSettingsSchemaStage,
} from '../../tools/database/production-rollout-core.mjs';
import {
  MATCH_COMMAND_RETENTION_JOB,
  MATCH_COMMAND_RETENTION_SCHEMA,
  SETTINGS_SCHEMA,
  VALID_LOCALE_VALUES,
} from '../../tools/database/production-rollout.mjs';

type Check = (name: string, run: () => void) => void;
type Guarded = (run: () => unknown, pattern: RegExp) => void;

export interface ProductionSchemaCaseOptions {
  readonly check: Check;
  readonly guarded: Guarded;
  readonly retentionMigration: string;
  readonly expandedLocalesMigration: string;
}

export function runProductionMigrationSchemaCases(options: ProductionSchemaCaseOptions): void {
  const { check, guarded, retentionMigration, expandedLocalesMigration } = options;

  check('schema metadata accepts only complete stages zero through four', () => {
    assert.equal(validatePlayerSettingsSchemaStage({
      baseTable: false, baseContract: false, localeColumn: false, localeConstraint: false,
      localeSix: false, localeExpanded: false, localeComment: false, localeValues: false,
    }), 0);
    assert.equal(validatePlayerSettingsSchemaStage({
      baseTable: true, baseContract: true, localeColumn: false, localeConstraint: false,
      localeSix: false, localeExpanded: false, localeComment: false, localeValues: false,
    }), 1);
    assert.equal(validatePlayerSettingsSchemaStage({
      baseTable: true, baseContract: true, localeColumn: true, localeConstraint: true,
      localeSix: false, localeExpanded: false, localeComment: true, localeValues: true,
    }), 2);
    assert.equal(validatePlayerSettingsSchemaStage({
      baseTable: true, baseContract: true, localeColumn: true, localeConstraint: true,
      localeSix: true, localeExpanded: false, localeComment: true, localeValues: true,
    }), 3);
    assert.equal(validatePlayerSettingsSchemaStage({
      baseTable: true, baseContract: true, localeColumn: true, localeConstraint: true,
      localeSix: true, localeExpanded: true, localeComment: true, localeValues: true,
    }), 4);
  });

  check('schema metadata rejects partial, out-of-order, and mismatched postconditions', () => {
    guarded(() => validatePlayerSettingsSchemaStage({
      baseTable: true, baseContract: false, localeColumn: false, localeConstraint: false,
      localeSix: false, localeExpanded: false, localeComment: false, localeValues: false,
    }), /base schema is partial/);
    guarded(() => validatePlayerSettingsSchemaStage({
      baseTable: false, baseContract: false, localeColumn: true, localeConstraint: true,
      localeSix: true, localeExpanded: true, localeComment: true, localeValues: true,
    }), /out of order/);
    guarded(() => validatePlayerSettingsSchemaStage({
      baseTable: true, baseContract: true, localeColumn: true, localeConstraint: true,
      localeSix: true, localeExpanded: true, localeComment: true, localeValues: false,
    }), /stored values/);
    guarded(() => validatePlayerSettingsSchemaStage({
      baseTable: true, baseContract: true, localeColumn: false, localeConstraint: false,
      localeSix: true, localeExpanded: true, localeComment: false, localeValues: false,
    }), /complete postcondition/);
    guarded(() => validatePlayerSettingsSchemaStage({
      baseTable: true, baseContract: true, localeColumn: true, localeConstraint: true,
      localeSix: false, localeExpanded: true, localeComment: true, localeValues: true,
    }), /complete postcondition/);
  });

  check('command-retention schema accepts only absent and complete states', () => {
    assert.equal(validateMatchCommandRetentionSchemaStage({
      cronExtension: false, retentionIndex: false, cleanupFunction: false,
      cleanupFunctionLocked: false, cronJob: false, cronJobContract: false,
    }), 0);
    assert.equal(validateMatchCommandRetentionSchemaStage({
      cronExtension: true, retentionIndex: false, cleanupFunction: false,
      cleanupFunctionLocked: false, cronJob: false, cronJobContract: false,
    }), 0);
    assert.equal(validateMatchCommandRetentionSchemaStage({
      cronExtension: true, retentionIndex: true, cleanupFunction: true,
      cleanupFunctionLocked: true, cronJob: true, cronJobContract: true,
    }), 1);
  });

  check('command-retention schema rejects every partial contract', () => {
    guarded(() => validateMatchCommandRetentionSchemaStage({
      cronExtension: true, retentionIndex: true, cleanupFunction: true,
      cleanupFunctionLocked: true, cronJob: true, cronJobContract: false,
    }), /partial/);
    guarded(() => validateMatchCommandRetentionSchemaStage({
      cronExtension: false, retentionIndex: true, cleanupFunction: true,
      cleanupFunctionLocked: true, cronJob: true, cronJobContract: true,
    }), /partial/);
  });

  check('command-retention production audit pins every safety boundary', () => {
    assert.match(MATCH_COMMAND_RETENTION_SCHEMA, /match_commands_retention_idx/);
    assert.match(MATCH_COMMAND_RETENTION_SCHEMA, /security-invoker|not prosecdef/);
    assert.match(MATCH_COMMAND_RETENTION_SCHEMA, /'anon', 'authenticated', 'service_role'/);
    assert.match(MATCH_COMMAND_RETENTION_JOB, /'0 \* \* \* \*'/);
    assert.match(MATCH_COMMAND_RETENTION_JOB, /interval ''7 days''/);
    assert.match(MATCH_COMMAND_RETENTION_JOB, /5000/);
    assert.deepEqual(parseMigrationFilename(retentionMigration), {
      filename: retentionMigration,
      version: '20260824212535',
      name: 'match_command_retention',
    });
  });

  check('production grant audit uses complete PostgreSQL 17 ACLs', () => {
    assert.match(SETTINGS_SCHEMA, /aclexplode\(/);
    assert.match(SETTINGS_SCHEMA, /'MAINTAIN'/);
    assert.doesNotMatch(SETTINGS_SCHEMA, /information_schema\.table_privileges/);
  });

  check('production locale audit pins the expanded stable identifier roster', () => {
    const textRoster = SUPPORTED_LOCALES.map((locale) => `'${locale}'::text`).join(', ');
    const valueRoster = SUPPORTED_LOCALES.map((locale) => `'${locale}'`).join(', ');
    assert.match(SETTINGS_SCHEMA, /locale_expanded/);
    assert.ok(SETTINGS_SCHEMA.includes(`ARRAY[${textRoster}]`));
    assert.ok(VALID_LOCALE_VALUES.includes(`array[${valueRoster}]::text[]`));
    assert.deepEqual(parseMigrationFilename(expandedLocalesMigration), {
      filename: expandedLocalesMigration,
      version: '20260901074059',
      name: 'expand_player_settings_locales_11',
    });
  });
}

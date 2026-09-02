import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AuthenticatedContext } from '../../supabase/functions/_shared/http.ts';
import type { MatchRow } from '../../supabase/functions/_shared/types.ts';
import { diceStream } from '../../src/core/dice.ts';
import { uploadPayload } from '../../tools/fnfiles.mjs';

type Check = (ok: boolean, message: string) => void;
type EnsureBotOpening = <T extends { match: MatchRow }>(
  context: AuthenticatedContext,
  payload: T,
) => Promise<T>;

class BotOpeningService {
  readonly calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  profileReads = 0;
  match: MatchRow;
  readonly seed: string;
  readonly p1IsBot: boolean;
  readonly actionRows: Array<Record<string, unknown>>;
  raceOnActionRead: MatchRow | null;

  constructor(
    match: MatchRow,
    seed: string,
    p1IsBot: boolean,
    actionRows: Array<Record<string, unknown>> = [],
    raceOnActionRead: MatchRow | null = null,
  ) {
    this.match = match;
    this.seed = seed;
    this.p1IsBot = p1IsBot;
    this.actionRows = actionRows;
    this.raceOnActionRead = raceOnActionRead;
  }

  from(table: string) {
    const query = {
      select: (_columns: string) => query,
      eq: (_column: string, _value: unknown) => query,
      maybeSingle: async () => ({ data: table === 'matches' ? this.match : null, error: null }),
      single: async () => {
        if (table === 'profiles') {
          this.profileReads++;
          return {
            data: { id: this.match.p1, is_bot: this.p1IsBot, rating: 900 },
            error: null,
          };
        }
        if (table === 'match_seeds') return { data: { seed: this.seed }, error: null };
        return { data: null, error: { message: `unexpected single ${table}` } };
      },
      order: async (_column: string) => {
        if (table === 'match_actions' && this.raceOnActionRead) {
          this.match = this.raceOnActionRead;
          this.raceOnActionRead = null;
        }
        return {
          data: table === 'match_actions' ? this.actionRows : null,
          error: table === 'match_actions' ? null : { message: `unexpected order ${table}` },
        };
      },
    };
    return query;
  }

  async rpc(name: string, input: Record<string, unknown>) {
    this.calls.push({ name, input });
    /* The public standing projection: no board row, so the bot is not in the apex. */
    if (name === 'player_standing') return { data: [], error: null };
    if (name !== 'commit_match_action') {
      return { data: null, error: { message: `unexpected RPC ${name}` } };
    }
    const actions = input.p_actions as Array<Record<string, unknown>>;
    this.match = {
      ...this.match,
      turn: input.p_next_turn as 0 | 1,
      next_die: input.p_next_die as number,
      action_version: actions.length,
      last_move_at: '2026-08-26T12:00:01.000Z',
    };
    return {
      data: {
        match: this.match,
        actions,
        action_version: actions.length,
        ...(input.p_response_meta as Record<string, unknown>),
      },
      error: null,
    };
  }
}

const seed = 'edge-bot-opening';
const openingMatch: MatchRow = {
  id: 'trial-bot-opening',
  p1: 'lower-rated-bot',
  p2: 'higher-rated-human',
  status: 'active',
  turn: 1,
  winner: null,
  p1_score: null,
  p2_score: null,
  p1_rating_delta: null,
  p2_rating_delta: null,
  curve_version: 1,
  scoring_version: 1,
  next_die: diceStream(seed)(),
  last_move_at: '2026-08-26T12:00:00.000Z',
  modifier: 'classic',
  season_id: 1,
  format: 'rune_trial',
  protocol_version: 2,
  rune_rules_version: 1,
  pool_tier: 'ivory',
  phase: 'playing',
  trial_offer: ['nudge', 'ward', 'fate'],
  p1_rune: 'nudge',
  p2_rune: 'ward',
  selection_deadline: null,
  selection_version: 2,
  action_version: 0,
  pending_aim: null,
  p1_auto_streak: 0,
  p2_auto_streak: 0,
};

export async function verifyRuneTrialBotOpening(check: Check): Promise<void> {
  // The core imports exist only in the computed upload closure. Materialize
  // that exact closure so this is a dynamic test of the deployed operation.
  const root = mkdtempSync(path.join(tmpdir(), 'knucklebones-bot-opening-test-'));
  const functionDir = path.join(root, 'pvp-rune-select');
  mkdirSync(functionDir, { recursive: true });
  try {
    for (const file of uploadPayload('pvp-rune-select')) {
      const target = path.resolve(functionDir, file.name);
      if (!target.startsWith(root + path.sep)) throw new Error('Edge fixture escaped temp root');
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    const moduleUrl = pathToFileURL(path.join(
      functionDir, '_shared/rune-trial-bot-opening.ts',
    )).href;
    const { ensureRankedActionBotOpening, ensureRuneTrialBotOpening } = await import(moduleUrl) as {
      ensureRankedActionBotOpening: EnsureBotOpening;
      ensureRuneTrialBotOpening: EnsureBotOpening;
    };

    const botService = new BotOpeningService(openingMatch, seed, true);
    const botContext = {
      user: { id: openingMatch.p2 }, authed: botService, service: () => botService,
    } as unknown as AuthenticatedContext;
    const opened = await ensureRuneTrialBotOpening(botContext, { match: openingMatch });
    const commits = botService.calls.filter((call) => call.name === 'commit_match_action');
    const command = commits[0]?.input;
    const actions = command?.p_actions as Array<{ kind?: string }> | undefined;
    check(commits.length === 1
        && botService.calls.some((call) =>
          call.name === 'player_standing' && call.input.p === openingMatch.p1)
        && command?.p_actor === openingMatch.p1 && command?.p_auto === false
        && command?.p_expected_action_version === 0 && actions?.at(-1)?.kind === 'place'
        && opened.match.action_version === actions?.length && opened.match.turn === 0,
      'lower-rated bot p1 did not atomically commit a complete opening turn');

    const equippedStandardMatch: MatchRow = {
      ...openingMatch,
      id: 'equipped-standard-bot-opening',
      format: 'standard',
      pool_tier: 'bone',
      trial_offer: null,
      p1_rune: null,
      p2_rune: 'ward',
    };
    const standardService = new BotOpeningService(equippedStandardMatch, seed, true);
    const standardContext = {
      user: { id: equippedStandardMatch.p2 }, authed: standardService, service: () => standardService,
    } as unknown as AuthenticatedContext;
    const standardOpened = await ensureRankedActionBotOpening(
      standardContext, { match: equippedStandardMatch },
    );
    const standardCommits = standardService.calls
      .filter((call) => call.name === 'commit_match_action');
    const standardCommand = standardCommits[0]?.input;
    const standardActions = standardCommand?.p_actions as Array<{ kind?: string }> | undefined;
    check(standardCommits.length === 1
        && standardActions?.length === 1
        && standardActions[0].kind === 'place'
        && standardOpened.match.action_version === 1,
      'a bare bot could not open ordinary action-protocol ranked with a normal placement');

    const racedRows = (command?.p_actions ?? []) as Array<Record<string, unknown>>;
    const racedService = new BotOpeningService(
      openingMatch,
      seed,
      true,
      racedRows,
      botService.match,
    );
    const racedContext = {
      user: { id: openingMatch.p2 }, authed: racedService, service: () => racedService,
    } as unknown as AuthenticatedContext;
    const raced = await ensureRuneTrialBotOpening(racedContext, { match: openingMatch });
    check(racedService.calls.length === 0
        && raced.match.action_version === botService.match.action_version
        && raced.match.turn === botService.match.turn,
      'bot opener did not converge when another finalizer committed between match/action reads');

    const humanMatch = { ...openingMatch, p1: 'lower-rated-human' };
    const humanService = new BotOpeningService(humanMatch, seed, false);
    const humanContext = {
      user: { id: humanMatch.p1 }, authed: humanService, service: () => humanService,
    } as unknown as AuthenticatedContext;
    const human = await ensureRuneTrialBotOpening(humanContext, { match: humanMatch });
    check(humanService.calls.length === 0 && humanService.profileReads === 1
        && human.match.action_version === 0,
      'human p1 incorrectly received a server-authored bot opening turn');

    const openedMatch = { ...openingMatch, action_version: 1, turn: 0 as const };
    const openedService = new BotOpeningService(openedMatch, seed, true);
    const openedContext = {
      user: { id: openedMatch.p2 }, authed: openedService, service: () => openedService,
    } as unknown as AuthenticatedContext;
    await ensureRuneTrialBotOpening(openedContext, { match: openedMatch });
    check(openedService.calls.length === 0 && openedService.profileReads === 0,
      'idempotent bot-opening recovery recommitted or reclassified an opened match');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

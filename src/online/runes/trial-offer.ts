// Private pre-game Rune Trial selection. The server owns the offer, deadline,
// choices and deterministic timeout fill; this controller owns only the one
// local choice surface and reconnect-safe waiting loop.
import { RUNE_TRIAL_FORMAT } from '../../core/ranked-outcomes.ts';
import { spellById, type SpellSpec } from '../../core/spells.ts';
import { t } from '../../i18n/index.ts';
import { cancelTrialSelection, requestTrialRuneChoice } from '../../ui/trial-select.ts';
import {
  autoSelectRune,
  readRuneTrialState,
  selectRune,
  type JoinResult,
  type MatchRow,
  type RuneTrialState,
} from '../api/match-api.ts';
import { watchMatch } from '../api/match-realtime.ts';
import { recoverIdempotentCommand } from '../api/idempotent-command.ts';
import { randomUuid } from '../api/random-id.ts';
import type { DialSide } from '../../ui/reveal-types.ts';

type Matched = Extract<JoinResult, { status: 'matched' }>;

export interface TrialSelectionPorts {
  owns: () => boolean;
  onWaiting: (deadline: string | null, opponentCommitted: boolean) => void;
  /** The versus line this choice screen shows, from revealPairing(). */
  pairing?: { me: DialSide; foe: DialSide };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type ChoiceRace =
  | { kind: 'choice'; value: string | null }
  | { kind: 'deadline' }
  | { kind: 'wake' };

async function chooseBeforeDeadline(
  offer: readonly SpellSpec[],
  pairing: { me: DialSide; foe: DialSide } | undefined,
  deadlineValue: string | null,
  wake: () => Promise<void>,
  onWake: () => Promise<boolean>,
): Promise<ChoiceRace> {
  const choice = requestTrialRuneChoice({
    offer,
    player: { name: () => t('common', 'people.you'), hue: 'var(--p1)' },
    title: () => t('game', 'modes.runeTrial.name'),
    prompt: () => t('game', 'runeTrial.choosePrompt'),
    /* The same stamp this function races below, so the number on screen is the
       one that will actually be acted on. */
    deadline: () => deadlineValue,
    versus: pairing,
  }).then((value): ChoiceRace => ({ kind: 'choice', value }));
  const deadline = Date.parse(deadlineValue ?? '');
  while (true) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const expired = new Promise<ChoiceRace>(() => undefined);
    const deadlineRace = Number.isFinite(deadline)
      ? new Promise<ChoiceRace>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'deadline' }), Math.max(0, deadline - Date.now()));
      })
      : expired;
    const changed = wake().then((): ChoiceRace => ({ kind: 'wake' }));
    const result = await Promise.race([choice, deadlineRace, changed]);
    if (timer) clearTimeout(timer);
    if (result.kind === 'wake' && !await onWake()) continue;
    if (result.kind !== 'choice') {
      cancelTrialSelection();
      await choice;
    }
    return result;
  }
}

function offerSpecs(trial: RuneTrialState | null | undefined): readonly SpellSpec[] | null {
  if (!trial || trial.offer.length !== 3 || new Set(trial.offer).size !== 3) return null;
  const spells = trial.offer.map((id) => spellById(id));
  return spells.every((spell): spell is SpellSpec => !!spell) ? spells : null;
}

function mergeTrial(
  current: Matched,
  response: { match: MatchRow; trial: RuneTrialState },
): Matched {
  return { ...current, match: response.match, trial: response.trial, rejoined: true };
}

function playing(result: Matched): boolean {
  return result.match.phase === 'playing'
    && typeof result.match.p1_rune === 'string'
    && typeof result.match.p2_rune === 'string';
}

/** Settlement can race either private choice. The server fills both choices
 * before it settles, so a terminal row is a complete Trial answer even though
 * it will never enter the playing phase. */
export function trialSelectionSettled(match: Pick<MatchRow, 'status'>): boolean {
  return match.status !== 'active';
}

/**
 * Return a revealed, playable Trial match or null when this queue generation
 * was cancelled. No opponent choice is read before the server changes phase.
 */
export async function resolveRankedTrial(
  initial: Matched,
  ports: TrialSelectionPorts,
): Promise<Matched | null> {
  if (initial.match.format !== RUNE_TRIAL_FORMAT) return initial;
  let current = initial;
  if (playing(current) || trialSelectionSettled(current.match)) return current;

  const offer = offerSpecs(current.trial);
  if (!offer) throw new Error('Rune Trial match did not include a valid private offer.');
  const wake = { current: null as (() => void) | null };
  const channel = watchMatch(current.match.id, () => undefined, () => wake.current?.());
  const waitForWake = (): Promise<void> => Promise.race([
    delay(1200),
    new Promise<void>((resolve) => { wake.current = resolve; }),
  ]);
  const refresh = async (): Promise<boolean> => {
    const response = await readRuneTrialState(current.match.id);
    if (!ports.owns() || response.status !== 200 || !response.data
        || response.data.match.id !== current.match.id) return false;
    current = mergeTrial(current, response.data);
    return true;
  };
  try {
    let choiceExpired = false;
    while (ports.owns() && !current.trial?.your_choice
        && !playing(current) && !trialSelectionSettled(current.match)) {
      const raced = await chooseBeforeDeadline(
        offer,
        ports.pairing,
        current.trial?.deadline ?? current.match.selection_deadline ?? null,
        waitForWake,
        async () => await refresh()
          && (playing(current) || trialSelectionSettled(current.match)),
      );
      wake.current = null;
      if (!ports.owns()) return null;
      if (raced.kind === 'wake') {
        return current;
      }
      if (raced.kind === 'deadline') {
        choiceExpired = true;
        const filled = await autoSelectRune(current.match.id);
        if (!ports.owns()) return null;
        if (filled.status === 200 && filled.data) current = mergeTrial(current, filled.data);
        else await refresh();
      } else if (!raced.value) {
        return null;
      } else {
        const selectedRune = raced.value;
        const commandId = randomUuid();
        let committed = await selectRune(current.match.id, selectedRune, commandId);
        if (!ports.owns()) return null;
        const uncertain = (response: typeof committed | null): boolean => !response
          || response.status === 0 || response.status >= 500
          || (response.status === 200 && !response.data);
        if (uncertain(committed)) {
          const recovered = await recoverIdempotentCommand(committed, {
            owns: ports.owns,
            uncertain,
            observe: async () => await refresh()
              && (!!current.trial?.your_choice || playing(current)
                || trialSelectionSettled(current.match)),
            replay: async () => await selectRune(current.match.id, selectedRune, commandId),
          });
          if (recovered.kind === 'cancelled') return null;
          if (recovered.kind === 'observed') continue;
          committed = recovered.response;
        }
        if (committed.status === 200 && committed.data) current = mergeTrial(current, committed.data);
        else await refresh(); // lost idempotent response or a terminal opponent update
      }
      if (choiceExpired) break;
    }
    if (playing(current) || trialSelectionSettled(current.match)) return current;

    ports.onWaiting(current.trial?.deadline ?? current.match.selection_deadline ?? null,
      !!current.trial?.opponent_committed);
    while (ports.owns()) {
      const deadline = Date.parse(current.trial?.deadline
        ?? current.match.selection_deadline ?? '');
      if (Number.isFinite(deadline) && Date.now() >= deadline) {
        const filled = await autoSelectRune(current.match.id);
        if (!ports.owns()) return null;
        if (filled.status === 200 && filled.data) current = mergeTrial(current, filled.data);
      }
      if (playing(current) || trialSelectionSettled(current.match)) return current;

      await waitForWake();
      wake.current = null;
      if (!ports.owns()) return null;
      if (await refresh()) {
        ports.onWaiting(current.trial?.deadline ?? current.match.selection_deadline ?? null,
          !!current.trial?.opponent_committed);
      }
      if (playing(current) || trialSelectionSettled(current.match)) return current;
    }
    return null;
  } finally {
    wake.current?.();
    cancelTrialSelection();
    void channel.unsubscribe();
  }
}

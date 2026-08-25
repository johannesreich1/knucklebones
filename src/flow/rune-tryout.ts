// Transient reward preview state. The ranked caller supplies only the route
// back; local records and persisted setup are borrowed and restored verbatim.
import { CLASSIC, type Mode, type Player } from '../core/rules.ts';
import { spellById } from '../core/spells.ts';
import { S } from '../state.ts';
import { appRoot } from '../ui/embed.ts';
import { closeEnd } from '../ui/endscreen.ts';

interface RuneTryoutSession {
  readonly onBackToRanked: () => void;
  readonly restore: {
    mode: typeof S.mode;
    diff: typeof S.diff;
    localMode: number;
    spell: string;
    localTrial: typeof S.localTrial;
    starter: Player;
  };
}

type StartDuel = (options: { scoring: Mode; spell: string }) => void;
let session: RuneTryoutSession | null = null;

export function beginRuneTryout(
  runeId: string,
  onBackToRanked: () => void,
  startDuel: StartDuel,
): boolean {
  if (session || !spellById(runeId)) return false;
  session = {
    onBackToRanked,
    restore: {
      mode: S.mode,
      diff: S.diff,
      localMode: S.localMode,
      spell: S.spell,
      localTrial: S.localTrial,
      starter: S.starter,
    },
  };
  appRoot().querySelector('#ovOnline')?.classList.remove('on');
  S.mode = 'cpu';
  S.diff = 'medium';
  S.localMode = CLASSIC;
  S.spell = runeId;
  S.localTrial = null;
  startDuel({ scoring: CLASSIC, spell: runeId });
  return true;
}

export function runeTryoutActive(): boolean {
  return session !== null;
}

export function backToRankedFromTryout(): boolean {
  const active = session;
  if (!active) return false;
  session = null;
  S.gen++;
  Object.assign(S, active.restore);
  closeEnd();
  active.onBackToRanked();
  return true;
}

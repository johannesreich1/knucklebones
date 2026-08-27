// A terminal match update can overtake its final action row in Realtime. Hold
// the result until one coherent full projection has drained, while still
// bounding recovery if the network has gone away entirely.
import type { MatchRow } from '../api/match-api.ts';
import { newerMatchProjection } from './match-sync.ts';
import type { OnlineState } from './play-types.ts';

interface TerminalDrainPorts {
  isCurrent(online: OnlineState): boolean;
  sync(fullRedraw: boolean): Promise<boolean>;
  applyMatchRow(match: MatchRow): void;
}

export async function drainTerminalProjection(
  online: OnlineState,
  incoming: MatchRow,
  ports: TerminalDrainPorts,
): Promise<void> {
  online.finalizing = true;
  online.pendingRow = newerMatchProjection(online.pendingRow, incoming);
  for (let attempt = 0; attempt < 30 && ports.isCurrent(online); attempt++) {
    const synced = await ports.sync(true);
    const complete = !online.trial
      || online.actionApplied >= (incoming.action_version ?? online.actionApplied);
    if (synced && complete) break;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  if (!ports.isCurrent(online)) return;
  online.finalizing = false;
  const terminal = newerMatchProjection(online.pendingRow, incoming);
  online.pendingRow = null;
  ports.applyMatchRow(terminal);
}

// Cancellation owns the join/leave race at the client boundary. The server's
// profile lock decides whether leaving or matching committed first; this seam
// serializes those answers so cleanup from an old run can never land after a
// replacement run has begun.
export type CanceledJoinResult =
  | { status: 'queued' }
  | { status: 'matched'; match: { id: string } }
  | { status: 'incompatible' }
  | null;

export type QueueLeaveResult =
  | { status: 'left' }
  | { status: 'matched'; match_id: string }
  | null;

export interface QueueCancellationPorts {
  leaveQueue: () => Promise<QueueLeaveResult>;
  resign: (matchId: string) => void;
  resignedOver: (matchId: string) => Promise<boolean>;
}

export interface QueueCancellation {
  cleanup(settledJoin?: CanceledJoinResult): Promise<void>;
}

export function createQueueCancellation(ports: QueueCancellationPorts): QueueCancellation {
  let tail = Promise.resolve();
  const resigning = new Map<string, Promise<void>>();

  const resignOnce = (matchId: string): Promise<void> => {
    const active = resigning.get(matchId);
    if (active) return active;
    const task = (async () => {
      ports.resign(matchId);
      try {
        if (!await ports.resignedOver(matchId)) resigning.delete(matchId);
      } catch {
        resigning.delete(matchId);
      }
    })();
    resigning.set(matchId, task);
    return task;
  };

  const cleanup = async (settledJoin: CanceledJoinResult): Promise<void> => {
    if (settledJoin?.status === 'incompatible') return;
    if (settledJoin?.status === 'matched') {
      await resignOnce(settledJoin.match.id);
      return;
    }
    const left = await ports.leaveQueue();
    if (left?.status === 'matched') await resignOnce(left.match_id);
  };

  return {
    cleanup(settledJoin = null) {
      const next = tail.then(() => cleanup(settledJoin), () => cleanup(settledJoin));
      tail = next;
      return next;
    },
  };
}

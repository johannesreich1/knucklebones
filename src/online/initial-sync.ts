// The first ranked read is an input gate, not background refresh: an older
// pvp-join can already have committed a bot opener. Try twice at entry, then
// let play's existing 5s watchdog pace one retry at a time without a private
// timer loop or unbounded recursion.
export interface InitialSyncBoundary {
  start(): Promise<boolean>;
  retry(): Promise<boolean>;
  pending(): boolean;
}

interface Ports {
  sync(): Promise<boolean>;
  owns(): boolean;
  onReady(): void;
  onWaiting(): void;
}

export function createInitialSyncBoundary(ports: Ports): InitialSyncBoundary {
  let ready = false;
  let running: Promise<boolean> | null = null;

  const attempt = async (limit: number): Promise<boolean> => {
    if (ready || !ports.owns()) return ready;
    if (running) return running;
    running = (async () => {
      for (let count = 0; count < limit && ports.owns(); count++) {
        if (await ports.sync()) {
          if (!ports.owns()) return false;
          ready = true;
          ports.onReady();
          return true;
        }
      }
      if (ports.owns()) ports.onWaiting();
      return false;
    })();
    try { return await running; } finally { running = null; }
  };

  return { start: () => attempt(2), retry: () => attempt(1), pending: () => !ready };
}

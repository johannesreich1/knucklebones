// Recovery loop for endpoints whose command id is durable server truth. A
// transport timeout is not a rejection: keep the same command and keep input
// closed until either replay answers definitively or authoritative state shows
// that the command (or a competing timeout action) already committed.
export interface CommandResponse<T> {
  status: number;
  data: T | null;
}

export type CommandRecovery<T> =
  | { kind: 'observed' }
  | { kind: 'response'; response: CommandResponse<T> }
  | { kind: 'cancelled' };

export interface CommandRecoveryPorts<T> {
  owns(): boolean;
  uncertain(response: CommandResponse<T> | null): boolean;
  observe(): Promise<boolean>;
  replay(): Promise<CommandResponse<T> | null>;
  pause?(): Promise<void>;
}

const defaultPause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 350));

export async function recoverIdempotentCommand<T>(
  initial: CommandResponse<T> | null,
  ports: CommandRecoveryPorts<T>,
): Promise<CommandRecovery<T>> {
  let response = initial;
  while (ports.owns() && ports.uncertain(response)) {
    if (await ports.observe()) return { kind: 'observed' };
    if (!ports.owns()) return { kind: 'cancelled' };
    await (ports.pause ?? defaultPause)();
    if (!ports.owns()) return { kind: 'cancelled' };
    try { response = await ports.replay(); }
    catch { response = null; }
  }
  if (!ports.owns()) return { kind: 'cancelled' };
  return response ? { kind: 'response', response } : { kind: 'cancelled' };
}

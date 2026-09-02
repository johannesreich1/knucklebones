import { $ } from '../../ui/dom.ts';

type AccountControl = HTMLButtonElement | HTMLInputElement
  | HTMLSelectElement | HTMLTextAreaElement;

/** Keep cached facts readable while account-changing controls await identity. */
export function createAccountActionLock() {
  let locked = false;
  let runeSeatAvailable = false;
  let disabledBefore = new WeakMap<AccountControl, boolean>();
  const panel = (): HTMLElement => $('#onAccount') as HTMLElement;
  const runeSeat = (): HTMLButtonElement => $('#accSeat') as HTMLButtonElement;
  const syncRuneSeat = (): void => {
    const seat = runeSeat();
    seat.disabled = locked || !runeSeatAvailable || seat.hasAttribute('aria-busy');
  };
  const controls = (): AccountControl[] => [
    ...panel().querySelectorAll<AccountControl>('button,input,select,textarea'),
  ];
  /** Start a different account presentation without inheriting either an old
   * lock baseline or an in-flight control's transient busy bit. Its semantic
   * painter immediately reapplies the few controls that truly begin disabled. */
  const reset = (): void => {
    for (const control of controls()) {
      control.disabled = disabledBefore.get(control) ?? false;
    }
    disabledBefore = new WeakMap<AccountControl, boolean>();
    panel().removeAttribute('data-account-pending');
    locked = false;
  };
  const lock = (): void => {
    panel().inert = false;
    panel().setAttribute('data-account-pending', '');
    locked = true;
    for (const control of controls()) {
      if (!disabledBefore.has(control)) disabledBefore.set(control, control.disabled);
      control.disabled = true;
    }
  };
  const unlock = (): void => {
    for (const control of controls()) {
      const previous = disabledBefore.get(control);
      if (previous !== undefined) control.disabled = previous;
    }
    disabledBefore = new WeakMap<AccountControl, boolean>();
    panel().removeAttribute('data-account-pending');
    locked = false;
    syncRuneSeat();
  };
  const repaint = (): void => {
    if (locked) lock();
    else syncRuneSeat();
  };
  const setRuneSeatAvailable = (available: boolean): void => {
    runeSeatAvailable = available;
    syncRuneSeat();
  };
  return { reset, lock, unlock, repaint, setRuneSeatAvailable };
}

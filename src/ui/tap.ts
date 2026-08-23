// A control PRESSES on the way down and ACTS on the way up. This is shared by
// ordinary controls and the swipe-back gesture; it knows nothing about game
// input or flow ownership.
import { rootElementFromPoint } from './query.ts';

type TapHandler = (event: Event) => void;

/* The ghost-click guard is GLOBAL, not per-element, and only a real pointer or
   touch arms it. A tap acts on release; the synthetic click that trails it can
   otherwise land on a different control after the first handler closes a view.
   Click-only hosts never arm the guard, so their fallback still works. */
let lastNativeTap = 0;

export function tap(el: HTMLElement, fn: TapHandler): void {
  const fire = (event: Event): void => {
    lastNativeTap = Date.now();
    fn(event);
  };
  let armed = false;
  const hold = (on: boolean): void => { el.classList.toggle('pressing', on); };
  const disarm = (): void => { armed = false; hold(false); };

  if (window.PointerEvent) {
    /* No pointer capture: several bindings live on a container and inspect
       event.target to learn which child control was released. */
    el.addEventListener('pointerdown', () => { armed = true; hold(true); });
    el.addEventListener('pointerup', (event) => {
      if (!armed) return;
      armed = false;
      hold(false);
      const rect = el.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right
          || event.clientY < rect.top || event.clientY > rect.bottom) return;
      fire(event);
    });
    el.addEventListener('pointercancel', disarm);
    el.addEventListener('pointerleave', disarm);
  } else if ('ontouchstart' in window) {
    el.addEventListener('touchstart', () => { armed = true; hold(true); }, { passive: true });
    el.addEventListener('touchend', (event) => {
      if (!armed) return;
      armed = false;
      hold(false);
      const touch = event.changedTouches[0];
      const over = touch ? rootElementFromPoint(touch.clientX, touch.clientY) : null;
      if (touch && (!over || (over !== el && !el.contains(over)))) return;
      fire(event);
    });
    el.addEventListener('touchcancel', disarm);
  }

  el.addEventListener('click', (event) => {
    if (Date.now() - lastNativeTap < 600) return;
    fn(event);
  });
}

/* Press a bound control from code (the edge swipe commits this way). A bare
   click can be swallowed by the ghost guard, so send the same down/up pair as
   a real tap before the click fallback. */
export function press(el: HTMLElement): void {
  if (window.PointerEvent) {
    const rect = el.getBoundingClientRect();
    const at: PointerEventInit = {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', at));
    el.dispatchEvent(new PointerEvent('pointerup', at));
  }
  el.click();
}

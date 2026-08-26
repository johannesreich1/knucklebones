// Small, restart-safe primitives for spell-owned die copies. A spell may need
// more choreography than the ordinary stage-to-slot flight, but it still has
// to obey the same standalone/widget coordinate boundary and generation
// cleanup contract.
import { fxRoot, pin } from '../fx.ts';
import { PREVIEW_CLASSES } from '../spellicons.ts';

export interface SpellMotionDelta {
  x: number;
  y: number;
  scale: number;
}

export interface PinnedDieGhostOptions {
  classes?: readonly string[];
  hideSource?: boolean;
  zIndex?: number;
}

export interface PinnedDieGhost {
  ghost: HTMLElement;
  sourceRect: DOMRect;
  deltaTo: (target: Element | DOMRectReadOnly) => SpellMotionDelta;
  remove: () => void;
}

function rectOf(target: Element | DOMRectReadOnly): DOMRectReadOnly {
  return 'getBoundingClientRect' in target ? target.getBoundingClientRect() : target;
}

/* Clone one visible die into the application's FX layer. The returned cleanup
   is idempotent and restores a hidden source even when a generation changes
   while the copy is moving. */
export function pinDieGhost(
  source: HTMLElement,
  options: PinnedDieGhostOptions = {},
): PinnedDieGhost {
  const sourceRect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.classList.remove('settle', 'dying', ...PREVIEW_CLASSES);
  ghost.classList.add(...(options.classes ?? []));
  ghost.removeAttribute('role');
  ghost.removeAttribute('aria-label');
  ghost.setAttribute('aria-hidden', 'true');
  pin(ghost, sourceRect, options.zIndex ?? 64);
  fxRoot().appendChild(ghost);

  const previousVisibility = source.style.visibility;
  if (options.hideSource) source.style.visibility = 'hidden';
  let removed = false;

  return {
    ghost,
    sourceRect,
    deltaTo(target) {
      const rect = rectOf(target);
      return {
        x: rect.left + rect.width / 2 - (sourceRect.left + sourceRect.width / 2),
        y: rect.top + rect.height / 2 - (sourceRect.top + sourceRect.height / 2),
        scale: sourceRect.width > 0 ? rect.width / sourceRect.width : 1,
      };
    },
    remove() {
      if (removed) return;
      removed = true;
      ghost.getAnimations().forEach((animation) => animation.cancel());
      ghost.remove();
      if (options.hideSource) source.style.visibility = previousVisibility;
    },
  };
}

/* WAAPI's `finished` promise does not know that a game was restarted. Poll the
   owning generation once per paint so a superseded spell cancels immediately
   instead of floating over the next screen until its nominal duration ends. */
export function playSpellAnimation(
  element: Element,
  keyframes: Keyframe[] | PropertyIndexedKeyframes,
  options: KeyframeAnimationOptions,
  isCurrent: () => boolean,
): Promise<boolean> {
  const animation = element.animate(keyframes, { fill: 'both', ...options });
  animation.id = 'kb-spell-motion';
  return new Promise((resolve) => {
    let frame = 0;
    let settled = false;
    const settle = (completed: boolean): void => {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(frame);
      resolve(completed);
    };
    const check = (): void => {
      if (!isCurrent()) {
        animation.cancel();
        settle(false);
        return;
      }
      frame = requestAnimationFrame(check);
    };
    animation.addEventListener('finish', () => settle(isCurrent()), { once: true });
    animation.addEventListener('cancel', () => settle(false), { once: true });
    if (!isCurrent()) {
      animation.cancel();
      settle(false);
    } else {
      frame = requestAnimationFrame(check);
    }
  });
}

export function cancelSpellAnimations(element: Element): void {
  element.getAnimations()
    .filter((animation) => animation.id === 'kb-spell-motion')
    .forEach((animation) => animation.cancel());
}

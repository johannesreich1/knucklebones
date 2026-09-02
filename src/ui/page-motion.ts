// One navigation-motion controller for every page surface. Ordinary owners
// keep changing logical visibility; the reused Online shell enters through
// changePagePanel(), its single mutation seam, so the outgoing frame is still
// measurable before that shell changes title, layout, scroll, and panel state.
// A committed edge swipe presses the real Back component and therefore enters
// this exact controller path without a second animation implementation.
// The motion itself is the platform push (page-motion-frames.ts): transform
// and opacity only, so a navigation never asks for layout or paint per frame.

import { authoredLayer, openRoom, topOpenOverlay } from './page-surface.ts';
import { makeInert, makeInertExcept, type InertSnapshot } from './modal-background.ts';
import {
  BRACKET_DURATION,
  BRACKET_EASE,
  PUSH_DURATION,
  PUSH_EASE,
  REDUCED_DURATION,
  pushTimeline,
  type PageMotionDirection,
} from './page-motion-frames.ts';

export type { PageMotionDirection } from './page-motion-frames.ts';

interface PageSurface {
  readonly key: string;
  readonly overlay: HTMLElement;
  readonly panel: HTMLElement | null;
  /** The overlay's authored layer while this surface owned the room. */
  readonly layer: number;
}

type RunCleanup = (completed: boolean) => void;

interface MotionRun {
  readonly direction: PageMotionDirection;
  readonly destination: PageSurface;
  readonly cleanups: Set<RunCleanup>;
  readonly settled: Promise<void>;
  cancel(): void;
}

interface HeldHydration {
  readonly run: MotionRun;
  readonly before: PageSurface;
  readonly after: PageSurface;
  readonly loader: HTMLElement;
  readonly ready: HTMLElement;
  readonly pinned: PinnedPanel | null;
  release(): void;
}

interface PinnedPanel {
  readonly paint: HTMLElement;
  release(): void;
}

interface PanelChangeSpec {
  readonly overlay: HTMLElement;
  readonly target: HTMLElement;
  /** The ready panel represented by a shared loading panel. */
  readonly logicalId?: string;
  readonly direction?: PageMotionDirection;
}

interface PageMotionController {
  changePanel(spec: PanelChangeSpec, mutate: () => void): Promise<void>;
  whenSettled(): Promise<void>;
}

const CONTROLLERS = new WeakMap<HTMLElement, PageMotionController>();
const PAGE_BASES = new Set(['ovStart', 'ovEnd']);

function eligibleOverlay(element: HTMLElement): boolean {
  return element.classList.contains('paged') || PAGE_BASES.has(element.id);
}

function visibleOnlinePanel(overlay: HTMLElement): HTMLElement | null {
  if (overlay.id !== 'ovOnline') return null;
  /* Hydrated content can be logically ready while the loading die is still the
     frame the player sees. Keep navigation sourced from that visible frame. */
  const held = overlay.querySelector<HTMLElement>(
    ':scope > .pbody > .page-motion-loader-hold,'
    + ':scope > .page-motion-panel-layer > .page-motion-loader-hold',
  );
  if (held) return held;
  return [...overlay.querySelectorAll<HTMLElement>('.pbody > .panel')]
    .find((panel) => !panel.hidden) ?? null;
}

function pageSurface(overlay: HTMLElement, panel: HTMLElement | null,
  logicalId?: string, layer?: number): PageSurface {
  return {
    overlay,
    panel,
    layer: layer ?? authoredLayer(overlay),
    key: panel ? `${overlay.id}/${logicalId || panel.dataset.pageMotionFor || panel.id}` : overlay.id,
  };
}

function surfaceOf(overlay: HTMLElement | null, layer?: number): PageSurface | null {
  if (!overlay || !eligibleOverlay(overlay)) return null;
  return pageSurface(overlay, visibleOnlinePanel(overlay), undefined, layer);
}

function surface(root: HTMLElement, behindSheet = false): PageSurface | null {
  const room = openRoom(root);
  return surfaceOf(behindSheet ? room.layerTop : room.top, room.layerTopZ);
}

function sameSurface(left: PageSurface | null, right: PageSurface | null): boolean {
  return left?.key === right?.key && left?.panel === right?.panel;
}

/** Keep page motion inside the layer each surface already owns. Ordinary
    pages may trade places below a sheet, while a raised Legal page keeps its
    intentional place above that sheet. */
function motionStack(
  before: PageSurface,
  after: PageSurface,
  direction: PageMotionDirection,
): { readonly source: number; readonly target: number } {
  /* A reused shell paints its own slab at 2 between the two panels, so the
     page on top sits at 3 (and its pinned header above that, in CSS). */
  if (before.overlay === after.overlay) {
    return direction === 'back' ? { source: 3, target: 1 } : { source: 1, target: 3 };
  }
  const sourceBase = before.layer;
  const targetBase = after.layer;
  if (sourceBase !== targetBase) {
    return { source: sourceBase + 1, target: targetBase + 1 };
  }
  return direction === 'back'
    ? { source: sourceBase + 2, target: targetBase + 1 }
    : { source: sourceBase + 1, target: targetBase + 2 };
}

function animate(
  target: Element,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
  id: string,
): Animation {
  const animation = target.animate(frames, { ...options, fill: 'both' });
  animation.id = id;
  return animation;
}

function bracketBeat(control: HTMLElement): Animation[] {
  if (getComputedStyle(control).visibility !== 'visible') return [];
  const options = { duration: BRACKET_DURATION, easing: BRACKET_EASE };
  const p1 = control.querySelector('.back-bracket--p1');
  const p2 = control.querySelector('.back-bracket--p2');
  return [
    p1 ? animate(p1, [
      { transform: 'translate(0, 0)' },
      { offset: .45, transform: 'translate(-3px, -1px)' },
      { transform: 'translate(0, 0)' },
    ], options, 'kb-duel-bracket-p1') : null,
    p2 ? animate(p2, [
      { transform: 'translate(0, 0)' },
      { offset: .45, transform: 'translate(3px, 1px)' },
      { transform: 'translate(0, 0)' },
    ], options, 'kb-duel-bracket-p2') : null,
  ].filter((entry): entry is Animation => entry !== null);
}

function defaultMotionElements(before: PageSurface, after: PageSurface): {
  source: HTMLElement;
  target: HTMLElement;
} | null {
  if (before.overlay !== after.overlay) {
    return { source: before.overlay, target: after.overlay };
  }
  if (before.panel && after.panel && before.panel !== after.panel) {
    return { source: before.panel, target: after.panel };
  }
  return null;
}

function startMotion(
  root: HTMLElement,
  before: PageSurface,
  after: PageSurface,
  direction: PageMotionDirection,
  onDone: (completed: boolean, run: MotionRun) => void,
  painted?: { readonly source: HTMLElement; readonly target: HTMLElement },
): MotionRun | null {
  const elements = painted ?? defaultMotionElements(before, after);
  if (!elements) return null;
  const { source, target } = elements;
  const stage = direction === 'back' ? before.overlay : after.overlay;
  const reduced = root.classList.contains('reduce-motion');
  const animations: Animation[] = [];
  const cleanups = new Set<RunCleanup>();
  let cleaned = false;
  let settleRun = (): void => undefined;
  const settled = new Promise<void>((resolve) => { settleRun = resolve; });

  const sourceBase = source === before.overlay ? before.layer : null;
  const targetBase = target === after.overlay ? after.layer : null;
  const stack = motionStack(before, after, direction);
  source.style.setProperty('--page-motion-z', String(stack.source));
  target.style.setProperty('--page-motion-z', String(stack.target));
  /* topOpenOverlay() must compare the page's authored layer, not this
     temporary compositor lift. */
  if (sourceBase !== null) {
    source.style.setProperty('--page-motion-base-z', String(sourceBase));
  }
  if (targetBase !== null) {
    target.style.setProperty('--page-motion-base-z', String(targetBase));
  }
  cleanups.add(() => {
    source.style.removeProperty('--page-motion-z');
    target.style.removeProperty('--page-motion-z');
    source.style.removeProperty('--page-motion-base-z');
    target.style.removeProperty('--page-motion-base-z');
  });

  /* The outgoing overlay remains painted for the push after its logical route
     has closed. The shared inert borrower composes with a sheet that may open
     during this same 420ms; neither owner can restore the other's lock. */
  if (source === before.overlay) {
    const sourceInert: InertSnapshot = makeInert(source);
    cleanups.add(() => sourceInert.release());
  }

  /* CSS clipping and pointer-events only govern sighted pointer input. Borrow
     inert for every incoming branch except its Back control as well, so Tab,
     keyboard activation, and assistive navigation cannot enter content before
     the push lands. The same ownership primitive composes with loaders,
     sheets, and interrupted runs, then restores their original state. */
  const targetBack = target.querySelector<HTMLElement>('[data-page-back]');
  const activeBeforeLock = document.activeElement;
  const deferredTargetFocus = activeBeforeLock instanceof HTMLElement
      && activeBeforeLock !== targetBack && target.contains(activeBeforeLock)
    ? activeBeforeLock : null;
  const targetInert = makeInertExcept(target, targetBack);
  cleanups.add((completed) => {
    targetInert.forEach((snapshot) => snapshot.release());
    /* Owners such as Legal establish their destination focus together with
       logical visibility. Inert temporarily clears it; restore that intent
       only after a natural landing and only if no user/sheet chose a newer
       focus while the transition was running. */
    if (completed && deferredTargetFocus?.isConnected
        && (document.activeElement === document.body
          || document.activeElement === document.documentElement)) {
      deferredTargetFocus.focus({ preventScroll: true });
    }
  });

  /* An interrupted run may hand either surface straight to its replacement.
     Its generation-aware rAF deliberately left this class in place; the new
     owner must clear it before applying its own source/target state. */
  source.classList.remove('page-motion-cleanup');
  target.classList.remove('page-motion-cleanup');
  if (after.panel?.id === 'onLoading') {
    after.panel.classList.add('page-motion-loader-revealed');
  }
  source.classList.add('page-motion-source', `page-motion-${direction}`);
  target.classList.add('page-motion-target', `page-motion-${direction}`);
  stage.classList.add('page-motion-stage');
  root.classList.add('page-motion-active');
  root.dataset.pageMotionDirection = direction;

  /* A reused shell moves TRANSPARENT panels over its own aurora, so the shell
     itself paints what a full-screen page carries for free: an opaque slab
     that travels with the page on top, a scrim over the page underneath, and
     its one title arriving with the page it names (the owner's report: a
     cached page's details were on screen in the first frame). A cross-overlay
     run has two opaque pages; the one underneath wears the scrim. Both paints
     are pseudo-elements the controller animates, so they leave nothing in the
     DOM and cancel with everything else. */
  const within = before.overlay === after.overlay;
  const under = direction === 'forward' ? source : target;
  const scrimHost = within ? stage : under;
  const title = within ? stage.querySelector<HTMLElement>('.shead .ttl') : null;
  if (within) stage.classList.add('page-motion-within');
  const pseudo = (host: Element, frames: Keyframe[], options: KeyframeAnimationOptions,
    id: string, pseudoElement: string): Animation =>
    animate(host, frames, { ...options, pseudoElement }, id);

  if (reduced) {
    const options = { duration: REDUCED_DURATION, easing: 'ease-out' };
    animations.push(
      animate(source, [{ opacity: 1 }, { opacity: direction === 'back' ? 0 : .88 }],
        options, 'kb-page-crossfade-source'),
      animate(target, [{ opacity: direction === 'back' ? .88 : 0 }, { opacity: 1 }],
        options, 'kb-page-crossfade-target'),
    );
    if (within) {
      animations.push(pseudo(stage, [{ opacity: 0 }, { opacity: 1 }], options,
        'kb-page-crossfade-slab', '::before'));
      if (title) {
        animations.push(animate(title, [{ opacity: 0 }, { opacity: 1 }], options,
          'kb-page-crossfade-title'));
      }
    }
  } else {
    const options = { duration: PUSH_DURATION, easing: PUSH_EASE };
    const frames = pushTimeline(direction);
    animations.push(
      animate(source, frames.source, options, 'kb-page-push-source'),
      animate(target, frames.target, options, 'kb-page-push-target'),
      pseudo(scrimHost, frames.scrim, options, 'kb-page-push-scrim', '::after'),
    );
    if (within) {
      animations.push(pseudo(stage, frames.slab, options, 'kb-page-push-slab', '::before'));
      if (title) animations.push(animate(title, frames.title, options, 'kb-page-push-title'));
    }
    if (direction === 'back') {
      const control = before.overlay.querySelector<HTMLElement>('[data-page-back]');
      if (control) animations.push(...bracketBeat(control));
    }
  }

  let run: MotionRun;
  const cleanup = (completed: boolean): void => {
    if (cleaned) return;
    cleaned = true;
    animations.forEach((animation) => animation.cancel());
    cleanups.forEach((finish) => finish(completed));
    source.classList.add('page-motion-cleanup');
    target.classList.add('page-motion-cleanup');
    source.classList.remove('page-motion-source', `page-motion-${direction}`);
    target.classList.remove('page-motion-target', `page-motion-${direction}`);
    stage.classList.remove('page-motion-stage', 'page-motion-within');
    /* Commit the cleanup rules before letting the generic overlay transition
       exist again. Without this flush Chromium treats removal as a fresh
       visible -> hidden delay and a closed page reports visible for .28s. */
    void getComputedStyle(source).visibility;
    void getComputedStyle(target).visibility;
    root.classList.remove('page-motion-active');
    delete root.dataset.pageMotionDirection;
    requestAnimationFrame(() => {
      if (!source.classList.contains('page-motion-source')) source.classList.remove('page-motion-cleanup');
      if (!target.classList.contains('page-motion-target')) target.classList.remove('page-motion-cleanup');
    });
    onDone(completed, run);
    settleRun();
  };
  run = {
    direction,
    destination: after,
    cleanups,
    settled,
    cancel: () => cleanup(false),
  };
  void Promise.allSettled(animations.map((animation) => animation.finished))
    .then(() => cleanup(true));
  return run;
}

/** Move the real outgoing panel into a temporary viewport-aligned layer. It
    keeps every live value and virtual row without cloning IDs, and its anchor
    restores the one original node after the compositor is finished. */
function pinPanel(panel: HTMLElement, overlay: HTMLElement): PinnedPanel | null {
  const rect = panel.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const anchor = document.createComment('page-motion-panel-anchor');
  panel.before(anchor);
  const layer = document.createElement('div');
  layer.className = 'page-motion-panel-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  layer.style.setProperty('--page-panel-x', `${rect.left - overlayRect.left}px`);
  layer.style.setProperty('--page-panel-y', `${rect.top - overlayRect.top}px`);
  layer.style.setProperty('--page-panel-w', `${rect.width}px`);
  layer.style.setProperty('--page-panel-h', `${rect.height}px`);
  overlay.appendChild(layer);
  layer.appendChild(panel);
  let released = false;
  return {
    paint: layer,
    release: () => {
      if (released) return;
      released = true;
      anchor.replaceWith(panel);
      layer.remove();
    },
  };
}

/** The shared panel seam used by a reused overlay such as Online. The owner
    provides its one logical mutation; motion captures before and paints after. */
export function changePagePanel(spec: PanelChangeSpec, mutate: () => void): Promise<void> {
  const root = spec.overlay.closest<HTMLElement>('#kbroot');
  const controller = root ? CONTROLLERS.get(root) : null;
  if (controller) return controller.changePanel(spec, mutate);
  mutate();
  return Promise.resolve();
}

/** Resolve after the current navigation presentation (including an
    interruption that hands off to another run) has genuinely landed. The rAF
    lets MutationObserver reconcile a just-authored overlay change first. */
export function whenPageMotionSettled(root: HTMLElement): Promise<void> {
  return new Promise<void>((resolve) => requestAnimationFrame(() => {
    const controller = CONTROLLERS.get(root);
    void (controller?.whenSettled() ?? Promise.resolve()).then(resolve);
  }));
}

export function bindPageMotion(root: HTMLElement): void {
  if (CONTROLLERS.has(root)) return;
  let current = surface(root);
  let history = current ? [current.key] : [];
  let activeRun: MotionRun | null = null;
  let heldHydration: HeldHydration | null = null;
  let scheduled = false;
  let pendingDirection: { direction: PageMotionDirection; at: number } | null = null;
  let lastPointerIntentAt = 0;

  const rememberIntent = (target: EventTarget | null): void => {
    const element = target instanceof Element
      ? target.closest<HTMLElement>('[data-page-back],[data-page-motion-direction],button,a,[role="button"]')
      : null;
    if (!element || !root.contains(element)) return;
    const declared = element.dataset.pageMotionDirection;
    pendingDirection = {
      direction: declared === 'back' || declared === 'forward'
        ? declared : element.matches('[data-page-back]') ? 'back' : 'forward',
      at: Date.now(),
    };
  };
  root.addEventListener('pointerdown', (event) => {
    lastPointerIntentAt = Date.now();
    rememberIntent(event.target);
  }, true);
  root.addEventListener('click', (event) => {
    if (Date.now() - lastPointerIntentAt > 600) rememberIntent(event.target);
  }, true);

  const consumeDirection = (declared?: PageMotionDirection): PageMotionDirection | null => {
    if (declared) {
      pendingDirection = null;
      return declared;
    }
    const intent = pendingDirection && Date.now() - pendingDirection.at <= 1500
      ? pendingDirection.direction : null;
    pendingDirection = null;
    return intent;
  };

  const chooseDirection = (next: PageSurface,
    declared?: PageMotionDirection): PageMotionDirection => {
    const intended = consumeDirection(declared);
    const earlier = history.lastIndexOf(next.key, Math.max(0, history.length - 2));
    const direction = intended ?? (earlier >= 0 ? 'back' : 'forward');
    if (direction === 'back') {
      if (earlier >= 0) history.splice(earlier + 1);
      else {
        history.pop();
        if (history[history.length - 1] !== next.key) history.push(next.key);
      }
    } else if (history[history.length - 1] !== next.key) history.push(next.key);
    return direction;
  };

  const discardHeldHydration = (): void => {
    if (!heldHydration) return;
    heldHydration.release();
  };

  const setActiveRun = (
    before: PageSurface,
    after: PageSurface,
    direction: PageMotionDirection,
    painted?: { readonly source: HTMLElement; readonly target: HTMLElement },
  ): MotionRun | null => {
    let started: MotionRun | null = null;
    started = startMotion(root, before, after, direction, (_completed, finished) => {
      if (activeRun === finished) activeRun = null;
    }, painted);
    activeRun = started;
    return started;
  };

  const holdHydration = (
    run: MotionRun,
    before: PageSurface,
    after: PageSurface,
    pinned: PinnedPanel | null,
  ): void => {
    const loader = before.panel;
    const ready = after.panel;
    if (!loader || !ready) {
      pinned?.release();
      return;
    }
    loader.classList.add('page-motion-loader-hold');
    ready.classList.add('page-motion-loader-next');
    const readyInert = makeInert(ready);
    let released = false;
    const held: HeldHydration = {
      run,
      before,
      after,
      loader,
      ready,
      pinned,
      release: () => {
        if (released) return;
        released = true;
        loader.classList.remove('page-motion-loader-hold', 'page-motion-loader-revealed');
        ready.classList.remove('page-motion-loader-next');
        readyInert.release();
        pinned?.release();
        if (heldHydration === held) heldHydration = null;
      },
    };
    heldHydration = held;
    current = before;
    run.cleanups.add((completed) => {
      if (heldHydration?.run !== run || !completed) return;
      held.release();
      current = after;
    });
  };

  const changePanel = (spec: PanelChangeSpec, mutate: () => void): Promise<void> => {
    const overlayWasPage = topOpenOverlay(root) === spec.overlay && eligibleOverlay(spec.overlay);
    const before = current ?? surface(root);
    const targetKey = `${spec.overlay.id}/${spec.logicalId || spec.target.id}`;
    const pendingIntent = pendingDirection && Date.now() - pendingDirection.at <= 1500
      ? pendingDirection.direction : null;
    const intent = spec.direction ?? pendingIntent;

    /* A caller may preseed a hidden reused shell, or may have shown it in this
       same task before MutationObserver reconciles. Keep the prior page as the
       top-level source; only reconcile owns the cross-overlay hand-off. */
    if (before && before.overlay !== spec.overlay) {
      mutate();
      const openedBeforeReconcile = topOpenOverlay(root) === spec.overlay;
      if (openedBeforeReconcile && !scheduled) {
        scheduled = true;
        queueMicrotask(reconcile);
      }
      if (!openedBeforeReconcile) return Promise.resolve();
      /* Cached data can paint in the same task that opened the overlay, before
         MutationObserver establishes its one top-level run. Defer one
         microtask so Account rewards/focus and other presentation side effects
         cannot outrun that push. A superseding route resolves immediately;
         its owner revision remains the final authority. */
      return new Promise<void>((resolve) => queueMicrotask(() => {
        const run = activeRun;
        if (run?.destination.overlay === spec.overlay && run.destination.key === targetKey) {
          void run.settled.then(resolve);
        } else resolve();
      }));
    }

    /* Queue/search painters legitimately restate their current panel while a
       top-level entry is still running. That is content paint, not a second
       route, and must not truncate the one 420ms page timeline. */
    if (before?.overlay === spec.overlay && before.panel === spec.target
        && before.key === targetKey) {
      mutate();
      pendingDirection = null;
      return activeRun?.destination.key === targetKey
        ? activeRun.settled : Promise.resolve();
    }
    /* A fast owner may restate the fully painted destination while its first
       loader hold is still presenting. Repaint in place; nesting a second pin
       would orphan the real loader between two temporary anchors. A real Back
       intent is navigation, though: it falls through and transfers that one
       pinned loader into the shared Back run. */
    if (heldHydration?.after.key === targetKey && heldHydration.ready === spec.target
        && activeRun === heldHydration.run && current === heldHydration.before
        && intent !== 'back') {
      mutate();
      pendingDirection = null;
      return heldHydration.run.settled;
    }
    const hydration = intent !== 'back' && !!before?.panel && before.panel.id === 'onLoading'
      && before.key === targetKey && spec.target !== before.panel;

    if (hydration) {
      /* Move the already-painted die out of pbody flow before ready content is
         revealed. The ready panel can now lay out and prime virtual rows under
         it without moving the visual frame the player is watching. */
      const pinned = overlayWasPage && before.panel
        ? pinPanel(before.panel, spec.overlay) : null;
      mutate();
      const after = pageSurface(spec.overlay, spec.target, spec.logicalId);
      const ownsEntry = activeRun?.destination.key === before.key
        && activeRun.destination.panel === before.panel;
      if (overlayWasPage && activeRun && ownsEntry) {
        holdHydration(activeRun, before, after, pinned);
      } else {
        pinned?.release();
        before.panel?.classList.remove('page-motion-loader-revealed');
        current = after;
      }
      pendingDirection = null;
      return activeRun && ownsEntry ? activeRun.settled : Promise.resolve();
    }

    /* A second navigation may interrupt a page that is still settling. Restore
       its first source, then pin the frame the player currently sees. */
    activeRun?.cancel();
    activeRun = null;
    const source = before?.overlay === spec.overlay ? before.panel : null;
    /* Hydration may already have pinned the loader. Transfer that exact paint
       layer to the replacement run; pinning the same node twice would leave
       the new layer empty when the first anchor restores it. */
    const heldSource = heldHydration?.loader === source ? heldHydration : null;
    const pinned = heldSource ? heldSource.pinned
      : overlayWasPage && source && source !== spec.target
        ? pinPanel(source, spec.overlay) : null;
    if (!heldSource) discardHeldHydration();
    mutate();

    if (!overlayWasPage || !before || !source || source === spec.target) {
      if (heldSource) discardHeldHydration();
      else pinned?.release();
      if (topOpenOverlay(root) === spec.overlay) {
        current = pageSurface(spec.overlay, spec.target, spec.logicalId);
      }
      pendingDirection = null;
      return Promise.resolve();
    }

    const after = pageSurface(spec.overlay, spec.target, spec.logicalId);
    current = after;
    const direction = chooseDirection(after, spec.direction);
    const run = setActiveRun(before, after, direction, {
      source: pinned?.paint ?? source,
      target: spec.target,
    });
    if (!run) {
      if (heldSource) discardHeldHydration();
      else pinned?.release();
    } else if (heldSource) {
      run.cleanups.add(() => discardHeldHydration());
    } else if (pinned) run.cleanups.add(() => pinned.release());
    if (source.id === 'onLoading') {
      if (run) run.cleanups.add(() => source.classList.remove('page-motion-loader-revealed'));
      else source.classList.remove('page-motion-loader-revealed');
    }
    return run?.settled ?? Promise.resolve();
  };

  const whenSettled = async (): Promise<void> => {
    while (activeRun) await activeRun.settled;
  };

  CONTROLLERS.set(root, { changePanel, whenSettled });

  const reconcile = (): void => {
    scheduled = false;
    const room = openRoom(root);
    const top = room.top;
    const layeredTop = room.layerTop;
    let next: PageSurface | null;
    if (!top && layeredTop) {
      /* A sheet owns the room. Keep the page under it stable. The exception is
         a just-closed raised Legal page: push that source away to the page
         beneath the sheet, whose authored z remains below the modal. */
      if (current && !current.overlay.classList.contains('on')) {
        next = surfaceOf(layeredTop, room.layerTopZ);
      } else return;
    } else if (top && !eligibleOverlay(top)) {
      /* A pass-through overlay such as the lazy download wait leaves its
         source page open. Preserve history, but stop any compositor run so a
         modal never competes with navigation. Real departures hide their page
         first (Queue -> reveal), and therefore reset below. */
      if (current?.overlay.classList.contains('on')) {
        activeRun?.cancel();
        activeRun = null;
        discardHeldHydration();
        pendingDirection = null;
        return;
      }
      next = null;
    } else {
      next = surfaceOf(top, room.layerTopZ);
    }
    if (sameSurface(current, next)) return;
    const previous = current;
    current = next;
    if (!previous || !next) {
      activeRun?.cancel();
      activeRun = null;
      discardHeldHydration();
      history = next ? [next.key] : [];
      pendingDirection = null;
      return;
    }

    const changesPage = previous.overlay !== next.overlay
      && (previous.overlay.classList.contains('paged') || next.overlay.classList.contains('paged'));
    if (!changesPage) {
      history = [next.key];
      pendingDirection = null;
      return;
    }

    const direction = chooseDirection(next);
    activeRun?.cancel();
    activeRun = null;
    const run = setActiveRun(previous, next, direction);
    /* Back during a fast hydration must carry out the die the player saw, not
       reveal ready content underneath it halfway through the new run. */
    if (run && heldHydration && previous.overlay === heldHydration.before.overlay
        && next.overlay !== previous.overlay) {
      run.cleanups.add(() => discardHeldHydration());
    }
  };

  /* Only overlay class changes can create a top-level page transition. Online
     panels call the explicit shared seam above, so virtual rows, dice, sheets,
     inert toggles, and every unrelated class no longer rescan the page stack. */
  /* The controller's own paint classes land on .ov elements too. Without this
     filter every run woke the router four to six times to discover nothing
     had routed, and each wake-up re-read computed styles right after a class
     write — a forced style flush per wake-up (measured 2026-09-02). */
  const routed = (record: MutationRecord): boolean => {
    const target = record.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('ov')) return false;
    const before = new Set((record.oldValue ?? '').split(/\s+/).filter(Boolean));
    const after = new Set(target.classList);
    for (const token of before) {
      if (!after.has(token) && !token.startsWith('page-motion-')) return true;
    }
    for (const token of after) {
      if (!before.has(token) && !token.startsWith('page-motion-')) return true;
    }
    return false;
  };
  const observer = new MutationObserver((records) => {
    if (scheduled || !records.some(routed)) return;
    scheduled = true;
    queueMicrotask(reconcile);
  });
  observer.observe(root, {
    subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true,
  });
}

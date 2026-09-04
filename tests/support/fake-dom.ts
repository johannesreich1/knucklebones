// A permissive DOM stand-in for Node-driven owner tests that execute the
// shared game render path as a side effect (board/score repaint inside the
// ranked synchronizer). Pixels are meaningless here — the browser suites own
// visual truth — so every element accepts writes and returns inert children.
// The one selector-aware behavior: '#spellBar' resolves to null so the rune
// rail keeps its real "no rail mounted" early return instead of building a
// fake hand. Install BEFORE the first render call; imports of src/ modules
// are side-effect-safe without a DOM.

/* Structural typing against the real DOM is deliberately out of scope: the
   stub only needs to absorb calls, so `any` is the honest type. */

const rect = () => ({
  top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
});

const fakeStyle = () => ({
  setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; },
});

const fakeClassList = () => ({
  add() {}, remove() {}, toggle() { return false; }, contains() { return false; },
});

export function fakeElement(): any {
  const el: any = {
    dataset: {}, style: fakeStyle(), classList: fakeClassList(),
    children: [], childNodes: [],
    firstChild: null, firstElementChild: null, lastElementChild: null,
    previousElementSibling: null, nextElementSibling: null, parentElement: null,
    hidden: false, disabled: false, textContent: '', innerHTML: '', outerHTML: '', title: '',
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    appendChild(child: unknown) { return child; },
    removeChild(child: unknown) { return child; },
    insertAdjacentHTML() {}, insertAdjacentElement() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    querySelector() { return fakeElement(); },
    querySelectorAll() { return [fakeElement(), fakeElement(), fakeElement(), fakeElement()]; },
    closest() { return null; }, contains() { return false; },
    getBoundingClientRect: rect,
    animate() { return { finished: Promise.resolve(), cancel() {}, onfinish: null }; },
    /* The move animation clears whatever is still running on a node it reuses. */
    getAnimations() { return [] as unknown[]; },
    focus() {}, blur() {}, click() {}, remove() {},
    /* <template> factory support: makeDie() reads .content.firstElementChild.
       Lazy getter — an eager child would recurse forever. */
    get content() { return { firstElementChild: fakeElement() }; },
  };
  return el;
}

/** Install a #kbroot-rooted fake document plus the style/frame globals the
    render path touches. Idempotent enough for one test process. */
export function installFakeDom(): void {
  const root = fakeElement();
  root.id = 'kbroot';
  root.querySelector = (selector: string) =>
    (selector.includes('#spellBar') ? null : fakeElement());
  (globalThis as any).document = {
    getElementById: (id: string) => (id === 'kbroot' ? root : null),
    createElement: () => fakeElement(),
    createElementNS: () => fakeElement(),
    createTextNode: (text: string) => ({ textContent: text }),
    documentElement: fakeElement(),
    body: fakeElement(),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    elementFromPoint: () => null,
    visibilityState: 'visible', hidden: false,
  };
  /* A REAL ENOUGH localStorage. Several modules read one — the progression and
     curve caches above all — and without it every write silently answers false
     and every read answers null, which reads in a test as "the default", not as
     "the store is missing". play-sync could not put its client on curve v1 to
     exercise the old-schema fallback until this existed. In-memory and rebuilt
     per install, so suites cannot leak state into each other. */
  const cells = new Map<string, string>();
  (globalThis as any).localStorage = {
    get length() { return cells.size; },
    key: (index: number) => [...cells.keys()][index] ?? null,
    getItem: (key: string) => (cells.has(key) ? cells.get(key)! : null),
    setItem: (key: string, value: string) => { cells.set(String(key), String(value)); },
    removeItem: (key: string) => { cells.delete(key); },
    clear: () => { cells.clear(); },
  };
  (globalThis as any).getComputedStyle = () => ({
    getPropertyValue: () => '', borderRadius: '',
  });
  (globalThis as any).requestAnimationFrame =
    (callback: (time: number) => void) => setTimeout(() => callback(0), 0);
  /* An owner test that enters the REPLAY rather than a projection runs the
     shared move animation, and that reaches Sfx — which reads `window` before
     it can decide there is no audio to make. A window with no AudioContext is
     the honest stand-in: ac() returns null and every tone is skipped, exactly
     as on a page whose context never unlocked. */
  (globalThis as any).window ??= globalThis;
  (globalThis as any).matchMedia ??= () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
}

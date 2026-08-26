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
  (globalThis as any).getComputedStyle = () => ({
    getPropertyValue: () => '', borderRadius: '',
  });
  (globalThis as any).requestAnimationFrame =
    (callback: (time: number) => void) => setTimeout(() => callback(0), 0);
  (globalThis as any).matchMedia ??= () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
}

// Embed mode: false = the page owns the viewport (standalone / PWA / native),
// true = the game lives inside #kbroot on someone else's page (widget build).
// Every behavioural difference between the two is a branch on isEmbed() — and
// every visual one a cascade override in widget-embed.css. Nothing is patched
// after the build.
let embedded = false;

export const setEmbed = (v: boolean): void => { embedded = v; };
export const isEmbed = (): boolean => embedded;

export const kbroot = (): HTMLElement | null => document.getElementById('kbroot');

/* Every entry point provides exactly one application root before boot. Keep
   the nullable lookup for the widget-removal guard, but application code uses
   this required form: falling back to <body> is how portals and state escaped
   into an embedding page in the first place. */
export function appRoot(): HTMLElement {
  const root = kbroot();
  if (!root) throw new Error('Knucklebones requires one #kbroot application root');
  return root;
}

export const rootRect = (): DOMRect => appRoot().getBoundingClientRect();

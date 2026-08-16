// Embed mode: false = the page owns the viewport (standalone / PWA / native),
// true = the game lives inside #kbroot on someone else's page (widget build).
// Every behavioural difference between the two is a branch on isEmbed() — and
// every visual one a cascade override in widget-embed.css. Nothing is patched
// after the build.
let embedded = false;

export const setEmbed = (v: boolean): void => { embedded = v; };
export const isEmbed = (): boolean => embedded;

export const kbroot = (): HTMLElement | null => document.getElementById('kbroot');
export const rootRect = (): DOMRect => kbroot()!.getBoundingClientRect();

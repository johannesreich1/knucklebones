// Dependency-free DOM lookup shared by UI modules. Keeping this below layout
// and screen helpers prevents a basic query from pulling their behavior back
// upward into the dependency graph.
import { appRoot } from './embed.ts';

export const $ = (selector: string): HTMLElement =>
  appRoot().querySelector(selector) as HTMLElement;

/* Hit-testing is document-global by browser design. Turn it back into an
   application query before any gesture interprets a class or id: an embedding
   host is allowed to have its own .col, .btn, or even a legacy #dieStage. */
export function rootElementFromPoint(x: number, y: number): Element | null {
  const element = document.elementFromPoint(x, y);
  return element && appRoot().contains(element) ? element : null;
}

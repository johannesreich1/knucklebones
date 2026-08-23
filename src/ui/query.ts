// Dependency-free DOM lookup shared by UI modules. Keeping this below layout
// and screen helpers prevents a basic query from pulling their behavior back
// upward into the dependency graph.
import { appRoot } from './embed.ts';

export const $ = (selector: string): HTMLElement =>
  appRoot().querySelector(selector) as HTMLElement;

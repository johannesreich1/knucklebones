// The target vocabulary belongs to the input seam (ui/input.ts defines what a
// board gesture can point at); flow re-exports it so spell modules keep one
// local seam name.
export type { SpellInputTarget } from '../ui/input.ts';

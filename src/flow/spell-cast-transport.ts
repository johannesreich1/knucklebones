// Ranked play routes spell input to the server instead of the local cast()
// path. The transport is installed and torn down as ONE bundle — cast, aim
// and the caster guard always travel together, so a half-installed transport
// is unrepresentable. Local play simply leaves it null.
import type { Player } from '../core/rules.ts';

export type SpellCastTransport = (id: string, column: number) => Promise<boolean>;
export type SpellAimTransport = (id: string) => Promise<boolean>;

export interface SpellTransport {
  cast: SpellCastTransport;
  aim: SpellAimTransport;
  casterAllowed: (who: Player) => boolean;
}

let transport: SpellTransport | null = null;

export function setSpellTransport(next: SpellTransport | null): void {
  transport = next;
}

export function hasSpellAimTransport(): boolean {
  return transport !== null;
}

export function transportSpellCast(id: string, column: number): Promise<boolean> | null {
  return transport?.cast(id, column) ?? null;
}

export function transportSpellAim(id: string): Promise<boolean> | null {
  return transport?.aim(id) ?? null;
}

export function spellCasterAllowed(who: Player): boolean {
  return transport?.casterAllowed(who) ?? true;
}

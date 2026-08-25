import type { Player } from '../core/rules.ts';

export type SpellCastTransport = (id: string, column: number) => Promise<boolean>;
export type SpellAimTransport = (id: string) => Promise<boolean>;

let transport: SpellCastTransport | null = null;
let aimTransport: SpellAimTransport | null = null;
let casterGuard: ((who: Player) => boolean) | null = null;

export function setSpellCastTransport(next: SpellCastTransport | null): void {
  transport = next;
}

export function setSpellAimTransport(next: SpellAimTransport | null): void {
  aimTransport = next;
}

export function setSpellCasterGuard(next: ((who: Player) => boolean) | null): void {
  casterGuard = next;
}

export function hasSpellCastTransport(): boolean {
  return transport !== null;
}

export function hasSpellAimTransport(): boolean {
  return aimTransport !== null;
}

export function transportSpellCast(id: string, column: number): Promise<boolean> | null {
  return transport?.(id, column) ?? null;
}

export function transportSpellAim(id: string): Promise<boolean> | null {
  return aimTransport?.(id) ?? null;
}

export function spellCasterAllowed(who: Player): boolean {
  return casterGuard?.(who) ?? true;
}

// The armed rune's whole life: arming it, the commitment some runes make the
// moment they are aimed, cancelling, which board target a shot actually fits,
// the number-key mapping, and what an expiring turn clock does to an aim.
// Aiming may cancel before commitment; a cast cannot be undone afterward.
//
// This leaf decides WHERE, never WHETHER. Its own legality reads (spell-
// legality) are advisory; every path out hands a chosen (id, column) to the
// cast port, so flow/spells' cast() still rules on legality exactly once.
import type { Player } from '../core/rules.ts';
import { spellById, type SpellSpec } from '../core/spells.ts';
import { spellCopy } from '../i18n/index.ts';
import { S } from '../state.ts';
import { Sfx } from '../ui/audio.ts';
import { setStatus } from '../ui/game/turn-state.ts';
import { transportSpellAim } from './spell-cast-transport.ts';
import { currentCastContext } from './spell-context.ts';
import { clearSpellTargets } from './spell-gestures.ts';
import { castable, caster, chargesOf, firstLegalColumn } from './spell-legality.ts';
import { isAimedColumn } from './spell-rail.ts';
import type { SpellInputTarget } from './spell-target.ts';

export interface SpellAimPorts {
  /* The only way out: whether the chosen column is actually legal is decided
     there, not here. */
  cast: (id: string, column: number) => Promise<boolean>;
  render: () => void;
  /* A thunk, not the notifier itself — flow/spells' chooser port is replaced
     wholesale after boot, and a captured reference would freeze the no-op. */
  onChoice: () => void;
  spendCharge: (who: Player, spell: SpellSpec, faceUp?: boolean) => void;
}

export interface SpellAim {
  applyAimPresentation(who: Player, spell: SpellSpec, faceUp?: boolean): void;
  arm(id: string): boolean;
  /* Drop the aim without rendering or notifying: for a cast already underway. */
  clearAim(): void;
  disarm(force?: boolean): boolean;
  castArmed(target: SpellInputTarget | null): boolean;
  castArmedByIndex(column: number): boolean;
  resolveTimedOutSpellAim(): Promise<boolean>;
}

/* Bound once by flow/spells. The aim itself lives in S, so this facade holds
   no state of its own and binding it twice would not fork a second aim. */
export function createSpellAim(ports: SpellAimPorts): SpellAim {
  /* A committed aim spends its charge immediately and reserves it for the cast. */
  function applyAimPresentation(who: Player, spell: SpellSpec, faceUp = false): void {
    ports.spendCharge(who, spell, faceUp);
    S.spellArmed = spell.id;
    S.spellAimCommitted = { id: spell.id, who };
  }

  function arm(id: string): boolean {
    if (S.spellArmed === id) return true;
    if (S.spellAimCommitted) return false;
    const who = caster();
    const spell = spellById(id);
    if (who === null || !spell || !castable(id)) return false;
    S.spellArmed = id;
    if (spell.commitsOnAim) {
      /* ONE PATH FOR BOTH DRIVERS. Ranked used to skip this and wait for the
         action log to light the die, which cost it the marks entirely: the
         transport below sets S.busy synchronously, caster() answers null while
         it is set, and markAim then CLEARS every ring and preview rather than
         drawing them. So a ranked ANVIL aim painted nothing at all until the
         projection landed — and nothing ever, if it was refused. Reported from
         a device 2026-08-29: "not even the dice got the effect color when
         activating".
         Painting first is safe because a refusal is fully recoverable: the
         charge is put back here, and the resync that follows a refused action
         reinstalls charges, board and aim from the log regardless. */
      const held = chargesOf(who, id);
      applyAimPresentation(who, spell);
      void transportSpellAim(id)?.then((accepted) => {
        if (accepted || S.spellAimCommitted?.id !== id) return;
        /* A refused aim was never spent on the server. Hand the charge back
           rather than leaving the player a rune they cannot cast and cannot
           get rid of — the freeze reported the same day, against 5 real
           pvp-action 409s. */
        S.spellCharges[who][id] = held;
        S.spellCastThisTurn = null;
        clearAim();
        ports.render();
      });
    }
    ports.render();
    setStatus({ visible: () => spellCopy(spell.id).aimCompact,
      accessible: () => spellCopy(spell.id).aim }, who);
    return true;
  }

  function clearAim(): void {
    S.spellArmed = null;
    S.spellAimCommitted = null;
    clearSpellTargets();
  }

  function disarm(force = false): boolean {
    if ((S.spellAimCommitted || spellById(S.spellArmed)?.locksOnAim) && !force) return false;
    if (!S.spellArmed && !S.spellAimCommitted) return true;
    clearAim();
    ports.render();
    if (S.phase === 'choose') ports.onChoice();
    return true;
  }

  /* An armed spell claims board input before placement. Wrong or empty targets
     consume the input event; ordinary aims cancel, while a registry-locked aim
     stays open until it receives a legal answer. */
  function castArmed(target: SpellInputTarget | null): boolean {
    const id = S.spellArmed;
    if (!id) return false;
    const spell = spellById(id);
    const who = S.turn as Player;
    const targetSide = spell?.side === 'foe' ? (1 - who) as Player : who;
    const fits = !!target && !!spell && (spell.target === 'self'
      ? target.kind === 'stage'
      : target.kind === 'column' && target.who === targetSide
        && isAimedColumn(target.who, target.column));
    if (!fits) {
      Sfx.tap();
      disarm();
      return true;
    }
    void ports.cast(id, target.kind === 'stage' ? -1 : target.column);
    return true;
  }

  /* Number keys select the uniquely expected side for the armed spell. Physical
     pointer paths carry their actual side through SpellInputTarget instead. */
  function castArmedByIndex(column: number): boolean {
    const spell = spellById(S.spellArmed);
    if (!spell) return false;
    /* An armed self spell still owns the number key. A column key is the wrong
       target for it, so feed that mismatch through the normal cancellation path
       instead of falling through to ordinary placement. */
    if (spell.target !== 'column') return castArmed(null);
    const who = S.turn as Player;
    const side = (spell.side === 'foe' ? 1 - who : who) as Player;
    return castArmed({ kind: 'column', who: side, column });
  }

  /* The normal turn clock keeps running while a rune is aimed. An ordinary aim
     simply falls away at expiry; an information-bearing ANVIL aim has already
     committed, so expiry selects its first legal marked column instead of
     refunding it or letting the duel stall forever. A completed cast receives
     the usual fresh placement clock through onCastComplete(). */
  async function resolveTimedOutSpellAim(): Promise<boolean> {
    const id = S.spellArmed;
    if (!id) return false;
    const spell = spellById(id);
    /* Every committed aim now says so in S, ranked included, so this is the
       whole question — the transport no longer has to be asked separately. */
    const committed = !!S.spellAimCommitted;
    if (!committed) {
      disarm(true);
      return false;
    }
    const who = caster();
    if (!spell || who === null || spell.target !== 'column') return false;
    const column = firstLegalColumn(spell, who, currentCastContext());
    return column < 0 ? false : ports.cast(id, column);
  }

  return {
    applyAimPresentation, arm, clearAim, disarm,
    castArmed, castArmedByIndex, resolveTimedOutSpellAim,
  };
}

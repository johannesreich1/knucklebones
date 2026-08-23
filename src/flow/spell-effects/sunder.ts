import { freshCharm, openStrikes, type Player, type StrikeOutcome } from '../../core/rules.ts';
import { S } from '../../state.ts';
import { Sfx, vibrate } from '../../ui/audio.ts';
import { slotEl, slotIdx } from '../../ui/dom.ts';
import { appRoot } from '../../ui/embed.ts';
import { REDUCED, burst, shake } from '../../ui/fx.ts';
import { spellHue } from '../../ui/spellicons.ts';
import { clearSunderPresentation } from '../../ui/game/sunder-presentation.ts';
import { effectPause, type SpellEffect } from './types.ts';

/* openStrikes is authoritative but consumes the live SUNDER mark. Preview on a
   fresh charm instead: the board is read-only, current wards are copied, and
   COLUMN SHIELD / SINGLE STRIKE remain exactly the rule the real move uses. */
function sunderPreview(who: Player): StrikeOutcome[] {
  const preview = freshCharm();
  preview.wards = [S.charm.wards[0].slice(), S.charm.wards[1].slice()];
  preview.sunder[who] = true;
  return openStrikes(S.boards, who, 0, S.die, S.scoring, preview);
}

function markSunderVictims(who: Player): number {
  clearSunderPresentation();
  const foe = (1 - who) as Player;
  let order = 0;
  for (const strike of sunderPreview(who)) {
    /* A ward answers the whole strike. Its matching dice are in danger, but
       not doomed; painting them as failures would promise a destruction the
       authoritative move will not perform. Shielded columns never enter the
       plan because victimsOf already makes them silent. */
    if (strike.warded) continue;
    for (const index of strike.victims) {
      const slot = slotEl(foe, strike.col, slotIdx(foe, index));
      const die = slot?.firstElementChild as HTMLElement | null;
      if (!slot || !die) continue;
      slot.classList.add('sunder-doomed-slot');
      slot.style.setProperty('--sunder-order', String(order++));
      die.classList.add('sunder-doomed');
    }
  }
  return order;
}

/* SU6 — Overload. The hand strains against its ring while the exact dice the
   next placement will destroy go crooked, tremble briefly, shed two embers and
   then hold a readable static warning. The registry mutation happens before
   any marking: flow has already committed the charge, and the screen never
   offers a preview of a cast that can still be taken back. */
export const sunderEffect: SpellEffect = async (who, _col, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);
  apply();

  const marked = markSunderVictims(who);
  const stage = appRoot().querySelector<HTMLElement>('#dieStage');
  if (stage) {
    stage.classList.add('sundered');
    const rect = stage.getBoundingClientRect();
    burst(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      spellHue('sunder'),
      Math.max(10, 10 + marked * 2),
    );
  }
  shake(marked ? 4 : 2);
  await effectPause(REDUCED ? 0 : 220);
};

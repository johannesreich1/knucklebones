import { Sfx, vibrate } from '../../ui/audio.ts';
import { REDUCED, burst } from '../../ui/fx.ts';
import { renderSide } from '../../ui/game/board.ts';
import { wardClaspRect } from '../../ui/game/seals.ts';
import { spellHue } from '../../ui/spellicons.ts';
import { effectPause, type SpellEffect } from './types.ts';

/* WARD fastens one visible clasp on the chosen column. Score rendering owns
   the seal's draw-on beat; the spell effect merely resolves the registry
   mutation, repaints that one side, and answers at the clasp's real transformed
   position (portrait, landscape and either table half use the same path). */
export const wardEffect: SpellEffect = async (who, col, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);
  apply();
  renderSide(who, true);

  const clasp = wardClaspRect(who, col);
  if (clasp) {
    burst(
      clasp.left + clasp.width / 2,
      clasp.top + clasp.height / 2,
      spellHue('ward'),
      14,
    );
  }
  await effectPause(REDUCED ? 0 : 260);
};

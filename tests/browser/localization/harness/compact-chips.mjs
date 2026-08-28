/* THE COMPACT MODE/RUNE CHIP ROW, swept from the registries.
 *
 * The chips above the board name the duel's scoring mode and its runes in the
 * player's language, in the tightest space the app has. The variants are read
 * from src/core/modes.ts and src/core/spells.ts rather than listed here, so a
 * newly registered mode or rune is measured the day it lands instead of the
 * day someone remembers to extend a list.
 *
 * The pair variant exists because two chips share the row's width: a rune that
 * fits alone can still push its partner out.
 */
import { MODES } from '../../../../src/core/modes.ts';
import { SPELLS } from '../../../../src/core/spells.ts';
import { frame } from './layout-inspection.mjs';
import { LOCALE_IDS as LOCALES, chooseLocale } from './locale-control.mjs';

const MODE_VARIANTS = MODES.map(({ mode, id }) => ({ mode, id }));
const RUNE_VARIANTS = SPELLS.map(({ id }) => id);

async function badgeSnapshot(page, rootSelector) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const rootBox = root.getBoundingClientRect();
    const row = root.querySelector('#rec');
    const chips = [...root.querySelectorAll('#rec .rchip')].map((chip) => {
      const box = chip.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(chip);
      const text = range.getBoundingClientRect();
      return {
        text: chip.textContent?.trim(),
        width: box.width,
        height: box.height,
        scrollWidth: chip.scrollWidth,
        clientWidth: chip.clientWidth,
        textInside: text.x >= box.x - 0.5 && text.right <= box.right + 0.5
          && text.y >= box.y - 0.5 && text.bottom <= box.bottom + 0.5,
        insideRoot: box.x >= rootBox.x - 0.5 && box.right <= rootBox.right + 0.5,
      };
    });
    return {
      chips,
      row: row ? { scrollWidth: row.scrollWidth, clientWidth: row.clientWidth } : null,
    };
  }, rootSelector);
}

/** Repaints a fresh duel per registered variant, in every locale, and fails
    on any chip whose text leaves the chip or the row. Leaves the board on the
    last variant it painted. */
export async function checkCompactChipVariants(
  page, rootSelector, localeOwnerSelector, label, check,
) {
  const failures = [];
  for (const locale of LOCALES) {
    await chooseLocale(page, locale, localeOwnerSelector);
    for (const variant of [
      ...MODE_VARIANTS.map(({ mode, id }) => ({ kind: 'mode', id, scoring: mode, spells: ['', ''] })),
      ...RUNE_VARIANTS.map((id) => ({ kind: 'rune', id, scoring: 0, spells: [id, id] })),
      { kind: 'rune-pair', id: `${RUNE_VARIANTS[0]}+${RUNE_VARIANTS[1]}`,
        scoring: 0, spells: [RUNE_VARIANTS[0], RUNE_VARIANTS[1]] },
    ]) {
      await page.evaluate(({ scoring, spells }) => {
        const game = window.__kb;
        game.S.mode = 'duo';
        game.S.seat = 'pass';
        game.newGame({ scoring, spells });
        game.S.gen++;
        game.renderAll(false);
        game.fit();
      }, variant);
      await frame(page);
      const view = await badgeSnapshot(page, rootSelector);
      if (!view.row || view.row.scrollWidth > view.row.clientWidth + 0.5
          || view.chips.length === 0
          || view.chips.some((chip) => !chip.text || !chip.textInside || !chip.insideRoot
            || chip.scrollWidth > chip.clientWidth + 0.5)) {
        failures.push({ locale, variant, view });
      }
    }
  }
  check(failures.length === 0,
    `${label} clips a registered mode/rune compact chip`, failures);
}

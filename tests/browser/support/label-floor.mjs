// The compact-label floor, judged as the player sees it: every visible label
// matched by `selector` must render at or above the shared --font-label-min
// token (itself required sane, >= 10px). One contract for any surface — the
// settings sheet was merely the first place a squeezed locale shrank a label
// under the floor.
export async function checkCompactLabelFloor(page, check, surface, selector) {
  const labels = await page.evaluate((sel) => {
    const root = document.getElementById('kbroot');
    const minimum = root
      ? parseFloat(getComputedStyle(root).getPropertyValue('--font-label-min'))
      : 0;
    const sizes = [...document.querySelectorAll(sel)]
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map((element) => parseFloat(getComputedStyle(element).fontSize));
    return { minimum, sizes };
  }, selector);
  check(labels.minimum >= 10
    && labels.sizes.length > 0
    && labels.sizes.every((size) => size >= labels.minimum),
  `${surface} label fell below the shared compact-label minimum`, labels);
}

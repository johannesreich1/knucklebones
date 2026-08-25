export const frame = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

export async function inspectSurface(page, containerSelector, selectors) {
  return page.evaluate(({ containerSelector, selectors }) => {
    const container = document.querySelector(containerSelector);
    const bounds = container.getBoundingClientRect();
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height,
        right: box.right, bottom: box.bottom };
    };
    const records = selectors.flatMap((selector) => (selector === ':scope'
      ? [container] : [...container.querySelectorAll(selector)])
      .map((element) => ({ selector, element })))
      .filter(({ element }) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && style.visibility !== 'hidden'
          && style.display !== 'none' && Number(style.opacity) !== 0;
      })
      .map(({ selector, element }) => {
        const box = rect(element);
        const style = getComputedStyle(element);
        const range = document.createRange();
        range.selectNodeContents(element);
        const rangeBox = rect(range);
        const textInsideX = rangeBox.width <= 0
          || (rangeBox.x >= bounds.x - 0.5 && rangeBox.right <= bounds.right + 0.5);
        const textInsideY = rangeBox.height <= 0
          || (rangeBox.y >= bounds.y - 0.5 && rangeBox.bottom <= bounds.bottom + 0.5);
        const collisionBox = element instanceof HTMLButtonElement
          || rangeBox.width <= 0 || rangeBox.height <= 0 ? box : rangeBox;
        const interactive = element.matches('button, a, input, select, textarea, [role="button"]');
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { element, item: {
          selector,
          text: element.textContent?.trim() ?? '',
          box,
          textBox: rangeBox,
          collisionBox,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          textOverflow: style.textOverflow,
          inside: box.x >= bounds.x - 0.5 && box.y >= bounds.y - 0.5
            && box.right <= bounds.right + 0.5 && box.bottom <= bounds.bottom + 0.5,
          textInsideX,
          textInsideY,
          interactive,
          targetAtLeast44: !interactive || (box.width >= 44 && box.height >= 44),
          centreHit: !interactive || element === hit || element.contains(hit),
        } };
      });
    const items = records.map(({ item }) => item);
    const overlaps = [];
    for (let left = 0; left < items.length; left++) for (let right = left + 1; right < items.length; right++) {
      const a = items[left].collisionBox, b = items[right].collisionBox;
      const width = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      /* Parent/child boxes intentionally overlap. Only sibling surfaces are a
         collision; nested text naturally occupies its button/card. */
      const aNode = records[left].element;
      const bNode = records[right].element;
      if (width > 0.5 && height > 0.5
          && !aNode.contains(bNode) && !bNode.contains(aNode)) {
        overlaps.push({ left: items[left], right: items[right], width, height });
      }
    }
    const style = getComputedStyle(container);
    return {
      bounds: rect(container),
      items,
      overlaps,
      overflowX: style.overflowX,
      scrollable: container.scrollHeight > container.clientHeight + 0.5
        && ['auto', 'scroll'].includes(style.overflowY),
      scrollWidth: container.scrollWidth,
      clientWidth: container.clientWidth,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    };
  }, { containerSelector, selectors });
}

export function checkSurface(
  check,
  label,
  surface,
  { overlap = true, allowScrollable = false, targets = true } = {},
) {
  const clipped = surface.items.filter((item) => (!item.inside && !(allowScrollable && surface.scrollable))
    || !item.textInsideX || (!item.textInsideY && !(allowScrollable && surface.scrollable))
    || (item.scrollWidth > item.clientWidth + 0.5 && item.overflowX !== 'visible')
    || (item.scrollHeight > item.clientHeight + 0.5 && item.overflowY !== 'visible'));
  const horizontalContained = surface.scrollWidth <= surface.clientWidth + 0.5
    || ['hidden', 'clip'].includes(surface.overflowX);
  check(surface.items.length > 0 && clipped.length === 0
    && horizontalContained,
    `${label} clips, truncates, or pushes localized copy outside its surface`, {
      clipped,
      geometry: {
        scrollWidth: surface.scrollWidth,
        clientWidth: surface.clientWidth,
        scrollHeight: surface.scrollHeight,
        clientHeight: surface.clientHeight,
        overflowX: surface.overflowX,
        overflowOwners: surface.overflowOwners,
      },
      surface,
    });
  if (overlap) check(surface.overlaps.length === 0,
    `${label} overlaps sibling localized controls or copy`, surface.overlaps);
  if (targets) {
    const inaccessible = surface.items.filter((item) => item.interactive
      && (!item.targetAtLeast44 || !item.centreHit));
    check(inaccessible.length === 0,
      `${label} has an undersized or obscured localized control`, inaccessible);
  }
}

export async function checkReachableTargets(page, check, label, selectors) {
  const observations = [];
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if (!await locator.count()) continue;
    /* A target below a scrollport is intentionally not Playwright-visible yet;
       that is exactly the target this helper must bring into reach. Skip only
       controls removed from layout, not rendered controls outside the current
       viewport. */
    const rendered = await locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0 && element.getClientRects().length > 0;
    });
    if (!rendered) continue;
    await locator.scrollIntoViewIfNeeded();
    await locator.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'center' }));
    await frame(page);
    observations.push(await locator.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const centreX = box.x + box.width / 2;
      const centreY = box.y + box.height / 2;
      const owns = (x, y) => {
        const hit = document.elementFromPoint(x, y);
        return hit === element || element.contains(hit);
      };
      let top = centreY, bottom = centreY, left = centreX, right = centreX;
      if (owns(centreX, centreY)) {
        while (top > 1 && owns(centreX, top - 1)) top--;
        while (bottom < innerHeight - 1 && owns(centreX, bottom + 1)) bottom++;
        while (left > 1 && owns(left - 1, centreY)) left--;
        while (right < innerWidth - 1 && owns(right + 1, centreY)) right++;
      }
      return {
        selector: element.id ? `#${element.id}` : element.tagName,
        width: box.width,
        height: box.height,
        effectiveWidth: Math.round(right - left) + 1,
        effectiveHeight: Math.round(bottom - top) + 1,
        insideViewport: box.x >= -0.5 && box.y >= -0.5
          && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5,
        centreHit: owns(centreX, centreY),
      };
    }));
  }
  check(observations.length === selectors.length
    && observations.every((item) => item.effectiveWidth >= 44 && item.effectiveHeight >= 44
      && item.insideViewport && item.centreHit),
  `${label} does not keep every action reachable as a 44px hit target`, observations);
}

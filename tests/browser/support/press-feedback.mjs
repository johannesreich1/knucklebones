const target = (page, selector) => page.locator(selector).first();

const scaleOf = async (page, selector) => target(page, selector).evaluate((button) => {
  const transform = getComputedStyle(button).transform;
  if (transform === 'none') return 1;
  return new DOMMatrix(transform).a;
});

/* Hold long enough to sample the painted end state, then leave the control
   before release. This proves both the native :active path and cancellation
   without firing the button's action. */
export async function holdAndCancel(page, selector) {
  const button = target(page, selector);
  await button.waitFor({ state: 'visible' });
  const box = await button.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const resting = await scaleOf(page, selector);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(180);
  const held = await scaleOf(page, selector);
  await page.mouse.move(1, 1, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(180);
  const released = await scaleOf(page, selector);
  return { resting, held, released };
}

export async function pressingClass(page, selector) {
  const resting = await scaleOf(page, selector);
  await target(page, selector).evaluate((button) => button.classList.add('pressing'));
  await page.waitForTimeout(180);
  const held = await scaleOf(page, selector);
  await target(page, selector).evaluate((button) => button.classList.remove('pressing'));
  await page.waitForTimeout(180);
  const released = await scaleOf(page, selector);
  return { resting, held, released };
}

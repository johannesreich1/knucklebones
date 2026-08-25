import { frame } from './layout-inspection.mjs';

export const SURFACE_SIZES = [
  { name: '320x568', width: 320, height: 568 },
  { name: '390x844', width: 390, height: 844 },
  { name: '568x320', width: 568, height: 320 },
  { name: '667x375', width: 667, height: 375 },
];

export async function renderedTargets(page, selectors) {
  return page.evaluate((candidates) => candidates.filter((selector) => {
    const element = document.querySelector(selector);
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) !== 0 && element.getClientRects().length > 0;
  }), selectors);
}

export async function requiredHomeTargets(page) {
  const targets = await renderedTargets(page,
    ['#btnOnline', '#btnBoardHome', '#btnSettingsHome', '#btnVsCpu', '#btnDuoHome', '#btnLearn']);
  const complete = ['#btnSettingsHome', '#btnVsCpu', '#btnDuoHome', '#btnLearn']
    .every((selector) => targets.includes(selector))
    && ['#btnOnline', '#btnBoardHome'].some((selector) => targets.includes(selector));
  return { targets, complete };
}

/** Wait for the readable resting frame, not an opening overlay transition. */
export async function waitForSurface(page, overlaySelector, contentSelector) {
  await page.waitForFunction(({ overlaySelector, contentSelector }) => {
    const overlay = document.querySelector(overlaySelector);
    const content = overlay?.querySelector(contentSelector);
    if (!overlay?.classList.contains('on') || !content) return false;
    const overlayStyle = getComputedStyle(overlay);
    const contentStyle = getComputedStyle(content);
    const box = content.getBoundingClientRect();
    return overlayStyle.visibility === 'visible' && Number(overlayStyle.opacity) >= 0.99
      && contentStyle.visibility === 'visible' && contentStyle.display !== 'none'
      && Number(contentStyle.opacity) > 0 && box.width > 0 && box.height > 0;
  }, { overlaySelector, contentSelector });
  await frame(page);
}

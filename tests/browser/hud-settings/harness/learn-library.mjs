/* ONE ENTRY OF ONE LIBRARY, AS HOW TO PLAY SHOWS IT: opened from Home, read in
   the copy and the hue it is actually painted in, then left again through the
   Learn pages' single shared Back header. It reports facts and judges nothing —
   the caller owns what the entry is supposed to say.
   The header travels with the entry because that Back control is one
   implementation for every library page, and the only place it can be caught
   wearing a second button (or a ✕) is on a library that is really open. */
export async function readLearnLibraryEntry(page, button, ov, id) {
  await page.tap('#btnLearn'); await page.waitForTimeout(320);
  await page.tap(button); await page.waitForTimeout(420);
  const r = await page.evaluate(([ov, id]) => {
    const o = document.getElementById(ov);
    const c = o?.querySelector(`.modecard[data-mode="${id}"]`);
    const h = c?.querySelector('.mchead');
    const head = o?.querySelector('.shead');
    const buttons = [...(head?.querySelectorAll('button') ?? [])];
    const back = head?.querySelector(`[data-learn-back="${ov}"]`);
    return { on: o?.classList.contains('on') ?? false,
             title: head?.querySelector('.ttl')?.textContent?.trim() ?? '',
             name: c?.querySelector('.mcname')?.textContent?.trim() ?? '',
             detail: c?.querySelector('.mcdetail')?.textContent?.trim() ?? '',
             // the entry's OWN hue, as painted — not the token it came from
             hue: h ? getComputedStyle(h).color : '',
             nav: { buttons: buttons.length,
                    backs: head?.querySelectorAll(`[data-learn-back="${ov}"]`).length ?? 0,
                    glyph: back?.textContent?.trim() ?? '',
                    label: back?.getAttribute('aria-label') ?? '',
                    left: head?.firstElementChild === back,
                    noX: !buttons.some((button) => button.textContent?.includes('✕')) } };
  }, [ov, id]);
  await page.tap(`[data-learn-back="${ov}"]`); await page.waitForTimeout(300);
  r.back = await page.evaluate((ov) => ({
    child: document.getElementById(ov)?.classList.contains('on') ?? false,
    learn: document.getElementById('ovLearn').classList.contains('on'),
  }), ov);
  await page.tap('#btnLearnBack'); await page.waitForTimeout(340);
  return r;
}

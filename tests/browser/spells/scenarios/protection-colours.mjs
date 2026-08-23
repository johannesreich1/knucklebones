export async function runProtectionColourScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, guard } = suite;

  /* COLUMN SHIELD already moves from gold to ice in colour-blind mode; Ward
     must move with the rest of its identity rather than leaving a mint card
     that turns red only after it lands. The shield's circling bead remains
     part of the shield hue — borrowing Ward red would collapse the distinction
     this mode is meant to strengthen. Drive the real Settings control so this
     also covers its palette synchronisation path. */
  await page.evaluate(() => window.__kb.goHome());
  await page.tap('#btnSettingsHome'); await page.waitForTimeout(250);
  await page.tap('#cbSeg button[data-b="1"]'); await page.waitForTimeout(150);
  await page.tap('#btnSettingsBack'); await page.waitForTimeout(250);
  await newGame({ spell: 'ward', mode: 3 });
  check(await waitChoose(), 'game never reached choose (colour-blind protections)');
  await table([[], [], []], [[5, 5, 2], [4], []], 5);
  await guard(1, 0);
  out.protectionColoursCb = await page.evaluate(() => {
    const root = document.getElementById('kbroot');
    const resolve = (token) => {
      const probe = document.createElement('i');
      probe.style.color = `var(${token})`; root.appendChild(probe);
      const value = getComputedStyle(probe).color; probe.remove(); return value;
    };
    const colour = (selector, property = 'color') => {
      const node = document.querySelector(selector);
      return node ? getComputedStyle(node)[property] : null;
    };
    return {
      red: resolve('--red'), ice: resolve('--ice'),
      wardCard: colour('.rune[data-spell="ward"]'),
      wardChip: colour('#topCols .chip:nth-child(2) .wd'),
      shieldChip: colour('#topCols .chip:first-child .sh'),
      wardSeal: colour('#topBoard .col[data-col="1"] .seal .sa', 'stroke'),
      shieldLoop: colour('#topBoard .col[data-col="0"] .seal .sl', 'stroke'),
      shieldBead: colour('#topBoard .col[data-col="0"] .seal .sb', 'stroke'),
    };
  });
  check(out.protectionColoursCb.wardCard === out.protectionColoursCb.red
    && out.protectionColoursCb.wardChip === out.protectionColoursCb.red,
    'colour-blind mode did not make the whole Ward identity red', out.protectionColoursCb);
  check(out.protectionColoursCb.shieldChip === out.protectionColoursCb.ice,
    'colour-blind COLUMN SHIELD is not ice-white', out.protectionColoursCb);
  check(out.protectionColoursCb.wardSeal !== out.protectionColoursCb.shieldLoop
    && out.protectionColoursCb.wardSeal !== out.protectionColoursCb.shieldBead,
    'the shield loop or its bead borrowed the Ward colour', out.protectionColoursCb);

  /* Leave the persistent setting as this suite found it. */
  await page.evaluate(() => window.__kb.goHome());
  await page.tap('#btnSettingsHome'); await page.waitForTimeout(200);
  await page.tap('#cbSeg button[data-b="0"]'); await page.waitForTimeout(100);
}

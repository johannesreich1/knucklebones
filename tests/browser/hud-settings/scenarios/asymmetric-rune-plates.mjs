// RANDOM ×2 owns a responsive player/rune layout rather than the general
// badge-card behavior. Keep its pixel, ownership, resize, and handoff contract
// together so the broad badge interaction scenario stays focused.
export async function runAsymmetricRunePlateScenarios(suite) {
  const { page, browser, F, out, check, spellCopy, errs } = suite;

  const layoutNow = (target = page) => target.evaluate(() => {
    const rec = document.getElementById('rec');
    const badge = rec.getBoundingClientRect();
    const hud = rec.closest('.hud').getBoundingClientRect();
    const leave = document.getElementById('btnLeave').getBoundingClientRect();
    const chipElements = [...document.querySelectorAll('#rec .rchip, .rune-tag .rchip')];
    const rows = [...document.querySelectorAll('.side')].map((side) => {
      const board = side.querySelector('.board')?.getBoundingClientRect();
      const whoEl = side.querySelector('.who');
      const who = whoEl?.getBoundingClientRect();
      const identity = side.querySelector('.player-id')?.getBoundingClientRect();
      const runeEl = side.querySelector('.rune-tag .rchip');
      const rune = runeEl?.getBoundingClientRect();
      const runeIcon = runeEl?.querySelector('svg')?.getBoundingClientRect();
      const dot = side.querySelector('.player-id .dot')?.getBoundingClientRect();
      const tagEl = side.querySelector('.tag');
      const tagStyle = tagEl && getComputedStyle(tagEl);
      const runeStyle = runeEl && getComputedStyle(runeEl);
      const metadataStyle = ['fontSize', 'letterSpacing', 'paddingTop', 'paddingRight',
        'paddingBottom', 'paddingLeft', 'borderRadius', 'borderTopWidth'];
      const hitYs = [];
      if (rune) {
        const x = rune.x + rune.width / 2;
        for (let y = Math.floor(rune.top - 32); y <= Math.ceil(rune.bottom + 32); y++) {
          const target = document.elementFromPoint(x, y);
          if (target && runeEl.contains(target)) hitYs.push(y);
        }
      }
      const hit = rune
        ? document.elementFromPoint(rune.x + rune.width / 2, rune.y + rune.height / 2)
        : null;
      return {
        side: side.id, owner: side.dataset.owner,
        split: side.querySelector('.plate')?.classList.contains('rune-meta') ?? false,
        board: board && { left: board.left, right: board.right, width: board.width },
        who: who && { left: who.left, right: who.right, width: who.width,
                      turned: getComputedStyle(whoEl).transform !== 'none' },
        identity: identity && { left: identity.left, right: identity.right, width: identity.width },
        rune: rune && { left: rune.left, right: rune.right, width: rune.width,
                        id: runeEl.dataset.id, owner: runeEl.dataset.owner,
                        icon: !!runeIcon && runeIcon.width > 0 && runeIcon.height > 0,
                        info: runeEl.querySelector('.mi')?.textContent?.trim() ?? '',
                        metadataStyle: metadataStyle.every((key) => runeStyle[key] === tagStyle[key]),
                        hitHeight: hitYs.length ? hitYs.at(-1) - hitYs[0] + 1 : 0,
                        clearOfBoard: hitYs.length > 0 && (side.id === 'sideTop'
                          ? hitYs.at(-1) < board.top : hitYs[0] > board.bottom),
                        ownerDot: getComputedStyle(runeEl, '::before').content,
                        hit: runeEl.contains(hit) },
        identityDotShown: !!dot && dot.width > 0 && dot.height > 0,
      };
    });
    return {
      hudCount: rec.querySelectorAll('.rchip').length,
      compactOwners: rec.hasAttribute('data-compact-owners'),
      labels: chipElements.map((chip) => chip.querySelector('.rlab')?.textContent?.trim() ?? ''),
      geometry: { badgeCenter: badge.left + badge.width / 2,
                  hudCenter: hud.left + hud.width / 2,
                  badgeRight: badge.right, leaveLeft: leave.left },
      rows,
      chips: chipElements.map((chip) => {
        const box = chip.getBoundingClientRect();
        const icon = chip.querySelector('svg')?.getBoundingClientRect();
        const label = chip.querySelector('.rlab')?.getBoundingClientRect();
        return {
          lib: chip.dataset.lib ?? null, id: chip.dataset.id ?? null,
          owner: chip.dataset.owner ?? null, host: chip.parentElement?.id ?? null,
          shown: box.width > 0 && box.height > 0,
          icon: !!icon && icon.width > 0 && icon.height > 0,
          labelShown: !!label && label.width > 0 && label.height > 0,
          info: chip.querySelector('.mi')?.textContent?.trim() ?? '',
          tappable: chip.classList.contains('tapmode'),
          ownerDot: getComputedStyle(chip, '::before').content,
          ariaLabel: chip.getAttribute('aria-label') ?? '',
        };
      }),
    };
  });

  const assertRoomy = (snapshot, label) => {
    const runes = snapshot.chips.filter((chip) => chip.lib === 'spells');
    const rows = snapshot.rows.filter((row) => row.rune);
    check(snapshot.chips.length === 3 && snapshot.hudCount === 1
        && runes.find((chip) => chip.owner === '1')?.id === 'ward'
        && runes.find((chip) => chip.owner === '0')?.id === 'fate'
        && runes.every((chip) => chip.host !== 'rec' && chip.shown && !chip.icon && chip.tappable),
      `${label}: asymmetric runes did not move to their player plates`, snapshot);
    check(rows.length === 2 && rows.every((row) => row.split && row.identityDotShown),
      `${label}: each player needs one split identity/rune line`, rows);
    for (const row of rows) {
      const expected = row.owner === '1' ? 'ward' : 'fate';
      const edgeError = row.who && row.board ? Math.max(
        Math.abs(row.who.left - row.board.left), Math.abs(row.who.right - row.board.right)) : 99;
      const identityLeads = row.who?.turned
        ? row.rune.right < row.identity.left : row.identity.right < row.rune.left;
      const edgePlaced = row.who?.turned
        ? Math.abs(row.identity.right - row.board.right) <= .6
          && Math.abs(row.rune.left - row.board.left) <= .6
        : Math.abs(row.identity.left - row.board.left) <= .6
          && Math.abs(row.rune.right - row.board.right) <= .6;
      check(row.rune.id === expected && row.rune.owner === row.owner,
        `${label}: rune attached to the wrong player`, row);
      check(edgeError <= .6 && identityLeads && edgePlaced,
        `${label}: player/rune line does not span its board`, row);
      check(!row.rune.icon && row.rune.info === 'ⓘ' && row.rune.metadataStyle
          && row.rune.hitHeight >= 36 && row.rune.clearOfBoard
          && row.rune.ownerDot === 'none' && row.rune.hit,
        `${label}: plate rune is not a compact metadata-style info tag`, row);
    }
  };

  const ownerRunesUseFullHudControls = (snapshot) => {
    const ownerRunes = snapshot.chips.filter((chip) => chip.owner);
    return ownerRunes.length === 2 && ownerRunes.every((chip) => chip.host === 'rec'
      && chip.shown && chip.icon && chip.info === 'ⓘ' && chip.tappable
      && chip.ownerDot !== 'none' && chip.ariaLabel.length > 0);
  };

  const assertCentralHud = (snapshot, label, { contentMeasured = false } = {}) => {
    const ownerRunes = snapshot.chips.filter((chip) => chip.owner);
    check(snapshot.hudCount === 3 && snapshot.chips.length === 3
        && snapshot.chips.every((chip) => chip.host === 'rec' && chip.shown)
        && snapshot.rows.length === 2
        && snapshot.rows.every((row) => !row.split && !row.rune)
        && ownerRunesUseFullHudControls(snapshot),
      `${label}: fallback did not keep three complete controls in the central HUD`, snapshot);
    check(ownerRunes.every((chip) => !chip.labelShown)
        && (!contentMeasured || snapshot.compactOwners),
      `${label}: fallback did not compact only the two owner-labelled runes`, snapshot);
    check(Math.abs(snapshot.geometry.badgeCenter - snapshot.geometry.hudCenter) <= .5
        && snapshot.geometry.badgeRight <= snapshot.geometry.leaveLeft - 4,
      `${label}: fallback badge is off-centre or intrudes on Leave`, snapshot);
  };

  await page.evaluate(() => {
    const k = window.__kb;
    k.S.mode = 'duo'; k.S.seat = 'face'; k.S.timer = 0;
    k.S.localMode = 0; k.S.spell = 'random2';
    k.newGame({ spells: ['fate', 'ward'] });
  });
  await page.waitForTimeout(180);
  out.badgeDual = await layoutNow();
  assertRoomy(out.badgeDual, 'roomy portrait');

  // A relocated rune retains the one-details-card behavior of a HUD rune.
  for (const [owner, id] of [['1', 'ward'], ['0', 'fate']]) {
    await page.tap(`.rune-tag .rchip[data-owner="${owner}"]`);
    await page.waitForTimeout(480);
    const card = await page.evaluate(() => {
      const dialog = document.querySelector('.faceoff');
      const box = dialog?.querySelector('.focard')?.getBoundingClientRect();
      const hit = box ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) : null;
      return { name: dialog?.querySelector('.mcname')?.textContent?.trim() ?? '',
               visible: !!dialog && !!box && dialog.contains(hit),
               rosters: [...document.querySelectorAll('.ov.on')].map((node) => node.id) };
    });
    check(card.visible && card.name === spellCopy(id).name && card.rosters.length === 0,
      `player-${owner} rune tag did not deal its own details card`, { id, card });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // fit() and a seat handoff must move, never recreate or defocus, the buttons.
  out.badgeDualFocus = await page.evaluate(() => {
    const rune = document.querySelector('.rune-tag .rchip[data-owner="1"]');
    rune.focus(); window.__dualRuneNodes = [...document.querySelectorAll('.rune-tag .rchip')];
    window.__kb.fit();
    return document.activeElement === rune;
  });
  check(out.badgeDualFocus, 'an unchanged responsive fit dropped rune-button focus', null);
  await page.evaluate(() => {
    const k = window.__kb; k.S.bottom = 0; k.applySides(); k.fit();
  });
  out.badgeDualSwapped = await layoutNow();
  assertRoomy(out.badgeDualSwapped, 'seat handoff');
  out.badgeDualStable = await page.evaluate(() => {
    const now = [...document.querySelectorAll('.rune-tag .rchip')];
    return { same: window.__dualRuneNodes.length === now.length
                    && window.__dualRuneNodes.every((node) => now.includes(node)),
             focusedOwner: document.activeElement?.dataset?.owner ?? null };
  });
  check(out.badgeDualStable.same && out.badgeDualStable.focusedOwner === '1',
    'seat handoff recreated or defocused the rune controls', out.badgeDualStable);

  // The threshold is measured from real content, not a device-name breakpoint.
  await page.evaluate(() => {
    document.getElementById('nameBot').textContent = 'A VERY LONG LOCALIZED PLAYER NAME';
    window.__kb.fit();
  });
  out.badgeDualLongName = await layoutNow();
  check(out.badgeDualLongName.hudCount === 3
      && out.badgeDualLongName.rows.every((row) => !row.split && !row.rune)
      && ownerRunesUseFullHudControls(out.badgeDualLongName),
    'an over-wide identity did not fall back to owner-dotted HUD runes', out.badgeDualLongName);
  await page.evaluate(() => { window.__kb.applySides(); window.__kb.fit(); });
  assertRoomy(await layoutNow(), 'restored roomy portrait');

  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 360, height: 640 }); await page.waitForTimeout(160);
  out.badgeDualThreshold = await layoutNow();
  const threshold = out.badgeDualThreshold;
  assertRoomy(threshold, '360px portrait');

  await page.setViewportSize({ width: 320, height: 568 }); await page.waitForTimeout(160);
  out.badgeDualCompact = await layoutNow();
  const compact = out.badgeDualCompact;
  assertCentralHud(compact, 'compact portrait');

  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(180);
  out.badgeDualLandscape = await layoutNow();
  check(out.badgeDualLandscape.hudCount === 3
      && out.badgeDualLandscape.rows.every((row) => !row.split && !row.rune)
      && ownerRunesUseFullHudControls(out.badgeDualLandscape),
    'landscape did not keep owner-dotted runes in the HUD', out.badgeDualLandscape);

  if (originalViewport) await page.setViewportSize(originalViewport);
  await page.waitForTimeout(160);
  assertRoomy(await layoutNow(), 'portrait after resize');
  await page.tap('#btnLeave'); await page.waitForTimeout(250);
  await page.tap('#btnAskYes'); await page.waitForTimeout(400);

  /* Real German copy is wider than English at the iPhone-13 width. Give it an
     isolated locale context so this geometry probe cannot alter the language
     selector scenario's automatic-locale state. */
  const deContext = await browser.newContext({ viewport: { width: 390, height: 664 },
    locale: 'de-DE', hasTouch: true, isMobile: true });
  await deContext.addInitScript(() => {
    try { delete Navigator.prototype.serviceWorker; } catch { /* strict hosts keep it */ }
    localStorage.setItem('knucklebones.v1', JSON.stringify({ played: true }));
  });
  const dePage = await deContext.newPage();
  dePage.on('pageerror', (error) => errs.push('DE PAGEERROR: ' + error.message));
  dePage.on('console', (message) => {
    if (message.type() === 'error') errs.push('DE CONSOLE: ' + message.text());
  });
  await dePage.goto(F); await dePage.waitForTimeout(500);
  await dePage.evaluate(() => {
    const k = window.__kb;
    k.S.mode = 'duo'; k.S.seat = 'face'; k.S.timer = 0;
    k.S.localMode = 0; k.S.spell = 'random2';
    k.newGame({ spells: ['fate', 'ward'] });
  });
  await dePage.waitForTimeout(180);
  out.badgeDualGerman = await layoutNow(dePage);
  const german = out.badgeDualGerman;
  if (german.compactOwners) {
    assertCentralHud(german, 'German portrait', { contentMeasured: true });
  } else {
    assertRoomy(german, 'German portrait');
  }
  check(german.labels.includes('KLASSIK') && german.labels.includes('SCHICKSAL')
      && german.labels.includes('SCHUTZ'),
    'German inline rune metadata lost its localized labels', german);
  await deContext.close();
}

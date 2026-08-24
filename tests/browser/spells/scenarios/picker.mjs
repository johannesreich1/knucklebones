export async function runPickerScenarios(suite) {
  const { page, out, check, SPELLS, RANDOM_SPELL } = suite;
  /* ---------- 0. the picker: NONE by default, one slice per spell ----------
     Same component as the game-mode row, and the slice wears the SAME rune the
     game draws — so what you pick and what lands on the rail cannot disagree. */
  await page.tap('#btnVsCpu'); await page.waitForTimeout(300);
  out.picker = await page.evaluate(() => {
    const strip = document.getElementById('spellPick');
    const bs = [...strip.querySelectorAll('button')];
    return {
      slices: bs.length, on: bs.findIndex(b => b.classList.contains('on')),
      values: bs.map(b => b.dataset.v),
      icons: bs.map(b => !!b.querySelector('svg')),
      info: document.getElementById('spellPickInfo').textContent,
      setupLabel: strip.closest('.card')?.querySelector('.lbl')?.textContent?.trim() ?? '',
      learnLabel: document.querySelector('#btnLearnSpells .lname')?.textContent?.trim() ?? '',
      pick: window.__kb.S.spell,
      sameComponent: strip.className === document.getElementById('modePick').className,
    };
  });
  check(out.picker.pick === '' && out.picker.on === 0, 'the spell picker must default to NONE', out.picker);
  check(out.picker.setupLabel === 'Rune' && out.picker.learnLabel === 'Runes',
    'the player-facing category must be Rune / Runes', out.picker);
  /* ASK THE REGISTRY, never restate it. The picker builds itself from SPELLS
     (ui/library.ts), so a hardcoded slice count here would pass while the two
     disagree — and that is not hypothetical: this line said "the five runes"
     and src/markup.ts advertised "five to choose from" long enough for a sixth
     to be measured, written and iconed before either noticed. */
  const wantSlices = ['', ...SPELLS.map((s) => s.id), RANDOM_SPELL];
  check(String(out.picker.values) === String(wantSlices),
    'the picker must be NONE + every rune in registry order + RANDOM',
    { got: out.picker.values, want: wantSlices });
  check(out.picker.values.at(-1) === RANDOM_SPELL, 'RANDOM is the last slice, as on the mode row', out.picker.values);
  check(out.picker.icons.every(Boolean), 'every slice must draw a mark', out.picker.icons);
  /* ONE idea, ONE mark: RANDOM means the same thing in both rows, so it must
     LOOK the same in both. A hand-copied glyph drifted here once — the mode's
     shuffle is two paths and the copy took one, so the spell row showed a bare
     X beside the mode row's arrows (user spotted it). Compare what is drawn. */
  out.randomIcon = await page.evaluate(() => {
    const strip = (sel, v) => document.querySelector(`${sel} button[data-v="${v}"]`);
    const svg = (b) => b?.querySelector('svg');
    const geom = (b) => [...(svg(b)?.querySelectorAll('path,circle,rect,line,polyline') ?? [])]
      .map((n) => n.tagName + ':' + (n.getAttribute('d') ?? '')).join('|');
    const mode = strip('#modePick', '-1'), spell = strip('#spellPick', 'random');
    return { mode: geom(mode), spell: geom(spell),
             modeHue: mode?.style.getPropertyValue('--mh'), spellHue: spell?.style.getPropertyValue('--mh') };
  });
  check(out.randomIcon.mode === out.randomIcon.spell && !!out.randomIcon.mode,
    'THE TWO RANDOM SLICES DRAW DIFFERENT MARKS', out.randomIcon);
  check(out.randomIcon.modeHue === out.randomIcon.spellHue,
    'the two RANDOM slices wear different hues', out.randomIcon);
  check(!out.picker.values.includes('swap'), 'the retired swap must not be pickable', out.picker.values);
  check(out.picker.icons.every(Boolean), 'every slice carries its icon', out.picker);
  check(out.picker.info === 'NONE — No rune — the pure game.',
    'NONE must describe the absence of a rune', out.picker.info);
  check(out.picker.sameComponent, 'the spell row must reuse the game-mode row', out.picker);
  // picking the spell names it, with its own blurb
  await page.tap('#spellPick button[data-v="pilfer"]'); await page.waitForTimeout(200);
  out.picked = await page.evaluate(() => ({
    pick: window.__kb.S.spell,
    on: document.querySelector('#spellPick button.on')?.dataset.v,
    info: document.getElementById('spellPickInfo').textContent,
  }));
  check(out.picked.pick === 'pilfer' && out.picked.on === 'pilfer', 'picking a spell did not take', out.picked);
  check(/^PILFER — /.test(out.picked.info), 'a picked spell needs its name and line', out.picked.info);
  await page.evaluate(() => window.__kb.goHome());

}

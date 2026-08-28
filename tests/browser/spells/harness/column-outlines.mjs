/* EVERY RING A COLUMN PAINTS, in one list per column. The seal says "this
   column is protected"; .col.legal::after says "you may play here this turn".
   Both are true of a warded column with room left, and until now both drew a
   ring — the seal's line 1.6px outside the column box, the hint's dashed one
   at 4px — so the player saw ONE DOUBLED EDGE 2.4px thick and reported it as
   a rendering fault (photographed). The fix is not to drop a fact: it is that
   the hint is not a ring but a STATE the column's outline wears, so where a
   seal is drawn the seal carries it and the pseudo stands down. This measures
   what the fix has to keep true — never two, and never none. */
export function createColumnOutlineProbe({ page, check }) {
  const outlinesOf = (pg = page) => pg.evaluate(() => {
    const drawn = (n, col) => { let p = n, a = 1;
      while (p && p !== col) { const st = getComputedStyle(p);
        if (st.display === 'none' || st.visibility === 'hidden') return 0;
        a *= +st.opacity; p = p.parentElement; }
      return a; };
    const pseudo = (col, at) => { const s = getComputedStyle(col, at);
      const w = parseFloat(s.borderTopWidth) || 0;
      return (s.content !== 'none' && s.display !== 'none' && w > 0
        && s.borderTopStyle !== 'none' && +s.opacity > 0.05)
        ? at + '(' + s.borderTopStyle + ' ' + +w.toFixed(1) + 'px @' + parseFloat(s.top) + 'px)' : null;
    };
    return [...document.querySelectorAll('#topBoard .col,#botBoard .col')].map((col) => {
      const seal = col.querySelector('.seal');
      const lit = !!seal && getComputedStyle(seal).display !== 'none'
        && [...seal.querySelectorAll('path,circle')].some((n) => drawn(n, col) > 0.05);
      return { id: col.closest('.board').id + '#' + col.dataset.col,
        cls: [...col.classList].filter((c) => c !== 'col').sort().join('.'),
        rings: [lit ? 'seal' : null, pseudo(col, '::after'), pseudo(col, '::before')].filter(Boolean) };
    });
  });
  const oneOutline = (list, where) => {
    check(list.every((o) => o.rings.length <= 1),
      'A COLUMN WEARS TWO OUTLINES in ' + where + ' — two rings 2.4px apart read as one doubled edge',
      list.filter((o) => o.rings.length > 1));
    /* ...and the other half of the same rule, which is what stops "one outline"
       being solved by deleting one: never NONE either. A column you may play
       into has to say so, sealed or bare. */
    const playable = list.filter((o) => /(^|\.)legal(\.|$)/.test(o.cls));
    check(playable.length > 0 && playable.every((o) => o.rings.length >= 1),
      'A PLAYABLE COLUMN LOST ITS AFFORDANCE in ' + where
      + ' — every column you may play into must still wear a ring',
      playable.filter((o) => !o.rings.length));
  };
  return { outlinesOf, oneOutline };
}

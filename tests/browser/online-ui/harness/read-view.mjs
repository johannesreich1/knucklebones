export function readOnlineView(page) {
  return page.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); if (!e) return false;
      const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return {
      panel: document.querySelector('#onAccount')?.hidden === false ? 'account' : 'auth',
      title: document.querySelector('#onAuth')?.hidden === false
        ? document.querySelector('#onAuthTitle')?.textContent
        : document.querySelector('#onTitle')?.textContent,
      /* the profile shows the name ONCE, as the headline under the ring. The
         claim card exists only while the name is still the minted placeholder
         (migration 0026): its input starts EMPTY, with the current name as the
         placeholder — the name you keep by never claiming. */
      accName: document.querySelector('#accName')?.textContent,
      accNameShown: vis('#accName'),
      /* League identity is paint, not just copy: the profile must use the
         exact material colour the same league receives on the ladder. */
      accGroup: (() => {
        const group = document.querySelector('#accGroup');
        return group ? { text: group.textContent, color: getComputedStyle(group).color } : null;
      })(),
      claim: vis('#accClaim'),
      nickValue: document.querySelector('#onNick')?.value,
      nickHint: document.querySelector('#onNick')?.placeholder,
      guestBox: vis('#accGuest'),
      signOut: vis('#btnSignOut'),
      actions: [...document.querySelectorAll('#onAuthActs .btn')].map((x) => x.textContent),
      /* the OTHER door out of this panel. "Create account" stopped being a
         second action here: signing up from the sign-in form minted a fresh
         empty account and threw away the guest rating, so it is a swap to the
         panel that creates one properly (user call). */
      swapDoor: document.querySelector('#btnAuthSwap')?.hidden === false
        ? document.querySelector('#btnAuthSwap')?.textContent : null,
      /* What a ladder row SAYS. It used to read "42W/103" — wins over games —
         so a loss appeared nowhere on the ladder while the HUD and the account
         card both said W · L. All three go through ui/record.ts now, and this
         reads the rendered row because the old bug was invisible to anything
         that only inspected the data. */
      rows: [...document.querySelectorAll('#ovOnline .lb .lrow')].map((r) => {
        const ws = r.querySelector('.ws'); const l = ws?.querySelector('.n2');
        return { text: ws?.textContent ?? '', lossItalic: l ? getComputedStyle(l).fontStyle : null,
                 pts: r.querySelector('.rt')?.textContent ?? '' };
      }),
      /* the groups, as the reader meets them: a horizon labels each material
         change, and the ladder OPENS with one — a list that starts with a bare
         row has lost its structure */
      horizons: [...document.querySelectorAll('#ovOnline .lb .ghor .gn')].map((e) => e.textContent),
      /* The board still OPENS with its group horizon — but the list is windowed
         now, so the horizon lives inside the first slot's wrapper rather than
         being the list's own first child. What matters to the reader is
         unchanged: the first thing painted at the top of the board is a
         horizon, above the first row. */
      firstIsHorizon: (() => {
        const head = document.querySelector('#ovOnline .lb')?.firstElementChild;
        if (!head) return false;
        const inner = head.classList.contains('ghor') ? head : head.firstElementChild;
        return !!inner?.classList.contains('ghor');
      })(),
    };
  });
}

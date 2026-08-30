/** Computed pixels and semantics for the profile's equipped-rune seat. */
export const measureEquippedSeat = () => {
  const seat = document.getElementById('accSeat');
  if (!seat) return null;
  const rect = seat.getBoundingClientRect();
  const icon = seat.querySelector('svg');
  const iconRect = icon?.getBoundingClientRect() ?? null;
  /* --rh is the rune's own hue, and it is set inline per rune. Resolve it the
     only way that proves a colour reached the screen. */
  const probe = document.createElement('span');
  probe.style.color = 'var(--rh)';
  probe.style.display = 'none';
  seat.appendChild(probe);
  const hue = getComputedStyle(probe).color;
  probe.remove();
  return {
    hidden: seat.hidden,
    none: seat.classList.contains('none'),
    waiting: seat.classList.contains('waiting'),
    random: seat.classList.contains('random'),
    label: seat.getAttribute('aria-label') ?? '',
    hue,
    painted: rect.width > 0 && rect.height > 0,
    hasIcon: !!icon && !!iconRect && iconRect.width > 0 && iconRect.height > 0,
    /* An empty seat draws a plus too, so an SVG alone does not prove that a
       rune is seated. The seatnone marker is the player-visible distinction. */
    hasRune: !!icon && !!iconRect && iconRect.width > 0 && iconRect.height > 0
      && !icon.classList.contains('seatnone'),
    hasSocket: !!seat.querySelector('.seatnone'),
    /* The outer 34px seat IS the socket. The plus must not draw a second
       dotted circle inside it, and both painted boxes must share a centre. */
    hasInnerSocket: !!seat.querySelector('.seatnone circle'),
    iconCentreDx: iconRect ? Math.abs(iconRect.x + iconRect.width / 2
      - (rect.x + rect.width / 2)) : null,
    iconCentreDy: iconRect ? Math.abs(iconRect.y + iconRect.height / 2
      - (rect.y + rect.height / 2)) : null,
  };
};

/* The default door is the home chip, which IS the door to the profile, so the
   panel is already open by the time a probe runs. Wait for the containing grid
   rather than relying on a timer. */
export async function readEquippedSeat(page) {
  await page.waitForSelector('#accRuneGrid', { timeout: 10000 });
  return page.evaluate(measureEquippedSeat);
}

/** The whole transient picker boundary, including what must stay inert. */
export const measureRunePickerState = () => {
  const panel = document.getElementById('onAccount');
  const host = document.getElementById('accRunes');
  const seat = document.getElementById('accSeat');
  const outside = [document.querySelector('#ovOnline .shead'),
    ...(panel ? [...panel.children].filter((element) => element !== host) : [])]
    .filter(Boolean);
  return {
    active: !!host?.classList.contains('choosing')
      && !!panel?.classList.contains('rune-picking'),
    outsideInert: outside.length > 0 && outside.every((element) => element.inert),
    anyOutsideInert: outside.some((element) => element.inert),
    sheet: !!document.querySelector('.faceoff'),
    profileVisible: !!panel && !panel.hidden
      && document.getElementById('ovOnline')?.classList.contains('on') === true,
    seatDisabled: seat?.disabled ?? null,
    seatBusy: seat?.getAttribute('aria-busy') ?? null,
    focused: document.activeElement?.id ?? null,
  };
};

/** Drive the shipped iOS edge gesture rather than invoking Back directly. */
export const dispatchEdgeSwipe = () => {
  const makeTouch = (x, y) => ({
    identifier: 17, target: document.body, clientX: x, clientY: y,
  });
  /* WebKit exposes Touch but does not make it constructible. The gesture only
     consumes the standard touch-list surface, so install that surface on a
     bubbling event rather than turning this regression into an engine probe. */
  const fire = (type, touch) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' ? [] : [touch] },
      changedTouches: { value: [touch] },
    });
    return document.body.dispatchEvent(event);
  };
  fire('touchstart', makeTouch(12, 300));
  for (const x of [30, 55, 90]) fire('touchmove', makeTouch(x, 304));
  fire('touchend', makeTouch(90, 304));
};

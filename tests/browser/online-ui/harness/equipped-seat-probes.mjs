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

/* The failure is paint outside the button's border, not a missing box-shadow
   declaration. Capture the same settled lane with and without that one shadow
   and scan the changed pixels on both horizontal sides. A scrollport clipping
   the glow at its 3px content padding reports only ~3px here even though the
   computed shadow still says 30px. */
export async function primaryShadowBleed(page) {
  const geometry = await page.$eval('#accSeatEquip', (button) => {
    const box = button.getBoundingClientRect();
    const body = button.closest('.seatmode-content')?.getBoundingClientRect() ?? null;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const left = Math.max(0, Math.floor(box.left - 24));
    const top = Math.max(0, Math.floor(box.top - 8));
    const right = Math.min(viewportWidth, Math.ceil(box.right + 24));
    const bottom = Math.min(viewportHeight, Math.ceil(box.bottom + 24));
    return {
      button: { left: box.left, right: box.right },
      body: body ? { left: body.left, right: body.right } : null,
      clip: { x: left, y: top, width: right - left, height: bottom - top },
      overflowX: getComputedStyle(button.closest('.seatmode-content')).overflowX,
    };
  });
  const capture = () => page.screenshot({ clip: geometry.clip, animations: 'disabled' });
  const withShadow = await capture();
  await page.$eval('#accSeatEquip', (button) => {
    button.style.setProperty('box-shadow', 'none', 'important');
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  const withoutShadow = await capture();
  await page.$eval('#accSeatEquip', (button) => button.style.removeProperty('box-shadow'));

  const pixels = await page.evaluate(async ({ withSource, withoutSource, geometry: measured }) => {
    const decode = async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height,
        data: context.getImageData(0, 0, image.width, image.height).data };
    };
    const before = await decode(withSource);
    const after = await decode(withoutSource);
    const scale = before.width / measured.clip.width;
    const buttonLeft = (measured.button.left - measured.clip.x) * scale;
    const buttonRight = (measured.button.right - measured.clip.x) * scale;
    let leftmost = before.width;
    let rightmost = -1;
    for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width; x++) {
      if (x >= buttonLeft && x < buttonRight) continue;
      const offset = (y * before.width + x) * 4;
      const delta = Math.abs(before.data[offset] - after.data[offset])
        + Math.abs(before.data[offset + 1] - after.data[offset + 1])
        + Math.abs(before.data[offset + 2] - after.data[offset + 2]);
      if (delta < 8) continue;
      leftmost = Math.min(leftmost, x);
      rightmost = Math.max(rightmost, x);
    }
    return {
      left: leftmost < buttonLeft ? (buttonLeft - leftmost) / scale : 0,
      right: rightmost >= buttonRight ? (rightmost + 1 - buttonRight) / scale : 0,
    };
  }, {
    withSource: `data:image/png;base64,${withShadow.toString('base64')}`,
    withoutSource: `data:image/png;base64,${withoutShadow.toString('base64')}`,
    geometry,
  });
  return { ...geometry, ...pixels };
}

/** The disabled one-rune RANDOM action still owns its opponent-colour identity. */
export async function readRandomChoice(page) {
  return page.evaluate(() => {
    const button = document.getElementById('accSeatRandom');
    const detail = document.getElementById('accSeatRandomDetail');
    const probe = document.createElement('span');
    probe.style.color = 'var(--p2)';
    document.getElementById('kbroot').appendChild(probe);
    const opponentColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      disabled: button?.disabled ?? null,
      ariaDisabled: button?.getAttribute('aria-disabled') ?? null,
      detail: detail?.textContent?.trim() ?? '',
      describedBy: button?.getAttribute('aria-describedby') ?? null,
      visible: !!button && button.getBoundingClientRect().height >= 44,
      color: button ? getComputedStyle(button).color : '',
      opponentColor,
    };
  });
}

/** Computed action-sheet semantics plus the painted primary-glow reach. */
export async function readEquipmentSheet(page) {
  const sheet = await page.evaluate(() => {
    const inspectButton = (selector) => {
      const button = document.querySelector(selector);
      if (!button) return null;
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const hueProbe = document.createElement('span');
      hueProbe.style.color = 'var(--p2)';
      button.appendChild(hueProbe);
      const opponentColor = getComputedStyle(hueProbe).color;
      hueProbe.remove();
      return {
        text: button.textContent?.trim() ?? '',
        equipmentKind: button.dataset.equipmentKind ?? null,
        disabled: button.disabled,
        ariaDisabled: button.getAttribute('aria-disabled'),
        height: box.height,
        centreHit: button === hit || button.contains(hit),
        color: getComputedStyle(button).color,
        opponentColor,
      };
    };
    return {
      runes: [...document.querySelectorAll('.faceoff .accrune')]
        .map((button) => button.dataset.rune),
      detail: document.querySelector('.seatmode-content > .mcdetail')?.textContent?.trim() ?? '',
      equip: inspectButton('#accSeatEquip'),
      random: inspectButton('#accSeatRandom'),
    };
  });
  sheet.primaryShadow = await primaryShadowBleed(page);
  return sheet;
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

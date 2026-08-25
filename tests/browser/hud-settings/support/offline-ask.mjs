export const readOfflineAskShape = () => {
  const card = document.querySelector('#ovAsk .askcard');
  const visible = (element) => {
    if (!element || element.hidden) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const buttonShape = (id) => {
    const element = document.getElementById(id);
    if (!visible(element)) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const sheen = getComputedStyle(element, '::after');
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      id,
      text: element.textContent.trim(),
      width: rect.width,
      height: rect.height,
      hit: hit === element || element.contains(hit),
      glint: {
        content: sheen.content,
        animationName: sheen.animationName,
        running: element.getAnimations({ subtree: true })
          .some((animation) => animation.animationName === 'primaryGlint'),
      },
      style: {
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        boxShadow: style.boxShadow,
        color: style.color,
        borderTopWidth: style.borderTopWidth,
        borderTopStyle: style.borderTopStyle,
        borderTopColor: style.borderTopColor,
        borderRadius: style.borderRadius,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
      },
    };
  };
  const primary = card?.querySelector('.btn.primary');
  const cardRect = card?.getBoundingClientRect();
  const primaryRect = primary?.getBoundingClientRect();
  return {
    on: document.getElementById('ovAsk')?.classList.contains('on') ?? false,
    head: document.getElementById('askHead')?.textContent?.trim() ?? '',
    sharedSheet: !!card?.closest('.faceoff.asksheet')
      && card.closest('.focard')?.getAttribute('role') === 'dialog'
      && !!card.closest('.focard')?.querySelector(':scope > .fograb'),
    order: [...(card?.querySelectorAll(':scope > button') ?? [])]
      .filter(visible).map((button) => button.textContent.trim()),
    keep: buttonShape('btnAskNo'),
    restart: buttonShape('btnAskAlt'),
    quit: buttonShape('btnAskYes'),
    glowGutter: cardRect && primaryRect ? {
      left: primaryRect.left - cardRect.left,
      right: cardRect.right - primaryRect.right,
      horizontalContained: card.scrollWidth <= card.clientWidth + 0.5,
    } : null,
  };
};

export function checkOfflineAskLayout(check, label, shape) {
  check(shape.on && shape.head === 'Quit this duel?',
    `${label}: offline quit question copy is wrong`, shape);
  check(shape.sharedSheet,
    `${label}: offline quit did not use the shared draggable sheet`, shape);
  check(shape.order.join(' -> ') === 'Keep playing -> Restart duel -> Quit duel',
    `${label}: offline quit actions are missing or out of order`, shape);
  check(shape.restart?.hit === true && shape.quit?.hit === true,
    `${label}: Restart duel or Quit duel is not the painted hit target`, shape);
  check(shape.keep?.glint.animationName === 'primaryGlint' && shape.keep.glint.running
    && shape.restart?.glint.animationName === 'none' && shape.quit?.glint.animationName === 'none',
  `${label}: Keep playing is not the modal's sole animated two-colour action`, shape);
  check(shape.glowGutter?.left >= 29 && shape.glowGutter?.right >= 29
    && shape.glowGutter.horizontalContained,
  `${label}: the primary action's glow is clipped by its ask-card scrollport`, shape);
  check(!!shape.keep && !!shape.restart && !!shape.quit
    && Math.abs(shape.keep.width - shape.restart.width) < 0.5
    && Math.abs(shape.restart.height - shape.quit.height) < 0.5
    && JSON.stringify(shape.restart.style) === JSON.stringify(shape.quit.style),
  `${label}: Restart duel does not match Quit duel in height and computed style`, shape);
}

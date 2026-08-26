// Interactive sheet layout changes when a form, locale, or mobile viewport
// changes its bounded height. Keep that observation separate from sheet.ts's
// gesture state machine: it reports exactly one fact — whether native internal
// scrolling or whole-card dragging owns the current layout.
export interface InteractiveSheetLayout {
  refresh(): void;
  disconnect(): void;
}

export function observeInteractiveSheetLayout(
  overlay: HTMLElement,
  card: HTMLElement,
  content: HTMLElement,
): InteractiveSheetLayout {
  const refresh = (): void => {
    if (!overlay.isConnected) return;
    const overflowing = content.scrollHeight > content.clientHeight + 1;
    overlay.classList.toggle('fooverflow', overflowing);
    overlay.classList.toggle('focarddrag', !overflowing);
  };
  let frame = 0;
  const schedule = (): void => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(refresh);
  };
  const resize = new ResizeObserver(schedule);
  const mutation = new MutationObserver(schedule);
  resize.observe(card);
  resize.observe(content);
  mutation.observe(content, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['hidden', 'class', 'style'],
  });
  window.addEventListener('resize', schedule);
  refresh();
  return {
    refresh,
    disconnect: () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener('resize', schedule);
    },
  };
}

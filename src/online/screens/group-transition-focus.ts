import { appRoot } from '../../ui/embed.ts';

/** Restore keyboard focus to the ranked result after its mandatory transition
 * deck closes, including the brief persistence lock applied by its owner. */
export function restoreGroupTransitionResultFocus(opener: HTMLElement | null): void {
  const root = appRoot();
  const result = root.querySelector<HTMLElement>('#ovEnd.on');
  if (!result) return;
  const connectedOpener = opener && root.contains(opener) ? opener : null;
  const candidates = [
    ...result.querySelectorAll<HTMLElement>('#btnAgain, #btnEndQuiet'),
    ...(connectedOpener ? [connectedOpener] : []),
  ];
  const focus = (): boolean => {
    if (!result.classList.contains('on')) return true;
    if (result.inert) return false;
    const target = candidates.find((candidate) => candidate.isConnected
      && !candidate.inert && !candidate.hasAttribute('disabled')
      && candidate.getClientRects().length > 0);
    if (!target) return true;
    target.focus({ preventScroll: true });
    return true;
  };
  if (focus()) return;

  /* Result persistence may briefly make the restored screen inert again
     after present() resolves. Follow that explicit state instead of racing
     it with a timeout, then focus the first usable result action. */
  const observer = new MutationObserver(() => {
    if (!focus()) return;
    observer.disconnect();
  });
  observer.observe(result, { attributes: true, attributeFilter: ['class', 'inert'] });
}

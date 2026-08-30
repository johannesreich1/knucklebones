// Result-screen share acceptance belongs to one focused browser probe. The
// profile-navigation suite supplies the already-painted result and this helper
// verifies the native bridge, public URL, cancellation, and old-binary fallback
// without making navigation ownership carry native-share implementation detail.
export async function measureResultShare(page, check) {
  /* THE NATIVE BUTTON OPENS THE NATIVE SHARE SHEET WITH A PUBLIC LINK. Native
     builds serve the bundle from https://localhost, so location.origin there
     is private. Leave navigator.share present: the Capacitor plugin must win. */
  const shareLink = await page.evaluate(async () => {
    const button = document.getElementById('btnShare');
    if (!button || button.hidden) return { skipped: true };
    const seen = { native: [], web: [] };
    const hadShare = 'share' in navigator;
    const oldShare = navigator.share;
    const hadCapacitor = 'Capacitor' in window;
    const oldCapacitor = window.Capacitor;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data) => { seen.web.push(data); },
    });
    window.Capacitor = {
      getPlatform: () => 'ios',
      Plugins: { Share: { share: async (data) => { seen.native.push(data); } } },
    };
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (hadShare) Object.defineProperty(navigator, 'share', {
      configurable: true, value: oldShare,
    });
    else delete navigator.share;
    if (hadCapacitor) window.Capacitor = oldCapacitor;
    else delete window.Capacitor;
    return { skipped: false, host: location.hostname, seen };
  });
  check(!shareLink.skipped,
    'the result screen offered no share action to measure', shareLink);
  check(shareLink.skipped || shareLink.host === 'localhost'
    || shareLink.host === '127.0.0.1',
  'this probe only reproduces the defect when served from a local address', shareLink);
  check(shareLink.skipped || (shareLink.seen.native.length === 1
    && shareLink.seen.web.length === 0),
  'THE NATIVE SHARE BUTTON DID NOT USE THE CAPACITOR SHARE SHEET', shareLink);
  check(shareLink.skipped || !/\/\/(localhost|127\.0\.0\.1)/.test(
    shareLink.seen.native[0]?.url ?? ''),
  'THE NATIVE SHARE LINK POINTS AT LOCALHOST — that is the recipient\'s '
    + 'own machine, so the shared link goes nowhere', shareLink);
  check(shareLink.skipped || /^https:\/\/[a-z0-9.-]+\//.test(
    shareLink.seen.native[0]?.url ?? ''),
  'the shared link is not a public https URL', shareLink);
  check(shareLink.skipped || (shareLink.seen.native[0]?.title
    && shareLink.seen.native[0].dialogTitle === shareLink.seen.native[0].title
    && shareLink.seen.native[0].text),
  'the native sheet lost its localized title/dialog title or result text', shareLink);

  /* Closing the native sheet is a completed interaction, not a signal to open
     a second share UI underneath it. Capacitor iOS rejects with the official
     `Share canceled` message; no fallback may fire for that branch. */
  const dismissedShare = await page.evaluate(async () => {
    const seen = { native: 0, web: 0, clipboard: 0, exec: 0 };
    const oldShare = navigator.share;
    const oldClipboard = navigator.clipboard;
    const oldCapacitor = window.Capacitor;
    const oldExec = document.execCommand;
    Object.defineProperty(navigator, 'share', { configurable: true,
      value: async () => { seen.web++; } });
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async () => { seen.clipboard++; } } });
    document.execCommand = () => { seen.exec++; return true; };
    window.Capacitor = { getPlatform: () => 'ios', Plugins: { Share: {
      share: async () => { seen.native++; throw new Error('Share canceled'); },
    } } };
    document.getElementById('btnShare')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    Object.defineProperty(navigator, 'share', { configurable: true, value: oldShare });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: oldClipboard });
    window.Capacitor = oldCapacitor;
    document.execCommand = oldExec;
    return seen;
  });
  check(dismissedShare.native === 1 && dismissedShare.web === 0
    && dismissedShare.clipboard === 0 && dismissedShare.exec === 0,
  'closing the native sheet opened a second share/copy path', dismissedShare);

  /* A broken or missing native plugin is different: the same tap must still
     reach web sharing. This keeps a newly deployed web bundle usable inside
     an installed old binary until the next native build. */
  const failedNativeShare = await page.evaluate(async () => {
    const seen = { native: 0, web: 0, clipboard: 0 };
    const oldShare = navigator.share;
    const oldClipboard = navigator.clipboard;
    const oldCapacitor = window.Capacitor;
    Object.defineProperty(navigator, 'share', { configurable: true,
      value: async () => { seen.web++; } });
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async () => { seen.clipboard++; } } });
    window.Capacitor = { getPlatform: () => 'ios', Plugins: { Share: {
      share: async () => { seen.native++; throw new Error('plugin unavailable'); },
    } } };
    document.getElementById('btnShare')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    Object.defineProperty(navigator, 'share', { configurable: true, value: oldShare });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: oldClipboard });
    window.Capacitor = oldCapacitor;
    return seen;
  });
  check(failedNativeShare.native === 1 && failedNativeShare.web === 1
    && failedNativeShare.clipboard === 0,
  'a real native-share failure did not fall through to web sharing', failedNativeShare);

  return { shareLink, dismissedShare, failedNativeShare };
}

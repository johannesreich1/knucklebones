/* Native-only Settings acceptance for the device-local profile launcher.
   Kept beside native-startup.mjs so startup, bridge visibility, and migration
   remain one test owner without turning that orchestration file into a suite. */
export async function runNativeAppIconScenarios({ browser, devices, check, errs }) {
  const observations = [];
  for (const platform of ['ios', 'android']) {
    const context = await browser.newContext({
      ...devices['iPhone 13'], hasTouch: true, isMobile: true, locale: 'en-US',
    });
    await context.addInitScript((nativePlatform) => {
      localStorage.setItem('knucklebones.v1', JSON.stringify({ played: true }));
      localStorage.setItem('knucklebones.online.profile', JSON.stringify({
        accountId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        nickname: 'Icon tester',
        rating: 1200,
        avatar: 'die:4:green',
      }));
      localStorage.removeItem('knucklebones.native.profile-app-icon.enabled');
      // The previous automatic release may have left an alternate selected.
      // Missing preference now means OFF, so boot must repair it to primary.
      window.__nativeAppIcon = { current: 'die-2-mg', reads: 0, changes: [] };
      window.Capacitor = {
        getPlatform: () => nativePlatform,
        Plugins: {
          SplashScreen: { hide: async () => undefined },
          AppIcon: {
            getState: async () => {
              window.__nativeAppIcon.reads++;
              return { supported: true, icon: window.__nativeAppIcon.current };
            },
            setIcon: async ({ icon }) => {
              const changed = window.__nativeAppIcon.current !== icon;
              window.__nativeAppIcon.current = icon;
              window.__nativeAppIcon.changes.push(icon);
              return { supported: true, icon, changed };
            },
          },
        },
      };
    }, platform);
    const page = await context.newPage();
    page.on('pageerror', (error) => errs.push(`${platform} app icon PAGEERROR: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errs.push(`${platform} app icon CONSOLE: ${message.text()}`);
    });
    await page.goto(`file://${process.cwd()}/knucklebones-neon.html`);
    await page.waitForFunction(() => !!window.__kb);
    await page.waitForFunction(() => window.__nativeAppIcon.current === 'primary');
    await page.tap('#btnSettingsHome');
    await page.waitForTimeout(100);
    const initial = await page.evaluate(() => {
      const card = document.getElementById('appIconCard');
      const box = card?.getBoundingClientRect();
      return {
        hidden: card?.hidden,
        width: box?.width ?? 0,
        height: box?.height ?? 0,
        selected: document.querySelector('#appIconSeg button.on')?.dataset.ai,
        copy: card?.querySelector('.lbl')?.textContent?.trim(),
        native: { ...window.__nativeAppIcon },
      };
    });
    check(initial.hidden === false && initial.width > 0 && initial.height > 0
      && initial.selected === '0' && initial.copy === 'Use profile die as app icon'
      && initial.native.current === 'primary'
      && JSON.stringify(initial.native.changes) === JSON.stringify(['primary']),
    `${platform}: native profile-icon choice was not visible, OFF, and primary by default`, initial);

    await page.tap('#appIconSeg button[data-ai="1"]');
    await page.waitForFunction(() => window.__nativeAppIcon.current === 'die-4-green'
      && localStorage.getItem('knucklebones.native.profile-app-icon.enabled') === '1');
    const enabled = await page.evaluate(() => ({
      selected: document.querySelector('#appIconSeg button.on')?.dataset.ai,
      stored: localStorage.getItem('knucklebones.native.profile-app-icon.enabled'),
      native: { ...window.__nativeAppIcon },
    }));
    check(enabled.selected === '1' && enabled.stored === '1'
      && enabled.native.current === 'die-4-green'
      && JSON.stringify(enabled.native.changes) === JSON.stringify(['primary', 'die-4-green']),
    `${platform}: explicit ON did not apply the confirmed cached profile die`, enabled);

    await page.tap('#appIconSeg button[data-ai="0"]');
    await page.waitForFunction(() => window.__nativeAppIcon.current === 'primary'
      && localStorage.getItem('knucklebones.native.profile-app-icon.enabled') === null);
    const disabled = await page.evaluate(() => ({
      selected: document.querySelector('#appIconSeg button.on')?.dataset.ai,
      stored: localStorage.getItem('knucklebones.native.profile-app-icon.enabled'),
      native: { ...window.__nativeAppIcon },
    }));
    check(disabled.selected === '0' && disabled.stored === null
      && disabled.native.current === 'primary'
      && JSON.stringify(disabled.native.changes) === JSON.stringify([
        'primary', 'die-4-green', 'primary',
      ]),
    `${platform}: explicit OFF did not restore the primary launcher`, disabled);
    observations.push({ platform, initial, enabled, disabled });
    await context.close();
  }
  return observations;
}

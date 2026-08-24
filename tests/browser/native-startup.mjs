import pkg from 'playwright';

const { chromium, devices } = pkg;
const browser = await chromium.launch();
const problems = [];
const errs = [];
const check = (condition, message, detail) => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const context = await browser.newContext({
  ...devices['iPhone 13'],
  hasTouch: true,
  isMobile: true,
});
await context.addInitScript(() => {
  window.__nativeSplashHides = [];
  window.Capacitor = {
    getPlatform: () => 'ios',
    Plugins: {
      SplashScreen: {
        hide: async (options) => {
          const home = document.getElementById('ovStart');
          const root = document.getElementById('kbroot');
          const duel = document.getElementById('homeDuel');
          const style = home ? getComputedStyle(home) : null;
          const rect = home?.getBoundingClientRect();
          window.__nativeSplashHides.push({
            options,
            rootPresent: !!root,
            hooksPresent: !!window.__kb,
            homeClasses: home?.className ?? null,
            homeDisplay: style?.display ?? null,
            homeVisibility: style?.visibility ?? null,
            homeOpacity: style?.opacity ?? null,
            homeWidth: rect?.width ?? 0,
            homeHeight: rect?.height ?? 0,
            duelDice: duel?.querySelectorAll('.die').length ?? 0,
          });
        },
      },
    },
  };
});

const page = await context.newPage();
page.on('pageerror', (error) => errs.push(`PAGEERROR: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errs.push(`CONSOLE: ${message.text()}`);
});
await page.goto(`file://${process.cwd()}/knucklebones-neon.html`);
await page.waitForFunction(() => window.__nativeSplashHides?.length > 0);
await page.waitForTimeout(100);

const hides = await page.evaluate(() => window.__nativeSplashHides);
check(hides.length === 1, 'native splash did not hide exactly once', hides);
const atHide = hides[0] ?? {};
check(atHide.options?.fadeOutDuration === 200,
  'native splash did not use the configured 200 ms fade', atHide);
check(atHide.rootPresent && atHide.hooksPresent && /\bon\b/.test(atHide.homeClasses ?? '')
  && atHide.homeDisplay !== 'none' && atHide.homeVisibility === 'visible'
  && Number(atHide.homeOpacity) > 0 && atHide.homeWidth > 0 && atHide.homeHeight > 0
  && atHide.duelDice === 2,
'native splash hid before the boot-composed Home was visibly ready', atHide);

await browser.close();
console.log(JSON.stringify({ hides, problems, errs }, null, 2));
process.exit(problems.length || errs.length ? 1 : 0);

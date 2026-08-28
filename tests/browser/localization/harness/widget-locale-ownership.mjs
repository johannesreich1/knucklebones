import { frame } from './layout-inspection.mjs';

/* The widget as a host actually embeds it: a German device inside a page the
   host has already tagged es-MX. One boot, read twice — as it first paints,
   and again after the device language turns French — because the second
   reading only means anything measured against the first. */
export async function readWidgetLocaleOwnership({ widgetUrl, attachErrors, localeContext }) {
  const widgetContext = await localeContext(['de-DE'], {
    viewport: { width: 406, height: 680 },
    hostLanguage: 'es-MX',
  });
  const widget = attachErrors(await widgetContext.newPage(), 'widget-locale');
  await widget.goto(widgetUrl);
  await widget.waitForFunction(() => window.__kb);
  await frame(widget);
  const ownership = await widget.evaluate(() => ({
    override: window.__kb.S.localeOverride,
    htmlLang: document.documentElement.lang,
    rootLang: document.getElementById('kbroot')?.lang,
    rootLocale: document.getElementById('kbroot')?.dataset.locale,
    settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
    widgetTitle: document.querySelector('#kbroot > h2.sr-only')?.textContent?.trim(),
    first: window.__kbFirstHomeFrame ?? {
      htmlLang: document.documentElement.lang,
      rootLang: document.getElementById('kbroot')?.lang,
      locale: document.getElementById('kbroot')?.dataset.locale,
      settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
      visible: !!document.getElementById('ovStart')?.getBoundingClientRect().width,
      capturedLate: true,
    },
  }));

  await widget.evaluate(() => {
    window.__kbTestLanguageTags = ['fr-FR'];
    window.dispatchEvent(new Event('languagechange'));
  });
  await widget.waitForFunction(() => document.getElementById('kbroot')?.lang === 'fr');
  const change = await widget.evaluate(() => ({
    htmlLang: document.documentElement.lang,
    rootLang: document.getElementById('kbroot')?.lang,
    rootLocale: document.getElementById('kbroot')?.dataset.locale,
    settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
    widgetTitle: document.querySelector('#kbroot > h2.sr-only')?.textContent?.trim(),
  }));
  await widgetContext.close();
  return { ownership, change };
}

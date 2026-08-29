// A STUB THAT CANNOT ANSWER MUST FAIL THE SUITE, NOT PASS IT.
//
// Playwright swallows an exception thrown inside a page.route() handler: it
// prints the stack to stderr, leaves the request hanging or unfulfilled, and
// the run carries on. The client then sees a dead endpoint, which usually looks
// like "the feature is simply off" — and a suite asserting that the feature is
// off agrees with it.
//
// That is not hypothetical. On 2026-08-28 a harness edit left `runeCalls`
// undefined, so EVERY request to the collection endpoint threw, and the whole
// online-ui suite still exited 0. It was caught only because a human read
// stderr, which is not a gate.
//
// So wrap route registration once, at the page, before any module installs a
// handler. Every page.route() call made afterwards is guarded, wherever it
// lives — routes.mjs, the ladder/profile/identity sets, the trial fixture.
export function guardRoutes(page, report) {
  const install = page.route.bind(page);
  page.route = (pattern, handler, options) => install(pattern, async (route, request) => {
    try {
      return await handler(route, request);
    } catch (error) {
      /* Say which endpoint and why, because the scenario that fails downstream
         will describe a missing feature rather than a broken stub. */
      report(`HARNESS ROUTE THREW for ${request.method()} ${request.url()} :: ${error?.message ?? error}`);
      /* Answer 500 rather than leave it hanging: the client gets a definite
         failure it can report, instead of a timeout minutes later that hides
         the cause. The recorded problem is what actually fails the suite. */
      try {
        return await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'harness route handler threw' }),
        });
      } catch { /* already answered or the page is gone; the report stands */ }
    }
  }, options);
}

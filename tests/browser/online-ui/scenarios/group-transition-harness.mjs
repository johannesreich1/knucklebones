// Shared network and presentation seams for ranked group-transition scenarios.
// Routes are installed after the online harness routes so no progression read
// or acknowledgement can escape a scenario fixture to a live project.
export async function installProgressionRoutes(page, row) {
  const reads = [];
  const acknowledgements = [];
  let markAcknowledged;
  const acknowledged = new Promise((resolve) => { markAcknowledged = resolve; });

  await page.route('**/rest/v1/ranked_progression_events*', async (route) => {
    const request = route.request();
    const headers = request.headers();
    reads.push({
      url: decodeURIComponent(request.url()),
      authorization: headers.authorization ?? '',
    });
    const object = (headers.accept ?? '').includes('application/vnd.pgrst.object');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/1' },
      body: JSON.stringify(object ? row : [row]),
    });
  });
  await page.route('**/rest/v1/rpc/acknowledge_ranked_progression*', async (route) => {
    const request = route.request();
    acknowledgements.push({
      body: request.postDataJSON() ?? {},
      authorization: request.headers().authorization ?? '',
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'true' });
    markAcknowledged();
  });
  return { reads, acknowledgements, acknowledged };
}

export async function showTransitionResult(page, report) {
  await page.evaluate((payload) => {
    window.__kb.S.played = true;
    window.__kbResult(payload);
  }, report);
  await page.waitForSelector('#ovEnd.on', { timeout: 10000 });
  await page.waitForSelector('#ovGroupTransition.on .gt-deck', { timeout: 10000 });
}

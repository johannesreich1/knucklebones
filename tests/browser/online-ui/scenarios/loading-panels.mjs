export async function runOnlineLoadingPanelScenarios(suite) {
  const { visit, out, check } = suite;

  const profile = await visit({ inspectLoading: true });
  const ladder = await visit({ door: 'board', inspectLoading: true });
  out.onlineLoading = { profile: profile.loading, ladder: ladder.loading };

  for (const [name, run, title, finalPanel] of [
    ['profile', profile, 'PROFILE', 'account'],
    ['ladder', ladder, 'LADDER', null],
  ]) {
    const loading = run.loading;
    check(loading?.visible === true,
      `${name} does not show the shared loading die after its grace`, loading);
    check(Math.abs(loading?.xError ?? 999) <= 1 && Math.abs(loading?.yError ?? 999) <= 24,
      `${name} loading die is not centred in the visible view`, loading);
    check(loading?.targetHidden === true && loading?.visiblePanels?.length === 0,
      `${name} reveals partial content behind its loading die`, loading);
    check(loading?.title === title,
      `${name} loading state lost the destination title`, loading);
    if (finalPanel) {
      check(run.seen.panel === finalPanel && run.seen.accName === 'TestGuest001',
        'profile did not reveal one complete final view', run.seen);
    } else {
      check(run.seen.rows.length === 2,
        'ladder did not replace its centred wait with the final rows', run.seen);
    }
    check(run.errs.length === 0, `page errors during the ${name} loading transition`, run.errs);
  }
}

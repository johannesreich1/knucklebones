import { holdAndCancel, pressingClass } from '../../support/press-feedback.mjs';

const near = (actual, expected) => Math.abs(actual - expected) <= .01;
const restored = (sample) => near(sample.resting, 1) && near(sample.released, 1);

export async function runOnlineMenuPressFeedbackScenarios(suite) {
  const { visit, out, check } = suite;

  const account = await visit({
    probe: async (page) => {
      const history = await holdAndCancel(page, '#btnHistory');
      const avatarDoor = await holdAndCancel(page, '#btnAvatar');
      const ladderDoor = await holdAndCancel(page, '#btnLadder');
      const accountAction = await holdAndCancel(page, '#btnClaim');
      const panelAfterCancel = await page.locator('#onAccount').evaluate((panel) => !panel.hidden);
      const classPress = await pressingClass(page, '#btnHistory');

      await page.click('#btnAvatar');
      await page.waitForSelector('#onAvatar:not([hidden])');
      const avatarFace = await holdAndCancel(page, '#avFaces button');
      const avatarHue = await holdAndCancel(page, '#avHues button');
      const avatarStillOpen = await page.locator('#onAvatar').evaluate((panel) => !panel.hidden);
      await page.click('#btnOnlineBack');
      await page.waitForSelector('#onAccount:not([hidden])');

      return {
        history, avatarDoor, ladderDoor, accountAction, classPress,
        avatarFace, avatarHue, panelAfterCancel, avatarStillOpen,
      };
    },
  });
  const a = account.probeResult;
  check(a?.panelAfterCancel && a?.avatarStillOpen,
    'cancelled account/avatar press navigated to another control', a);
  check(near(a?.history.held, .97) && restored(a.history),
    'Full match history lacks shared press feedback', a?.history);
  check(near(a?.avatarDoor.held, .97) && restored(a.avatarDoor)
        && near(a?.ladderDoor.held, .97) && restored(a.ladderDoor),
    'profile avatar or ladder action lacks shared press feedback', a);
  check(near(a?.accountAction.held, .96) && restored(a.accountAction),
    'account .btn lost its existing press strength', a?.accountAction);
  check(near(a?.avatarFace.held, .97) && restored(a.avatarFace),
    'avatar face choice lacks shared press feedback', a?.avatarFace);
  check(near(a?.avatarHue.held, .9) && restored(a.avatarHue),
    'avatar hue choice lost its stronger press feedback', a?.avatarHue);
  check(near(a?.classPress.held, .97) && restored(a.classPress),
    'online control does not respond to the shared .pressing state', a?.classPress);

  const board = await visit({
    door: 'board',
    probe: async (page) => {
      const row = await holdAndCancel(page, '#onLadderList .lrow');
      return {
        row,
        boardStillOpen: await page.locator('#onLadder').evaluate((panel) => !panel.hidden),
        faceoffAbsent: await page.locator('.faceoff').count() === 0,
      };
    },
  });
  const l = board.probeResult;
  check(l?.boardStillOpen && l?.faceoffAbsent && near(l?.row.held, .97) && restored(l.row),
    'cancelled ladder-row press opened another view or lacks feedback', l);

  out.onlineMenuPressFeedback = { account: a, ladder: l };
}

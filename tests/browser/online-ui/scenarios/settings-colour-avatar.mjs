/* YOUR COLOUR REACHES YOUR AVATAR, AND THE PLAYER SEES IT HAPPEN.
 *
 * Since the avatar's hue became "your colour" from Settings, changing that
 * colour has to move two things: the row other players read
 * (`profiles.avatar`), and the pips the player is looking at right now.
 *
 * The second one is the bug this scenario exists for. Every other surface
 * showing your colour inherits `--p1` from the root and recolours with no
 * JavaScript at all; the avatar deliberately does not, because `paintAvatar`
 * stamps a RAW hue inline (`--dc`) so an avatar can hold a colour of its own.
 * The first release of this feature wrote the new hue to the server and the
 * cache and repainted nothing, so the Home chip kept its old pips until a
 * boot or some unrelated screen happened to repaint it — reported from a
 * device: "i change the color and the avatar color still stays the same".
 *
 * So this asserts the COMPUTED COLOUR of the chip's die, not the stored
 * string: a probe reading `localStorage` alone passes while the bug is live.
 *
 * The second half is the offline promise. A write that cannot reach Supabase
 * must not be lost — it is re-attempted when the device comes back online,
 * and only then does the chip catch up. */
const HUE = { cy: '#28e8ff', green: '#7ee787', violet: '#b18cff' };

const chipAvatar = (page) => page.evaluate(() => {
  const die = document.querySelector('#homeChip .pav .die');
  const cached = JSON.parse(localStorage.getItem('knucklebones.online.profile') ?? 'null');
  return {
    painted: die ? getComputedStyle(die).getPropertyValue('--dc').trim() : null,
    face: die?.getAttribute('data-v') ?? null,
    stored: cached?.avatar ?? null,
  };
});

async function pickColour(page, hue) {
  await page.click(`#p1Pick button[data-h="${hue}"]`);
  /* the write is a round trip; give it room without pinning a duration */
  await page.waitForTimeout(250);
}

export async function runSettingsColourAvatarScenarios(suite) {
  const { visit, out, check } = suite;
  const run = await visit({
    named: true,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page, routes) => {
      await page.click('#btnOnlineBack');
      await page.waitForSelector('#ovStart.on', { timeout: 15000 });
      const before = await chipAvatar(page);

      await page.click('#btnSettingsHome');
      await page.waitForSelector('#ovSettings.on', { timeout: 15000 });
      await pickColour(page, 'green');
      const recoloured = await chipAvatar(page);

      /* A write that cannot land must neither repaint nor be forgotten. */
      routes.failNextAvatarWrite();
      await pickColour(page, 'violet');
      const whileOffline = await chipAvatar(page);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForTimeout(400);
      const afterReconnect = await chipAvatar(page);

      return { before, recoloured, whileOffline, afterReconnect };
    },
  });
  const reading = run.probeResult;
  out.settingsColourAvatar = reading;

  check(reading?.before.painted === HUE.cy && reading.before.stored === 'die:5:cy',
    'the colour fixture did not start from a cyan avatar', reading?.before);
  /* THE REPORTED BUG. Both halves matter: the row other players read, and the
     pips this player is looking at. */
  check(reading?.recoloured.stored === 'die:5:green',
    'changing "your colour" did not carry into the avatar other players read',
    reading?.recoloured);
  check(reading?.recoloured.painted === HUE.green,
    'the avatar on Home kept its old colour after "your colour" changed',
    reading?.recoloured);
  check(reading?.recoloured.face === '5',
    'aligning the avatar hue disturbed the face the player chose', reading?.recoloured);
  /* the deferred half: nothing changes while the write cannot land... */
  check(reading?.whileOffline.painted === HUE.green
      && reading.whileOffline.stored === 'die:5:green',
  'a failed avatar write repainted or cached a colour the server never took',
  reading?.whileOffline);
  /* ...and coming back online settles it without the player doing anything */
  check(reading?.afterReconnect.painted === HUE.violet
      && reading.afterReconnect.stored === 'die:5:violet',
  'a colour change lost to a failed write was never retried once online again',
  reading?.afterReconnect);
  check(run.errs.length === 0, 'page errors while following the Settings colour', run.errs);
}

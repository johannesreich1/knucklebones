/* ONE SWEEP PER OPEN. The profile ring is a JS tween over --p (it is a
   conic-gradient angle stop, which no engine interpolates reliably), and
   resetAccountPresentation used to empty --p on every call. One tap on Profile
   reaches beginPresentation three times — the entry door paints the cached
   snapshot, ui.ts restates that wait once hydration returns, and the
   authenticated route then begins its own run — so the player watched the
   circle fill, snap back to empty, and fill again (reported from a device
   2026-09-03: "the progress round circle is animated twice").

   This pins the fact at the level it was reported: the value the player is
   looking at, sampled every frame across a real cached open. A restart is a
   sample that falls back to empty after the ring has visibly filled. */
import { seedCompleteProfile } from './cached-profile-resilience.mjs';

/* The cached snapshot is stamped v2, so the server has to agree: classified
   through the default v1 floors the same 321 points land in a different group,
   and the ring would legitimately fill to 77% and then drop to 5% as the fresh
   curve arrives — real behaviour, but not the thing being measured here. */
const V2_STATUS = Object.freeze({
  curve_version: 2,
  scoring_version: 2,
  admission_paused: false,
  outcomes: [
    'classic', 'singlestrike', 'colshield', 'limited',
    'rowswitch', 'rowmult', 'bounty', 'rune_trial',
  ],
  weekly_unlocked: false,
  pending_bot_debuts: [],
  neon_medal_seasons: [],
  weekly: null,
});

/* Sampling starts before the app boots, so no part of the first sweep can
   happen before the recorder is watching. #accRing carries --p inline from the
   shell's own markup, so this reads exactly what the tween writes. */
const recordRingSamples = () => {
  window.__ringSamples = [];
  const sample = () => {
    const raw = document.getElementById('accRing')?.style.getPropertyValue('--p');
    if (raw) window.__ringSamples.push(Number(raw));
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

export async function runProfileRingSweepScenarios(suite) {
  const { visit, out, check } = suite;

  const opened = await visit({
    preauthenticated: true,
    /* The fresh read agrees with the cached snapshot, so the only thing that
       can move the fill is the entrance itself. A legitimate points change
       would tween the ring downward and is not what this measures. */
    standingPoints: 321,
    progressionStatus: V2_STATUS,
    /* HYDRATION HAS TO TAKE TIME, or this measures nothing. The cached paint
       and the two presentations that follow it are separated by exactly one
       await of the entry hydration; answered instantly they all land before
       the first frame of the tween, and a ring that restarts at --p 0 looks
       identical to one that never restarted. A phone's network puts them
       mid-sweep, which is where the player saw the circle snap back. */
    dataDelay: 400,
    initScript: `(${seedCompleteProfile.toString()})();`
      + `(${recordRingSamples.toString()})();`,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page) => {
      await page.waitForSelector('#onAccount:not([hidden])');
      /* Past the 850ms tween AND past hydration, which is where the second and
         third presentations used to land. */
      await page.waitForTimeout(2000);
      return page.evaluate(() => {
        const samples = window.__ringSamples ?? [];
        return {
          samples,
          count: samples.length,
          settled: Number(document.getElementById('accRing')
            ?.style.getPropertyValue('--p')),
        };
      });
    },
  });

  const result = opened.probeResult;
  const samples = result?.samples ?? [];
  const settled = result?.settled ?? 0;
  /* A SWEEP IS A DEPARTURE FROM AN EMPTY RING, which is the event the player
     counted. Exactly zero, because that is what the reset writes and what the
     shell's markup starts at — nothing else ever produces it. Reading it this
     way rather than as "never decreases" also means a genuine downward tween,
     from a points loss the standing confirms, could never read as the bug. */
  const rises = samples.filter((value, index) =>
    index > 0 && value > 0 && samples[index - 1] === 0).length;
  const distinct = new Set(samples).size;
  out.profileRingSweep = {
    rises,
    distinct,
    settled,
    frames: result?.count,
    peak: samples.length ? Math.max(...samples) : null,
  };

  check(samples.length > 0 && rises === 1,
    'the profile ring leaves empty more than once for one cached open — it '
    + 'fills, snaps back to empty, and fills again',
    out.profileRingSweep);
  /* Guards the other direction: a ring that snapped straight to its fill and
     never animated would also report exactly one rise. */
  check(distinct >= 8 && settled > 0,
    'the profile ring did not sweep in at all on a cached open',
    out.profileRingSweep);
  check(opened.errs.length === 0,
    'page errors while sweeping the cached Profile ring', opened.errs);
}

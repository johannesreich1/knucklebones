// THE IDENTITY LADDER: nobody is asked to type anything to play.
//
// A first-timer who taps ACCOUNT (or RANKED) becomes a guest — a real user row,
// a real nickname, a real rating — without ever seeing a form. The panel they
// land on offers the way UP; it never blocks the way in.
//
// Two failure modes are worth locking down, and both are invisible to a test
// that only checks the happy path:
//   · the project with anonymous sign-ins switched OFF must fall back to the
//     old sign-in panel rather than dead-ending,
//   · a device that has held a real account must NOT be silently re-minted as
//     a guest — that player signed out in order to sign back in.
//
// Served suite: the online chunk is lazy, so it needs a real origin. Supabase
// is stubbed at the network edge — this asserts OUR decisions, not theirs.
import pkg from 'playwright';
import { servedBase } from '../../serve.mjs';
import { selectScenarios, validateScenarioShards } from '../../support/browser-scenarios.mjs';
import { createVisit } from './harness/visit.mjs';
import { runMatchmakingScenarios } from './scenarios/matchmaking.mjs';
import { runFreshAccountScenarios } from './scenarios/fresh-account.mjs';
import { runLadderFaceoffScenarios } from './scenarios/ladder-faceoff.mjs';
import { runLadderScrollScenarios } from './scenarios/ladder-scroll.mjs';
import { runLadderRecoveryScenarios } from './scenarios/ladder-recovery.mjs';
import { runHistoryCrawlScenarios } from './scenarios/history-crawl.mjs';
import { runAccountLifecycleScenarios } from './scenarios/account-lifecycle.mjs';
import {
  runAccountMutationOwnershipScenarios,
} from './scenarios/account-mutation-ownership.mjs';
import { runExplicitGuestSessionScenarios } from './scenarios/explicit-guest-session.mjs';
import { runOnlineMenuPressFeedbackScenarios } from './scenarios/menu-press-feedback.mjs';
import { runOnlineLoadingPanelScenarios } from './scenarios/loading-panels.mjs';
import { runPageNavigationMotionScenarios } from './scenarios/page-navigation-motion.mjs';
import {
  runPageNavigationPerformanceScenarios,
} from './scenarios/page-navigation-performance.mjs';
import {
  runRankedGameMotionExclusionScenarios,
} from './scenarios/ranked-game-motion-exclusion.mjs';
import { runEntryWithoutDieScenarios } from './scenarios/entry-without-die.mjs';
import { runOfflineEntryScenarios } from './scenarios/offline-entry.mjs';
import { runAuthModalScenarios } from './scenarios/auth-modal.mjs';
import { runAuthCredentialScenarios } from './scenarios/auth-credentials.mjs';
import { runAccountAccessScenarios } from './scenarios/account-access.mjs';
import { runAccountGameCenterScenarios } from './scenarios/account-game-center.mjs';
import {
  runAccountGameCenterBlockedScenarios,
} from './scenarios/account-game-center-blocked.mjs';
import { runAccountErrorSheetScenarios } from './scenarios/account-error-sheet.mjs';
import { runProfileRuneSheetScenarios } from './scenarios/profile-rune-sheet.mjs';
import { runProfileRingSweepScenarios } from './scenarios/profile-ring-sweep.mjs';
import {
  runFirstRuneProfileRecoveryScenario,
} from './scenarios/first-rune-profile-recovery.mjs';
import { runRuneTrialUiScenarios } from './scenarios/rune-trial-ui.mjs';
import { runRuneTrialRailScenarios } from './scenarios/rune-trial-rail.mjs';
import { runRuneRewardRaceScenarios } from './scenarios/rune-reward-races.mjs';
import { runAwayForfeitScenarios } from './scenarios/away-forfeit.mjs';
import { runSeatColourScenarios } from './scenarios/seat-colours.mjs';
import {
  runSettingsColourAvatarScenarios,
} from './scenarios/settings-colour-avatar.mjs';
import { runEquippedSeatScenarios } from './scenarios/equipped-seat.mjs';
import { runEquippedSeatInterlockScenarios } from './scenarios/equipped-seat-interlocks.mjs';
import { runTrialMoveLatencyScenarios } from './scenarios/trial-move-latency.mjs';
import { runTrialRefusedActionScenarios } from './scenarios/trial-refused-action.mjs';
import { runRankedRevealLayoutScenarios } from './scenarios/ranked-reveal-layout.mjs';
import { runFlyingDieColourScenarios } from './scenarios/flying-die-colour.mjs';
import { runTrialCastLatencyScenarios } from './scenarios/trial-cast-latency.mjs';
import { runBotOpeningBeatScenarios } from './scenarios/bot-opening-beat.mjs';
import { runRowSwitchOpeningScenarios } from './scenarios/row-switch-opening.mjs';
import {
  runAccountAchievementsWeeklyScenarios,
} from './scenarios/account-achievements-weekly.mjs';
import { runGroupTransitionScenarios } from './scenarios/group-transition.mjs';
import {
  runGroupTransitionDemotionScenarios,
} from './scenarios/group-transition-demotion.mjs';
import {
  runGroupTransitionResponsiveScenarios,
} from './scenarios/group-transition-responsive.mjs';
import {
  runGroupTransitionAccountRaceScenarios,
} from './scenarios/group-transition-account-race.mjs';
import { emitReport } from '../../support/emit-report.mjs';

const { webkit, chromium } = pkg;
const SCENARIOS = Object.freeze([
  { id: 'matchmaking', run: runMatchmakingScenarios },
  { id: 'fresh-account', run: runFreshAccountScenarios },
  { id: 'ladder-faceoff', run: runLadderFaceoffScenarios },
  { id: 'ladder-scroll', run: runLadderScrollScenarios },
  { id: 'ladder-recovery', run: runLadderRecoveryScenarios },
  { id: 'history-crawl', run: runHistoryCrawlScenarios },
  { id: 'account-lifecycle', run: runAccountLifecycleScenarios },
  { id: 'account-mutation-ownership', run: runAccountMutationOwnershipScenarios },
  { id: 'explicit-guest-session', run: runExplicitGuestSessionScenarios },
  { id: 'menu-press-feedback', run: runOnlineMenuPressFeedbackScenarios },
  { id: 'loading-panels', run: runOnlineLoadingPanelScenarios },
  { id: 'page-navigation-motion', run: runPageNavigationMotionScenarios },
  { id: 'page-navigation-performance', run: runPageNavigationPerformanceScenarios },
  { id: 'ranked-game-motion-exclusion', run: runRankedGameMotionExclusionScenarios },
  { id: 'entry-without-die', run: runEntryWithoutDieScenarios },
  { id: 'offline-entry', run: runOfflineEntryScenarios },
  { id: 'auth-modal', run: runAuthModalScenarios },
  { id: 'auth-credentials', run: runAuthCredentialScenarios },
  { id: 'account-access', run: runAccountAccessScenarios },
  { id: 'account-game-center', run: runAccountGameCenterScenarios },
  { id: 'account-game-center-blocked', run: runAccountGameCenterBlockedScenarios },
  { id: 'account-error-sheet', run: runAccountErrorSheetScenarios },
  { id: 'profile-rune-sheet', run: runProfileRuneSheetScenarios },
  { id: 'profile-ring-sweep', run: runProfileRingSweepScenarios },
  { id: 'first-rune-profile-recovery', run: runFirstRuneProfileRecoveryScenario },
  { id: 'rune-trial', run: runRuneTrialUiScenarios },
  { id: 'rune-trial-rail', run: runRuneTrialRailScenarios },
  { id: 'away-forfeit', run: runAwayForfeitScenarios },
  { id: 'seat-colours', run: runSeatColourScenarios },
  { id: 'settings-colour-avatar', run: runSettingsColourAvatarScenarios },
  { id: 'equipped-seat', run: runEquippedSeatScenarios },
  { id: 'equipped-seat-interlocks', run: runEquippedSeatInterlockScenarios },
  { id: 'trial-move-latency', run: runTrialMoveLatencyScenarios },
  { id: 'trial-refused-action', run: runTrialRefusedActionScenarios },
  { id: 'ranked-reveal-layout', run: runRankedRevealLayoutScenarios },
  { id: 'flying-die-colour', run: runFlyingDieColourScenarios },
  { id: 'trial-cast-latency', run: runTrialCastLatencyScenarios },
  { id: 'bot-opening-beat', run: runBotOpeningBeatScenarios },
  { id: 'row-switch-opening', run: runRowSwitchOpeningScenarios },
  { id: 'account-achievements-weekly', run: runAccountAchievementsWeeklyScenarios },
  { id: 'group-transition', run: runGroupTransitionScenarios },
  { id: 'group-transition-demotion', run: runGroupTransitionDemotionScenarios },
  { id: 'group-transition-responsive', run: runGroupTransitionResponsiveScenarios },
  { id: 'group-transition-account-race', run: runGroupTransitionAccountRaceScenarios },
  // Deliberately outside the no-argument gate run: the reward-race probes are
  // a focused investigation surface, reached only through an explicit --only.
  { id: 'rune-reward-races', run: runRuneRewardRaceScenarios, manual: true },
]);
/* GATE SHARDS. The gate kills any one suite at its per-suite limit and this
   tree outgrew it once three release streams landed together (measured
   2026-09-02: 23 of 40 scenarios took 260s). Each shard is a separate gate
   suite (tests/support/gate-manifest.mjs) so four workers overlap them; the
   validator refuses a scenario that is in no shard or in two. Balance by the
   report's `timings`, not by feel. A no-argument run still walks the whole
   tree, with three shards' budget. */
const SHARDS = Object.freeze({
  entry: Object.freeze([
    'matchmaking', 'fresh-account', 'ladder-faceoff', 'ladder-scroll', 'ladder-recovery',
    'history-crawl',
    'explicit-guest-session', 'menu-press-feedback', 'loading-panels',
    'page-navigation-motion', 'page-navigation-performance', 'ranked-game-motion-exclusion',
    'entry-without-die',
    'offline-entry', 'auth-modal', 'auth-credentials',
  ]),
  account: Object.freeze([
    'account-lifecycle', 'account-mutation-ownership', 'account-access',
    'settings-colour-avatar',
    'account-game-center', 'account-game-center-blocked', 'account-error-sheet',
    'profile-rune-sheet', 'profile-ring-sweep',
    'first-rune-profile-recovery', 'account-achievements-weekly',
    'rune-trial', 'rune-trial-rail',
  ]),
  ranked: Object.freeze([
    'away-forfeit', 'seat-colours', 'equipped-seat', 'equipped-seat-interlocks',
    'trial-move-latency', 'trial-refused-action', 'ranked-reveal-layout',
    'flying-die-colour', 'trial-cast-latency', 'bot-opening-beat', 'row-switch-opening',
    'group-transition', 'group-transition-demotion', 'group-transition-responsive',
    'group-transition-account-race',
  ]),
});
validateScenarioShards('online UI browser', SCENARIOS, SHARDS);
let scenarios;
try {
  scenarios = selectScenarios('online UI browser', SCENARIOS, process.argv.slice(2), SHARDS);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
// the origin comes from run-all (KB_URL) or from a server this suite starts —
// a kernel-picked port either way, so a peer's gate cannot answer it
const URL = await servedBase();
const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => `${b64({ alg: 'HS256', typ: 'JWT' })}.` +
  `${b64({ sub, aud: 'authenticated', role: 'authenticated', is_anonymous: true,
           exp: Math.floor(Date.now() / 1000) + 3600 })}.stub`;

const GUEST_ID = '00000000-0000-4000-8000-00000000beef';
const SESSION = {
  access_token: jwt(GUEST_ID), token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub',
  user: { id: GUEST_ID, aud: 'authenticated', role: 'authenticated',
          email: null, is_anonymous: true, created_at: new Date().toISOString(),
          app_metadata: {}, user_metadata: {}, identities: [] },
};

/* WebKit stops beginning navigations after roughly sixty create/close context
   cycles on this machine: the next page.goto sits before domcontentloaded for
   its full timeout, while the same scenario is green in a fresh process. This
   tree is intentionally exhaustive and now crosses that lifetime. Recycle at
   a measured margin BETWEEN visits, when createVisit has closed its context;
   the stable wrapper means scenarios do not learn about browser lifetimes. */
const WEBKIT_VISITS_PER_BROWSER = 48;
let browser = await webkit.launch();
let webkitVisits = 0;
let visitOnBrowser = createVisit({ browser, URL, SESSION, GUEST_ID,
  onHarnessError: (message) => problems.push(message) });
const recycleWebKit = async () => {
  await browser.close().catch(() => {});
  browser = await webkit.launch();
  visitOnBrowser = createVisit({ browser, URL, SESSION, GUEST_ID,
    onHarnessError: (message) => problems.push(message) });
  webkitVisits = 0;
};
const visit = async (options) => {
  if (webkitVisits >= WEBKIT_VISITS_PER_BROWSER) await recycleWebKit();
  const result = await visitOnBrowser(options);
  webkitVisits++;
  return result;
};
/* A SECOND ENGINE, LAUNCHED ONLY IF A SCENARIO ASKS FOR ONE. This suite is
   WebKit, and that is exactly why a Chromium scroll-anchoring bug shipped: the
   bug cannot exist in an engine that has not implemented the feature. One
   scenario needs Chromium; the others must not pay for a second launch, so it
   is memoised on first use. Scenarios run sequentially, so no lock is needed. */
let chrome = null;
let chromeVisit = null;
const visitChromium = async (options) => {
  chrome ??= await chromium.launch();
  chromeVisit ??= createVisit({ browser: chrome, URL, SESSION, GUEST_ID,
    onHarnessError: (message) => problems.push(message) });
  return chromeVisit(options);
};
const suite = { visit, visitChromium, out, check };

/* EVERY SCENARIO ANSWERS, AND THE TREE ANSWERS IN BOUNDED TIME. A scenario
   that awaits a harness promise nobody resolves used to hang the whole run
   (measured 2026-09-02: 45 minutes with WebKit alive and no report), and one
   thrown wait used to abort every scenario after it while the report listed
   only the checks collected before it. Each owner now gets its own watchdog
   and its own THREW line, a hung owner's engine is replaced so the next one
   starts clean, and the tree stops itself inside the gate's per-suite budget
   so a red run still names what it did not reach instead of being killed
   without a report. Timings are part of the report so a slow owner is a
   number, not a feeling. */
const SCENARIO_TIMEOUT_MS = 180_000;
const SHARD_BUDGET_MS = 420_000;
const SUITE_BUDGET_MS = process.argv.includes('--shard') || process.argv.includes('--only')
  ? SHARD_BUDGET_MS : SHARD_BUDGET_MS * Object.keys(SHARDS).length;
const timings = {};
const suiteStarted = performance.now();
const progress = (line) => process.stderr.write(`online-ui: ${line}\n`);
for (const [index, scenario] of scenarios.entries()) {
  const elapsed = performance.now() - suiteStarted;
  if (elapsed > SUITE_BUDGET_MS) {
    const skipped = scenarios.slice(index).map(({ id }) => id);
    problems.push(`NOT RUN :: budget of ${SUITE_BUDGET_MS / 1000}s exhausted after `
      + `${(elapsed / 1000).toFixed(1)}s; skipped ${skipped.join(', ')}`);
    break;
  }
  const started = performance.now();
  progress(`${scenario.id} start`);
  let watchdog;
  const running = scenario.run(suite);
  const expiry = new Promise((_, reject) => {
    watchdog = setTimeout(() => reject(new Error(
      `hung: no answer within ${SCENARIO_TIMEOUT_MS / 1000}s`)), SCENARIO_TIMEOUT_MS);
  });
  try {
    await Promise.race([running, expiry]);
  } catch (e) {
    problems.push(`THREW in ${scenario.id} :: ${e.message}`);
    /* The owner may still be parked on a promise nobody will resolve, holding
       its contexts. Its rejection, once the engine goes, is expected. */
    running.catch(() => {});
    await recycleWebKit();
    if (chrome) { await chrome.close().catch(() => {}); chrome = null; chromeVisit = null; }
  } finally {
    clearTimeout(watchdog);
  }
  timings[scenario.id] = Math.round(performance.now() - started);
  progress(`${scenario.id} done in ${(timings[scenario.id] / 1000).toFixed(1)}s`);
}
await browser.close();
await chrome?.close();
emitReport({ out, timings, problems }, problems.length);

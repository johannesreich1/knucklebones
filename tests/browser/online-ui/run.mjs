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
import { runHistoryCrawlScenarios } from './scenarios/history-crawl.mjs';
import { runAccountLifecycleScenarios } from './scenarios/account-lifecycle.mjs';
import { runOnlineMenuPressFeedbackScenarios } from './scenarios/menu-press-feedback.mjs';
import { runOnlineLoadingPanelScenarios } from './scenarios/loading-panels.mjs';
import { runEntryWithoutDieScenarios } from './scenarios/entry-without-die.mjs';
import { runAuthModalScenarios } from './scenarios/auth-modal.mjs';
import { runAuthCredentialScenarios } from './scenarios/auth-credentials.mjs';
import { runAccountAccessScenarios } from './scenarios/account-access.mjs';
import { runAccountGameCenterScenarios } from './scenarios/account-game-center.mjs';
import {
  runAccountGameCenterBlockedScenarios,
} from './scenarios/account-game-center-blocked.mjs';
import { runAccountErrorSheetScenarios } from './scenarios/account-error-sheet.mjs';
import { runProfileRuneSheetScenarios } from './scenarios/profile-rune-sheet.mjs';
import { runRuneTrialUiScenarios } from './scenarios/rune-trial-ui.mjs';
import { runRuneTrialRailScenarios } from './scenarios/rune-trial-rail.mjs';
import { runRuneRewardRaceScenarios } from './scenarios/rune-reward-races.mjs';
import { runAwayForfeitScenarios } from './scenarios/away-forfeit.mjs';
import { runSeatColourScenarios } from './scenarios/seat-colours.mjs';
import { runEquippedSeatScenarios } from './scenarios/equipped-seat.mjs';
import { runEquippedSeatInterlockScenarios } from './scenarios/equipped-seat-interlocks.mjs';
import { runTrialMoveLatencyScenarios } from './scenarios/trial-move-latency.mjs';
import { runTrialRefusedActionScenarios } from './scenarios/trial-refused-action.mjs';
import { runRankedRevealLayoutScenarios } from './scenarios/ranked-reveal-layout.mjs';
import { runFlyingDieColourScenarios } from './scenarios/flying-die-colour.mjs';
import { runTrialCastLatencyScenarios } from './scenarios/trial-cast-latency.mjs';
import { runBotOpeningBeatScenarios } from './scenarios/bot-opening-beat.mjs';
import { emitReport } from '../../support/emit-report.mjs';

const { webkit, chromium } = pkg;
const SCENARIOS = Object.freeze([
  { id: 'matchmaking', run: runMatchmakingScenarios },
  { id: 'fresh-account', run: runFreshAccountScenarios },
  { id: 'ladder-faceoff', run: runLadderFaceoffScenarios },
  { id: 'ladder-scroll', run: runLadderScrollScenarios },
  { id: 'history-crawl', run: runHistoryCrawlScenarios },
  { id: 'account-lifecycle', run: runAccountLifecycleScenarios },
  { id: 'menu-press-feedback', run: runOnlineMenuPressFeedbackScenarios },
  { id: 'loading-panels', run: runOnlineLoadingPanelScenarios },
  { id: 'entry-without-die', run: runEntryWithoutDieScenarios },
  { id: 'auth-modal', run: runAuthModalScenarios },
  { id: 'auth-credentials', run: runAuthCredentialScenarios },
  { id: 'account-access', run: runAccountAccessScenarios },
  { id: 'account-game-center', run: runAccountGameCenterScenarios },
  { id: 'account-game-center-blocked', run: runAccountGameCenterBlockedScenarios },
  { id: 'account-error-sheet', run: runAccountErrorSheetScenarios },
  { id: 'profile-rune-sheet', run: runProfileRuneSheetScenarios },
  { id: 'rune-trial', run: runRuneTrialUiScenarios },
  { id: 'rune-trial-rail', run: runRuneTrialRailScenarios },
  { id: 'away-forfeit', run: runAwayForfeitScenarios },
  { id: 'seat-colours', run: runSeatColourScenarios },
  { id: 'equipped-seat', run: runEquippedSeatScenarios },
  { id: 'equipped-seat-interlocks', run: runEquippedSeatInterlockScenarios },
  { id: 'trial-move-latency', run: runTrialMoveLatencyScenarios },
  { id: 'trial-refused-action', run: runTrialRefusedActionScenarios },
  { id: 'ranked-reveal-layout', run: runRankedRevealLayoutScenarios },
  { id: 'flying-die-colour', run: runFlyingDieColourScenarios },
  { id: 'trial-cast-latency', run: runTrialCastLatencyScenarios },
  { id: 'bot-opening-beat', run: runBotOpeningBeatScenarios },
  // Deliberately outside the no-argument gate run: the reward-race probes are
  // a focused investigation surface, reached only through an explicit --only.
  { id: 'rune-reward-races', run: runRuneRewardRaceScenarios, manual: true },
]);
validateScenarioShards('online UI browser', SCENARIOS);
let scenarios;
try {
  scenarios = selectScenarios('online UI browser', SCENARIOS, process.argv.slice(2));
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

const browser = await webkit.launch();
const visit = createVisit({ browser, URL, SESSION, GUEST_ID,
  onHarnessError: (message) => problems.push(message) });
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

try {
  for (const scenario of scenarios) await scenario.run(suite);
} catch (e) {
  problems.push('THREW :: ' + e.message);
}
await browser.close();
await chrome?.close();
emitReport({ out, problems }, problems.length);

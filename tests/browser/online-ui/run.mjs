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
import { createVisit } from './harness/visit.mjs';
import { runMatchmakingScenarios } from './scenarios/matchmaking.mjs';
import { runFreshAccountScenarios } from './scenarios/fresh-account.mjs';
import { runLadderFaceoffScenarios } from './scenarios/ladder-faceoff.mjs';
import { runAccountLifecycleScenarios } from './scenarios/account-lifecycle.mjs';
import { runOnlineMenuPressFeedbackScenarios } from './scenarios/menu-press-feedback.mjs';
import { runOnlineLoadingPanelScenarios } from './scenarios/loading-panels.mjs';
import { runAuthModalScenarios } from './scenarios/auth-modal.mjs';
import { runRuneTrialUiScenarios } from './scenarios/rune-trial-ui.mjs';
import { runRuneRewardRaceScenarios } from './scenarios/rune-reward-races.mjs';

const { webkit } = pkg;
const args = process.argv.slice(2);
const only = args.length === 2 && args[0] === '--only' ? args[1] : null;
if (args.length && !['auth-modal', 'loading-panels', 'rune-trial', 'rune-reward-races'].includes(only)) {
  throw new Error('Usage: run.mjs [--only auth-modal|loading-panels|rune-trial|rune-reward-races]');
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
const visit = createVisit({ browser, URL, SESSION, GUEST_ID });
const suite = { visit, out, check };

try {
  if (only === 'auth-modal') {
    await runAuthModalScenarios(suite);
  } else if (only === 'loading-panels') {
    await runOnlineLoadingPanelScenarios(suite);
  } else if (!only) {
    await runMatchmakingScenarios(suite);
    await runFreshAccountScenarios(suite);
    await runLadderFaceoffScenarios(suite);
    await runAccountLifecycleScenarios(suite);
    await runOnlineMenuPressFeedbackScenarios(suite);
    await runOnlineLoadingPanelScenarios(suite);
    await runAuthModalScenarios(suite);
  }
  if (only === 'rune-reward-races') await runRuneRewardRaceScenarios(suite);
  else if (only === 'rune-trial' || !only) await runRuneTrialUiScenarios(suite);
} catch (e) {
  problems.push('THREW :: ' + e.message);
}
await browser.close();
console.log(JSON.stringify({ out, problems }, null, 2));
process.exit(problems.length ? 1 : 0);

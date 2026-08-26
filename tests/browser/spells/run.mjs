// SPELLS: the optional powers layer, driven the way a player drives it.
//
// The rules of the effects are pinned in tests/spells.test.ts (pure). This
// suite guards the RUNTIME: that the rune only appears where it should, that
// both gestures (tap-to-arm, drag-and-drop) reach the same one gate — for a
// COLUMN spell (PILFER) and for a SELF spell aimed at the die in play (FATE)
// — that the board a player can SEE matches the state after a cast (the
// test13 lesson: assert computed pixels, never merely the DOM), that a charge
// is spent exactly once, and — the promise the feature is built on — that
// switching spells OFF leaves the table indistinguishable from the game
// before spells existed.
import pkg from 'playwright';
/* the registry itself, so the probe compares the SCREEN against the source of
   truth rather than against a count someone typed here (node strips the types) */
import { RANDOM_DUAL_SPELL, SPELLS, RANDOM_SPELL } from '../../../src/core/spells.ts';
import { spellCopy } from '../../../src/i18n/index.ts';
import { createBrowserReport, capturePageErrors } from '../../support/browser-report.mjs';
import { runPickerScenarios } from './scenarios/picker.mjs';
import { runCastingScenarios } from './scenarios/casting.mjs';
import { runTurnPresentationScenarios } from './scenarios/turn-presentation.mjs';
import { runAvailabilityScenarios } from './scenarios/availability.mjs';
import { runEffectScenarios } from './scenarios/effects.mjs';
import { runStageEffectScenarios } from './scenarios/stage-effects.mjs';
import { runSunderOverloadScenarios } from './scenarios/sunder-overload.mjs';
import { runBountyMintScenarios } from './scenarios/bounty-mint.mjs';
import { runPilferAnvilEffectScenarios } from './scenarios/pilfer-anvil-effects.mjs';
import { runProtectionScenarios } from './scenarios/protections.mjs';
import { runLayoutScenarios } from './scenarios/layout.mjs';
import { runScoringWardScenarios } from './scenarios/scoring-ward.mjs';

const SCENARIOS = Object.freeze([
  { id: 'picker', run: runPickerScenarios },
  { id: 'casting', run: runCastingScenarios },
  { id: 'turn-presentation', run: runTurnPresentationScenarios },
  { id: 'availability', run: runAvailabilityScenarios },
  { id: 'effects', run: runEffectScenarios },
  { id: 'stage-effects', run: runStageEffectScenarios },
  { id: 'bounty-mint', run: runBountyMintScenarios },
  { id: 'sunder-overload', run: runSunderOverloadScenarios },
  { id: 'pilfer-anvil-effects', run: runPilferAnvilEffectScenarios },
  { id: 'protections', run: runProtectionScenarios },
  { id: 'scoring-ward', run: runScoringWardScenarios },
  { id: 'layout', run: runLayoutScenarios },
]);

const SHARDS = Object.freeze({
  defense: Object.freeze(['protections', 'availability']),
  interaction: Object.freeze(['picker', 'casting', 'layout']),
  presentation: Object.freeze(['turn-presentation', 'effects', 'stage-effects']),
  advanced: Object.freeze(['bounty-mint', 'sunder-overload', 'pilfer-anvil-effects', 'scoring-ward']),
});

function validateShards() {
  const memberships = new Map(SCENARIOS.map(({ id }) => [id, 0]));
  if (memberships.size !== SCENARIOS.length) {
    throw new Error('Spell browser scenario IDs must be unique');
  }
  for (const [shard, ids] of Object.entries(SHARDS)) {
    for (const id of ids) {
      if (!memberships.has(id)) {
        throw new Error(`Spell browser shard "${shard}" references unknown scenario "${id}"`);
      }
      memberships.set(id, memberships.get(id) + 1);
    }
  }
  for (const [id, count] of memberships) {
    if (count !== 1) {
      throw new Error(`Spell browser scenario "${id}" belongs to ${count} shards; expected exactly one`);
    }
  }
}

function selectedScenarios(argv) {
  if (argv.length === 0) return SCENARIOS;
  if (argv.length !== 2 || !argv[1]) {
    throw new Error('Usage: run.mjs [--only <scenario-id> | --shard <name>]');
  }

  const [flag, value] = argv;
  if (flag === '--only') {
    const scenario = SCENARIOS.find(({ id }) => id === value);
    if (!scenario) throw new Error(`Unknown spell browser scenario "${value}"`);
    return [scenario];
  }
  if (flag === '--shard') {
    const ids = SHARDS[value];
    if (!ids) throw new Error(`Unknown spell browser shard "${value}"`);
    return ids.map((id) => SCENARIOS.find((scenario) => scenario.id === id));
  }
  throw new Error(`Unknown spell browser argument "${flag}"`);
}

validateShards();
let scenarios;
try {
  scenarios = selectedScenarios(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const { chromium, devices } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';   // the single-file build
const browser = await chromium.launch();
const { problems, out, check } = createBrowserReport();
try {
const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true,
    locale: 'en-US' });
const fullRuneCache = {
  version: 1,
  accountId: '11111111-2222-4333-8444-555555555555',
  verifiedAt: 1,
  collected: SPELLS.map(({ id }) => id),
};
await ctx.addInitScript((snapshot) => localStorage.setItem('knucklebones.runes.v1', JSON.stringify(snapshot)),
  fullRuneCache);
  const page = await ctx.newPage();
  capturePageErrors(page, problems);
  await page.goto(F); await page.waitForTimeout(400);

  /* start a two-player face-to-face game: no CPU reply and no hand-off card
     racing the assertions, and no turn clock auto-placing under them */
  const newGame = (opts = {}, pg = page) => pg.evaluate((o) => {
    const k = window.__kb;
    k.S.spell = o.spell === undefined ? 'pilfer' : o.spell;   // the OFFLINE screen's pick
    /* the game MODE is a parameter, not a second helper: the seal probe below
       needs COLUMN SHIELD and a rune in the same game, and a copy of this
       function differing by one number is the duplicate CLAUDE.md forbids */
    k.S.timer = 0; k.S.localMode = o.mode ?? 0; k.S.mode = 'duo'; k.S.seat = 'face';
    /* PIN THE OPENER. Offline, who starts is a coin flip per app load and
       alternates from there (src/state.ts) — right for play, useless for a
       probe: face-to-face keeps the rune in the plate of whoever is NOT to
       move, so a random opener relocates the very thing half these assertions
       measure. This suite is about layout, not seating; test15/18/19 pin
       S.turn for the same reason. Without this the failure is a null
       getBoundingClientRect in whichever block happens to draw the wrong
       side — a flake that reads as a layout regression. */
    k.S.starter = 1;                                          // ME opens every game in this probe
    k.newGame(o.tutorial ? { tutorial: true } : undefined);
    /* Ordinary scenarios assert the ready table, not the opener's real-time
       pause and roll. Invalidate the generation captured by newGame's 650ms
       callback before making that exact settled state synchronously. Tutorial
       pacing is product behaviour, and LIMITED must consume its real die bag,
       so those two paths deliberately keep the authentic opener. */
    if (!o.tutorial && (o.mode ?? 0) !== 6) {
      k.S.gen += 1;
      k.S.turn = 1; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'choose'; k.S.die = o.die ?? 4;
      k.renderAll(false); k.applySides(); k.setStageDie(k.S.die, 1); k.sayChoose(); k.showHints();
    }
  }, opts);
  const waitChoose = async (pg = page) => {
    for (let i = 0; i < 60; i++) {
      if (await pg.evaluate(() => window.__kb.S.phase === 'choose')) return true;
      await pg.waitForTimeout(120);
    }
    return false;
  };
  /* put a known board on the table, mid-turn, with the caster to move.
     THE TRAILING `pg` on these three is what keeps the seal blocks below from
     growing a second copy of the setup: the reduced-motion probe, the two
     orientation probes and the main page are all the same scene, dealt the same
     way, and differ only in the viewport they are dealt onto. */
  const table = (mine, theirs, die = 4, pg = page) => pg.evaluate(([m, t, d]) => {
    const k = window.__kb;
    k.S.boards[1] = m; k.S.boards[0] = t;
    k.S.turn = 1; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'choose'; k.S.die = d;
    k.applySides(); k.renderAll(false); k.setStageDie(d, 1); k.showHints(); k.spells.render();
  }, [mine, theirs, die]);
  /* one ward, placed by hand: §10 above already proves the CAST path, and what
     the seal blocks test is the MARK, not the gesture */
  const guard = (c = 1, who = 0, pg = page) => pg.evaluate(([cc, w]) => {
    window.__kb.S.charm.wards[w][cc] = 1; window.__kb.renderAll(false);
  }, [c, who]);
  /* a second probe page, dressed for one viewport — every seal block that is
     not the main phone borrows this rather than repeating the boot */
  const sidePage = async (view) => {
    const c = await browser.newContext({ hasTouch: true, isMobile: true, deviceScaleFactor: 2,
      locale: 'en-US',
      ...(view.device || { viewport: { width: view.w, height: view.h } }), ...(view.opts || {}) });
    await c.addInitScript((snapshot) => localStorage.setItem('knucklebones.runes.v1', JSON.stringify(snapshot)),
      fullRuneCache);
    await c.addInitScript(() => { const k = 'knucklebones.v1', cf = JSON.parse(localStorage.getItem(k) || '{}'); cf.played = true; localStorage.setItem(k, JSON.stringify(cf)); });
    if (view.noPointer) await c.addInitScript(() => {
      /* Exercise the semantic click seam used by accessibility/legacy hosts,
         not Chromium's default pointer path. */
      Object.defineProperty(window, 'PointerEvent', { configurable: true, value: undefined });
    });
    const p = await c.newPage();
    capturePageErrors(p, problems, view.name);
    await p.goto(F); await p.waitForTimeout(400);
    return { ctx: c, page: p };
  };
  /* what a PLAYER can see, plus the state behind it */
  const look = () => page.evaluate(() => {
    const dice = [...document.querySelectorAll('#topBoard .die,#botBoard .die')];
    const visibleRunes = [...document.querySelectorAll('#spellBar .rune:not([hidden])')]
      .filter((element) => !!element.offsetParent);
    /* Every dealt seat now keeps a physical card, including shared named and
       RANDOM deals. Scenario helpers must drive/read the hand that owns the
       turn; document order deliberately says nothing about which card is on
       top once the two hands trade active/standby depth. */
    const rune = visibleRunes.find((element) => element.classList.contains('hand-active'))
      ?? visibleRunes.find((element) => Number(element.dataset.seat) === window.__kb.S.turn)
      ?? visibleRunes[0];
    return {
      mine: JSON.stringify(window.__kb.S.boards[1]), theirs: JSON.stringify(window.__kb.S.boards[0]),
      charges: JSON.stringify(window.__kb.S.spellCharges),
      armed: window.__kb.S.spellArmed, casting: document.getElementById('kbroot').classList.contains('casting'),
      castself: document.getElementById('kbroot').classList.contains('castself'),
      phase: window.__kb.S.phase, busy: window.__kb.S.busy, die: window.__kb.S.die,
      runeShown: !!rune && !!rune.offsetParent,
      mineHome: rune?.parentElement?.id || rune?.parentElement?.className,
      runeSeat: rune?.dataset.seat ?? null,
      runeClass: rune ? rune.className : null,
      cards: rune ? [...rune.querySelectorAll('.rune-charge')].filter((e) => !e.hidden).length : 0,
      outlines: rune ? [...rune.querySelectorAll('.rune-empty')].filter((e) => !e.hidden).length : 0,
      visibleRunes: visibleRunes.length,
      runes: visibleRunes.map((element) => ({
        seat: element.dataset.seat ?? null, spell: element.dataset.spell ?? null,
        active: element.classList.contains('hand-active'),
        standby: element.classList.contains('hand-standby'),
        cards: [...element.querySelectorAll('.rune-charge')].filter((card) => !card.hidden).length,
        outlines: [...element.querySelectorAll('.rune-empty')].filter((card) => !card.hidden).length,
      })),
      present: dice.length,
      visible: dice.filter(d => getComputedStyle(d).visibility === 'visible' && +getComputedStyle(d).opacity > 0.05).length,
      strays: document.querySelectorAll('body > .die, body > .runeghost').length,
      status: document.getElementById('status').textContent,
      end: document.getElementById('ovEnd').classList.contains('on'),
    };
  });
  const tapCol = (c) => page.tap(`#botBoard .col[data-col="${c}"]`);
  const tapRune = () => page.tap('#spellBar .rune.hand-active:not([hidden])');


  const suite = {
    browser, devices, F, problems, out, check, ctx, page,
    SPELLS, RANDOM_SPELL, RANDOM_DUAL_SPELL, spellCopy, newGame, waitChoose, table, guard, sidePage,
    look, tapCol, tapRune,
  };
  for (const scenario of scenarios) await scenario.run(suite);

  /* Selected runs are the fast iteration/release path. Keep their successful
     report tiny so the parent gate does not buffer and parse hundreds of KB;
     failures retain the full observations needed to diagnose the scenario.
     The no-argument diagnostic contract remains byte-for-shape unchanged. */
  const reportOut = scenarios.length === SCENARIOS.length || problems.length
    ? out : { scenarios: scenarios.map(({ id }) => id) };
  console.log(JSON.stringify({ out: reportOut, problems }, null, 2));
} finally { await browser.close(); }
process.exit(problems.length ? 1 : 0);

// A RANKED RUNE TRIAL, IN MATCH — the authoritative log served from memory.
//
// The online suite could reach the queue, the profile and the result screen,
// but never the ranked TABLE, so nothing in the gate had ever watched a ranked
// turn change hands. One shape here is load-bearing and is copied from the
// deployed server rather than invented: a bot has no request loop, so
// pvp-action commits its whole reply INSIDE the human's own action command
// (supabase/functions/pvp-action/operation.ts — "its optional cast and
// placement join the same atomic action command"). One request therefore
// returns TWO rows and hands the turn straight back, and that batch is what
// the client's replay has to paint.
import { CLASSIC, applyMove, emptyBoard, legalCols } from '../../../../src/core/rules.ts';

export const TRIAL_MATCH_ID = '33333333-3333-4333-8333-333333333333';
const OPPONENT_ID = '44444444-4444-4444-8444-444444444444';

/* One face per seat, forever. The seats never share a value, so no placement
   destroys anything and the projection stays trivially replayable — this
   fixture is about the turn boundary, not about scoring. */
const FACE = Object.freeze({ 0: 5, 1: 2 });

/** Install the in-match routes over an already-installed online stub. Playwright
 *  gives the most recently registered handler precedence, so these deliberately
 *  land after installOnlineRoutes and take over pvp-join and `matches`. */
export async function installTrialMatchRoutes(page, {
  GUEST_ID,
  you = 1,                       // ME(1) is p1: the player opens
  myRune = 'pilfer',
  foeRune = 'pilfer',
  opponentName = 'NovaComet992',
  /* Hold the committed action back, so a probe can tell a board that filled
     at tap time apart from one that waited for the server. */
  actionDelay = 0,
} = {}) {
  const boards = [emptyBoard(), emptyBoard()];
  const rows = [];
  let moveCount = 0;
  let actionCalls = 0;
  const match = {
    id: TRIAL_MATCH_ID,
    p1: GUEST_ID,
    p2: OPPONENT_ID,
    status: 'active',
    turn: 1,
    winner: null,
    p1_score: null,
    p2_score: null,
    p1_rating_delta: null,
    p2_rating_delta: null,
    next_die: FACE[1],
    last_move_at: new Date().toISOString(),
    modifier: 'classic',
    format: 'rune_trial',
    protocol_version: 2,
    rune_rules_version: 1,
    pool_tier: 'bone',
    phase: 'playing',
    p1_rune: myRune,
    p2_rune: foeRune,
    action_version: 0,
    pending_aim: null,
    p1_auto_streak: 0,
    p2_auto_streak: 0,
  };

  const place = (seat, col) => {
    const row = {
      idx: rows.length,
      move_idx: moveCount,
      who: seat,
      kind: 'place',
      rune_id: null,
      target_col: null,
      placed_col: col,
      die_before: match.next_die,
      die_after: FACE[1 - seat],
      created_at: new Date().toISOString(),
    };
    applyMove(boards, seat, col, row.die_before, CLASSIC);
    moveCount++;
    rows.push(row);
    match.turn = 1 - seat;
    match.next_die = row.die_after;
    match.action_version = rows.length;
    match.last_move_at = new Date().toISOString();
    return row;
  };

  await page.route('**/functions/v1/pvp-join', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    /* rejoined + phase 'playing' is the door past the reveal and the private
       selection: the server has already published both runes, so the queue
       hands this straight to enterMatch. */
    body: JSON.stringify({
      status: 'matched',
      you,
      rejoined: true,
      match: { ...match },
      names: {
        p1: 'TestGuest001',
        p2: opponentName,
        ratings: { p1: 1000, p2: 1010 },
        avatars: { p1: null, p2: null },
      },
      trial: {
        offer: [], phase: 'playing', deadline: null,
        your_choice: myRune, opponent_committed: true,
      },
    }),
  }));

  await page.route('**/rest/v1/match_actions*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(rows),
  }));
  await page.route('**/rest/v1/matches*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([match]),
  }));

  await page.route('**/functions/v1/pvp-action', async (route) => {
    actionCalls++;
    if (actionDelay) await new Promise((resolve) => setTimeout(resolve, actionDelay));
    const body = route.request().postDataJSON() ?? {};
    const action = body.action ?? {};
    if (action.kind !== 'place' || !legalCols(boards[match.turn]).includes(action.placed_col)) {
      return route.fulfill({ status: 422, contentType: 'application/json',
        body: JSON.stringify({ error: 'illegal-action' }) });
    }
    const committed = [place(match.turn, action.placed_col)];
    // The bot's whole turn joins this same command, exactly as the server does.
    const botActions = [];
    const legal = legalCols(boards[match.turn]);
    if (legal.length) botActions.push(place(match.turn, legal[0]));
    committed.push(...botActions);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        match: { ...match },
        action_version: match.action_version,
        actions: committed,
        bot_actions: botActions,
        your_die: committed[0].die_before,
      }),
    });
  });

  return {
    trialMatchId: TRIAL_MATCH_ID,
    trialActionCalls: () => actionCalls,
    trialRows: () => rows.map((row) => ({ ...row })),
    trialMatchRow: () => ({ ...match }),
  };
}

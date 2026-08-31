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
import { CLASSIC, applyMove, emptyBoard, freshCharm, legalCols } from '../../../../src/core/rules.ts';
import { spellById } from '../../../../src/core/spells.ts';

export const TRIAL_MATCH_ID = '33333333-3333-4333-8333-333333333333';
const OPPONENT_ID = '44444444-4444-4444-8444-444444444444';

/* One face per seat, forever. The seats never share a value, so no placement
   destroys anything and the projection stays trivially replayable — this
   fixture is about the turn boundary, not about scoring. */
const FACE = Object.freeze({ 0: 5, 1: 2 });
/* What FATE pulls out of the supply. Unlike either seat's face, so a redraw is
   unmistakable in a probe reading the die in hand. */
const FATE_DRAW = 6;

/** Install the in-match routes over an already-installed online stub. Playwright
 *  gives the most recently registered handler precedence, so these deliberately
 *  land after installOnlineRoutes and take over pvp-join and `matches`. */
export async function installTrialMatchRoutes(page, {
  GUEST_ID,
  you = 1,                       // ME(1) is p1: the player opens
  myRune = 'pilfer',
  foeRune = 'pilfer',
  /* Most consumers exercise Rune Trial after its reveal. A fresh standard
     match reuses the same authoritative projection fixture so a reveal probe
     can cross the real queue boundary rather than invoking a UI hook. */
  format = 'rune_trial',
  rejoined = true,
  opponentName = 'NovaComet992',
  /* Hold the committed action back, so a probe can tell a board that filled
     at tap time apart from one that waited for the server. */
  actionDelay = 0,
  /* Refuse the next committed action with this status. Any non-200 that is not
     "uncertain" (status 0, 5xx, or a 200 with no match) takes submit()'s
     refusal branch — 409 is what production actually returns. */
  refuseWith = null,
  /* Make the READ that follows a refusal unable to recover, which is the only
     state in which the client's own refusal handling is load-bearing. A refused
     action resyncs, and installTrialProjection disarms and reopens the turn from
     the log — so a fixture whose read is coherent hides every client-side
     recovery behind the projection. Reporting one action_version more than the
     log holds trips exactly the check that guards a two-read snapshot
     (`projected.actionCount !== match.action_version`), so the projection is
     refused and nothing downstream of it runs. */
  desyncAfterRefusal = false,
  /* Announce the seeded rows as a bot OPENING, the way the real pvp-join does
     when it commits one inside the join/select request. Without this the client
     cannot tell an opener from history and paints it in one silent frame. */
  botOpened = false,
  /* The die the opening seat holds. projectRankedActions always starts at
     ME(1), so seat 1 opens no matter who the viewer is. */
  openingDie = FACE[1],
  /* Placements to commit BEFORE the client ever reads the log, as
     `{ who, col, nextDie }`. The projector replays these for real, so they are
     the only way to hand the viewer a board a rune can act on — ANVIL needs a
     FULL own column holding a die unlike the one in hand, which an empty
     opening board can never satisfy. */
  seedPlacements = [],
} = {}) {
  const boards = [emptyBoard(), emptyBoard()];
  const charm = freshCharm();
  const rows = [];
  let moveCount = 0;
  let joinCalls = 0;
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
    next_die: openingDie,
    last_move_at: new Date().toISOString(),
    modifier: 'classic',
    format,
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

  const commit = (row) => {
    rows.push(row);
    match.action_version = rows.length;
    match.last_move_at = new Date().toISOString();
    return row;
  };

  const place = (seat, col, nextDie = FACE[1 - seat]) => {
    const row = {
      idx: rows.length,
      move_idx: moveCount,
      who: seat,
      kind: 'place',
      rune_id: null,
      target_col: null,
      placed_col: col,
      die_before: match.next_die,
      die_after: nextDie,
      created_at: new Date().toISOString(),
    };
    applyMove(boards, seat, col, row.die_before, CLASSIC, charm);
    moveCount++;
    match.turn = 1 - seat;
    match.next_die = nextDie;
    match.pending_aim = null;
    return commit(row);
  };

  /* A CAST KEEPS THE TURN. Derived by running the registry's own apply(), so
     die_after is whatever the rules say it is — projectRankedActions replays
     this row through the same code and refuses the whole projection if the two
     ever disagree, which is the point of deriving it rather than stating it. */
  const cast = (seat, runeId, targetCol) => {
    const spell = spellById(runeId);
    let die = match.next_die;
    const context = {
      mode: CLASSIC,
      die,
      setDie(value) { die = value; this.die = value; },
      /* FATE is the only rune that reaches this. A fixed face keeps the
         redraw deterministic and visibly different from what was in hand. */
      draw: () => FATE_DRAW,
      bagLeft: null,
      charm,
    };
    if (!spell?.legal(boards, seat, targetCol, context)) return null;
    spell.apply(boards, seat, targetCol, context);
    const row = {
      idx: rows.length,
      move_idx: null,
      who: seat,
      kind: 'cast',
      rune_id: runeId,
      target_col: targetCol,
      placed_col: null,
      die_before: match.next_die,
      die_after: die,
      created_at: new Date().toISOString(),
    };
    match.next_die = die;
    match.pending_aim = null;
    return commit(row);
  };

  /* An aim commits the rune without choosing a column: the die is untouched
     and the seat still owes the log a cast. */
  const aim = (seat, runeId) => {
    const spell = spellById(runeId);
    if (!spell?.commitsOnAim) return null;
    const row = {
      idx: rows.length,
      move_idx: null,
      who: seat,
      kind: 'aim',
      rune_id: runeId,
      target_col: null,
      placed_col: null,
      die_before: match.next_die,
      die_after: match.next_die,
      created_at: new Date().toISOString(),
    };
    match.pending_aim = runeId;
    return commit(row);
  };

  for (const step of seedPlacements) place(step.who, step.col, step.nextDie);

  await page.route('**/functions/v1/pvp-join', (route) => {
    joinCalls++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      /* The fixture defaults to a rejoin past the reveal and private selection.
         A reveal regression can explicitly make this a fresh match instead. */
      body: JSON.stringify({
        status: 'matched',
        you,
        rejoined,
        match: { ...match },
        ...(botOpened ? { bot_actions: rows.map((row) => ({ ...row })) } : {}),
        names: {
          p1: 'TestGuest001',
          p2: opponentName,
          ratings: { p1: 1000, p2: 1010 },
          avatars: { p1: null, p2: null },
        },
        ...(format === 'rune_trial' ? {
          trial: {
            offer: [], phase: 'playing', deadline: null,
            your_choice: myRune, opponent_committed: true,
          },
        } : {}),
      }),
    });
  });

  await page.route('**/rest/v1/match_actions*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(rows),
  }));
  let refused = 0;
  await page.route('**/rest/v1/matches*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([desyncAfterRefusal && refused
      ? { ...match, action_version: match.action_version + 1 }
      : match]),
  }));

  await page.route('**/functions/v1/pvp-action', async (route) => {
    actionCalls++;
    if (actionDelay) await new Promise((resolve) => setTimeout(resolve, actionDelay));
    if (refuseWith) {
      refused++;
      return route.fulfill({ status: refuseWith, contentType: 'application/json',
        body: JSON.stringify({ error: 'refused' }) });
    }
    const body = route.request().postDataJSON() ?? {};
    const action = body.action ?? {};
    const seat = match.turn;
    /* A cast or an aim keeps the turn, so neither draws a bot reply — only a
       placement hands the board over. */
    let mine = null;
    if (action.kind === 'cast') mine = cast(seat, action.rune_id, action.target_col);
    else if (action.kind === 'aim') mine = aim(seat, action.rune_id);
    else if (action.kind === 'place' && legalCols(boards[seat]).includes(action.placed_col)) {
      mine = place(seat, action.placed_col);
    }
    if (!mine) {
      return route.fulfill({ status: 422, contentType: 'application/json',
        body: JSON.stringify({ error: 'illegal-action' }) });
    }
    const committed = [mine];
    // The bot's whole turn joins this same command, exactly as the server does.
    const botActions = [];
    if (mine.kind === 'place') {
      const legal = legalCols(boards[match.turn]);
      if (legal.length) botActions.push(place(match.turn, legal[0]));
    }
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
    trialJoinCalls: () => joinCalls,
    trialActionCalls: () => actionCalls,
    trialRows: () => rows.map((row) => ({ ...row })),
    trialMatchRow: () => ({ ...match }),
  };
}

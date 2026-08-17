// Identity + game-shape configuration. ONE place, so a rename or a new board
// shape is a config change, not a codebase hunt.

/* Rename pending: "Knucklebones" is Cult of the Lamb's minigame — get a legal
   opinion and a new name before store submission or monetisation. */
export const GAME_NAME = 'Knucklebones';

/* Placeholder on purpose — the real bundle/app id is supplied by the owner
   before any store build. Deliberately invalid so it can't ship unnoticed. */
export const APP_ID = 'invalid.appid.TBD';

/* The classic board. Game modes with other shapes (e.g. 4 columns) become a
   different spec carried by the mode — the rules and AI read dimensions from
   here and never hard-code them. Balancing and AI depth budgets are NOT
   automatic: re-measure with tests/bench3.mjs when introducing a new spec. */
export interface BoardSpec {
  readonly cols: number;
  readonly rows: number;
}
export const CLASSIC: BoardSpec = { cols: 3, rows: 3 };

/* Six-sided dice. The scoring formula (value × count²) and the AI's expectation
   averages both derive from this. */
export const DICE_FACES = 6;

/* Online turn clock, seconds. Client-enforced pace: an honest client
   auto-places when it expires; the server's 60s stall forfeit remains the
   backstop for clients that vanish entirely (see pvp-claim / pvp-join). */
export const ONLINE_TURN_SECS = 10;

/* Supabase project — both values are public BY DESIGN (the publishable key is
   made to ship in clients; row security lives in RLS + Edge Functions).
   The online module lazy-loads; nothing here touches the offline boot path. */
export const SUPABASE_URL = 'https://euzjcejbkxvqfrttgaxu.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_xu398Mifx_w42hnJzcD2GA_lxRfVS43';

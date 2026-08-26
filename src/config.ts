// Identity + game-shape configuration. ONE place, so a rename or a new board
// shape is a config change, not a codebase hunt.

/* Rename pending: "Knucklebones" is Cult of the Lamb's minigame — get a legal
   opinion and a new name before store submission or monetisation. */
export const GAME_NAME = 'Knucklebones';

/* Canonical application identifier. Native/Xcode copies cannot import TS, so
   tests/iosship.test.ts fails unless every unavoidable copy matches this. */
export const APP_ID = 'com.appavaria.knucklebones';

/* Installed native identity. App Store Connect and Play Console use the
   separate marketing name below; Capacitor, Info.plist, and Android resources
   copy NATIVE_APP_NAME because those files cannot import TypeScript. */
export const NATIVE_APP_NAME = GAME_NAME;
export const NATIVE_STORE_NAME = 'Knucklebones Neon';

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
   auto-places when it expires; the server's 30s stall forfeit remains the
   backstop for clients that vanish entirely (see pvp-claim / pvp-join). */
export const ONLINE_TURN_SECS = 10;

/* Supabase project — both values are public BY DESIGN (the publishable key is
   made to ship in clients; row security lives in RLS + Edge Functions).
   The online module lazy-loads; nothing here touches the offline boot path. */
export const SUPABASE_PROJECT_REF = 'euzjcejbkxvqfrttgaxu';
export const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
export const SUPABASE_KEY = 'sb_publishable_xu398Mifx_w42hnJzcD2GA_lxRfVS43';
export const SUPABASE_AUTH_STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;

/* Game Center assertions never go directly to the public Edge Function. The
   release build supplies the dedicated Cloudflare Worker origin; an absent
   value keeps Game Center account exchange unavailable rather than bypassing
   the gateway. */
export const IDENTITY_GATEWAY_URL = String(
  (import.meta as ImportMeta & {
    readonly env?: { readonly VITE_IDENTITY_GATEWAY_URL?: string };
  }).env?.VITE_IDENTITY_GATEWAY_URL ?? '',
).replace(/\/$/, '');

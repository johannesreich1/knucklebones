// The HUD's leave control. Practice quits instantly; an online match must arm a
// two-tap forfeit confirm first. The online chunk is lazy-loaded, so boot
// cannot import it — instead the match driver registers an interceptor here
// while a match is live, and boot consults it before quitting to the menu.
type Interceptor = () => boolean;   // true = handled, skip the default quit
let intercept: Interceptor | null = null;

export function setLeaveInterceptor(f: Interceptor | null): void { intercept = f; }
export function requestLeave(): boolean { return intercept ? intercept() : false; }
/* Is there a RANKED match to lose? Registered only while one is live, so the
   quit modal can say what quitting actually costs instead of guessing. */
export const leavingForfeits = (): boolean => intercept !== null;

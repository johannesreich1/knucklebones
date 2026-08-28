// THE RESULT'S SHARE AFFORDANCE — the text, the attempt, and its one word back.
//
// Split out of ui/endscreen.ts: nothing else on the result screen reads any of
// this state, and the screen should not have to know that a clipboard write is
// asynchronous. The whole point of keeping it together is the revision guard —
// a share started on one result may resolve after the next one is on screen,
// and only the module that owns the counter can be sure it never repaints
// "Copied" onto a verdict that did not earn it.
import { $ } from './dom.ts';
import { t } from '../i18n/index.ts';

let shareText = '';
type ShareFeedback = 'idle' | 'copied' | 'copyFailed';
let shareFeedback: ShareFeedback = 'idle';
let shareFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
/* which result is on screen; an in-flight share compares against it */
let presentationRevision = 0;

/** What this result offers to share — absent hides the link. */
export function setShareText(text?: string): void {
  shareText = text ?? '';
  ($('#btnShare') as HTMLButtonElement).hidden = !text;
  repaintShareLabel();
}

/** A different result is being presented (or the screen is closing): the old
    one's pending feedback is not this one's, and any share still in flight for
    it must no longer be able to speak. */
export function resetShare(): void {
  presentationRevision++;
  clearFeedback();
}

export function repaintShareLabel(): void {
  const key = shareFeedback === 'idle' ? 'result.share' : `result.${shareFeedback}` as const;
  $('#btnShare').textContent = t('game', key);
}

export async function shareResult(): Promise<void> {
  const revision = presentationRevision;
  const url = location.origin + location.pathname;
  try {
    if (navigator.share) { await navigator.share({ text: shareText, url }); return; }
    await navigator.clipboard.writeText(shareText + ' ' + url);
    if (presentationRevision === revision) showShareFeedback('copied');
  } catch {
    if (presentationRevision === revision) showShareFeedback('copyFailed');
  }
}

/* clearing the feedback is NOT resetShare: only a new presentation may retire
   the revision, or a second attempt on the same result would find its guard
   already stale and go quiet */
function clearFeedback(): void {
  if (shareFeedbackTimer !== null) clearTimeout(shareFeedbackTimer);
  shareFeedbackTimer = null;
  shareFeedback = 'idle';
}

function showShareFeedback(feedback: Exclude<ShareFeedback, 'idle'>): void {
  clearFeedback();
  shareFeedback = feedback;
  repaintShareLabel();
  shareFeedbackTimer = setTimeout(() => {
    shareFeedbackTimer = null;
    shareFeedback = 'idle';
    repaintShareLabel();
  }, 1500);
}

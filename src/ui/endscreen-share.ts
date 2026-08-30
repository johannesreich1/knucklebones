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
import { LEGAL_RELEASE } from '../legal/config.ts';

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

/* WHERE A SHARED LINK HAS TO POINT. The native builds run the same bundle from
   `https://localhost` (capacitor.config.json sets iosScheme/androidScheme), so
   `location.origin` there is a private address that means nothing to whoever
   receives it — the iOS share copied a link to the recipient's own machine.
   The public origin already has exactly one home, the canonical origin the
   legal pages build their URLs from, so this reads that rather than writing the
   domain down a second time. On the web nothing changes: the page is already
   served from it. */
function shareUrl(): string {
  const here = location.origin + location.pathname;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    || location.protocol === 'capacitor:' || location.protocol === 'file:';
  return local ? `${LEGAL_RELEASE.canonicalOrigin}/` : here;
}

/* THE COPY OF LAST RESORT. navigator.clipboard is not reliably reachable inside
   a WKWebView — it is absent or refuses without a gesture it can see — and
   navigator.share does not exist there at all, so the iOS button had nothing
   left to try and reported failure. execCommand('copy') is deprecated and still
   the one path that works in that shell; it is only ever reached after the
   modern API has already refused. */
function copyByExecCommand(text: string): boolean {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  /* Off-screen but focusable: display:none cannot be selected, and a visible
     field would flash a keyboard open on the device. */
  field.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.appendChild(field);
  try {
    field.select();
    field.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

export async function shareResult(): Promise<void> {
  const revision = presentationRevision;
  const payload = `${shareText} ${shareUrl()}`;
  try {
    if (navigator.share) {
      await navigator.share({ text: shareText, url: shareUrl() });
      return;
    }
  } catch {
    /* A share sheet the player dismissed is not a failure to report. */
    return;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(payload);
    copied = true;
  } catch { /* fall through to the shell that WKWebView does answer */ }
  if (!copied) copied = copyByExecCommand(payload);
  if (presentationRevision === revision) {
    showShareFeedback(copied ? 'copied' : 'copyFailed');
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

// The ask-card: ONE question model mounted in the shared sheet.
//
// Callers differ only in their words, emphasis, and optional guard/action. A
// normal offline duel adds one quiet restart between the way back and the way
// out; forfeiting a ranked match and account questions remain either/or. The
// deletion guard exists because that answer wants a deliberate act, not a
// second tap in the same place the first one landed.
//
// The sheet owns modal geometry, entrance/exit, drag, backdrop, Escape,
// background inertness, and focus restoration. This module owns only the
// question's stable content and answer semantics. It lives in ui/ (not
// online/) because the quit question is offline-reachable, and anything the
// offline game can open must not pull in the online chunk.
import { t } from '../i18n/index.ts';
import { Sfx } from './audio.ts';
import { showSheet, type Sheet } from './sheet.ts';

/** A callback is re-read when the visible card's locale changes. */
export type AskText = string | (() => string);

export interface AskAction {
  label: AskText;
  run: () => void;
}

export interface Ask {
  head: AskText;
  body: AskText;
  confirm: AskText;
  cancel?: AskText;
  /* the destructive answer reads destructive */
  danger?: boolean;
  /* when set, the confirm stays disabled until this is ticked — the guard for
     an answer nobody should be able to give by reflex */
  check?: AskText;
  /* which answer is encouraged. A question guarding a destructive act keeps
     the loud button on the way OUT (default); an INVITATION flips it, so the
     yes wears primary and the no goes quiet. */
  loud?: boolean;
  /** Explicit opener for touch flows, where tapping a button need not focus it. */
  restoreFocus?: HTMLElement | null;
  /* an optional third path. It stays quiet like the trailing answer and runs
     only after the card has dismissed and resolved as cancel (false through
     the compatibility wrapper) to its caller. */
  alternate?: AskAction;
}

let card: HTMLElement | null = null;
function build(): HTMLElement {
  if (card) return card;
  card = document.createElement('div');
  card.className = 'askcard';
  card.innerHTML = `
    <div class="fh" id="askHead"></div>
    <p class="fp" id="askBody"></p>
    <label class="askcheck" id="askCheckRow" hidden>
      <input type="checkbox" id="askCheck"><span id="askCheckText"></span>
    </label>
    <button class="btn soft" id="btnAskYes"></button>
    <button class="btn soft small" id="btnAskAlt" hidden></button>
    <button class="btn primary" id="btnAskNo"></button>`;
  return card;
}

function askElement<T extends HTMLElement = HTMLElement>(selector: string): T {
  return build().querySelector(selector) as T;
}

export type AskOutcome = 'confirm' | 'cancel' | 'dismissed' | 'replaced';

let settle: ((outcome: AskOutcome) => void) | null = null;
let activeAsk: Ask | null = null;
let activeSheet: Sheet | null = null;

const resolveText = (value: AskText): string =>
  typeof value === 'function' ? value() : value;

/** Repaint copy only: checkbox state, focus, actions, and card nodes stay put. */
function repaintAskCopy(spec: Ask): void {
  askElement('#askHead').textContent = resolveText(spec.head);
  askElement('#askBody').textContent = resolveText(spec.body);
  askElement('#btnAskYes').textContent = resolveText(spec.confirm);
  askElement('#btnAskAlt').textContent = spec.alternate ? resolveText(spec.alternate.label) : '';
  askElement('#btnAskNo').textContent = spec.cancel !== undefined
    ? resolveText(spec.cancel)
    : t('common', 'actions.cancel');
  askElement('#askCheckText').textContent = spec.check !== undefined ? resolveText(spec.check) : '';
}

function resolveAsk(outcome: AskOutcome): void {
  activeAsk = null;
  const finish = settle;
  settle = null;
  finish?.(outcome);
}

function answer(
  outcome: AskOutcome,
  restoreOpener = outcome === 'cancel' || outcome === 'dismissed',
): void {
  const sheet = activeSheet;
  activeSheet = null;
  resolveAsk(outcome);
  sheet?.close(restoreOpener);
}

/** Detailed ownership result for callers that must distinguish a player's NO
 * from another component replacing the one shared sheet. Never rejects. */
export function askOutcome(spec: Ask): Promise<AskOutcome> {
  /* A newer question owns the room. Resolve the retired caller distinctly so
     it cannot mistake replacement for the player's cancel and reopen itself. */
  if (activeSheet || settle) answer('replaced');

  const content = build();
  const yes = askElement<HTMLButtonElement>('#btnAskYes');
  const alternate = askElement<HTMLButtonElement>('#btnAskAlt');
  const no = askElement<HTMLButtonElement>('#btnAskNo');
  const action = spec.alternate;
  activeAsk = spec;
  repaintAskCopy(spec);
  alternate.hidden = !action;
  yes.classList.toggle('danger', !!spec.danger);
  /* the un-encouraged answer wears .soft, never .quiet — .quiet is the HOME
     SCREEN's section wrapper (margin-top, flex column), and a button sharing
     that name inherited its 20px margin: the "answers too far apart" report */
  yes.classList.toggle('primary', !!spec.loud);
  yes.classList.toggle('soft', !spec.loud);
  no.classList.toggle('primary', !spec.loud);
  no.classList.toggle('soft', !!spec.loud);
  /* the encouraged answer is the BIG coloured button and it goes FIRST. Any
     alternate sits in the middle, matching the smaller quiet answer that
     trails at the bottom. Markup carries no fixed answer order. */
  yes.classList.toggle('small', !spec.loud);
  no.classList.toggle('small', !!spec.loud);
  yes.parentElement!.append(...(spec.loud
    ? [yes, alternate, no]
    : [no, alternate, yes]));

  const box = askElement<HTMLInputElement>('#askCheck');
  askElement('#askCheckRow').hidden = spec.check === undefined;
  box.checked = false;
  /* the guard: disabled until ticked, and re-armed every time the card opens
     so a previous yes can never carry over */
  yes.disabled = spec.check !== undefined;
  box.onchange = () => { yes.disabled = spec.check !== undefined && !box.checked; };

  yes.onclick = () => { if (yes.disabled) return; Sfx.tap(); answer('confirm'); };
  alternate.onclick = action ? () => {
    Sfx.tap();
    answer('cancel');
    action.run();
  } : null;
  no.onclick = () => { Sfx.tap(); answer('cancel'); };

  const pending = new Promise<AskOutcome>((resolve) => { settle = resolve; });
  let sheet!: Sheet;
  sheet = showSheet({
    content,
    interactive: true,
    cls: 'asksheet',
    label: () => resolveText(spec.head),
    restoreFocus: spec.restoreFocus,
    repaintLocale: () => {
      if (activeAsk === spec) repaintAskCopy(spec);
    },
    /* A sheet gesture is a player dismissal. Let the shared sheet finish its
       own exit flight; onClose is the final fallback for programmatic
       replacement by another caller. */
    onDismiss: () => {
      if (activeSheet === sheet) resolveAsk('dismissed');
    },
    onClose: () => {
      if (activeSheet === sheet) activeSheet = null;
      if (activeAsk === spec) resolveAsk('replaced');
    },
  });
  /* Keep the stable public hook while changing its implementation. Existing
     input/layout contracts and focused browser tests can still identify the
     live question, but it is now visibly and behaviorally the shared sheet. */
  sheet.ov.id = 'ovAsk';
  sheet.ov.classList.add('on');
  activeSheet = sheet;
  return pending;
}

/* Boolean compatibility for ordinary questions: only the affirmative answer
   is true; cancel, dismissal, and replacement all preserve existing callers'
   established false result. */
export async function ask(spec: Ask): Promise<boolean> {
  return await askOutcome(spec) === 'confirm';
}

/* Escape and any other global dismissal are distinct in the detailed API and
   remain false through the compatibility wrapper. */
export function dismissAsk(): void {
  if (!activeSheet) return;
  answer('dismissed');
}

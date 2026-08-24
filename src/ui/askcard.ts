// The ask-card: ONE modal that puts a single question with a way back.
//
// Callers differ only in their words, emphasis, and optional guard/action. A
// normal offline duel adds one quiet restart between the way back and the way
// out; forfeiting a ranked match and account questions remain either/or. The
// deletion guard exists because that answer wants a deliberate act, not a
// second tap in the same place the first one landed.
//
// Lives in ui/ (not online/) because the quit modal is offline-reachable, and
// anything the offline game can open must not pull in the online chunk.
import { $, show, hide } from './dom.ts';
import { Sfx } from './audio.ts';
import { appRoot } from './embed.ts';

export interface AskAction {
  label: string;
  run: () => void;
}

export interface Ask {
  head: string;
  body: string;
  confirm: string;
  cancel?: string;
  /* the destructive answer reads destructive */
  danger?: boolean;
  /* when set, the confirm stays disabled until this is ticked — the guard for
     an answer nobody should be able to give by reflex */
  check?: string;
  /* which answer is encouraged. A question guarding a destructive act keeps
     the loud button on the way OUT (default); an INVITATION flips it, so the
     yes wears primary and the no goes quiet. */
  loud?: boolean;
  /* an optional third path. It stays quiet like the trailing answer and runs
     only after the card has dismissed and resolved as "no" to its caller. */
  alternate?: AskAction;
}

let built = false;
function build(): void {
  if (built) return;
  built = true;
  appRoot().insertAdjacentHTML('beforeend', `
<div class="ov" id="ovAsk">
  <div class="askcard">
    <div class="fh" id="askHead"></div>
    <p class="fp" id="askBody"></p>
    <label class="askcheck" id="askCheckRow" hidden>
      <input type="checkbox" id="askCheck"><span id="askCheckText"></span>
    </label>
    <button class="btn soft" id="btnAskYes"></button>
    <button class="btn soft small" id="btnAskAlt" hidden></button>
    <button class="btn primary" id="btnAskNo"></button>
  </div>
</div>`);
}

let settle: ((ok: boolean) => void) | null = null;

/* Resolves TRUE when the question is answered yes. Never rejects: a dismissed
   question is a no, which is the answer that changes nothing. */
export function ask(spec: Ask): Promise<boolean> {
  build();
  /* every .ov shares one z-index, so paint order is DOM order — and overlays
     injected AFTER the first ask() (the online panel, for one) would otherwise
     cover the question. Re-appending moves the existing node last, so the card
     opens above whatever is on screen, listeners intact. */
  appRoot().appendChild($('#ovAsk'));
  const done = (ok: boolean): void => {
    hide('#ovAsk');
    const f = settle; settle = null;
    f?.(ok);
  };
  /* a question already on screen is answered NO before the next one opens —
     leaving a stale promise unsettled would hang whatever awaited it */
  settle?.(false);

  $('#askHead').textContent = spec.head;
  $('#askBody').textContent = spec.body;
  const yes = $('#btnAskYes') as HTMLButtonElement;
  const alternate = $('#btnAskAlt') as HTMLButtonElement;
  const no = $('#btnAskNo') as HTMLButtonElement;
  const action = spec.alternate;
  yes.textContent = spec.confirm;
  alternate.textContent = action?.label ?? '';
  alternate.hidden = !action;
  no.textContent = spec.cancel ?? 'Cancel';
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

  const box = $('#askCheck') as HTMLInputElement;
  $('#askCheckRow').hidden = !spec.check;
  $('#askCheckText').textContent = spec.check ?? '';
  box.checked = false;
  /* the guard: disabled until ticked, and re-armed every time the card opens
     so a previous yes can never carry over */
  yes.disabled = !!spec.check;
  box.onchange = () => { yes.disabled = !!spec.check && !box.checked; };

  yes.onclick = () => { if (yes.disabled) return; Sfx.tap(); done(true); };
  alternate.onclick = action ? () => {
    Sfx.tap();
    done(false);
    action.run();
  } : null;
  no.onclick = () => { Sfx.tap(); done(false); };

  show('#ovAsk');
  return new Promise<boolean>((resolve) => { settle = resolve; });
}

/* Escape and any other global dismissal answers no. */
export function dismissAsk(): void {
  if (!appRoot().querySelector('#ovAsk')?.classList.contains('on')) return;
  hide('#ovAsk');
  const f = settle; settle = null;
  f?.(false);
}

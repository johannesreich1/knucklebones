// The ask-card: ONE modal that puts a single question with a way back.
//
// Three callers so far and they differ only in their words and whether the
// confirm is guarded — quitting a game, forfeiting a ranked match, deleting an
// account. That last one is the reason the guard exists: an account deletion
// wants a deliberate act, not a second tap in the same place the first one
// landed, which is what a two-tap arm gives you.
//
// Lives in ui/ (not online/) because the quit modal is offline-reachable, and
// anything the offline game can open must not pull in the online chunk.
import { $, show, hide } from './dom.ts';
import { Sfx } from './audio.ts';

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
}

let built = false;
function build(): void {
  if (built) return;
  built = true;
  document.body.insertAdjacentHTML('beforeend', `
<div class="ov" id="ovAsk">
  <div class="askcard">
    <div class="fh" id="askHead"></div>
    <p class="fp" id="askBody"></p>
    <label class="askcheck" id="askCheckRow" hidden>
      <input type="checkbox" id="askCheck"><span id="askCheckText"></span>
    </label>
    <button class="btn quiet" id="btnAskYes"></button>
    <button class="btn primary small" id="btnAskNo"></button>
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
  document.body.appendChild(document.getElementById('ovAsk')!);
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
  const no = $('#btnAskNo') as HTMLButtonElement;
  yes.textContent = spec.confirm;
  no.textContent = spec.cancel ?? 'Cancel';
  yes.classList.toggle('danger', !!spec.danger);
  yes.classList.toggle('primary', !!spec.loud);
  yes.classList.toggle('quiet', !spec.loud);
  no.classList.toggle('primary', !spec.loud);
  no.classList.toggle('quiet', !!spec.loud);

  const box = $('#askCheck') as HTMLInputElement;
  $('#askCheckRow').hidden = !spec.check;
  $('#askCheckText').textContent = spec.check ?? '';
  box.checked = false;
  /* the guard: disabled until ticked, and re-armed every time the card opens
     so a previous yes can never carry over */
  yes.disabled = !!spec.check;
  box.onchange = () => { yes.disabled = !!spec.check && !box.checked; };

  yes.onclick = () => { if (yes.disabled) return; Sfx.tap(); done(true); };
  no.onclick = () => { Sfx.tap(); done(false); };

  show('#ovAsk');
  return new Promise<boolean>((resolve) => { settle = resolve; });
}

/* Escape and any other global dismissal answers no. */
export function dismissAsk(): void {
  if (!document.getElementById('ovAsk')?.classList.contains('on')) return;
  hide('#ovAsk');
  const f = settle; settle = null;
  f?.(false);
}

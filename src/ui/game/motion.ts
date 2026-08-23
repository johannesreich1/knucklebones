// The board's physical language: a die rattles on the centre stage, then the
// visible die flies into its slot. Local and ranked play choose the timing and
// the final face; neither owns another animation implementation.
import { ME, SPEC, type Player } from '../../core/rules.ts';
import { S } from '../../state.ts';
import { Sfx, vibrate } from '../audio.ts';
import { makeGameDie, setStageDie } from '../die.ts';
import { $, faceRotated, slotEl, slotIdx } from '../dom.ts';
import { REDUCED, fxRoot, pin } from '../fx.ts';
import { setStatus } from './turn-state.ts';

export interface RollVisualSpec {
  who: Player;
  durationMs: number;
  tickMs?: number;
  /* Local roll shows a face immediately; ranked reveal waits one tick. */
  leadingTick?: boolean;
  /* FATE resolves immediately under reduced motion but keeps the same pop. */
  scramble?: boolean;
  playRollSound?: boolean;
  vibrateOnReveal?: boolean;
  isCurrent: () => boolean;
  resolveDie: () => number;
}

/* One cancellable roll primitive. Cancellation is deliberately a predicate:
   local play owns a generation, ranked owns a generation + reveal sequence,
   and the animator does not need to know either flow's state vocabulary. */
export function animateStageRoll(spec: RollVisualSpec): Promise<number | null> {
  const stage = $('#dieStage');
  const tickMs = spec.tickMs ?? 60;
  // Reduced motion reveals the resolved face on the first step. Merely
  // shortening the CSS spin still left this JavaScript loop cycling faces.
  const scramble = !REDUCED && (spec.scramble ?? true);
  const started = performance.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  let settled = false;

  stage.classList.toggle('rolling', scramble);
  if (spec.playRollSound ?? true) Sfx.roll();

  return new Promise((resolve) => {
    const settle = (die: number | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearInterval(timer);
      stage.classList.remove('rolling');
      if (die !== null) {
        setStageDie(die, spec.who);
        stage.classList.add('pop');
        setTimeout(() => stage.classList.remove('pop'), 320);
        if (spec.vibrateOnReveal ?? true) vibrate(8);
      }
      resolve(die);
    };

    const step = (): void => {
      if (!spec.isCurrent()) { settle(null); return; }
      if (!scramble || performance.now() - started >= spec.durationMs) {
        settle(spec.resolveDie());
        return;
      }
      setStageDie(1 + ((Math.random() * 6) | 0), spec.who);
      Sfx.tick();
    };

    if (spec.leadingTick || !scramble) step();
    if (!settled) timer = setInterval(step, tickMs);
  });
}

/* Superseding a cosmetic ranked reveal removes its spin immediately; its
   isCurrent predicate clears the timer on the next scheduled tick. */
export function clearStageRoll(): void {
  $('#dieStage').classList.remove('rolling');
}

export async function flyDieToSlot(who: Player, col: number, die: number): Promise<void> {
  // Choosing ends when the die lifts. The next turn writes its own status.
  setStatus('', null);
  const stage = $('#dieStage');
  const source = stage.firstElementChild as HTMLElement | null;
  if (!source) return;
  const target = slotEl(who, col, slotIdx(who, S.boards[who][col].length));
  if (!target || S.boards[who][col].length >= SPEC.rows) return;

  // The caller paints the authoritative board immediately after this returns.
  // Do not manufacture a zero-duration traveller: it can still flash at the
  // root and briefly hides the readable stage die.
  if (REDUCED) return;

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const ghost = makeGameDie(die, who);
  if (faceRotated(who)) ghost.classList.add('p2flip');
  pin(ghost, from);
  fxRoot().appendChild(ghost);
  source.style.opacity = '0';

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const scale = to.width / from.width;
  const animation = ghost.animate([
    { transform: 'translate(0,0) scale(1) rotate(0deg)' },
    {
      transform: `translate(${dx * 0.5}px,${dy * 0.5 - 18}px) scale(${(1 + scale) / 2 * 1.06}) rotate(${who === ME ? -10 : 10}deg)`,
      offset: .55,
    },
    { transform: `translate(${dx}px,${dy}px) scale(${scale}) rotate(0deg)` },
  ], { duration: 300, easing: 'cubic-bezier(.3,.7,.2,1)' });
  await animation.finished.catch(() => undefined);
  ghost.remove();
}

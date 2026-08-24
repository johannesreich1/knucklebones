// The guided first game: scripted rolls, scripted CPU, one lesson per
// player turn. Deterministic, so the whole flow is testable.
import { ME } from '../core/rules.ts';
import { subscribeLocale, t } from '../i18n/index.ts';
import { S } from '../state.ts';
import { $ } from '../ui/dom.ts';
import { Sfx } from '../ui/audio.ts';
import { setTutorialPresentation } from '../ui/game/root-state.ts';
/* ===================== TUTORIAL =====================
   A guided first game. Rolls and CPU moves are scripted so every lesson is
   guaranteed to happen: the player always draws a second 4 for the multiplier
   lesson, and the CPU always has a 5 in its middle column for the destruction
   lesson — wherever the player put their earlier dice. Deterministic, so the
   whole flow is testable. */
let coachResolve: (() => void) | null = null;
let coachCopy: (() => string) | null = null;
export function coachShow(copy: string | (() => string), needTap = false): Promise<void> {
  coachCopy = typeof copy === 'function' ? copy : null;
  $('#coachMsg').textContent = typeof copy === 'function' ? copy() : copy;
  $('#coachHint').hidden = !needTap;
  $('#coach').hidden = false;
  return new Promise<void>((resolve) => {
    if (needTap) coachResolve = resolve;
    else resolve();
  });
}
export function coachHide(): void { $('#coach').hidden = true; coachResolve = null; coachCopy = null; }
export function repaintCoach(): void {
  if (coachCopy) $('#coachMsg').textContent = coachCopy();
}
subscribeLocale(repaintCoach);
export function clearTut(): void {
  S.tut = null;
  setTutorialPresentation(false);
  coachHide();
}
/* next scripted roll for whoever is rolling. After the script, free play
   keeps a thumb on the scale: the student re-rolls low dice once, the
   sparring partner re-rolls high ones — a guided first game should be WON
   (98.6% over 500 simulated games, vs 86% with fair dice). */
export function tutNextRoll(): number {
  const tutorial = S.tut;
  if (!tutorial) throw new Error('tutNextRoll requires an active tutorial');
  const queue = S.turn === ME ? tutorial.prolls : tutorial.crolls;
  if (queue.length) return queue.shift()!;
  let d = 1 + ((Math.random() * 6) | 0);
  if (S.turn === ME ? d <= 2 : d >= 5) d = 1 + ((Math.random() * 6) | 0);
  return d;
}
/* one lesson per player turn, keyed by turn number (board counts shift when
   dice get destroyed, so placements are the wrong key) */
export function tutOnChoose(): void {
  const tutorial = S.tut;
  if (!tutorial) return;
  tutorial.turnNo++;
  tutorial.restrict = null;
  if(tutorial.turnNo===0){
    coachShow(() => t('learn', 'tutorial.lesson1'));
  }else if(tutorial.turnNo===1){
    tutorial.restrict=tutorial.firstCol;
    coachShow(() => t('learn', 'tutorial.lesson2'));
  }else if(tutorial.turnNo===2){
    tutorial.restrict=1;
    coachShow(() => t('learn', 'tutorial.lesson3'));
  }else if(tutorial.turnNo===3){
    coachShow(() => t('learn', 'tutorial.lesson4'));
  }else{
    coachHide();
  }
}
/* the coach banner's tap target -- consumes the pending continue-resolver */
export function coachTap(): void {
  if (coachResolve) {
    const resolve = coachResolve;
    coachResolve = null;
    coachHide();
    Sfx.tap();
    resolve();
  }
}

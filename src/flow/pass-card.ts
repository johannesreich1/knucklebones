// The face-down hand-off presentation. The turn machine controls when it is
// shown; this module keeps its live name and scores locale-aware in place.
import { AI, ME, totalOf, type Player } from '../core/rules.ts';
import { formatNumber } from '../i18n/index.ts';
import { S } from '../state.ts';
import { $, hide, show } from '../ui/dom.ts';
import { colorOf, nameOf } from '../ui/identity.ts';

function scoreOf(player: Player): number {
  return totalOf(S.boards[player], S.bounty[player], S.scoring);
}

function paint(who: Player): void {
  const color = colorOf(who);
  $('#ovPass').style.setProperty('--pc', color);
  const name = $('#passWho');
  name.textContent = nameOf(who);
  name.style.color = color;
  $('#passP1').textContent = formatNumber(scoreOf(ME));
  $('#passP2').textContent = formatNumber(scoreOf(AI));
}

export function showPassCard(who: Player): void {
  paint(who);
  show('#ovPass');
}

export function hidePassCard(): void {
  hide('#ovPass');
}

export function repaintPassLocale(): void {
  if (!$('#ovPass').classList.contains('on') || S.phase !== 'pass') return;
  paint(S.turn);
}

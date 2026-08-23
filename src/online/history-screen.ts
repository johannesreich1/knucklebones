import { $ } from '../ui/dom.ts';
import { loaderWait } from '../ui/loader.ts';
import { recordHtml } from '../ui/record.ts';
import { matchHistory, myLadder, type HistoryRow } from './ladder-api.ts';
import { esc } from './format.ts';
import { showOnlinePanel } from './shell.ts';

export function historyRow(row: HistoryRow): HTMLElement {
  const element = document.createElement('div');
  element.className = 'row history-row ' + row.result;
  const when = row.when
    ? new Date(row.when).toLocaleDateString('en', { day: 'numeric', month: 'short' })
    : '';
  const sign = row.delta > 0 ? '+' : '';
  element.innerHTML =
    `<span class="hres">${row.result === 'win' ? 'W' : row.result === 'loss' ? 'L' : 'D'}</span>`
    + `<span class="nm">${esc(row.opponent)}</span>`
    + `<span class="hsc">${row.mine}–${row.theirs}</span>`
    + `<span class="hd">${sign}${row.delta}</span>`
    + `<span class="hwhen">${when}</span>`;
  return element;
}

export async function showHistory(): Promise<void> {
  showOnlinePanel('onHistory');
  const list = $('#onHistoryList');
  list.innerHTML = '';
  const wait = loaderWait(36);
  wait.classList.add('lbload');
  list.appendChild(wait);
  const ladder = await myLadder();
  $('#onHistoryTotal').innerHTML = ladder
    ? recordHtml(ladder.wins, ladder.losses) + (ladder.draws ? ` · ${ladder.draws}D` : '')
    : '&nbsp;';
  const PAGE = 30;
  const rows = await matchHistory(PAGE);
  list.innerHTML = rows.length ? '' : '<div class="row">No ranked matches yet.</div>';
  for (const row of rows) list.appendChild(historyRow(row));
  let oldest = rows[rows.length - 1] ?? null;
  let done = rows.length < PAGE || !oldest;
  let loading = false;
  list.onscroll = () => {
    if (done || loading) return;
    if (list.scrollTop + list.clientHeight < list.scrollHeight - 300) return;
    loading = true;
    void matchHistory(PAGE, oldest!).then((more) => {
      loading = false;
      if ($('#onHistory').hidden) return;
      for (const row of more) list.appendChild(historyRow(row));
      const last = more[more.length - 1] ?? null;
      done = more.length < PAGE || !last;
      if (last) oldest = last;
    });
  };
}

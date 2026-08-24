import { formatDate, formatNumber, subscribeLocale, t } from '../i18n/index.ts';
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
    ? formatDate(new Date(row.when), { day: 'numeric', month: 'short' })
    : '';
  const sign = row.delta > 0 ? '+' : '';
  element.innerHTML =
    `<span class="hres">${row.result === 'win' ? t('common', 'record.win')
      : row.result === 'loss' ? t('common', 'record.loss') : t('common', 'record.draw')}</span>`
    + `<span class="nm">${esc(row.opponent)}</span>`
    + `<span class="hsc">${formatNumber(row.mine)}–${formatNumber(row.theirs)}</span>`
    + `<span class="hd">${sign}${formatNumber(row.delta)}</span>`
    + `<span class="hwhen">${when}</span>`;
  return element;
}

let visibleRows: HistoryRow[] = [];
let visibleLadder: Awaited<ReturnType<typeof myLadder>> = null;

function paintHistory(): void {
  const panel = document.getElementById('onHistory');
  if (!panel || panel.hidden) return;
  const list = $('#onHistoryList');
  const scrollTop = list.scrollTop;
  $('#onHistoryTotal').innerHTML = visibleLadder
    ? recordHtml(visibleLadder.wins, visibleLadder.losses)
      + (visibleLadder.draws
        ? ` · ${formatNumber(visibleLadder.draws)}${t('common', 'record.draw')}` : '')
    : '&nbsp;';
  list.innerHTML = '';
  if (!visibleRows.length) {
    const empty = document.createElement('div');
    empty.className = 'row';
    empty.textContent = t('online', 'history.empty');
    list.appendChild(empty);
  } else {
    for (const row of visibleRows) list.appendChild(historyRow(row));
  }
  list.scrollTop = scrollTop;
}

subscribeLocale(paintHistory);

export async function showHistory(): Promise<void> {
  showOnlinePanel('onHistory');
  const list = $('#onHistoryList');
  list.innerHTML = '';
  const wait = loaderWait(36);
  wait.classList.add('lbload');
  list.appendChild(wait);
  const ladder = await myLadder();
  visibleLadder = ladder;
  const PAGE = 30;
  const rows = await matchHistory(PAGE);
  visibleRows = rows;
  paintHistory();
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
      visibleRows.push(...more);
      for (const row of more) list.appendChild(historyRow(row));
      const last = more[more.length - 1] ?? null;
      done = more.length < PAGE || !last;
      if (last) oldest = last;
    });
  };
}

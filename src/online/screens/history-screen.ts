import { formatDate, formatNumber, subscribeLocale, t } from '../../i18n/index.ts';
import { $, byId } from '../../ui/dom.ts';
import { recordHtml } from '../../ui/record.ts';
import { mountVirtualList, type VirtualList } from '../../ui/virtual-list.ts';
import { matchHistory, myLadder, type HistoryRow } from '../api/ladder-api.ts';
import { esc } from './format.ts';
import { isOnlinePanelCurrent, showOnlinePanel } from './shell.ts';

/* ONE ROW, TWO HOMES. The panel's list mounts a window of these, and the
   profile's PAST DUELS section (account-screen.ts) builds its three by hand —
   a fixed, unvirtualised three, because there is nothing there to scroll. So
   the row is split into the element and the paint, and historyRow() below
   composes them for the profile: one implementation, with the difference named
   rather than copied. */
export function historyElement(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'row history-row';
  return element;
}

export function paintHistoryRow(element: HTMLElement, row: HistoryRow): void {
  /* className is rewritten WHOLESALE, not appended to: the result decides the
     row's colour (.hres and .hd in history.css), and a slot that kept a stale
     win/loss/draw from the row it showed before would paint the wrong one. */
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
}

export function historyRow(row: HistoryRow): HTMLElement {
  const element = historyElement();
  paintHistoryRow(element, row);
  return element;
}

let visibleLadder: Awaited<ReturnType<typeof myLadder>> = null;

/* The tally heads the list but is not IN it, so the window knows nothing about
   it. Repainting only the mounted slots would leave it frozen in the previous
   language — stale words AND stale number formatting — so it is painted here,
   beside them, on the same signal. */
function paintTotal(): void {
  const total = byId('onHistoryTotal');
  if (!total) return;
  total.innerHTML = visibleLadder
    ? recordHtml(visibleLadder.wins, visibleLadder.losses)
      + (visibleLadder.draws
        ? ` · ${formatNumber(visibleLadder.draws)}${t('common', 'record.draw')}` : '')
    : '&nbsp;';
}

let virtual: VirtualList | null = null;
let showRevision = 0;

subscribeLocale(() => {
  const panel = byId('onHistory');
  if (!panel || panel.hidden) return;
  paintTotal();
  virtual?.repaint();
});

export async function showHistory(): Promise<void> {
  const run = ++showRevision;
  showOnlinePanel('onHistory');
  const list = $('#onHistoryList');
  /* THE SCROLLER IS THE PAGE, NOT THIS LIST. #ovOnline.listview .lb is
     overflow:visible (ladder.css), so #onHistoryList has no scrolling box: the
     old list.onscroll never fired and match history silently stopped at its
     first page for every player with more than thirty season matches.
     ladder-screen and account-screen were both moved to closest('.pbody')
     during the paged-view refactor; this one was missed. */
  const scroller = list.closest<HTMLElement>('.pbody');
  if (!scroller) throw new Error('history page scroller is missing');
  virtual?.destroy();
  virtual = null;
  list.innerHTML = '';

  visibleLadder = await myLadder();
  if (run !== showRevision || !isOnlinePanelCurrent('onHistory')) return;
  paintTotal();

  const PAGE = 30;
  /* Fetched here rather than by the window, so the list is revealed with rows
     on it and the empty line — which is not a slot, because the window owns the
     list's children — can be decided from the one page that settles it. */
  const opening = await matchHistory(PAGE);
  if (run !== showRevision || !isOnlinePanelCurrent('onHistory')) return;
  const emptyLine = byId('onHistoryEmpty');
  if (emptyLine) emptyLine.hidden = opening.length > 0;

  virtual = mountVirtualList<HistoryRow>({
    scroller,
    list,
    page: PAGE,
    /* Match history has no count and no random access — the RPC offers only a
       strictly-older keyset cursor. So: no `before`, no `seek`, and the end is
       DISCOVERED from a short page. A source with no seek simply cannot be
       jumped into, which is the honest behaviour for a list whose thumb cannot
       be turned back into a query. */
    total: null,
    seed: { rows: opening, position: 0 },
    alive: () => run === showRevision && isOnlinePanelCurrent('onHistory'),
    source: {
      after: async (anchor, count) => ({
        /* least(greatest(limit_n,1),100) in SQL: asking for more than 100 would
           come back short and be read as the end of the list. */
        rows: await matchHistory(Math.min(count, 100), anchor?.item),
        position: anchor ? anchor.position + 1 : 0,
      }),
    },
    slots: {
      key: (row) => row.id,
      create: historyElement,
      render: (element, row) => paintHistoryRow(element, row),
      pending: (element) => {
        element.className = 'row history-row';
        element.setAttribute('aria-hidden', 'true');
        element.innerHTML = '<span class="nm">&nbsp;</span>';
      },
    },
  });
  await virtual.ready;
}

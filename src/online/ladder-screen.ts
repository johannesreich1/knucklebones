import { groupFill, boardGroup } from '../core/ladder.ts';
import {
  formatNumber,
  ladderGroupName,
  subscribeLocale,
  t,
} from '../i18n/index.ts';
import { Sfx } from '../ui/audio.ts';
import { $ } from '../ui/dom.ts';
import { paintAvatar } from '../ui/avatar.ts';
import { recordHtml } from '../ui/record.ts';
import {
  leaderboard,
  leaderboardBefore,
  myLadder,
  myStanding,
  type LeaderboardRow,
} from './ladder-api.ts';
import { myProfile } from './session.ts';
import { esc, pts, rank } from './format.ts';
import { showFaceoff } from './faceoff.ts';
import { isOnlinePanelCurrent, showOnlineLoading, showOnlinePanel } from './shell.ts';

interface LadderPorts {
  showAccount(): Promise<void>;
  getExit(): () => void;
  setExit(next: () => void): void;
}

export interface LadderScreen {
  show(): Promise<void>;
}

const gapHtml = (distance: number): string =>
  distance > 0 ? `<span class="gap"><b>${esc(t('online', 'ladder.onYou', { points: pts(distance) }))}</b></span>`
  : distance < 0 ? `<span class="gap"><b class="down">${esc(t('online', 'ladder.behind', { points: pts(-distance) }))}</b></span>`
  : `<span class="gap">${esc(t('online', 'ladder.levelWithYou'))}</span>`;

function centerInScroller(scroller: HTMLElement, target: HTMLElement): void {
  const scrollBox = scroller.getBoundingClientRect();
  const targetBox = target.getBoundingClientRect();
  const contentCenter = scroller.scrollTop + targetBox.top - scrollBox.top + targetBox.height / 2;
  const desired = contentCenter - scroller.clientHeight / 2;
  const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  scroller.scrollTop = Math.max(0, Math.min(maximum, desired));
}

export function createLadderScreen(ports: LadderPorts): LadderScreen {
  let paintVisible: (() => void) | null = null;
  let showRevision = 0;
  subscribeLocale(() => {
    const panel = document.getElementById('onBoard');
    if (panel && !panel.hidden) paintVisible?.();
  });

  async function show(): Promise<void> {
    const run = ++showRevision;
    paintVisible = null;
    showOnlineLoading('onBoard');
    const list = $('#onBoardList');
    const scroller = list.closest<HTMLElement>('.pbody');
    if (!scroller) throw new Error('ladder page scroller is missing');
    scroller.onscroll = null;
    list.innerHTML = '';
    const PAGE = 50;
    const ABOVE_ME = 20;
    const [me, ladder, standing] = await Promise.all([myProfile(), myLadder(), myStanding()]);
    let topDry = true;
    let rows: LeaderboardRow[];
    if (me && standing?.rank) {
      const prior = await leaderboardBefore(ABOVE_ME, standing.rank, me.nickname);
      topDry = prior.length < ABOVE_ME;
      const anchor = prior[prior.length - 1];
      const tail = anchor
        ? await leaderboard(PAGE - prior.length, Number(anchor.rank), anchor.nickname)
        : await leaderboard(PAGE, standing.rank);
      rows = [...prior, ...tail];
    } else {
      rows = await leaderboard(PAGE);
    }
    if (run !== showRevision || !isOnlinePanelCurrent('onBoard')) return;
    list.innerHTML = '';
    let empty: HTMLElement | null = null;
    if (!rows.length) {
      empty = document.createElement('div');
      empty.className = 'row';
      list.appendChild(empty);
    }
    const myRow = me ? rows.find((row) => row.nickname === me.nickname) ?? null : null;
    const myGroup = myRow
      ? boardGroup(myRow.points, myRow.apex)
      : ladder ? boardGroup(ladder.points, false) : null;
    let meElement: HTMLElement | null = null;
    const rowViews: Array<{
      button: HTMLButtonElement;
      row: LeaderboardRow;
      group: ReturnType<typeof boardGroup>;
      isMe: boolean;
    }> = [];
    const horizonViews: Array<{
      element: HTMLElement;
      group: ReturnType<typeof boardGroup>;
    }> = [];

    const paintRow = (view: typeof rowViews[number]): void => {
      const { button, row, group, isMe } = view;
      const groupName = ladderGroupName(group.id);
      button.setAttribute('aria-label', isMe
        ? t('online', 'ladder.openProfile', {
          name: row.nickname,
          rank: rank(row.rank),
          group: groupName,
        })
        : t('online', 'ladder.comparePlayer', {
          name: row.nickname,
          rank: rank(row.rank),
          group: groupName,
          points: pts(row.points),
        }));
      if (isMe) {
        const state = row.apex ? t('online', 'ladder.topOnePercent')
          : t('online', 'ladder.progress', {
            percent: formatNumber(Math.round(groupFill(row.points) * 100)),
          });
        button.innerHTML = `<span class="av"></span><span class="nmwrap"><span class="nm">${esc(row.nickname)}</span>`
          + `<span class="mesub"><b>${esc(groupName)}</b> · ${esc(state)} · ${recordHtml(row.wins, row.losses)}</span></span>`
          + `<span class="ptcol"><span class="pt2">${pts(row.points)}</span><span class="rk2">${esc(t('online', 'ladder.rank', { rank: rank(row.rank) }))}</span></span>`;
      } else {
        const middle = ladder ? gapHtml(row.points - ladder.points)
          : `<span class="ws">${recordHtml(row.wins, row.losses)}</span>`;
        button.innerHTML = `<span class="rank">${formatNumber(row.rank)}</span><span class="av"></span>`
          + `<span class="nm">${esc(row.nickname)}</span>${middle}<span class="rt">${pts(row.points)}</span>`;
      }
      paintAvatar(button.querySelector('.av') as HTMLElement, row.avatar, isMe ? 34 : 24);
    };

    const paintHorizon = (view: typeof horizonViews[number]): void => {
      const { element, group } = view;
      const sub = group.id === 'neon' ? t('online', 'ladder.topOnePercent')
        : group.floor === 0 ? t('online', 'ladder.floorZero')
        : t('online', 'ladder.andUp', { points: pts(group.floor) });
      element.innerHTML = `<span class="gn">${esc(ladderGroupName(group.id))}</span>`
        + `<span class="gf">${esc(sub)}${ladder && myGroup === group
          ? ` · ${esc(t('online', 'ladder.yourGroup'))}` : ''}</span>`;
    };

    paintVisible = (): void => {
      if (empty) empty.textContent = t('online', 'ladder.empty');
      for (const view of rowViews) paintRow(view);
      for (const view of horizonViews) paintHorizon(view);
    };
    paintVisible();

    const rowElement = (
      row: LeaderboardRow,
      group: ReturnType<typeof boardGroup>,
    ): HTMLElement => {
      const isMe = !!me && row.nickname === me.nickname;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lrow' + (isMe ? ' me' : '');
      button.style.setProperty('--gc', `var(--g-${group.id})`);
      const view = { button, row, group, isMe };
      rowViews.push(view);
      paintRow(view);
      if (isMe) meElement = button;
      button.addEventListener('click', () => {
        Sfx.tap();
        if (isMe) {
          const back = ports.getExit();
          ports.setExit(() => {
            ports.setExit(back);
            showOnlinePanel('onBoard');
          });
          void ports.showAccount();
          return;
        }
        showFaceoff(row, me && ladder
          ? { name: me.nickname, avatar: me.avatar ?? null, lad: ladder }
          : null);
      });
      return button;
    };

    const horizonElement = (group: ReturnType<typeof boardGroup>): HTMLElement => {
      const horizon = document.createElement('div');
      horizon.className = 'ghor' + (group.id === 'neon' ? ' apex' : '');
      horizon.style.setProperty('--gc', `var(--g-${group.id})`);
      const view = { element: horizon, group };
      horizonViews.push(view);
      paintHorizon(view);
      horizon.dataset.g = group.id;
      return horizon;
    };

    const seen = new Set<string>();
    const chunk = (
      page: LeaderboardRow[],
      previous: string,
    ): { frag: DocumentFragment; last: string; first: string } => {
      const frag = document.createDocumentFragment();
      let horizon = previous;
      let first = '';
      for (const row of page) {
        if (seen.has(row.nickname)) continue;
        seen.add(row.nickname);
        const group = boardGroup(row.points, row.apex);
        if (!first) first = group.id;
        if (group.id !== horizon) {
          horizon = group.id;
          frag.appendChild(horizonElement(group));
        }
        frag.appendChild(rowElement(row, group));
      }
      return { frag, last: horizon, first };
    };

    const head = chunk(rows, '');
    list.appendChild(head.frag);
    let topCursor = rows.length
      ? { rank: Number(rows[0].rank), nickname: rows[0].nickname }
      : { rank: 1, nickname: '' };
    let bottomCursor = rows.length
      ? { rank: Number(rows[rows.length - 1].rank), nickname: rows[rows.length - 1].nickname }
      : { rank: 1, nickname: '' };
    let bottomGroup = head.last;
    let bottomDry = rows.length < PAGE;
    let loading = false;

    const growDown = (): void => {
      if (bottomDry || loading) return;
      loading = true;
      void leaderboard(PAGE, bottomCursor.rank, bottomCursor.nickname).then((page) => {
        loading = false;
        if (run !== showRevision || !isOnlinePanelCurrent('onBoard')) return;
        const fresh = page.filter((row) => !seen.has(row.nickname));
        bottomDry = page.length < PAGE;
        if (page.length) {
          const last = page[page.length - 1];
          bottomCursor = { rank: Number(last.rank), nickname: last.nickname };
        }
        if (fresh.length) {
          const next = chunk(page, bottomGroup);
          bottomGroup = next.last;
          list.appendChild(next.frag);
        }
        if (scroller.scrollHeight <= scroller.clientHeight + 60) {
          if (!bottomDry) growDown();
          else growUp();
        }
      });
    };

    const growUp = (): void => {
      if (topDry || loading) return;
      loading = true;
      void leaderboardBefore(PAGE, topCursor.rank, topCursor.nickname).then((page) => {
        loading = false;
        if (run !== showRevision || !isOnlinePanelCurrent('onBoard')) return;
        const fresh = page.filter((row) => !seen.has(row.nickname));
        topDry = page.length < PAGE;
        if (page.length) {
          const first = page[0];
          topCursor = { rank: Number(first.rank), nickname: first.nickname };
        }
        if (!fresh.length) return;
        const next = chunk(fresh, '');
        const oldHead = list.firstElementChild as HTMLElement | null;
        if (oldHead?.classList.contains('ghor') && oldHead.dataset.g === next.last) oldHead.remove();
        const before = scroller.scrollHeight;
        list.insertBefore(next.frag, list.firstChild);
        scroller.scrollTop += scroller.scrollHeight - before;
        if (scroller.scrollHeight <= scroller.clientHeight + 60 && !topDry) growUp();
      });
    };

    scroller.onscroll = () => {
      if (run !== showRevision || !isOnlinePanelCurrent('onBoard')) return;
      if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 400) growDown();
      else if (scroller.scrollTop < 400) growUp();
    };
    showOnlinePanel('onBoard');
    if (scroller.scrollHeight <= scroller.clientHeight + 60) {
      if (!bottomDry) growDown();
      else growUp();
    }
    if (meElement) centerInScroller(scroller, meElement);
  }

  return { show };
}

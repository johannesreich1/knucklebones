import { groupFill, boardGroup, rk } from '../core/ladder.ts';
import { Sfx } from '../ui/audio.ts';
import { $ } from '../ui/dom.ts';
import { loaderDie, loaderWait } from '../ui/loader.ts';
import { paintAvatar } from '../ui/avatar.ts';
import { recordHtml } from '../ui/record.ts';
import { showSheet } from '../ui/sheet.ts';
import {
  leaderboard,
  leaderboardBefore,
  myLadder,
  myStanding,
  bestStreak,
  playerCard,
  type Ladder,
  type LeaderboardRow,
} from './ladder-api.ts';
import { myProfile } from './session.ts';
import { esc, pts } from './format.ts';
import { showOnlinePanel } from './shell.ts';

export interface MySide {
  name: string;
  avatar: string | null;
  lad: Ladder;
}

interface LadderPorts {
  showAccount(): Promise<void>;
  getExit(): () => void;
  setExit(next: () => void): void;
}

export interface LadderScreen {
  show(): Promise<void>;
}

const gapHtml = (distance: number): string =>
  distance > 0 ? `<span class="gap"><b>+${pts(distance)}</b> on you</span>`
  : distance < 0 ? `<span class="gap"><b class="down">−${pts(-distance)}</b> behind</span>`
  : '<span class="gap">level with you</span>';

export function createLadderScreen(ports: LadderPorts): LadderScreen {
  async function show(): Promise<void> {
    showOnlinePanel('onBoard');
    const list = $('#onBoardList');
    list.innerHTML = '';
    const wait = loaderWait(44);
    wait.classList.add('lbload');
    list.appendChild(wait);
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
    list.innerHTML = rows.length ? '' : '<div class="row">No ranked games yet — be the first!</div>';
    const myRow = me ? rows.find((row) => row.nickname === me.nickname) ?? null : null;
    const myGroup = myRow
      ? boardGroup(myRow.points, myRow.apex)
      : ladder ? boardGroup(ladder.points, false) : null;
    let meElement: HTMLElement | null = null;

    const rowElement = (
      row: LeaderboardRow,
      group: ReturnType<typeof boardGroup>,
    ): HTMLElement => {
      const isMe = !!me && row.nickname === me.nickname;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lrow' + (isMe ? ' me' : '');
      button.style.setProperty('--gc', `var(--g-${group.id})`);
      button.setAttribute('aria-label', isMe
        ? `${row.nickname} — you, rank ${row.rank}, ${group.name}. Open your profile`
        : `${row.nickname}, rank ${row.rank}, ${group.name}, ${pts(row.points)} points. Compare`);
      if (isMe) {
        const state = row.apex ? 'top 1%' : `${Math.round(groupFill(row.points) * 100)}% through`;
        button.innerHTML = `<span class="av"></span><span class="nmwrap"><span class="nm">${esc(row.nickname)}</span>`
          + `<span class="mesub"><b>${group.name}</b> · ${state} · ${recordHtml(row.wins, row.losses)}</span></span>`
          + `<span class="ptcol"><span class="pt2">${pts(row.points)}</span><span class="rk2">Rank ${rk(row.rank)}</span></span>`;
        meElement = button;
      } else {
        const middle = ladder ? gapHtml(row.points - ladder.points)
          : `<span class="ws">${recordHtml(row.wins, row.losses)}</span>`;
        button.innerHTML = `<span class="rank">${row.rank}</span><span class="av"></span>`
          + `<span class="nm">${esc(row.nickname)}</span>${middle}<span class="rt">${pts(row.points)}</span>`;
      }
      paintAvatar(button.querySelector('.av') as HTMLElement, row.avatar, isMe ? 34 : 24);
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
      const sub = group.id === 'neon' ? 'top 1%'
        : group.floor === 0 ? 'the floor is 0'
        : `${pts(group.floor)} and up`;
      horizon.innerHTML = `<span class="gn">${group.name}</span>`
        + `<span class="gf">${sub}${ladder && myGroup === group ? ' · your group' : ''}</span>`;
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
        if ($('#onBoard').hidden) return;
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
        if (list.scrollHeight <= list.clientHeight + 60) {
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
        if ($('#onBoard').hidden) return;
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
        const before = list.scrollHeight;
        list.insertBefore(next.frag, list.firstChild);
        list.scrollTop += list.scrollHeight - before;
        if (list.scrollHeight <= list.clientHeight + 60 && !topDry) growUp();
      });
    };

    list.onscroll = () => {
      if (list.scrollTop + list.clientHeight > list.scrollHeight - 400) growDown();
      else if (list.scrollTop < 400) growUp();
    };
    if (list.scrollHeight <= list.clientHeight + 60) {
      if (!bottomDry) growDown();
      else growUp();
    }
    (meElement as HTMLElement | null)?.scrollIntoView({ block: 'center' });
  }

  return { show };
}

export function showFaceoff(row: LeaderboardRow, mine: MySide | null): void {
  const group = boardGroup(row.points, row.apex);
  const myGroup = mine ? boardGroup(mine.lad.points, false) : null;
  const myGames = mine ? mine.lad.wins + mine.lad.losses + mine.lad.draws : 0;
  const rate = (wins: number, games: number): string => games
    ? Math.round((wins / games) * 100) + '%' : '–';
  const stat = (key: string, theirs: string, ours?: string | false | null): string =>
    `<div class="fost"><span class="a">${theirs}</span><span class="k">${key}</span>`
    + (mine ? `<span class="b">${ours || '–'}</span>` : '') + '</div>';
  const { ov } = showSheet({
    cls: mine ? undefined : 'solo',
    label: row.nickname,
    body: `<div class="focols dice-static">
      <div class="focol" style="--gc:var(--g-${group.id})">
        <span class="av"></span><span class="fnm">${esc(row.nickname)}</span>
        <span class="gpill">${group.name} · ${rk(row.rank)}</span>
      </div>` + (mine ? `
      <span class="fovs">VS</span>
      <div class="focol you" style="--gc:var(--g-${myGroup!.id})">
        <span class="av"></span><span class="fnm">${esc(mine.name)}</span>
        <span class="gpill">${myGroup!.name}</span>
      </div>` : '') + `
    </div>
    <div class="fostats">
      ${stat('Points', pts(row.points), mine && pts(mine.lad.points))}
      ${stat('Record', recordHtml(row.wins, row.losses), mine && recordHtml(mine.lad.wins, mine.lad.losses))}
      ${stat('Best streak', '<span class="fostreak">–</span>', mine && '<span class="mystreak">–</span>')}
      ${stat('Peak', pts(row.peak), mine && pts(mine.lad.peak))}
      ${stat('Win rate', rate(row.wins, row.games), mine && rate(mine.lad.wins, myGames))}
    </div>`,
  });
  for (const selector of mine ? ['.fostreak', '.mystreak'] : ['.fostreak']) {
    (ov.querySelector(selector) as HTMLElement).replaceChildren(loaderDie(16));
  }
  paintAvatar(ov.querySelector('.focol .av') as HTMLElement, row.avatar, 46);
  if (mine) paintAvatar(ov.querySelector('.focol.you .av') as HTMLElement, mine.avatar, 46);
  void Promise.all([
    playerCard(row.nickname),
    mine ? bestStreak() : null,
    mine ? myStanding() : null,
  ]).then(([card, streak, standing]) => {
    const theirStreak = ov.querySelector('.fostreak');
    if (theirStreak) theirStreak.textContent = card ? String(card.streak) : '–';
    if (!mine) return;
    const myStreak = ov.querySelector('.mystreak');
    if (myStreak && streak != null) myStreak.textContent = String(streak);
    const groupPill = ov.querySelector('.focol.you .gpill');
    if (groupPill && standing) groupPill.textContent += ` · ${rk(standing.rank)}`;
  });
}

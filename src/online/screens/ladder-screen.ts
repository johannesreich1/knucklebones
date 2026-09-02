import { groupFill, boardGroup, inApex } from '../../core/ladder.ts';
import {
  formatNumber,
  ladderGroupName,
  subscribeLocale,
  t,
} from '../../i18n/index.ts';
import { Sfx } from '../../ui/audio.ts';
import { $, byId } from '../../ui/dom.ts';
import { paintAvatar } from '../../ui/avatar.ts';
import { refreshHomeChip } from '../../ui/homechip.ts';
import { recordHtml } from '../../ui/record.ts';
import { cacheStanding } from '../../profile-cache.ts';
import {
  mountVirtualList,
  type VirtualList,
  type VirtualPage,
  type VirtualPlace,
} from '../../ui/virtual-list.ts';
import {
  ladderPage,
  ladderPageBefore,
  myLadderLookup,
  myStandingLookup,
  type LadderRow,
} from '../api/ladder-api.ts';
import { myProfile } from '../identity/profile.ts';
import { currentUser } from '../identity/session.ts';
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

/* A row the board has not handed us yet. It stands at the height the ruler
   assumed for it, so the page it lands on does not jump when it arrives. */
const tombstoneHtml = (position: number): string =>
  `<span class="rank">${formatNumber(position + 1)}</span><span class="av"></span>`
  + '<span class="nm">&nbsp;</span>';

export function createLadderScreen(ports: LadderPorts): LadderScreen {
  let virtual: VirtualList | null = null;
  let showRevision = 0;
  subscribeLocale(() => {
    const panel = byId('onLadder');
    if (panel && !panel.hidden) virtual?.repaint();
  });

  async function show(): Promise<void> {
    const run = ++showRevision;
    showOnlineLoading('onLadder');
    const listElement = $('#onLadderList');
    const scroller = listElement.closest<HTMLElement>('.pbody');
    if (!scroller) throw new Error('ladder page scroller is missing');
    virtual?.destroy();
    virtual = null;
    listElement.innerHTML = '';

    const [profile, ladderResult, standingResult] = await Promise.all([
      myProfile(), myLadderLookup(), myStandingLookup(),
    ]);
    const boundaryUser = await currentUser();
    if (run !== showRevision || !isOnlinePanelCurrent('onLadder')) return;
    const accountId = profile?.id.toLowerCase() ?? null;
    const coherent = !!accountId && ladderResult.ok
      && ladderResult.accountId === accountId
      && boundaryUser?.id.toLowerCase() === accountId;
    const me = coherent ? profile : null;
    const ladderBase = coherent && ladderResult.ok ? ladderResult.ladder : null;
    const standing = coherent && standingResult.ok
        && standingResult.accountId === accountId
      ? standingResult.standing : null;
    const ladder = ladderBase && standing
      ? { ...ladderBase, points: standing.points } : ladderBase;
    const mineApex = !!standing && inApex(
      standing.points, standing.rank, standing.population,
    );

    if (me && standingResult.ok && standingResult.accountId === accountId) {
      cacheStanding(me.id, standing, mineApex);
      refreshHomeChip();
    }

    const alive = () => run === showRevision && isOnlinePanelCurrent('onLadder');
    const myGroup = ladder ? boardGroup(ladder.points, mineApex) : null;
    /* Which row a mounted button is showing right now. A slot outlives any one
       item — a tombstone becomes a row, and a shifting board can re-seat it —
       so the tap has to read the CURRENT row rather than close over the first. */
    const showing = new WeakMap<HTMLElement, LadderRow>();

    /* ---- the board, as a sequence ---------------------------------------
       Positions come from the RPC's dense `pos` (migration 20260827203007),
       never from `rank`: rank() gaps after ties, and leaderboard_before's
       cursor enters a tie group PART-WAY, so its first row is the k-th member
       and rank-1 understates the position by k. Where an older deployment
       answers without `pos`, we fall back to counting from the cursor, which
       is exactly as wrong as it always was and no worse. */
    const positioned = (rows: LadderRow[], fallback: number): VirtualPage<LadderRow> => {
      const head = rows[0];
      if (head?.population !== undefined) virtual?.setTotal(head.population);
      return {
        rows,
        position: head?.pos !== undefined ? head.pos - 1 : fallback,
      };
    };

    const PAGE = 25;
    /* THE OPENING PAGE COVERS THE WHOLE MOUNTED WINDOW. Crawling wants small
       pages — a 25-row splice is about one frame — but OPENING with one leaves
       most of the window standing as tombstones until a second round trip
       lands, and a tombstone is not the height of the row it stands in for
       (your own row is half again as tall). The modelled total then moves as
       they fill, and the bottom padding visibly resettles under the reader
       (user report, at 132 of 153). Measured: 65 slots mounted, 40 of them
       tombstones. 100 is the RPC's own ceiling and covers the window on any
       phone; the rows are small and it is one request either way. */
    const OPEN_PAGE = 100;
    const source = {
      after: async (anchor: { item: LadderRow; position: number } | null, count: number) =>
        positioned(
          anchor
            ? await ladderPage(count, Number(anchor.item.rank), anchor.item.nickname)
            : await ladderPage(count, 1),
          anchor ? anchor.position + 1 : 0,
        ),
      before: async (anchor: { item: LadderRow; position: number }, count: number) => {
        const rows = await ladderPageBefore(
          count, Number(anchor.item.rank), anchor.item.nickname);
        return positioned(rows, Math.max(0, anchor.position - rows.length));
      },
      /* The thumb drag. from_pos is 1-based in SQL. */
      seek: async (position: number, count: number) =>
        positioned(await ladderPage(count, 1, undefined, position + 1), position),
    };

    /* ONE COMPLETE VIEW, NOT A PANEL THAT FILLS IN. The first page is fetched
       here, behind the shared loading die, and handed to the window as a seed —
       so the ladder is revealed with rows already on it. Mounting first and
       letting the window fetch would show an empty board for a round trip. */
    const opening = standing?.rank
      ? await source.seek(Math.max(0, standing.rank - 1 - (OPEN_PAGE >> 1)), OPEN_PAGE)
      : await source.after(null, OPEN_PAGE);
    if (run !== showRevision || !isOnlinePanelCurrent('onLadder')) return;

    /* THE EXACT ROW, FROM THE SEED. standing.rank - 1 is the position of a tie
       group's FIRST member, not necessarily mine — but the page we just fetched
       carries every row's dense `pos`, so my own position is already known and
       the opening needs no second, corrective jump. */
    const mine = me ? opening.rows.find((row) => row.nickname === me.nickname) : undefined;
    const focusIndex = mine?.pos !== undefined ? mine.pos - 1
      : standing?.rank ? standing.rank - 1 : 0;

    /* Revealed BEFORE the list is built: mountVirtualList measures and aims
       synchronously from here, so the first frame the browser paints is already
       in the right place. */
    showOnlinePanel('onLadder');

    virtual = mountVirtualList<LadderRow>({
      scroller,
      list: listElement,
      page: PAGE,
      /* THE SEED KNOWS THE BOARD'S SIZE TOO. Every row has carried `population`
         since 20260827203007 precisely because the ladder is public: a
         signed-out reader has no uuid, so player_standing cannot answer for
         them, and without this they get a band of tombstones under the last
         real row until a short page happens to settle it. positioned()'s
         setTotal cannot do this job for the OPENING page — `virtual` is still
         null while it is being fetched. */
      total: standing?.population ?? opening.rows[0]?.population ?? null,
      seed: { ...opening, asked: OPEN_PAGE },
      focus: me || standing?.rank ? { index: focusIndex, align: 'center' } : null,
      alive,
      source,
      slots: {
        key: (row) => row.nickname,
        create: () => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'lrow';
          button.addEventListener('click', () => {
            const row = showing.get(button);
            if (!row) return;
            Sfx.tap();
            if (me && row.nickname === me.nickname) {
              /* The panel swap collapses .pbody, so the browser clamps
                 scrollTop to 0 and the reading place is gone before the way
                 back is ever pressed. Save an ANCHOR — which row, how far down
                 — not an offset: pads ahead of the reader can be corrected
                 while the profile is up, and an offset would then point
                 somewhere else. */
              const place: VirtualPlace | null = virtual?.save() ?? null;
              const back = ports.getExit();
              ports.setExit(() => {
                ports.setExit(back);
                showOnlinePanel('onLadder');
                virtual?.refresh();
                virtual?.restore(place);
              });
              void ports.showAccount();
              return;
            }
            showFaceoff(row, me && ladder
              ? { name: me.nickname, avatar: me.avatar ?? null, lad: ladder, apex: mineApex }
              : null);
          });
          return button;
        },
        pending: (element, position) => {
          element.className = 'lrow';
          element.setAttribute('aria-hidden', 'true');
          element.tabIndex = -1;
          element.innerHTML = tombstoneHtml(position);
        },
        render: (element, row) => {
          showing.set(element, row);
          const isMe = !!me && row.nickname === me.nickname;
          element.className = 'lrow' + (isMe ? ' me' : '');
          element.removeAttribute('aria-hidden');
          element.tabIndex = 0;
          const group = boardGroup(row.points, row.apex);
          element.style.setProperty('--gc', `var(--g-${group.id})`);
          const groupName = ladderGroupName(group.id);
          element.setAttribute('aria-label', isMe
            ? t('online', 'ladder.openProfile', {
              name: row.nickname, rank: rank(row.rank), group: groupName,
            })
            : t('online', 'ladder.comparePlayer', {
              name: row.nickname, rank: rank(row.rank), group: groupName,
              points: pts(row.points),
            }));
          if (isMe) {
            const state = row.apex ? t('online', 'ladder.topOnePercent')
              : t('online', 'ladder.progress', {
                percent: formatNumber(Math.round(groupFill(row.points) * 100)),
              });
            element.innerHTML = `<span class="av"></span><span class="nmwrap"><span class="nm">${esc(row.nickname)}</span>`
              + `<span class="mesub"><b>${esc(groupName)}</b> · ${esc(state)} · ${recordHtml(row.wins, row.losses)}</span></span>`
              + `<span class="ptcol"><span class="pt2">${pts(row.points)}</span><span class="rk2">${esc(t('online', 'ladder.rank', { rank: rank(row.rank) }))}</span></span>`;
          } else {
            const middle = ladder ? gapHtml(row.points - ladder.points)
              : `<span class="ws">${recordHtml(row.wins, row.losses)}</span>`;
            element.innerHTML = `<span class="rank">${formatNumber(row.rank)}</span><span class="av"></span>`
              + `<span class="nm">${esc(row.nickname)}</span>${middle}<span class="rt">${pts(row.points)}</span>`;
          }
          paintAvatar(element.querySelector('.av') as HTMLElement, row.avatar, isMe ? 34 : 24);
        },
        lead: (row, previous, index) => {
          const group = boardGroup(row.points, row.apex);
          /* An unknown neighbour yields NO horizon. A cold landing has no
             previous row and is almost never a boundary; drawing one and taking
             it away is a visible 28px shift, while a label that arrives a
             moment late is not. */
          if (index > 0 && !previous) return null;
          if (previous && boardGroup(previous.points, previous.apex) === group) return null;
          const horizon = document.createElement('div');
          horizon.className = 'ghor' + (group.id === 'neon' ? ' apex' : '');
          horizon.style.setProperty('--gc', `var(--g-${group.id})`);
          horizon.dataset.g = group.id;
          const sub = group.id === 'neon' ? t('online', 'ladder.topOnePercent')
            : group.floor === 0 ? t('online', 'ladder.floorZero')
            : t('online', 'ladder.andUp', { points: pts(group.floor) });
          horizon.innerHTML = `<span class="gn">${esc(ladderGroupName(group.id))}</span>`
            + `<span class="gf">${esc(sub)}${ladder && myGroup === group
              ? ` · ${esc(t('online', 'ladder.yourGroup'))}` : ''}</span>`;
          return horizon;
        },
      },
    });

    await virtual.ready;
  }

  return { show };
}

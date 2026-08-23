import { groupFill, inApex, peakState, rankName, rk } from '../core/ladder.ts';
import { ask } from '../ui/askcard.ts';
import { Sfx } from '../ui/audio.ts';
import { DEFAULT_AVATAR, paintAvatar } from '../ui/avatar.ts';
import { $ } from '../ui/dom.ts';
import { REDUCED } from '../ui/fx.ts';
import { refreshHomeChip } from '../ui/homechip.ts';
import {
  bestStreak,
  matchHistory,
  myLadder,
  myStanding,
} from './ladder-api.ts';
import {
  cacheStanding,
  claimName,
  currentUser,
  deleteAccount,
  myProfile,
  signOut,
} from './session.ts';
import { historyRow } from './history-screen.ts';
import { showOnlinePanel } from './shell.ts';
import type { AuthMode } from './auth-screen.ts';

interface AccountPorts {
  showAuth(mode: AuthMode): void;
  showAvatar(): Promise<void>;
  showBoard(): Promise<void>;
  showHistory(): Promise<void>;
}

export interface AccountScreen {
  bind(): void;
  show(): Promise<void>;
}

const ringRun = new WeakMap<HTMLElement, number>();

function fillRing(ring: HTMLElement, target: number): void {
  const run = (ringRun.get(ring) ?? 0) + 1;
  ringRun.set(ring, run);
  const from = parseFloat(ring.style.getPropertyValue('--p')) || 0;
  if (REDUCED || Math.abs(target - from) < 0.002) {
    ring.style.setProperty('--p', String(target));
    return;
  }
  const started = performance.now();
  const duration = 850;
  const step = (now: number): void => {
    if (ringRun.get(ring) !== run) return;
    const time = Math.min(1, (now - started) / duration);
    ring.style.setProperty('--p', String(from + (target - from) * (1 - Math.pow(1 - time, 3))));
    if (time < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function createAccountScreen(ports: AccountPorts): AccountScreen {
  async function show(): Promise<void> {
    showOnlinePanel('onAccount');
    $('#onAccErr').textContent = '';
    const ring = $('#accRing') as HTMLElement;
    ring.classList.remove('haspeak');
    ring.style.setProperty('--p', '0');
    try {
      const cached = JSON.parse(localStorage.getItem('knucklebones.online.profile') ?? 'null')?.rating;
      if (typeof cached === 'number') {
        fillRing(ring, groupFill(cached));
        $('#accPoints').textContent = cached.toLocaleString('en');
        $('#accGroup').textContent = rankName(cached);
      }
    } catch { /* forgetful host — the fresh row below paints everything anyway */ }
    const [profile, user] = await Promise.all([myProfile(), currentUser()]);
    refreshHomeChip();
    $('#accGuest').hidden = !user?.guest;
    ($('#btnSignOut') as HTMLElement).hidden = !!user?.guest;
    $('#accName').textContent = profile?.nickname ?? '';
    const claim = $('#accClaim');
    claim.hidden = !profile || !!profile.named_at;
    if (!claim.hidden) {
      ($('#onNick') as HTMLInputElement).placeholder = profile!.nickname;
      $('#onNickErr').textContent = '';
    }
    paintAvatar($('#accDie'), profile?.avatar ?? DEFAULT_AVATAR);
    $('#accSince').textContent = !user?.guest && profile?.created_at
      ? 'Member since ' + new Date(profile.created_at)
        .toLocaleDateString('en', { month: 'long', year: 'numeric' })
      : '';

    const [ladder, standing, streak] = await Promise.all([
      myLadder(),
      myStanding(),
      bestStreak(),
    ]);
    const points = ladder?.points ?? 0;
    const peak = ladder?.peak ?? 0;
    $('#accPoints').textContent = points.toLocaleString('en');
    $('#accGroup').textContent = rankName(points);
    $('#accPeak').textContent = peak.toLocaleString('en');
    const games = ladder ? ladder.wins + ladder.losses + ladder.draws : 0;
    $('#accGames').textContent = games ? `${games} games ›` : 'none yet ›';
    const apex = standing ? inApex(points, standing.rank, standing.population) : false;
    $('#accRank').textContent = standing && games ? (apex ? 'NEON' : rk(standing.rank)) : '–';
    $('#accStreak').textContent = String(streak);
    cacheStanding(standing?.rank ?? null, apex);
    refreshHomeChip();

    const peakPosition = peakState(points, peak);
    fillRing(ring, groupFill(points));
    ring.classList.toggle('haspeak', peakPosition.kind !== 'at');
    if (peakPosition.kind === 'ahead') ring.style.setProperty('--pk', String(peakPosition.fill));
    if (peakPosition.kind === 'above') ring.style.setProperty('--pk', '1');

    const recent = $('#accRecent');
    recent.innerHTML = '';
    recent.hidden = true;
    void matchHistory(3).then((rows) => {
      if ($('#onAccount').hidden) return;
      for (const row of rows.slice(0, 3)) recent.appendChild(historyRow(row));
      recent.hidden = !recent.childElementCount;
      const account = $('#onAccount');
      while (recent.lastChild && account.scrollHeight > account.clientHeight + 1) {
        recent.removeChild(recent.lastChild);
      }
      recent.hidden = !recent.childElementCount;
    });
  }

  function bind(): void {
    $('#btnKeepAcc').addEventListener('click', () => {
      Sfx.tap();
      ports.showAuth('attach');
    });
    $('#btnHaveAcc').addEventListener('click', () => {
      Sfx.tap();
      ports.showAuth('restore');
    });
    $('#btnClaim').addEventListener('click', async () => {
      Sfx.tap();
      const name = ($('#onNick') as HTMLInputElement).value.trim();
      if (name.length > 16) {
        $('#onNickErr').textContent = `Too long — 16 characters at most (this one is ${name.length}).`;
        return;
      }
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
        $('#onNickErr').textContent = '3–16 letters, digits or underscores.';
        return;
      }
      const confirmed = await ask({
        head: `Play as ${name}?`,
        body: 'A name is claimed once and kept for good. It cannot be edited or claimed again later.',
        confirm: 'Claim it',
        cancel: 'Not yet',
        loud: true,
      });
      if (!confirmed) return;
      const button = $('#btnClaim') as HTMLButtonElement;
      button.disabled = true;
      const error = await claimName(name);
      if (error) {
        button.disabled = false;
        $('#onNickErr').textContent = error;
        return;
      }
      $('#accClaim').hidden = true;
      $('#accName').textContent = name;
      button.disabled = false;
      await show();
      const user = await currentUser();
      if (user?.guest) {
        const upgrade = await ask({
          head: `Keep ${name} forever?`,
          body: 'Your account lives on this device only — and the name you just claimed lives with it. '
            + 'Add an email and both survive anything.',
          confirm: 'Create account',
          cancel: 'Not now',
          loud: true,
        });
        if (upgrade) ports.showAuth('attach');
      }
    });
    $('#btnSignOut').addEventListener('click', async () => {
      Sfx.tap();
      await signOut();
      refreshHomeChip();
      ports.showAuth('restore');
    });
    $('#btnAvatar').addEventListener('click', () => {
      Sfx.tap();
      void ports.showAvatar();
    });
    $('#btnHistory').addEventListener('click', () => {
      Sfx.tap();
      void ports.showHistory();
    });
    $('#btnLadder').addEventListener('click', () => {
      Sfx.tap();
      void ports.showBoard();
    });
    $('#btnDeleteAcc').addEventListener('click', async () => {
      Sfx.tap();
      const confirmed = await ask({
        head: 'Delete your account?',
        body: 'Your profile, your matches and your ladder points are removed from the '
          + 'server. There is no undo, and nothing can be restored afterwards.',
        confirm: 'Delete everything',
        cancel: 'Keep my account',
        danger: true,
        check: 'I understand this cannot be undone',
      });
      if (!confirmed) return;
      const error = await deleteAccount();
      if (error) {
        $('#onAccErr').textContent = error;
        return;
      }
      refreshHomeChip();
      ports.showAuth('restore');
    });
  }

  return { bind, show };
}

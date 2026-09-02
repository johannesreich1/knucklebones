import { ME } from '../../core/rules.ts';
import { formatNumber, subscribeLocale, t } from '../../i18n/index.ts';
import { Sfx } from '../../ui/audio.ts';
import {
  AVATAR_FACES,
  DEFAULT_AVATAR,
  canonicalProfileAvatar,
  parseAvatar,
  paintAvatar,
  profileAvatar,
  type ProfileAvatar,
} from '../../ui/avatar.ts';
import { makeDie } from '../../ui/die.ts';
import { $, byId } from '../../ui/dom.ts';
import { loaderDie } from '../../ui/loader.ts';
import { readAccountProfileCache } from '../../profile-cache.ts';
import { repaintOnlineMessage } from '../message-copy.ts';
import { myProfileLookup, setAvatar, settingsAvatarHue } from '../identity/profile.ts';
import { showOnlinePanel } from './shell.ts';

export interface AvatarScreen {
  bind(): void;
  show(accountId: string): Promise<void>;
}

export function createAvatarScreen(showAccount: () => Promise<void>): AvatarScreen {
  let pick: ProfileAvatar = DEFAULT_AVATAR;
  let ownerAccountId: string | null = null;
  let showRevision = 0;
  let avatarError: (() => string) | null = null;
  const clearAvatarError = (): void => {
    avatarError = null;
    $('#onAvErr').textContent = '';
  };
  const showAvatarError = (render: () => string): void => {
    avatarError = render;
    $('#onAvErr').textContent = render();
  };
  /* The picker chooses a FACE. Its colour is "your colour" from Settings, so
     the avatar and the dice a player throws are one colour by construction. */
  const withSettingsHue = (avatar: ProfileAvatar): ProfileAvatar =>
    profileAvatar(parseAvatar(avatar).face, settingsAvatarHue());

  const paintLabels = (): void => {
    const panel = byId('onAvatar');
    if (!panel) return;
    $('#avFaces').querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.setAttribute('aria-label', t('online', 'avatar.faceLabel', {
        face: formatNumber(Number(button.dataset.face)),
      }));
    });
  };
  subscribeLocale(() => {
    paintLabels();
    const panel = byId('onAvatar');
    if (panel && !panel.hidden && avatarError) $('#onAvErr').textContent = avatarError();
  });

  async function show(accountId: string): Promise<void> {
    const run = ++showRevision;
    const expectedAccountId = accountId.toLowerCase();
    const cached = readAccountProfileCache(expectedAccountId);
    /* A reopened picker must not retain the previous account's choice. Save
       remains inert until this owner has supplied either a fresh row or its
       complete account-bound snapshot. */
    ownerAccountId = null;
    pick = withSettingsHue(canonicalProfileAvatar(cached?.profile.avatar ?? null));
    const save = $('#btnAvatarSave') as HTMLButtonElement;
    save.disabled = true;
    showOnlinePanel('onAvatar');
    clearAvatarError();
    const preview = $('#avPreview');
    if (!preview.firstChild) preview.appendChild(loaderDie(40));
    const profileResult = await myProfileLookup();
    if (run !== showRevision) return;
    if ((profileResult.ok
      && profileResult.profile.id.toLowerCase() !== expectedAccountId)
      || (!profileResult.ok && profileResult.reason === 'account-mismatch')) {
      ownerAccountId = null;
      await showAccount();
      return;
    }
    if (!profileResult.ok && !cached) {
      await showAccount();
      return;
    }
    pick = withSettingsHue(canonicalProfileAvatar(profileResult.ok
      ? profileResult.profile.avatar : cached?.profile.avatar ?? null));
    const draw = (): void => {
      const current = parseAvatar(pick);
      paintAvatar($('#avPreview'), pick, 86);
      $('#avFaces').querySelectorAll('button').forEach((button) =>
        button.classList.toggle('on', +(button as HTMLElement).dataset.face! === current.face));
    };
    if (!$('#avFaces').firstChild) {
      for (const face of AVATAR_FACES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.face = String(face);
        button.appendChild(makeDie(face, ME));
        button.addEventListener('click', () => {
          Sfx.tap();
          pick = profileAvatar(face, settingsAvatarHue());
          draw();
        });
        $('#avFaces').appendChild(button);
      }
      paintLabels();
    }
    draw();
    ownerAccountId = expectedAccountId;
    save.disabled = false;
  }

  function bind(): void {
    $('#btnAvatarSave').addEventListener('click', async () => {
      Sfx.tap();
      clearAvatarError();
      const accountId = ownerAccountId;
      if (!accountId) {
        await showAccount();
        return;
      }
      const button = $('#btnAvatarSave') as HTMLButtonElement;
      button.disabled = true;
      const result = await setAvatar(accountId, pick);
      if (!result.ok && result.reason === 'account-mismatch') {
        ownerAccountId = null;
        await showAccount();
        return;
      }
      if (!result.ok) {
        button.disabled = false;
        const returned = result.message;
        showAvatarError(() => repaintOnlineMessage(returned));
        return;
      }
      if (ownerAccountId !== accountId) return;
      clearAvatarError();
      ownerAccountId = null;
      await showAccount();
    });
  }

  return { bind, show };
}

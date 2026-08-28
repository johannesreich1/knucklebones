import { ME } from '../../core/rules.ts';
import { formatNumber, subscribeLocale, t } from '../../i18n/index.ts';
import { Sfx } from '../../ui/audio.ts';
import { AV_HUES, DEFAULT_AVATAR, parseAvatar, paintAvatar } from '../../ui/avatar.ts';
import { makeDie } from '../../ui/die.ts';
import { $, byId } from '../../ui/dom.ts';
import { loaderDie } from '../../ui/loader.ts';
import { repaintOnlineMessage } from '../message-copy.ts';
import { myProfile, setAvatar } from '../identity/profile.ts';
import { showOnlinePanel } from './shell.ts';

export interface AvatarScreen {
  bind(): void;
  show(): Promise<void>;
}

export function createAvatarScreen(showAccount: () => Promise<void>): AvatarScreen {
  let pick = DEFAULT_AVATAR;
  let avatarError: (() => string) | null = null;
  const clearAvatarError = (): void => {
    avatarError = null;
    $('#onAvErr').textContent = '';
  };
  const showAvatarError = (render: () => string): void => {
    avatarError = render;
    $('#onAvErr').textContent = render();
  };
  const colourKeys = {
    cy: 'avatar.colours.cy',
    mg: 'avatar.colours.mg',
    gold: 'avatar.colours.gold',
    green: 'avatar.colours.green',
    violet: 'avatar.colours.violet',
    orange: 'avatar.colours.orange',
  } as const;

  const paintLabels = (): void => {
    const panel = byId('onAvatar');
    if (!panel) return;
    $('#avFaces').querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.setAttribute('aria-label', t('online', 'avatar.faceLabel', {
        face: formatNumber(Number(button.dataset.face)),
      }));
    });
    $('#avHues').querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      const hue = button.dataset.hue as keyof typeof colourKeys;
      button.setAttribute('aria-label', t('online', 'avatar.colourLabel', {
        colour: t('online', colourKeys[hue]),
      }));
    });
  };
  subscribeLocale(() => {
    paintLabels();
    const panel = byId('onAvatar');
    if (panel && !panel.hidden && avatarError) $('#onAvErr').textContent = avatarError();
  });

  async function show(): Promise<void> {
    showOnlinePanel('onAvatar');
    clearAvatarError();
    const preview = $('#avPreview');
    if (!preview.firstChild) preview.appendChild(loaderDie(40));
    const profile = await myProfile();
    pick = profile?.avatar ?? DEFAULT_AVATAR;
    const draw = (): void => {
      const current = parseAvatar(pick);
      paintAvatar($('#avPreview'), pick, 86);
      $('#avFaces').querySelectorAll('button').forEach((button) =>
        button.classList.toggle('on', +(button as HTMLElement).dataset.face! === current.face));
      $('#avHues').querySelectorAll('button').forEach((button) =>
        button.classList.toggle('on', (button as HTMLElement).dataset.hue === current.hue));
    };
    if (!$('#avFaces').firstChild) {
      for (let face = 1; face <= 6; face++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.face = String(face);
        button.appendChild(makeDie(face, ME));
        button.addEventListener('click', () => {
          Sfx.tap();
          pick = `die:${face}:${parseAvatar(pick).hue}`;
          draw();
        });
        $('#avFaces').appendChild(button);
      }
      for (const hue of Object.keys(AV_HUES)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.hue = hue;
        button.className = 'hue';
        button.style.setProperty('--h', AV_HUES[hue]);
        button.addEventListener('click', () => {
          Sfx.tap();
          pick = `die:${parseAvatar(pick).face}:${hue}`;
          draw();
        });
        $('#avHues').appendChild(button);
      }
      paintLabels();
    }
    draw();
  }

  function bind(): void {
    $('#btnAvatarSave').addEventListener('click', async () => {
      Sfx.tap();
      clearAvatarError();
      const error = await setAvatar(pick);
      if (error) {
        const returned = error;
        showAvatarError(() => repaintOnlineMessage(returned));
        return;
      }
      clearAvatarError();
      await showAccount();
    });
  }

  return { bind, show };
}

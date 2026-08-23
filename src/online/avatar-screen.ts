import { ME } from '../core/rules.ts';
import { Sfx } from '../ui/audio.ts';
import { AV_HUES, DEFAULT_AVATAR, parseAvatar, paintAvatar } from '../ui/avatar.ts';
import { makeDie } from '../ui/die.ts';
import { $ } from '../ui/dom.ts';
import { loaderDie } from '../ui/loader.ts';
import { myProfile, setAvatar } from './session.ts';
import { showOnlinePanel } from './shell.ts';

export interface AvatarScreen {
  bind(): void;
  show(): Promise<void>;
}

export function createAvatarScreen(showAccount: () => Promise<void>): AvatarScreen {
  let pick = DEFAULT_AVATAR;

  async function show(): Promise<void> {
    showOnlinePanel('onAvatar');
    $('#onAvErr').textContent = '';
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
    }
    draw();
  }

  function bind(): void {
    $('#btnAvatarSave').addEventListener('click', async () => {
      Sfx.tap();
      const error = await setAvatar(pick);
      if (error) {
        $('#onAvErr').textContent = error;
        return;
      }
      await showAccount();
    });
  }

  return { bind, show };
}

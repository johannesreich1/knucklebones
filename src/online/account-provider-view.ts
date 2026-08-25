import { t } from '../i18n/index.ts';
import { $ } from '../ui/dom.ts';
import type { IdentityStatus, Me } from './session.ts';

export function paintAccountProviders(user: Me | null, identity: IdentityStatus | null): void {
  const providers = $('#accProviders');
  providers.hidden = !user || user.guest;
  if (providers.hidden) return;
  $('#accGameCenterState').textContent = t('online', identity?.gameCenterLinked
    ? 'profile.gameCenterLinked' : 'profile.gameCenterNotLinked');
  $('#accAppleState').textContent = t('online', identity?.appleLinked
    ? identity.appleRevocationReady
      ? 'profile.appleLinked' : 'profile.appleRepair'
    : 'profile.appleNotLinked');
  const apple = $('#btnLinkApple') as HTMLButtonElement;
  apple.hidden = !!identity?.appleLinked && !!identity.appleRevocationReady;
  const key = identity?.appleLinked ? 'profile.repairApple' : 'profile.addApple';
  apple.setAttribute('data-i18n', `online:${key}`);
  apple.textContent = t('online', key);
}

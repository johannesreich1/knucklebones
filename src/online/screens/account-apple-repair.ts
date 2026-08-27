/* The profile's Apple control is NOT the guest-upgrade sheet.
   "KEEP ACCOUNT · add an email and this account survives a reinstall" answers
   a question this player already answered: their account is attached, and for
   a repair it is already attached to Apple. The single missing thing is the
   deletion credential, which only a fresh Apple authorization code can supply
   — so the button runs the Apple provider and nothing else. Adding Apple to an
   account that lacks it is that same one step, which is why both labels of
   #btnLinkApple share this implementation instead of forking a second flow.
   #btnKeepAcc keeps the upgrade sheet; it is a different question. */
import { APPLE, type AppleIdentity } from '../identity/apple-identity.ts';
import { onlineMessage } from '../message-copy.ts';
import {
  bindAccountProviderControl,
  type AccountProviderPorts,
} from './account-provider-control.ts';

export interface AccountAppleRepairPorts extends AccountProviderPorts {
  apple?: Pick<AppleIdentity, 'repair'>;
}

export function bindAccountAppleRepair(ports: AccountAppleRepairPorts): void {
  const provider = ports.apple ?? APPLE;
  bindAccountProviderControl({
    clearError: ports.clearError,
    showError: ports.showError,
    refresh: ports.refresh,
    control: '#btnLinkApple',
    run: () => provider.repair(),
    rejected: () => onlineMessage('errors.appleFailed'),
  });
}

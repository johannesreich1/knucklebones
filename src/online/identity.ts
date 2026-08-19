// One-tap identity providers — the rungs above "guest" that need no typing.
//
// A provider is a registry entry, not a branch: it says whether it exists on
// this device and how to do the two things every identity must do — RESTORE
// (become that account) and ATTACH (hang itself on the guest account already
// playing, so the rating survives). The panel renders whatever is available and
// never learns a provider's name; the web build simply finds none.
//
// Native providers arrive through the Capacitor bridge on `window`, deliberately
// NOT through an import: the web bundle must not carry a line of plugin code.
import { supa } from './session.ts';

export interface OneTap {
  id: string;
  label: string;
  available(): boolean;
  restore(): Promise<string | null>;   // null = signed in
  attach(): Promise<string | null>;    // null = linked to the current user
}

interface Bridge { [plugin: string]: any }
const plugins = (): Bridge => (globalThis as any).Capacitor?.Plugins ?? {};

/* Apple hashes the nonce into the identity token and Supabase compares it
   against the raw one — so the plugin gets the digest, the server gets the
   original. Sending the same value to both would fail the check. */
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const APPLE: OneTap = {
  id: 'apple',
  label: 'Continue with Apple',
  available: () => !!plugins().SignInWithApple,

  async restore() {
    const cred = await appleToken();
    if (typeof cred === 'string') return cred;
    const { error } = await supa().auth.signInWithIdToken({
      provider: 'apple', token: cred.token, nonce: cred.nonce,
    });
    return error ? error.message : null;
  },

  async attach() {
    const cred = await appleToken();
    if (typeof cred === 'string') return cred;
    const { error } = await supa().auth.linkIdentity({
      provider: 'apple', token: cred.token, nonce: cred.nonce,
    } as any);
    return error ? error.message : null;
  },
};

async function appleToken(): Promise<{ token: string; nonce: string } | string> {
  const raw = crypto.randomUUID();
  try {
    const res = await plugins().SignInWithApple.authorize({
      clientId: 'com.appavaria.knucklebones',
      redirectURI: '',                 // native flow: Apple ignores both
      scopes: 'email name',
      nonce: await sha256hex(raw),
    });
    const token = res?.response?.identityToken;
    return token ? { token, nonce: raw } : 'Apple did not return a token';
  } catch (e: any) {
    // the player closing Apple's sheet is not an error worth shouting about
    return e?.message === 'The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)'
      ? '' : (e?.message ?? 'Apple sign-in failed');
  }
}

export const ONE_TAP: OneTap[] = [APPLE];
export const availableTaps = (): OneTap[] => ONE_TAP.filter((m) => m.available());

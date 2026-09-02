/** Install one shared Capacitor fixture. Apple and Game Center must be plugins
 * on the same object; separate init scripts would let the last one erase the
 * other before app boot. */
export async function installNativeBridges(page, {
  appleBridge,
  appleAuth,
  deferAppleNative,
  gameCenterBridge,
  proofRefusal,
  gameCenterPersistent,
}) {
  if (!appleBridge && !gameCenterBridge) return;
  await page.addInitScript(({
    apple, appleAuth, deferAppleNative, gameCenter, refusal, persistent,
  }) => {
    const Plugins = {};
    if (apple) {
      let releaseNative;
      const nativeRelease = new Promise((resolve) => { releaseNative = resolve; });
      globalThis.__releaseAppleNative = () => releaseNative();
      Plugins.AppleSignIn = {
        initialize: async () => {},
        signIn: async (options) => {
          globalThis.__appleSignIn = {
            calls: (globalThis.__appleSignIn?.calls ?? 0) + 1,
            options: options ?? null,
            started: true,
          };
          if (deferAppleNative) await nativeRelease;
          /* 'invalid' is a credential the app refuses on its own (no token, so
             Supabase is never asked); 'rejected' is one it sends and Supabase
             refuses, which is the only way a token-exchange error can be held. */
          return appleAuth === 'success'
            ? { idToken: 'apple-id-token', authorizationCode: 'apple-authorization-code' }
            : appleAuth === 'rejected'
              ? { idToken: 'apple-rejected-token' }
              : { idToken: '' };
        },
      };
    }
    if (gameCenter) {
      globalThis.__gameCenter = { proofs: 0 };
      // An older binary omits this field; absence is not the same as false.
      const state = { status: 'authenticated', revision: 1 };
      if (persistent !== null) state.persistentIdentity = persistent;
      Plugins.GameCenter = {
        initialize: async () => state,
        getAuthState: async () => state,
        addListener: () => ({ remove() {} }),
        fetchIdentityProof: async () => {
          globalThis.__gameCenter.proofs++;
          if (refusal && globalThis.__gameCenter.proofs > (refusal.afterProofs ?? 0)) {
            const error = new Error(refusal.message);
            if (refusal.code) error.code = refusal.code;
            throw error;
          }
          return {
            publicKeyUrl: 'https://static.gc.apple.com/public-key/gc-prod-12.cer',
            signature: 'signed', salt: 'salt', timestamp: '123',
            teamPlayerID: 'team-player',
          };
        },
      };
    }
    globalThis.Capacitor = { getPlatform: () => 'ios', Plugins };
  }, {
    apple: appleBridge,
    appleAuth,
    deferAppleNative,
    gameCenter: !!gameCenterBridge,
    refusal: proofRefusal,
    persistent: gameCenterPersistent,
  });
}

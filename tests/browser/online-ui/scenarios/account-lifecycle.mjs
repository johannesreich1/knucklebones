export async function runAccountLifecycleScenarios(suite) {
  const { visit, out, check } = suite;
  // 1c · the named player: the claim is spent, the card is GONE — not
  // disabled, not re-offered. The headline is all that remains of the name UI.
  const namedRun = await visit({ named: true });
  out.named = { accName: namedRun.seen.accName, claim: namedRun.seen.claim };
  check(namedRun.seen.accName === 'TestGuest001', 'a named player lost their headline', namedRun.seen);
  check(namedRun.seen.claim === false, 'the claim card survives after the name is set', namedRun.seen);
  check(namedRun.askAbove === true,
        'the ask-card opened UNDER a later overlay — ask() lost its re-append', namedRun.askAbove);
  check(namedRun.errs.length === 0, 'page errors on the named path', namedRun.errs);

  // 1d · the claim itself: confirm through the shared ask-card, the card
  // retires, the headline takes the name, and a GUEST is offered the way up
  const claimRun = await visit({ door: 'claim' });
  out.claim = claimRun.claimFlow;
  check(claimRun.claimFlow?.confirmHead === 'Play as NeonKing77?',
        'claiming does not ask the deliberate question', claimRun.claimFlow);
  check(claimRun.claimFlow?.head === 'Keep NeonKing77 forever?',
        'a guest claim did not offer the way up', claimRun.claimFlow);
  check(claimRun.claimFlow?.claimGone === true, 'the claim card survived its own success', claimRun.claimFlow);
  check(claimRun.claimFlow?.headline === 'NeonKing77', 'the headline did not take the claimed name', claimRun.claimFlow);
  check(claimRun.claimFlow?.authShown === true, 'Create account did not open the attach panel', claimRun.claimFlow);
  check(claimRun.claimFlow?.yesLoud === true,
        'the way-up offer does not wear primary on its yes', claimRun.claimFlow);
  check(claimRun.errs.length === 0, 'page errors on the claim flow', claimRun.errs);

  // 2 · the project with anonymous sign-ins off: degrade to the old panel
  const off = await visit({ anonymous: 422 });
  out.providerOff = off.seen;
  check(off.seen.panel === 'auth', 'no fallback when guests are unavailable', off.seen);
  check(off.seen.actions.join() === 'Sign in', 'the fallback lost its sign-in', off.seen);
  check(off.seen.swapDoor === 'Create account', 'the fallback offers no way to make an account', off.seen);
  check(off.errs.length === 0, 'page errors when guests are refused', off.errs);

  // 3 · the returning player: signing out must not mint a guest over them
  const back = await visit({ attached: true });
  out.afterSignOut = back.seen;
  check(back.seen.panel === 'auth', 'a signed-out player was re-minted as a guest', back.seen);
  check(back.signupCalls === 0, 'a guest was minted for a device that had a real account', back.signupCalls);
}

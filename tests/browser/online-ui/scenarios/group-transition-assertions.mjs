import { RESOURCES } from '../../../../src/i18n/catalogs.ts';

const COPY = RESOURCES.en;

export function assertPromotionTransition({ check, seen, errs, eventId, matchId }) {
  check(seen?.opened?.open && seen.opened.modal && seen.opened.focusInside
      && seen.opened.closeControls === 0
      && seen.opened.result.open && seen.opened.result.inert
      && seen.opened.result.actionHitByTransition,
    'the mandatory promotion deck did not own the ranked result as an accessible modal',
    seen?.opened);
  check(seen?.opened?.dots.count === 4 && seen.opened.dots.current === 0
      && seen.opened.dots.currentCount === 1
      && seen.opened.dots.label === COPY.online.groupTransition.slideLabel
        .replace('{{current}}', '1').replace('{{total}}', '4')
      && !seen.opened.back.visible
      && seen.opened.primary.label === COPY.common.actions.next
      && seen.opened.announcement === [
        COPY.online.groupTransition.slideLabel
          .replace('{{current}}', '1').replace('{{total}}', '4'),
        COPY.online.ladder.groups.bone.name,
        COPY.online.groupTransition.promotionBody,
      ].join('. '),
    'the first promotion page lost its dots, page label, or one-way Next action',
    seen?.opened);
  check(seen?.opened?.kicker?.visible === false
      && (!seen.opened.kicker.box
        || (seen.opened.kicker.box.width === 0 && seen.opened.kicker.box.height === 0))
      && seen.opened.points?.visible === false
      && (!seen.opened.points.box
        || (seen.opened.points.box.width === 0 && seen.opened.points.box.height === 0)),
    'the group page still rendered its NEW GROUP kicker or before/delta/after points row',
    { kicker: seen?.opened?.kicker, points: seen?.opened?.points });
  check(seen?.opened?.page?.label === '1 / 4'
      && seen.opened.page.box && seen.opened.page.headBox
      && Math.abs(seen.opened.page.box.right - seen.opened.page.headBox.right) <= 1,
    'the page count moved away from the fixed right edge when the left kicker was absent',
    seen?.opened?.page);
  check(seen?.opened?.layout?.deck?.height <= 560
      && seen.opened.layout.paddingTop <= 10
      && seen.opened.layout.paddingBottom <= 10
      && seen.opened.layout.buttonHeights.length === 1
      && seen.opened.layout.buttonHeights.every((height) => height >= 44),
    'the group card did not become visibly shorter with tighter vertical padding and a 44px action',
    seen?.opened?.layout);
  check(seen?.refusedDismissal?.open && seen.refusedDismissal.dots.current === 0
      && seen.acknowledgementsBeforeContinue === 0,
    'Escape or a backdrop tap dismissed/acknowledged the mandatory deck',
    { refused: seen?.refusedDismissal, acks: seen?.acknowledgementsBeforeContinue });

  const rowSwitchCopy = COPY.game.modes.rowswitch;
  check(seen?.rowSwitch?.deck?.dots.current === 1
      && seen.rowSwitch.deck.dots.count === 4
      && seen.rowSwitch.deck.back.visible
      && seen.rowSwitch.deck.back.label === COPY.common.actions.back
      && seen.rowSwitch.deck.primary.label === COPY.common.actions.next
      && seen.rowSwitch.shape.title === rowSwitchCopy.name
      && seen.rowSwitch.shape.text === rowSwitchCopy.blurb
      && seen.rowSwitch.deck.kicker.visible
      && seen.rowSwitch.deck.kicker.label === COPY.online.groupTransition.newMode
      && seen.rowSwitch.deck.announcement === [
        COPY.online.groupTransition.slideLabel
          .replace('{{current}}', '2').replace('{{total}}', '4'),
        rowSwitchCopy.name,
        rowSwitchCopy.blurb,
      ].join('. ')
      && seen.rowSwitch.shape.titles === 1 && seen.rowSwitch.shape.paragraphs === 1
      && seen.rowSwitch.shape.svgs === 1 && seen.rowSwitch.shape.modeIcons === 1
      && seen.rowSwitch.shape.extraMedia === 0,
    'ROW SWITCH is not the requested icon + title + text-only slide', seen?.rowSwitch);
  check(seen?.rowMultiplySwipe?.deck?.dots.current === 2
      && seen.rowMultiplySwipe.deck.dots.currentCount === 1
      && seen.rowMultiplySwipe.deck.dots.label === COPY.online.groupTransition.slideLabel
        .replace('{{current}}', '3').replace('{{total}}', '4')
      && seen.rowMultiplySwipe.shape.title === COPY.game.modes.rowmult.name
      && seen.rowMultiplySwipe.shape.text === COPY.game.modes.rowmult.blurb
      && seen.rowMultiplySwipe.shape.svgs === 1
      && seen.rowMultiplySwipe.shape.modeIcons === 1
      && seen.rowMultiplySwipe.shape.extraMedia === 0
      && seen.rowSwitchAgain?.dots.current === 1,
    'the real left/right pointer swipes did not advance and reverse exactly one page',
    { forward: seen?.rowMultiplySwipe, reverse: seen?.rowSwitchAgain });
  check(seen?.backToRowSwitch?.dots.current === 1,
    'Back did not return to the preceding mode slide', seen?.backToRowSwitch);
  check(seen?.bounty?.deck?.dots.current === 3
      && seen.bounty.deck.dots.currentCount === 1
      && seen.bounty.deck.dots.label === COPY.online.groupTransition.slideLabel
        .replace('{{current}}', '4').replace('{{total}}', '4')
      && seen.bounty.deck.primary.label === COPY.common.actions.continue
      && seen.bounty.shape.title === COPY.game.modes.bounty.name
      && seen.bounty.shape.text === COPY.game.modes.bounty.blurb
      && seen.bounty.shape.svgs === 1 && seen.bounty.shape.modeIcons === 1
      && seen.bounty.shape.extraMedia === 0 && seen.stillMandatory,
    'the last mode page is not a simplified BOUNTY slide ending in Continue',
    seen?.bounty);
  const explorePages = [
    ['group', seen?.opened],
    ['row switch', seen?.rowSwitch?.deck],
    ['row multiply', seen?.rowMultiplySwipe?.deck],
    ['bounty', seen?.bounty?.deck],
  ];
  check(explorePages.every(([, deck]) => deck?.swipe?.visible
      && deck.swipe.label === COPY.online.groupTransition.swipeExplore
      && deck.swipe.box && deck.layout?.body && deck.layout.dots && deck.layout.actions
      && deck.layout.body.bottom <= deck.swipe.box.top + 1
      && deck.swipe.box.bottom <= deck.layout.dots.top + 1
      && deck.layout.dots.bottom <= deck.layout.actions.top + 1),
  'every page did not keep the localized Swipe to explore hint in the footer',
  Object.fromEntries(explorePages));
  check(seen?.continued && !seen.continued.transitionOpen
      && seen.continued.resultOpen && !seen.continued.resultInert
      && seen.continued.focus === 'btnAgain'
      && seen.acknowledgementsBeforeContinue === 0
      && seen.acknowledgements.length === 1
      && seen.acknowledgements[0].body.p_event_id === eventId
      && !Object.hasOwn(seen.acknowledgements[0].body, 'player_id')
      && seen.acknowledgements[0].authorization.startsWith('Bearer '),
    'Continue did not exclusively close and owner-acknowledge the progression event',
    { continued: seen?.continued, acknowledgements: seen?.acknowledgements });
  check(seen?.reads.length >= 2
      && seen.reads.some(({ url }) => url.includes(`source_match_id=eq.${matchId}`))
      && seen.reads.some(({ url }) => !url.includes('source_match_id=eq.')
        && url.includes('order=created_at.asc'))
      && seen.reads.every(({ url, authorization }) =>
        url.includes('seen_at=is.null')
        && !url.includes('player_id=')
        && authorization.startsWith('Bearer ')),
    'the browser lost its owner-only match read or unseen-event recovery query', seen?.reads);
  check(errs.length === 0, 'page errors during the promotion deck', errs);
}

export function assertV2MilestoneTransition({ check, seen, errs, eventId }) {
  const expected = [
    {
      title: COPY.online.ladder.groups.neon.name,
      paragraph: COPY.online.groupTransition.promotionBody,
      kicker: '',
    },
    {
      title: COPY.game.modes.rowmult.name,
      paragraph: COPY.game.modes.rowmult.blurb,
      kicker: COPY.online.groupTransition.newMode,
    },
    {
      title: COPY.game.modes.runeTrial.name,
      paragraph: COPY.game.modes.runeTrial.blurb,
      kicker: COPY.online.groupTransition.newMode,
    },
    {
      title: COPY.online.groupTransition.runesUnlockedTitle,
      paragraph: COPY.online.groupTransition.runesUnlockedBody,
      kicker: COPY.online.groupTransition.whatChanges,
    },
    {
      title: COPY.game.modes.rowswitch.name,
      paragraph: COPY.game.modes.rowswitch.blurb,
      kicker: COPY.online.groupTransition.newMode,
    },
    {
      title: COPY.game.modes.limited.name,
      paragraph: COPY.game.modes.limited.blurb,
      kicker: COPY.online.groupTransition.newMode,
    },
    {
      title: COPY.online.groupTransition.weeklyUnlockedTitle,
      paragraph: COPY.online.groupTransition.weeklyUnlockedBody,
      kicker: COPY.online.groupTransition.newAccess,
    },
    {
      title: COPY.online.groupTransition.neonMedalTitle,
      paragraph: COPY.online.groupTransition.neonMedalBody,
      kicker: COPY.online.groupTransition.rewardEarned,
    },
  ];
  check(seen?.slides?.length === expected.length
      && seen.slides.every(({ deck }, index) => deck.open
        && deck.dots.count === expected.length
        && deck.dots.current === index
        && deck.dots.currentCount === 1
        && deck.title === expected[index].title
        && deck.paragraph === expected[index].paragraph
        && deck.kicker.label === expected[index].kicker
        && deck.swipe.visible
        && deck.swipe.label === COPY.online.groupTransition.swipeExplore),
    'the v2 catch-up deck did not teach exact grants in ascending milestone order',
    { actual: seen?.slides?.map(({ deck }) => ({
      title: deck.title, paragraph: deck.paragraph, kicker: deck.kicker.label,
      current: deck.dots.current, total: deck.dots.count,
    })), expected });
  const featureShapes = seen?.slides?.slice(1).map(({ shape }) => shape) ?? [];
  check(featureShapes.length === expected.length - 1
      && featureShapes.every((shape) => shape.titles === 1
        && shape.paragraphs === 1 && shape.svgs === 1
        && shape.modeIcons === 1 && shape.extraMedia === 0),
    'a v2 outcome/access/reward slide drifted from the icon + title + text shape',
    featureShapes);
  const final = seen?.slides?.at(-1)?.deck;
  check(final?.primary.label === COPY.common.actions.continue
      && seen.acknowledgementsBeforeContinue === 0
      && seen.acknowledgements?.length === 1
      && seen.acknowledgements[0].body.p_event_id === eventId,
    'the v2 deck acknowledged before its final NEON medal Continue',
    { final, acknowledgements: seen?.acknowledgements });
  check(errs.length === 0, 'page errors during the v2 milestone deck', errs);
}

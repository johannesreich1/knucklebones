// THE RESULT'S FEATURE CARD — what was won, and the door to where it lives.
//
// Split out of ui/endscreen.ts: the card is pure construction against one
// stated design rule and shares no state with the rest of the screen. The tap
// stays bound once on the shell (#endFeature is itself the <button>), so this
// file paints and nothing more.
import { $ } from './dom.ts';

/* A feature card is a DOOR: two lines name what was won and the whole card
   opens whatever already owns the full description. No body and no CTA — a
   printed explanation would be a second copy of that owner's text, and a
   button beside a tappable card is two targets for one destination. */
export interface EndFeature {
  className?: string;
  hue?: string;
  icon?: string;
  kicker: string;
  title: string;
  tap: () => void;
}

/** Paint the card, or clear it away entirely when this result has none. */
export function paintFeature(feature?: EndFeature): void {
  const box = $('#endFeature');
  box.innerHTML = '';
  box.hidden = !feature;
  box.className = `endfeature${feature?.className ? ` ${feature.className}` : ''}`;
  if (!feature) {
    box.style.removeProperty('--feature-hue');
    return;
  }
  if (feature.hue) box.style.setProperty('--feature-hue', feature.hue);
  else box.style.removeProperty('--feature-hue');

  const icon = document.createElement('i');
  icon.className = 'endfeature-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = feature.icon ?? '';
  const copy = document.createElement('div');
  copy.className = 'endfeature-copy';
  const kicker = document.createElement('small');
  kicker.textContent = feature.kicker;
  const title = document.createElement('b');
  title.textContent = feature.title;
  copy.append(kicker, title);
  // the plates' own mark for a row that opens something (ui/plate.ts)
  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.textContent = '›';
  box.append(icon, copy, chev);
}

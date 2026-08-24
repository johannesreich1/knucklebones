import { formatNumber } from '../i18n/index.ts';

export const esc = (text: string): string => text.replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export const pts = (points: number): string => formatNumber(points);
export const rank = (position: number): string => '#' + formatNumber(position);
export const percent = (ratio: number): string => formatNumber(ratio, {
  style: 'percent',
  maximumFractionDigits: 0,
});

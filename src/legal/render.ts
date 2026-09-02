import type { LegalDocument } from './types.ts';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  })[character]!);
}

// Legal facts are interpolated into natural-language prose. Restrict automatic
// links to ASCII URI/email syntax so Japanese and Korean particles next to a
// fact remain prose instead of becoming part of the href. The publication
// validator consumes the same email source so accepted addresses stay
// clickable instead of being partially linked.
const EMAIL_SOURCE = "[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+";
const HTTPS_SOURCE = "https://[A-Za-z0-9._~:/?#\\[\\]@!$&'()*+,;=%-]+";
const LINK = new RegExp(`(${HTTPS_SOURCE}|${EMAIL_SOURCE})`, 'gu');
const PUBLIC_EMAIL = new RegExp(`^${EMAIL_SOURCE}$`, 'u');

export function isLinkablePublicEmail(value: string): boolean {
  return PUBLIC_EMAIL.test(value);
}

function linkedText(value: string): string {
  let output = '';
  let offset = 0;
  for (const match of value.matchAll(LINK)) {
    const index = match.index ?? 0;
    output += escapeHtml(value.slice(offset, index));
    const target = match[0];
    const trailing = target.match(/[.,;:!?)]$/u)?.[0] ?? '';
    const clean = trailing ? target.slice(0, -1) : target;
    const href = clean.startsWith('https://') ? clean : `mailto:${clean}`;
    output += `<a href="${escapeHtml(href)}">${escapeHtml(clean)}</a>${escapeHtml(trailing)}`;
    offset = index + target.length;
  }
  return (output + escapeHtml(value.slice(offset))).replace(/\n/gu, '<br>');
}

export function renderLegalDocumentBody(document: LegalDocument): string {
  const sections = document.sections.map((section) => {
    const blocks = section.blocks.map((block) => block.kind === 'paragraph'
      ? `<p>${linkedText(block.text ?? '')}</p>`
      : `<ul>${(block.items ?? []).map((item) => `<li>${linkedText(item)}</li>`).join('')}</ul>`).join('');
    return `<section><h2>${escapeHtml(section.heading)}</h2>${blocks}</section>`;
  }).join('');
  return `<article class="legal-document" data-legal-document="${document.page}">
    <h1 tabindex="-1">${escapeHtml(document.title)}</h1>
    <p class="legal-intro">${linkedText(document.intro)}</p>
    ${sections}
  </article>`;
}

export { escapeHtml };

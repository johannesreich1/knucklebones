import {
  LOCALE_NAMESPACES,
  type LocaleKey,
  type LocaleNamespace,
} from './catalogs.ts';
import {
  effectiveLocale,
  subscribeLocale,
  t,
  translationExists,
  trustedStaticRich,
} from './runtime.ts';

function isNamespace(value: string): value is LocaleNamespace {
  return LOCALE_NAMESPACES.includes(value as LocaleNamespace);
}

function translationToken(token: string): [LocaleNamespace, string] {
  const separator = token.indexOf(':');
  const namespace = separator < 0 ? '' : token.slice(0, separator).trim();
  const key = separator < 0 ? '' : token.slice(separator + 1).trim();
  if (!isNamespace(namespace) || !key || !translationExists(namespace, key)) {
    throw new TypeError(`Unknown translation token: ${token}`);
  }
  return [namespace, key];
}

function elementMatches(value: unknown, selector: string): value is Element {
  return !!value && typeof (value as Element).matches === 'function'
    && (value as Element).matches(selector);
}

function elementsFor(root: ParentNode, selector: string): Element[] {
  const elements = Array.from(root.querySelectorAll(selector));
  if (elementMatches(root, selector)) elements.unshift(root);
  return elements;
}

/** Translate explicitly tagged static markup. Deliberately no MutationObserver. */
export function translateDom(root: ParentNode): void {
  for (const element of elementsFor(root, '[data-i18n]')) {
    const [namespace, key] = translationToken(element.getAttribute('data-i18n') ?? '');
    element.textContent = t(namespace, key as LocaleKey<typeof namespace>);
  }
  for (const element of elementsFor(root, '[data-i18n-rich]')) {
    const [namespace, key] = translationToken(element.getAttribute('data-i18n-rich') ?? '');
    element.innerHTML = trustedStaticRich(namespace, key as LocaleKey<typeof namespace>);
  }
  for (const element of elementsFor(root, '[data-i18n-attr]')) {
    const declarations = (element.getAttribute('data-i18n-attr') ?? '').split(';');
    for (const declaration of declarations) {
      if (!declaration.trim()) continue;
      const separator = declaration.indexOf('=');
      const attribute = separator < 0 ? '' : declaration.slice(0, separator).trim();
      const token = separator < 0 ? '' : declaration.slice(separator + 1).trim();
      if (!/^[A-Za-z_:][\w:.-]*$/u.test(attribute)) {
        throw new TypeError(`Invalid translated attribute: ${attribute}`);
      }
      const [namespace, key] = translationToken(token);
      element.setAttribute(attribute, t(namespace, key as LocaleKey<typeof namespace>));
    }
  }
}

export type LocaleRootOwnership = 'document' | 'widget';

function setRootLanguage(root: HTMLElement, ownership: LocaleRootOwnership): void {
  const owner = ownership === 'document' ? root.ownerDocument.documentElement : root;
  owner.lang = effectiveLocale();
}

/** Own `<html lang>` in the app, but only the widget root when embedded. */
export function bindLocaleRoot(
  root: HTMLElement,
  ownership: LocaleRootOwnership,
): () => void {
  const render = (): void => {
    setRootLanguage(root, ownership);
    translateDom(root);
  };
  render();
  return subscribeLocale(render);
}

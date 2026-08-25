import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const problems = [];
const check = (condition, message, detail) => {
  if (!condition) problems.push(`${message}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
};

const source = readFileSync('public/sw.js', 'utf8').replace(
  'const LEGAL_PATHS = [];',
  'const LEGAL_PATHS = ["/legal/en/privacy/"];',
);
const listeners = new Map();
const stored = new Map();
let online = true;
let sequence = 0;
const keyOf = (key) => typeof key === 'string' ? key : key.url;
const cache = {
  addAll: async () => undefined,
  put: async (key, response) => { stored.set(keyOf(key), response.clone()); },
};
const context = {
  URL,
  Request,
  Response,
  Promise,
  Error,
  setTimeout,
  clearTimeout,
  location: { origin: 'https://example.test' },
  self: {
    registration: { scope: 'https://example.test/' },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener: (type, listener) => listeners.set(type, listener),
  },
  caches: {
    open: async () => cache,
    match: async (key) => stored.get(keyOf(key)),
    keys: async () => ['kb-dev'],
    delete: async () => true,
  },
  fetch: async (request) => {
    if (!online) throw new Error('offline');
    sequence++;
    return new Response(`network-${sequence}:${request.url}`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  },
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'public/sw.js' });

function dispatch(url, mode = 'navigate') {
  let response;
  listeners.get('fetch')({
    request: { method: 'GET', mode, url },
    respondWith: (promise) => { response = Promise.resolve(promise); },
  });
  return response;
}

const rootKey = 'https://example.test/index.html';
const legalKey = 'https://example.test/legal/en/privacy/';
check(context.canonicalPageKey('https://example.test/') === rootKey,
  'root did not normalize to the app-shell cache key');
check(context.canonicalPageKey('https://example.test/index.html?from=test') === rootKey,
  'root query created another app-shell identity');
check(context.canonicalPageKey(legalKey) === legalKey,
  'known legal route did not retain its own cache key');
check(context.canonicalPageKey('https://example.test/legal/en/missing/') === null,
  'unknown legal route was treated as a cacheable page');

const rootNetwork = await dispatch('https://example.test/');
const rootBody = await rootNetwork.text();
const legalNetwork = await dispatch(legalKey);
const legalBody = await legalNetwork.text();
check(stored.has(rootKey) && stored.has(legalKey),
  'root and legal responses were not cached independently', [...stored.keys()]);
check(rootBody !== legalBody, 'network fixtures did not distinguish root and legal content');

online = false;
const offlineRoot = await (await dispatch('https://example.test/')).text();
const offlineLegal = await (await dispatch(legalKey)).text();
check(offlineRoot === rootBody, 'visiting legal replaced the offline Home response');
check(offlineLegal === legalBody, 'visited legal route did not retain its own offline response');

const unknown = dispatch('https://example.test/legal/en/missing/');
check(unknown === undefined, 'unknown navigation received a worker fallback');

let assetRejected = false;
try { await dispatch('https://example.test/assets/missing.js', 'same-origin'); }
catch { assetRejected = true; }
check(assetRejected, 'missing asset fell back to cached HTML');

console.log(JSON.stringify({ cached: [...stored.keys()], problems, errs: [] }, null, 2));
process.exitCode = problems.length ? 1 : 0;

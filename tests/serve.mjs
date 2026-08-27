// THE ONE STATIC SERVER — and the reason a peer's gate can run beside yours.
//
// Why any server at all: service workers refuse file:// pages
// (pwa-service-worker, pwa-update), and Chromium's file:// DOMStorage can
// hydrate a reloaded document from a stale disk commit — that race ate
// hud-timer's and tutorial-persistence's persistence codas repeatedly. Both
// want a real http origin.
//
// WHY AN EPHEMERAL PORT. The origin used to be a constant: 8123 for the pwa
// tree, 8124-6 for the three suites that bring their own server. A port
// number is machine-global, so two checkouts gating at the same time fought
// over it, and the two failures were not equally kind:
//   · 8124-6 failed LOUDLY — the suite noticed its server child had died on
//     the bind and threw "port held by a foreign server".
//   · 8123 failed SILENTLY. serve.py lost the bind and died, and the runner's
//     waitForPort(8123) then connected happily to the NEIGHBOUR's server. The
//     service-worker suites read the neighbour's pwa/ while that neighbour's
//     pwa-update rewrote it underneath them. Green meant nothing; red meant
//     nothing either.
// Binding port 0 hands the choice to the kernel. Not a scan for a free port —
// a scan still races between the look and the bind. There is no number to
// collide on, so waitForPort, the "is that server actually mine?" guard and
// the orphan-server class of bug are gone rather than handled.
//
// WHY NODE, NOT PYTHON. There were three servers: serve.py, which fixed the
// .webmanifest mime type and sent no-cache (pwa-service-worker asserts both),
// plus two bare `python3 -m http.server` spawns that did neither. One
// implementation, one set of headers, and no child process to wait for, kill,
// or orphan.
//
// Paths are resolved against the CURRENT WORKING DIRECTORY, which every suite
// and the runner set to the repo root — so a worktree serves its own build.
import http from 'node:http';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/* serve.py had to spell out .js and .webmanifest and so do we: some Python
   installs still call .js text/plain, and a text/plain module never executes;
   .webmanifest they do not know at all, and pwa-service-worker asserts that
   exact type. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

/** Serve `dir` on 127.0.0.1 and resolve once it is listening.
 *  → { url, port, stop }.  url always ends in '/', so `url + 'index.html'`
 *  is the whole of the address arithmetic a suite ever needs to do. */
export function serveTree(dir, { port = 0 } = {}) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const send = (code, body, type = 'text/plain; charset=utf-8') => {
      // no-cache: pwa-update rewrites files under a running page and reloads —
      // it must be served the new bytes, not the ones the browser remembers.
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    let file;
    try {
      // req.url is origin-form ('/x'), and a bare '//' would parse as a
      // protocol-relative URL against a base — so give it a real origin.
      const p = decodeURIComponent(new URL('http://127.0.0.1' + req.url).pathname);
      file = path.join(root, path.normalize(p));
      if (p.endsWith('/')) file = path.join(file, 'index.html');
    } catch { return send(400, 'bad request'); }
    /* The URL parser already collapses dot segments and normalize() drops the
       leading '..' of an absolute path, so this is the backstop rather than
       the front line — but a served tree is not the place to be clever. */
    if (file !== root && !file.startsWith(root + path.sep)) return send(403, 'forbidden');
    fsp.readFile(file).then(
      buf => send(200, buf, MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'),
      () => send(404, 'not found'));   // EISDIR lands here too, which is fine
  });
  /* A suite ends by falling off the end of its file, so the server must never
     be what keeps the process alive — nor a keep-alive socket Playwright left
     open. stop() is for the runner, which outlives its suites on purpose. */
  server.on('connection', s => s.unref());
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.unref();
      const { port: bound } = server.address();
      resolve({ url: `http://127.0.0.1:${bound}/`, port: bound, stop: () => server.close() });
    });
  });
}

/** The pwa/ origin, for the suites that read the built app.
 *  Inside the gate, run-all serves the tree ONCE and passes the address down
 *  in KB_URL. Run by hand, a suite starts its own — nothing to launch in
 *  another terminal first, and no instructions to forget. */
export async function servedBase() {
  return process.env.KB_URL ?? (await serveTree('pwa')).url;
}

// `mise exec -- npm run serve`: a human wants a stable address to click, so this keeps the
// old 8123 default (and takes a port argument when that one is busy).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? 8123) || 8123;
  try {
    const { url } = await serveTree('pwa', { port });
    console.log(`serving ./pwa on ${url}`);
    setInterval(() => {}, 1 << 30);   // suites let their server go; this one waits for Ctrl-C
  } catch (e) {
    console.error(e.code === 'EADDRINUSE'
      ? `port ${port} is busy — try: mise exec -- node tests/serve.mjs ${port + 1}` : e.message);
    process.exit(1);
  }
}

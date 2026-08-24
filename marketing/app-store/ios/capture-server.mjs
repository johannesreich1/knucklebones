import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const runtimePath = path.join(root, 'knucklebones-neon.html');
const sourcePath = path.join(here, 'source.html');
const port = Number(process.env.KB_CAPTURE_PORT) || 8765;

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'warn',
  server: { middlewareMode: true },
});

const server = createHttpServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://capture.local').pathname;

  // Vite cannot parse the control characters embedded in the production
  // single-file bundle. Serve that one artifact byte-for-byte while Vite
  // transforms the TypeScript modules imported by the deterministic fixtures.
  if (pathname === '/knucklebones-neon.html') {
    try {
      const runtime = await readFile(runtimePath);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': runtime.length,
        'Content-Type': 'text/html; charset=utf-8',
      });
      response.end(runtime);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (pathname === '/marketing/app-store/ios/source.html') {
    try {
      const source = await readFile(sourcePath, 'utf8');
      const transformed = await vite.transformIndexHtml(request.url ?? pathname, source);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(transformed),
        'Content-Type': 'text/html; charset=utf-8',
      });
      response.end(transformed);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  vite.middlewares(request, response, () => {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
});

const close = async () => {
  await vite.close();
  server.close();
};

process.once('SIGINT', close);
process.once('SIGTERM', close);

server.listen(port, '127.0.0.1', () => {
  console.log(`Capture source ready at http://localhost:${port}/marketing/app-store/ios/source.html?slide=1`);
});

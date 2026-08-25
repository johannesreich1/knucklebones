import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer as createViteServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const runtimePath = path.join(root, 'knucklebones-neon.html');
const sourcePath = path.join(here, 'source.html');

export async function startCaptureServer({ port = 0 } = {}) {
  const vite = await createViteServer({
    root,
    appType: 'custom',
    logLevel: 'warn',
    server: { middlewareMode: true, hmr: false },
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

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Capture server did not expose a TCP port');
  let closed = false;
  return {
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      await vite.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.KB_CAPTURE_PORT) || 8765;
  const running = await startCaptureServer({ port });
  console.log(`Capture source ready at ${running.url}/marketing/app-store/ios/source.html?slide=1&locale=en-GB&target=iphone-6.9`);
  const close = () => { void running.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

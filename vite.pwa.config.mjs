// Hosted PWA build: normal chunked output with hashed assets. Chosen for
// failure isolation, not size — future account/backend code lazy-loads so the
// offline game's boot path never depends on it. The service worker precaches
// the chunk list build.mjs generates from this output.
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist/pwa',
    minify: true,
    modulePreload: { polyfill: false },
  },
});

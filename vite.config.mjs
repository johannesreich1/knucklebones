// Main build: the standalone page / hosted PWA / native webview.
// Output is a single self-contained HTML file (offline PWA, Capacitor and the
// "one file you can airdrop" deliverable all want exactly that shape).
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  publicDir: 'public',
  build: {
    outDir: 'dist/main',
    // Readable output while the modular migration is underway — the artifact
    // stays diffable against the old hand-written source. Revisit later.
    minify: false,
    modulePreload: { polyfill: false },
  },
});

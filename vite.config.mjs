// Main build: the standalone page / hosted PWA / native webview.
// Output is a single self-contained HTML file (offline PWA, Capacitor and the
// "one file you can airdrop" deliverable all want exactly that shape).
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  publicDir: 'public',
  // dev server: honour an assigned port (e.g. the IDE preview) over the default
  // 5166, not 5173: another project on this machine owns 5173 (owner, 2026-09-04)
  server: { port: Number(process.env.PORT) || 5166 },
  build: {
    outDir: 'dist/main',
    minify: true,
    modulePreload: { polyfill: false },
  },
});

// Widget build: same source, second entry point. build.mjs extracts the
// fragment (styles + #kbroot + script) from this build's single-file page.
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  publicDir: false,
  build: {
    outDir: 'dist/widget',
    minify: true,
    modulePreload: { polyfill: false },
    rollupOptions: { input: 'widget-page.html' },
  },
});

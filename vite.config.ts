import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  // Relative base so the single-file build works at any URL path —
  // GitHub Pages (project sub-path), local file://, custom domains, etc.
  base: './',
  plugins: [react(), viteSingleFile()],
  server: {
    port: 8765,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    // viteSingleFile inlines JS+CSS into index.html. These options reinforce that.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});

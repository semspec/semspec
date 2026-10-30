// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Vite config of the app. The build writes 1 script and 1 style sheet to packages/app/dist. The
// CLI puts both into 1 HTML file, together with the graph data.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  plugins: [react(), tailwindcss()],
  // 1 copy of React for the app and for every library. 2 copies break the hooks.
  resolve: { alias: { '@': here('./src'), '@semspec/core': here('../core/src/index.ts') }, dedupe: ['react', 'react-dom'] },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: { entry: 'src/main.tsx', formats: ['iife'], name: 'Semspec', fileName: () => 'viewer.js', cssFileName: 'viewer' },
    outDir: 'dist',
    cssCodeSplit: false,
    minify: true,
    emptyOutDir: true,
  },
});

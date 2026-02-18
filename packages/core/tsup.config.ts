import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['better-sqlite3', 'sqlite-vec', '@huggingface/transformers', 'chokidar'],
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
    external: ['better-sqlite3', 'sqlite-vec', '@huggingface/transformers', 'chokidar'],
  },
]);

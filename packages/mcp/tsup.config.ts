import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  external: ['better-sqlite3', 'sqlite-vec', '@huggingface/transformers', 'chokidar'],
  noExternal: [],
});

import { defineConfig } from 'tsup';

export default defineConfig({
  // dist/index.js (the API) and dist/seed.js (production seed without tsx: `node dist/seed.js`).
  entry: { index: 'src/index.ts', seed: 'prisma/seed.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Two standalone files, no shared chunks.
  splitting: false,
  // Shared contract is TypeScript source in the monorepo: bundle it in.
  noExternal: ['@pw/shared'],
});

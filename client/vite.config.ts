import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // The API listens on 127.0.0.1 only in development (not "localhost", which may resolve to ::1 first).
    proxy: { '/api': 'http://127.0.0.1:4000' },
    // The dev server is reachable from the LAN (iPads at the stall), so it only serves the client, the shared
    // package and node_modules: never the rest of the project (database files, backups, server code).
    fs: {
      allow: [here('.'), here('../shared'), here('../node_modules')],
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.pgdata/**', '**/backups/**'],
    },
  },
});

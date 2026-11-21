import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two pages: the owner app (index.html) and the public twin page for visitors (t.html).
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900, // the Firebase SDK is one large shared chunk
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        t: resolve(import.meta.dirname, 't.html'),
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
} as any);

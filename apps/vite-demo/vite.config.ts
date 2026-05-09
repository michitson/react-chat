import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Workspace-dev override: send the package name straight at the TS source
      // so HMR works on package edits. The published package's main/exports
      // point at dist/, which would force a rebuild on every change.
      '@michitson/react-chat': path.resolve(
        __dirname,
        '../../packages/react-chat/src/index.ts',
      ),
    },
  },
});

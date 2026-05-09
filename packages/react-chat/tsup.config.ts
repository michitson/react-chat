import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['react', 'react-dom'],
  banner: {
    // esbuild strips top-level directives during bundling; re-inject 'use client'
    // so consumers (Next.js App Router) treat the built output as a client component.
    js: "'use client';",
  },
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});

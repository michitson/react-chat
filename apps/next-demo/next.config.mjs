import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The published package's main/exports point at dist/ (built JS). For
  // workspace dev consumption we want HMR straight off the TS source, so
  // alias the package name to the source entry.
  webpack: (config) => {
    config.resolve.alias['@michitson/react-chat'] = path.resolve(
      __dirname,
      '../../packages/react-chat/src/index.ts',
    );
    return config;
  },
  // transpilePackages stays as a belt-and-braces — Next will process the .ts
  // file the alias resolves to even though it lives outside the app dir.
  transpilePackages: ['@michitson/react-chat'],
};

export default nextConfig;

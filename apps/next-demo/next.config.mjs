/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace package's main field points at TS source for HMR-friendly
  // dev consumption. Without transpilePackages, Next won't process .ts/.tsx
  // imported from node_modules (the pnpm symlink target).
  transpilePackages: ['@michitson/react-chat'],
};

export default nextConfig;

import type { Config } from 'tailwindcss';

export default {
  content: [
    './app/**/*.{ts,tsx}',
    '../../packages/react-chat/src/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
} satisfies Config;

import type { Config } from 'tailwindcss';

export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/chatbot/src/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
} satisfies Config;

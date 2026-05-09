import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '@michitson/react-chat — Next.js demo',
  description: 'RSC-boundary smoke test for the react-chat component.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="h-full">{children}</body>
    </html>
  );
}

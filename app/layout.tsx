import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vent Nightmare',
  description: 'A 2D vent-based horror experience',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

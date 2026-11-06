import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro, Space_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppSidebar } from '../shared/layout/app-sidebar';
import { AppTopbar } from '../shared/layout/app-topbar';
import './globals.css';
import styles from './layout.module.css';

// Self-hosted at build time: no request to Google when the app runs.
const headingFont = Space_Grotesk({
  subsets: ['latin', 'vietnamese'],
  weight: ['500', '600', '700'],
  variable: '--font-heading',
  display: 'swap',
});

const bodyFont = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AI Team',
  description: 'Điều phối nhiều agent AI theo phòng ban, chạy trên máy của bạn.',
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#080D1A',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={`${headingFont.variable} ${bodyFont.variable}`}>
      <body>
        <div className={styles.shell}>
          <AppSidebar />
          <main className={styles.main}>
            <AppTopbar />
            <div className={styles.content}>{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}

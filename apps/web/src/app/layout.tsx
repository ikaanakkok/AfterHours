import type { Metadata } from 'next';
import { DesignSystem } from '@/components/design-system';
import '@fontsource-variable/plus-jakarta-sans/wght.css';

export const metadata: Metadata = {
  title: 'AfterHours · Business workspace',
  description: 'AfterHours workspace for customer requests and business operations.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DesignSystem />
        {children}
      </body>
    </html>
  );
}

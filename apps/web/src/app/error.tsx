'use client';

import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Button, Notice } from '@/components/ui';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="screen-state">
      <div className="panel screen-state-card stack">
        <div className="micro">AFTERHOURS</div>
        <h1>Could not open the workspace.</h1>
        <Notice variant="error">
          Something went wrong while loading this page. Check that the service is running, then try
          again.
        </Notice>
        <Button variant="primary" onClick={reset}>
          <RefreshCw size={14} aria-hidden="true" />
          Reload page
        </Button>
        <Link className="button ghost" href="/overview">
          Back to overview
        </Link>
      </div>
    </main>
  );
}

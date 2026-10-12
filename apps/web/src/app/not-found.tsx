import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <main className="screen-state">
      <div className="panel screen-state-card stack">
        <div className="micro">AFTERHOURS · 404</div>
        <h1>Page not found.</h1>
        <p className="muted">Choose a section from your workspace to continue.</p>
        <Link className="button primary" href="/overview">
          Back to your workspace <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </main>
  );
}

'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LockKeyhole, Moon } from 'lucide-react';
import { Button, Input, Notice } from './ui';

export function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
        }),
      });
      if (!response.ok) {
        setError(
          response.status === 429
            ? 'Too many attempts. Wait a moment and try again.'
            : 'Sign-in failed. Check your email and password.',
        );
        return;
      }
      const tenantResponse = await fetch('/api/tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: null }),
      });
      if (!tenantResponse.ok) {
        setError(
          'You signed in, but your business workspace could not be selected. Please try again.',
        );
        return;
      }
      router.replace('/overview');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check that AfterHours is running.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story" aria-label="AfterHours">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          AfterHours
        </div>
        <div>
          <Moon size={27} color="var(--accent)" aria-hidden="true" style={{ marginBottom: 25 }} />
          <h1>
            The workday ends.
            <br />
            Your work carries on.
          </h1>
          <p>
            Your business assistant welcomes customers, handles the tasks you teach it, and keeps
            you informed when needed.
          </p>
        </div>
        <small>ON YOUR MAC · UNDER YOUR CONTROL</small>
      </section>
      <section className="login-form-side">
        <div className="login-form">
          <div className="micro" style={{ marginBottom: 12 }}>
            BUSINESS WORKSPACE
          </div>
          <h2>Welcome back.</h2>
          <p>Sign in with your authorized business account.</p>
          <form className="form-stack" onSubmit={login}>
            <Input
              label="Email address"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="admin@afterhours.local"
              required
            />
            <Input
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-describedby={error ? 'login-error' : undefined}
              aria-invalid={!!error}
            />
            {error && (
              <div role="alert" id="login-error">
                <Notice variant="error">{error}</Notice>
              </div>
            )}
            <Button type="submit" variant="primary" busy={busy}>
              Sign in to your workspace <ArrowRight size={15} aria-hidden="true" />
            </Button>
          </form>
          <div
            className="row muted"
            style={{ marginTop: 24, fontSize: 12, alignItems: 'flex-start' }}
          >
            <LockKeyhole size={14} aria-hidden="true" />
            <p>
              A temporary password for your local setup account is created during setup. Each
              business signs in with its own authorized users.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

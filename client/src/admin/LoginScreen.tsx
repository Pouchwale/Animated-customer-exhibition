import { useState } from 'react';
import { Loader2, LogIn } from 'lucide-react';
import type { AdminUser } from '@pw/shared';
import { adminApi } from '../api/client';
import { errorText } from './ui';

export function LoginScreen({ onLogin, notice }: { onLogin: (user: AdminUser) => void; notice?: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await adminApi.login(email.trim(), password));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-pw-yellow-tint px-4 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border-2 border-ink bg-paper p-6 shadow-stamp-lg sm:p-8"
      >
        <img src="/logo-pink.png" alt="PouchWale" className="mb-6 h-9 w-auto" />
        <p className="pw-eyebrow text-pw-pink">Admin panel</p>
        <h1 className="pw-display mt-1 text-4xl">Sign in</h1>
        <p className="mt-2 text-sm font-semibold text-ink-2">Manage priority topics, recommendations and animations.</p>

        {notice && !error && (
          <p className="mt-4 rounded-xl bg-pw-blue-tint px-3 py-2 text-sm font-bold">{notice}</p>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-xl border-2 border-ink bg-pw-orange-tint px-3 py-2 text-sm font-bold">
            {error}
          </p>
        )}

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="pw-label">Email</span>
            <input
              className="pw-input"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="pw-label">Password</span>
            <input
              className="pw-input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>

        <button type="submit" className="pw-btn pw-btn-primary mt-6 w-full" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <a href="/" className="mt-4 block text-center text-xs font-bold text-ink-2 underline hover:text-ink">
          Back to the customer page
        </a>
      </form>
    </main>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, ListOrdered, Loader2, LogOut, MonitorPlay, Sparkles } from 'lucide-react';
import type { AdminUser } from '@pw/shared';
import { adminApi, ApiRequestError } from '../api/client';
import { LoginScreen } from './LoginScreen';
import { AdminProvider, errorText, useAdmin } from './ui';
import { ParametersTab } from './ParametersTab';
import { RecommendationsTab } from './RecommendationsTab';
import { IdleLogoTab } from './IdleLogoTab';
import { IntroSection } from './IntroSection';
import { ChangePasswordButton } from './ChangePassword';

/** Intro animation and idle logo mode. */
function AnimationsTab() {
  return (
    <div className="space-y-12">
      <IntroSection />
      <IdleLogoTab />
    </div>
  );
}

const TABS = [
  { id: 'parameters', label: 'Priority topics', icon: ListOrdered, Component: ParametersTab },
  { id: 'recommendations', label: 'Recommendations', icon: Sparkles, Component: RecommendationsTab },
  { id: 'animations', label: 'Animations', icon: MonitorPlay, Component: AnimationsTab },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Old links (#suggestions, #idle-logo, …) open the tab that now holds them. */
const HASH_ALIASES: Record<string, TabId> = {
  suggestions: 'recommendations',
  'idle-logo': 'animations',
  intro: 'animations',
};

const tabFromHash = (): TabId => {
  const raw = window.location.hash.replace('#', '').split('/')[0];
  const h = HASH_ALIASES[raw] ?? raw;
  return (TABS.find((t) => t.id === h)?.id ?? 'parameters') as TabId;
};

export function AdminApp() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Admin · PouchWale Configurator';
    adminApi
      .me()
      .then(setUser)
      .catch((err) => {
        if (!(err instanceof ApiRequestError && err.status === 401)) setNotice(errorText(err));
      })
      .finally(() => setChecking(false));
  }, []);

  const onAuthLost = useCallback(() => {
    setUser(null);
    setNotice('Your session has expired. Please sign in again.');
  }, []);

  if (checking) {
    return (
      <main className="flex min-h-dvh items-center justify-center gap-2 text-sm font-bold text-ink-2">
        <Loader2 className="size-4 animate-spin" /> Checking session…
      </main>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        notice={notice}
        onLogin={(u) => {
          setNotice(null);
          setUser(u);
        }}
      />
    );
  }

  return (
    <AdminProvider user={user} onAuthLost={onAuthLost}>
      <AdminShell
        onSignedOut={() => {
          setUser(null);
          setNotice('You have signed out.');
        }}
      />
    </AdminProvider>
  );
}

function AdminShell({ onSignedOut }: { onSignedOut: () => void }) {
  const { user, reportError } = useAdmin();
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const select = (id: TabId) => {
    setTab(id);
    history.replaceState(null, '', `#${id}`);
  };

  async function signOut() {
    setSigningOut(true);
    try {
      await adminApi.logout();
      onSignedOut();
    } catch (err) {
      reportError(err);
    } finally {
      setSigningOut(false);
    }
  }

  const Active = TABS.find((t) => t.id === tab)!.Component;

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b-2 border-ink bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
          <a href="/admin" className="flex items-center gap-3">
            <img src="/logo-pink.png" alt="PouchWale" className="h-7 w-auto" />
            <span className="pw-display rounded-md bg-ink px-2 pb-0.5 pt-1 text-sm text-paper">Admin</span>
          </a>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="hidden text-sm font-bold sm:inline">{user.name}</span>
            <span
              className={`rounded-full border-2 border-ink px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${
                user.role === 'ADMIN' ? 'bg-pw-pink text-paper' : 'bg-pw-blue-tint text-ink'
              }`}
              title={user.role === 'ADMIN' ? 'Full access' : 'Can add, edit and hide priority topics; recommendations and animations are admin-only'}
            >
              {user.role}
            </span>
            <a href="/" className="pw-btn-quiet">
              <ExternalLink className="size-3.5" />
              <span className="hidden sm:inline">View customer page</span>
              <span className="sm:hidden">Site</span>
            </a>
            <ChangePasswordButton />
            <button type="button" className="pw-btn pw-btn-ghost !py-1.5" onClick={signOut} disabled={signingOut}>
              {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              Sign out
            </button>
          </div>
        </div>
        <nav className="mx-auto max-w-6xl overflow-x-auto px-4 sm:px-6" aria-label="Admin sections">
          <ul className="flex gap-1 pb-3" role="tablist">
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = id === tab;
              return (
                <li key={id}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => select(id)}
                    className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border-2 px-3 py-1.5 text-sm font-extrabold transition-colors duration-[140ms] ${
                      active ? 'border-ink bg-ink text-paper' : 'border-transparent text-ink-2 hover:bg-pw-yellow-tint hover:text-ink'
                    }`}
                  >
                    <Icon className={`size-4 ${active ? 'text-pw-yellow' : ''}`} />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8" role="tabpanel">
        <Active />
      </main>
    </div>
  );
}

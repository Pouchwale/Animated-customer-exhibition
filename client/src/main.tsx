import { StrictMode, useCallback, useMemo, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import './index.css';
import { KioskContext } from './kiosk/kiosk';
import { FullscreenExitButton, IdleReset } from './kiosk/KioskControls';
import { CrashScreen, ErrorBoundary } from './kiosk/CrashScreen';
import { PRIORITIES_STORAGE_KEY } from './customer/model';
import { destroySmoothScroll, initSmoothScroll, scrollToTop } from './scroll/smoothScroll';

// Two surfaces only: the customer configurator ("/") and the admin panel ("/admin").
// Each is its own chunk so customers never download admin code.
const isAdmin = window.location.pathname.replace(/\/+$/, '').startsWith('/admin');
const root = createRoot(document.getElementById('root')!);

// Smooth scrolling for every page (customer site and admin panel), started once.
initSmoothScroll();
import.meta.hot?.dispose(destroySmoothScroll);

if (isAdmin) {
  document.getElementById('boot-cover')?.remove();
  import('./admin/AdminApp').then(({ AdminApp }) =>
    root.render(
      <StrictMode>
        <AdminApp />
      </StrictMode>,
    ),
  );
} else {
  // The brand intro plays on every load/reload; the page mounts underneath once the screen is covered.
  Promise.all([import('./customer/CustomerPage'), import('./intro/BrandIntro')]).then(([{ CustomerPage }, { BrandIntro }]) =>
    root.render(
      <StrictMode>
        <Site Page={CustomerPage} Intro={BrandIntro} />
      </StrictMode>,
    ),
  );
}

const VISITOR_STORAGE = [PRIORITIES_STORAGE_KEY];

function Site({
  Page,
  Intro,
}: {
  Page: ComponentType;
  Intro: ComponentType<{ onReveal: () => void; onDone: () => void }>;
}) {
  const [revealed, setRevealed] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  /** Bumped by "Start over": remounts the page with a clean slate and replays the intro (no reload, so fullscreen stays on). */
  const [session, setSession] = useState(0);

  const restart = useCallback(() => {
    try {
      VISITOR_STORAGE.forEach((k) => localStorage.removeItem(k));
    } catch {
      // Storage blocked: nothing was saved anyway.
    }
    scrollToTop();
    setIntroDone(false);
    setSession((s) => s + 1);
  }, []);
  const kiosk = useMemo(() => ({ restart }), [restart]);
  // The intro crashed: go straight to the page (the boot cover may still be up if it crashed early).
  const skipIntro = useCallback(() => {
    document.getElementById('boot-cover')?.remove();
    setRevealed(true);
    setIntroDone(true);
  }, []);

  return (
    <KioskContext.Provider value={kiosk}>
      {/* Reduced motion (the visitor's setting) for everything, including the kiosk buttons outside the page. */}
      <MotionConfig reducedMotion="user">
        {/* Never a blank screen: a crash shows "Something went wrong" with Start over. */}
        <ErrorBoundary fallback={<CrashScreen />} resetKey={session}>
          {revealed && <Page key={`page-${session}`} />}
          <ErrorBoundary fallback={null} resetKey={session} onError={skipIntro}>
            {!introDone && <Intro key={`intro-${session}`} onReveal={() => setRevealed(true)} onDone={() => setIntroDone(true)} />}
          </ErrorBoundary>
        </ErrorBoundary>
        <IdleReset />
        <FullscreenExitButton />
      </MotionConfig>
    </KioskContext.Provider>
  );
}

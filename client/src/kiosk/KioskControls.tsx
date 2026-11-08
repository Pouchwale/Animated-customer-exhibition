import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Maximize2, Minimize2, RotateCcw, Share, X } from 'lucide-react';
import { enterFullscreen, exitFullscreen, idleSeconds, useKioskSession, useScreenMode } from './kiosk';
import { ACTIVITY_EVENT } from '../customer/activity';
import { SPRING, T } from '../motion';

/** Header buttons: Full screen (or how to get it) and, in kiosk mode, Start over. */
export function KioskControls() {
  const mode = useScreenMode();
  const { restart } = useKioskSession();
  const [help, setHelp] = useState(false);

  // Kiosk mode: no pinch-zoom, no rubber-band/pull-to-refresh (see .kiosk in index.css).
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('kiosk', mode.kiosk);
    if (!mode.kiosk) return;
    const block = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', block); // Safari pinch
    return () => {
      document.removeEventListener('gesturestart', block);
      html.classList.remove('kiosk');
    };
  }, [mode.kiosk]);

  const goFullscreen = async () => {
    if (!mode.supported || !(await enterFullscreen())) setHelp(true);
  };

  return (
    <div className="relative flex items-center gap-2">
      {mode.kiosk && (
        <button type="button" onClick={restart} className="pw-btn pw-btn-ghost !py-1.5">
          {/* Icon only on phones, where the header also holds Tilt and Sound (names stay for screen readers). */}
          <RotateCcw className="size-4" /> <span className="sr-only sm:not-sr-only">Start over</span>
        </button>
      )}
      {/* In full screen, the floating Exit button (FullscreenExitButton) takes over. */}
      {mode.fullscreen && (
        // Same size as the floating Exit button, so it never covers "Start over".
        <span aria-hidden className="pw-btn invisible min-h-11 !px-4">
          <Minimize2 className="size-4" /> Exit full screen
        </span>
      )}
      {!mode.standalone && !mode.fullscreen && (
        <button type="button" onClick={goFullscreen} className="pw-btn pw-btn-primary !py-1.5">
          <Maximize2 className="size-4" /> <span className="sr-only sm:not-sr-only">Full screen</span>
        </button>
      )}

      <AnimatePresence>
        {help && (
          <motion.div
            role="dialog"
            aria-label="Show full screen"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={T.enter}
            className="absolute top-full right-0 z-50 mt-2 w-[min(320px,calc(100vw-32px))] rounded-2xl border-2 border-ink bg-paper p-4 text-sm shadow-stamp"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="pw-display text-lg">Go full screen</p>
              <button
                type="button"
                onClick={() => setHelp(false)}
                aria-label="Close"
                className="-m-1 flex size-9 items-center justify-center rounded-full hover:bg-ink/5"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-1 font-semibold text-ink-2">This browser can’t hide its controls from a button. Install the page instead:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 font-semibold">
              <li>
                Tap <Share className="inline size-4 align-[-2px]" /> <b>Share</b> in the browser bar.
              </li>
              <li>
                Choose <b>Add to Home Screen</b>.
              </li>
              <li>Open PouchWale from the Home Screen — it fills the whole screen.</li>
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Always-reachable Exit Full Screen button: pinned to the top-right corner and shown only
 * while the page is in full screen. Esc also exits (browsers do this natively; the key
 * handler covers browsers that pass Esc to the page instead).
 */
export function FullscreenExitButton() {
  const mode = useScreenMode();

  useEffect(() => {
    if (!mode.fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void exitFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode.fullscreen]);

  return (
    <AnimatePresence>
      {mode.fullscreen && (
        <motion.button
          type="button"
          onClick={() => void exitFullscreen()}
          initial={{ opacity: 0, scale: 0.8, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: -8 }}
          transition={SPRING.settle}
          className="pw-btn pw-btn-primary fixed top-[max(12px,env(safe-area-inset-top))] right-[max(12px,env(safe-area-inset-right))] z-[120] min-h-11 !px-4"
        >
          <Minimize2 className="size-4" /> Exit full screen
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/**
 * Kiosk auto-reset: after a visitor walks away (no touches for `idleSeconds()`),
 * show a 10 second countdown, then start over for the next visitor.
 */
export function IdleReset() {
  const mode = useScreenMode();
  const { restart } = useKioskSession();
  const [left, setLeft] = useState<number | null>(null);
  const touched = useRef(false);

  useEffect(() => {
    if (!mode.kiosk) return;
    const limit = idleSeconds() * 1000;
    const WARN = 10_000;
    let last = Date.now();
    const activity = () => {
      last = Date.now();
      touched.current = true;
      setLeft(null);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', ACTIVITY_EVENT] as const;
    events.forEach((e) => window.addEventListener(e, activity, { capture: true, passive: true }));
    const timer = window.setInterval(() => {
      if (!touched.current) return; // nothing to reset yet
      const idle = Date.now() - last;
      if (idle >= limit) {
        touched.current = false;
        setLeft(null);
        restart();
      } else if (idle >= limit - WARN) {
        setLeft(Math.ceil((limit - idle) / 1000));
      }
    }, 250);
    return () => {
      window.clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, activity, { capture: true }));
    };
  }, [mode.kiosk, restart]);

  return (
    <AnimatePresence>
      {left !== null && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          className="fixed inset-x-0 bottom-[max(20px,env(safe-area-inset-bottom))] z-[90] mx-auto flex w-fit max-w-[calc(100vw-32px)] items-center gap-3 rounded-full border-2 border-ink bg-pw-yellow px-5 py-3 text-sm font-extrabold shadow-stamp"
        >
          <span className="pw-display flex size-9 items-center justify-center rounded-full bg-ink text-lg text-paper tabular-nums">{left}</span>
          Still there? Starting over for the next visitor — tap anywhere to keep going.
        </motion.div>
      )}
    </AnimatePresence>
  );
}

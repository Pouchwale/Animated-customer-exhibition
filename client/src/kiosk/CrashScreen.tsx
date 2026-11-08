import { Component, useCallback, useEffect, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { useKioskSession, useScreenMode } from './kiosk';

/** Kiosk mode: after a crash, start over by itself after this long (ms). */
const AUTO_RESTART_MS = 15_000;

interface BoundaryProps {
  /** Shown instead of the children once one of them has crashed. */
  fallback: ReactNode;
  /** When this changes (e.g. kiosk "Start over"), the children get another go. */
  resetKey?: unknown;
  onError?: () => void;
  children: ReactNode;
}

/** A render error below this shows `fallback` instead of leaving the screen blank. */
export class ErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError?.();
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** When "Start over" last ran from this screen (ms since load). */
let lastStartOver = -Infinity;

/**
 * The page crashed: a plain branded screen with "Start over" (the same clean start as the kiosk button).
 * In kiosk mode it starts over by itself after 15 s, so a stall is never left stuck.
 */
export function CrashScreen() {
  const { restart } = useKioskSession();
  const { kiosk } = useScreenMode();

  const startOver = useCallback(() => {
    const again = performance.now() - lastStartOver < 60_000;
    lastStartOver = performance.now();
    restart(); // wipes the visitor's choices and replays the intro
    // Crashed again soon after starting over: reload the page this time (nothing left over in memory).
    if (again) window.location.reload();
  }, [restart]);

  // A crash before the intro took over would leave the white boot cover on top.
  useEffect(() => document.getElementById('boot-cover')?.remove(), []);

  useEffect(() => {
    if (!kiosk) return;
    const t = window.setTimeout(startOver, AUTO_RESTART_MS);
    return () => window.clearTimeout(t);
  }, [kiosk, startOver]);

  return (
    <main className="fixed inset-0 z-[105] flex flex-col items-center justify-center gap-6 bg-paper px-6 text-center">
      <img src="/logo-pink.png" alt="PouchWale" className="h-11 w-auto" draggable={false} />
      <h1 className="pw-display text-[40px]">
        Something went wrong<span className="text-pw-pink">.</span>
      </h1>
      <button type="button" onClick={startOver} className="pw-btn pw-btn-primary" autoFocus>
        <RotateCcw className="size-4" /> Start over
      </button>
    </main>
  );
}

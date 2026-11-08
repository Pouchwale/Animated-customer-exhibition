import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Exhibition / iPad kiosk helpers.
 * - Fullscreen: standard Fullscreen API, with Safari's webkit-prefixed fallback.
 * - Standalone: launched from the iPad Home Screen (no browser controls at all).
 * - Kiosk mode: fullscreen, standalone, or the URL flag ?kiosk=1 (remembered for the tab).
 */

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = () => document as FsDocument;

function fullscreenSupported(): boolean {
  const d = doc();
  return Boolean(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

function isFullscreen(): boolean {
  const d = doc();
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}

export async function enterFullscreen(): Promise<boolean> {
  const el = document.documentElement as FsElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  const d = doc();
  try {
    if (d.exitFullscreen) await d.exitFullscreen();
    else await d.webkitExitFullscreen?.();
  } catch {
    // Already out of fullscreen.
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const KIOSK_FLAG = 'pw-kiosk';
const IDLE_FLAG = 'pw-kiosk-idle';

/** ?kiosk=1 turns kiosk mode on for this tab (?kiosk=0 turns it off); ?idle=SECONDS sets the auto-reset. */
function readUrlFlags() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('kiosk')) sessionStorage.setItem(KIOSK_FLAG, params.get('kiosk') === '0' ? '0' : '1');
    const idle = Number(params.get('idle'));
    if (idle >= 15) sessionStorage.setItem(IDLE_FLAG, String(idle));
  } catch {
    // Storage blocked: flags just don't persist.
  }
}
readUrlFlags();

function kioskFlag(): boolean {
  try {
    return sessionStorage.getItem(KIOSK_FLAG) === '1';
  } catch {
    return false;
  }
}

/** Seconds of no touches before the kiosk starts over (default 90s). */
export function idleSeconds(): number {
  try {
    return Number(sessionStorage.getItem(IDLE_FLAG)) || 90;
  } catch {
    return 90;
  }
}

/** Live view of the screen mode. Re-renders when fullscreen is entered or left. */
export function useScreenMode() {
  const read = () => ({
    fullscreen: isFullscreen(),
    standalone: isStandalone(),
    supported: fullscreenSupported(),
    flag: kioskFlag(),
  });
  const [mode, setMode] = useState(read);

  useEffect(() => {
    const update = () => setMode(read());
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener?.('change', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
      mq.removeEventListener?.('change', update);
    };
  }, []);

  return { ...mode, kiosk: mode.fullscreen || mode.standalone || mode.flag };
}

// ---- Session restart (shared between the site shell and the page) ---------

interface KioskSession {
  /** Wipe the visitor's choices and replay the intro. */
  restart: () => void;
}

export const KioskContext = createContext<KioskSession>({ restart: () => window.location.reload() });
export const useKioskSession = () => useContext(KioskContext);

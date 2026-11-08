import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Rotate3d, X } from 'lucide-react';
import { allowMotion, setTiltOn, useTiltState, watchTilt } from './tilt';
import { T } from '../../motion';

/**
 * iPad tilt button for the page header.
 * - iOS: "Allow motion" (asks for motion access), then a Tilt on/off toggle.
 * - Sensors with no permission step (Android): the toggle, once real readings arrive.
 * - No sensor, not HTTPS, a desktop, or reduced motion: nothing at all.
 */
export function MotionControl() {
  const reduceMotion = useReducedMotion();
  const { support, on } = useTiltState();
  /** Help after motion access was declined: where to show it (left px, inside the wrapper) and how wide. */
  const [help, setHelp] = useState<{ left: number; width: number } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => (reduceMotion ? undefined : watchTilt()), [reduceMotion]);

  useEffect(() => {
    if (!help) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setHelp(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [help]);

  if (reduceMotion || support === 'none') return null;

  if (support === 'ready') {
    const label = on ? 'Tilt on' : 'Tilt off';
    return (
      <button
        type="button"
        // A toggle: a fixed name, with aria-pressed saying on or off.
        aria-pressed={on}
        aria-label="Tilt"
        onClick={() => setTiltOn(!on)}
        className="pw-btn pw-btn-ghost !py-1.5 aria-pressed:bg-pw-yellow-tint"
      >
        <Rotate3d className="size-4" aria-hidden />
        <span className="hidden sm:inline">{label}</span>
      </button>
    );
  }

  const ask = () => {
    // Straight from the tap: iOS only asks for motion access from a user gesture.
    void allowMotion().then((granted) => {
      const box = wrapper.current?.getBoundingClientRect();
      if (granted || !box) return setHelp(null);
      // Keep the note on screen, under the button (the header's right edge is close on phones).
      const width = Math.min(320, window.innerWidth - 32);
      const left = Math.min(Math.max(16, box.right - width), window.innerWidth - 16 - width);
      setHelp({ left: left - box.left, width });
    });
  };

  return (
    <div ref={wrapper} className="relative">
      <button type="button" onClick={ask} aria-label="Allow motion" className="pw-btn pw-btn-ghost !py-1.5">
        <Rotate3d className="size-4" aria-hidden />
        <span className="hidden sm:inline">Allow motion</span>
      </button>

      <AnimatePresence>
        {help && (
          <motion.div
            role="dialog"
            aria-label="Motion is off"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={T.enter}
            style={{ left: help.left, width: help.width }}
            className="absolute top-full z-50 mt-2 rounded-2xl border-2 border-ink bg-paper p-4 text-sm shadow-stamp"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="pw-display text-lg">Motion is off</p>
              <button
                type="button"
                onClick={() => setHelp(null)}
                aria-label="Close"
                className="-m-1 flex size-9 items-center justify-center rounded-full hover:bg-ink/5"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-1 font-semibold text-ink-2">Tilting stays off; everything else works as usual. To turn it on:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 font-semibold">
              <li>
                Reload the page, tap <b>Allow motion</b>, then choose <b>Allow</b>.
              </li>
              <li>Not asked again? Swipe the app away in the app switcher, open the page again and retry.</li>
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

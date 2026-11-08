import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { BubbleFace } from './Bubble';
import type { BubbleItem } from './model';

export interface Flight {
  id: number;
  item: BubbleItem;
  /** Centre of the bubble where the flight starts (viewport px). */
  fromX: number;
  fromY: number;
  /** Visual scale at the start (matches what the user saw at release). */
  fromScale: number;
  /** Natural diameter of the bubble face. */
  size: number;
}

export const rankAnchorSelector = (key: string) => `[data-rank-anchor="${CSS.escape(key)}"]`;

const DURATION = 0.68;

/**
 * Carries a bubble from where it was dropped (or tapped) into its rank circle in
 * Step 2: a quick pop, then an arcing glide while it shrinks evenly — it stays a
 * perfect circle the whole way — and lands exactly on the rank number.
 */
export function BubbleFlight({ flight, onLanded }: { flight: Flight; onLanded: () => void }) {
  const [target, setTarget] = useState<{ x: number; y: number; scale: number } | null>(null);
  const { size, fromX, fromY, fromScale } = flight;

  // The new row is already in the DOM (same commit); read where its rank circle sits.
  useLayoutEffect(() => {
    const anchor = document.querySelector<HTMLElement>(rankAnchorSelector(flight.item.key));
    if (!anchor) {
      onLanded();
      return;
    }
    const r = anchor.getBoundingClientRect(); // centre is unaffected by its own scale
    setTarget({ x: r.left + r.width / 2, y: r.top + r.height / 2, scale: anchor.offsetWidth / size });
  }, [flight.id]); // once per flight

  const start = { x: fromX - size / 2, y: fromY - size / 2 };
  const end = target ? { x: target.x - size / 2, y: target.y - size / 2 } : start;
  // Lift a little before travelling, so the path is a soft arc rather than a straight slide.
  const lift = Math.min(70, Math.max(28, Math.abs(end.x - start.x) * 0.18));

  return createPortal(
    <motion.div
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 z-[70]"
      style={{ width: size, height: size }}
      initial={{ x: start.x, y: start.y, scale: fromScale }}
      animate={
        target
          ? {
              x: [start.x, start.x, end.x],
              y: [start.y, start.y - lift, end.y],
              scale: [fromScale, fromScale * 1.16, target.scale],
            }
          : undefined
      }
      transition={{
        duration: DURATION,
        x: { duration: DURATION, times: [0, 0.18, 1], ease: [0.45, 0, 0.2, 1] },
        y: { duration: DURATION, times: [0, 0.3, 1], ease: ['easeOut', [0.55, 0, 0.3, 1]] },
        scale: { duration: DURATION, times: [0, 0.2, 1], ease: ['easeOut', [0.4, 0, 0.2, 1]] },
      }}
      onAnimationComplete={() => target && onLanded()}
    >
      <motion.div
        className="relative"
        initial={{ opacity: 1 }}
        animate={target ? { opacity: [1, 1, 0] } : undefined}
        transition={{ duration: DURATION, times: [0, 0.86, 1] }}
      >
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-ink"
          initial={{ x: 8, y: 8 }}
          animate={target ? { x: [8, 12, 3], y: [8, 14, 3] } : undefined}
          transition={{ duration: DURATION, times: [0, 0.3, 1] }}
        />
        <BubbleFace item={flight.item} flat />
      </motion.div>
    </motion.div>,
    document.body,
  );
}

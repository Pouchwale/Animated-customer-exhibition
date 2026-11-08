/**
 * One motion system for the customer page: 3 durations, the 2 brand easings (same curves as
 * --ease-pw / --ease-bounce in index.css) and a few named springs.
 * - Physical things (rows, badges, pops) use springs; panels and text use eases.
 * - Only transform and opacity are animated, so it stays smooth on iPad while the bubble physics runs.
 * New animations should use these rather than their own numbers.
 */

/** Seconds. fast: hovers, presses, exits · base: panels and text · slow: big reveals. */
export const DUR = { fast: 0.15, base: 0.25, slow: 0.4 } as const;

/** The brand curves: `pw` settles softly (most things), `bounce` overshoots a little (playful moments). */
export const EASE = {
  pw: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
  bounce: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
};

export const SPRING = {
  /** Rows and cards moving into place: quick, barely any overshoot. */
  settle: { type: 'spring' as const, stiffness: 420, damping: 32 },
  /** Pops (badges, check marks, small things appearing): lively. */
  pop: { type: 'spring' as const, stiffness: 520, damping: 18 },
  /** A panel changing shape (Step 3 placeholder → result card): calm. */
  morph: { type: 'spring' as const, stiffness: 260, damping: 30 },
};

/** Ready-made transitions for panels and text. Exits are quicker than entrances. */
export const T = {
  enter: { duration: DUR.base, ease: EASE.pw },
  exit: { duration: DUR.fast, ease: EASE.pw },
  reveal: { duration: DUR.slow, ease: EASE.pw },
};

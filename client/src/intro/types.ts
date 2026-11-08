/** What every intro animation gets from the intro component. */
export interface IntroRun {
  /** Mount the page underneath (safe to call more than once). */
  reveal: () => void;
  /** The intro is over: remove it. */
  finish: () => void;
  /** Set by the animation: what "Skip intro" does. */
  skipRef: { current: () => void };
}

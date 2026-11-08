/**
 * Site-wide smooth scrolling with Locomotive Scroll v5.
 *
 * v5 is built on Lenis, which smooths the browser's own scrolling instead of moving the page
 * with transforms. Fixed overlays (intro, toasts, drag overlay), sticky columns and
 * drag-and-drop measurements all keep working unchanged.
 *
 * - One instance for the whole app, started once from main.tsx (not tied to React renders).
 * - Rendered on GSAP's ticker, so it shares one animation clock with the GSAP intro.
 * - Mouse wheel / trackpad are smoothed; touch scrolling on phones and iPads stays native.
 * - Scrollable areas inside the page (e.g. the iPad landscape columns) scroll natively.
 * - Not started at all for visitors who prefer reduced motion.
 * - Only downloaded where it does something: a mouse or trackpad (pointer: fine). Touch screens such as the
 *   stall iPads scroll natively and never load it.
 */
import type LocomotiveScroll from 'locomotive-scroll';

let instance: LocomotiveScroll | null = null;
/** Bumped by destroy, so a load still on its way doesn't start an instance afterwards. */
let generation = 0;
let loading = false;
/** Why scrolling is paused (e.g. "intro"). Scrolling resumes when no reason is left. */
const locks = new Set<string>();

export function initSmoothScroll(): void {
  if (instance || loading || typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.matchMedia('(pointer: fine)').matches) return;

  loading = true;
  const gen = generation;
  Promise.all([import('locomotive-scroll'), import('gsap'), import('locomotive-scroll/dist/locomotive-scroll.css')])
    .then(([{ default: Locomotive }, { default: gsap }]) => {
      if (gen !== generation || instance) return;
      instance = new Locomotive({
        lenisOptions: {
          lerp: 0.1,
          smoothWheel: true,
          syncTouch: false,
          allowNestedScroll: true,
        },
        initCustomTicker: (render) => gsap.ticker.add(render),
        destroyCustomTicker: (render) => gsap.ticker.remove(render),
      });
      // Locked before it arrived (e.g. the intro is already up): start stopped.
      if (locks.size) instance.stop();
    })
    .catch(() => {
      // Couldn't load: the page simply scrolls natively.
    })
    .finally(() => {
      if (gen === generation) loading = false;
    });
}

/** Stops smooth scrolling and removes its listeners, classes and ticker callback. */
export function destroySmoothScroll(): void {
  generation++;
  loading = false;
  instance?.destroy();
  instance = null;
}

/** Pause page scrolling for a reason (e.g. while the intro covers the screen). */
export function lockScroll(reason: string): void {
  locks.add(reason);
  instance?.stop();
}

export function unlockScroll(reason: string): void {
  locks.delete(reason);
  if (!locks.size) instance?.start();
}

/** Smoothly bring an element into view (page scroll), keeping the smooth scroller in sync. */
export function scrollToElement(el: HTMLElement, offset = -16): void {
  if (instance) instance.scrollTo(el, { offset, duration: 0.9 });
  // Phones and tablets (no smooth scroller loaded): the browser's own smooth scroll, same offset.
  else {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + offset, behavior: reduced ? 'auto' : 'smooth' });
  }
}

/** Jump straight to the top (no animation), keeping the smooth scroller in sync. */
export function scrollToTop(): void {
  if (instance) instance.scrollTo(0, { immediate: true, force: true });
  else window.scrollTo(0, 0);
}

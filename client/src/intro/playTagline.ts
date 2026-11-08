/**
 * "Logo to tagline" intro: the logo settles in, its tear tab lifts out, drops below the tagline and stretches into
 * its underline while the words rise; then the tab snaps back into the logo and the page fades in underneath.
 * Transform and opacity only, ~3.2 s.
 */
import gsap from 'gsap';
import type { IntroRun } from './types';

/** The tear tab in the 1894×802 logo artwork: centre, size (as fractions of the image) and angle. */
const TAB = { cx: 792 / 1894, cy: 380 / 802, w: 170 / 1894, h: 52 / 802, rot: 12 };

export function playTagline(el: HTMLElement, run: IntroRun) {
  const q = gsap.utils.selector(el);
  const logo = q('[data-intro="l2t-logo"]')[0] as HTMLElement;
  const patch = q('[data-intro="l2t-patch"]')[0] as HTMLElement;
  const strip = q('[data-intro="l2t-strip"]')[0] as HTMLElement;
  const line = q('[data-intro="l2t-line"]')[0] as HTMLElement;
  const words = q('[data-intro="l2t-word"]');

  // Geometry, in the logo box's own pixels.
  const w = logo.offsetWidth;
  const h = logo.offsetHeight;
  const tw = TAB.w * w;
  const th = TAB.h * h;
  const home = { x: TAB.cx * w - tw / 2, y: TAB.cy * h - th / 2, width: tw, height: th, rotation: TAB.rot };
  // Measured when the tab drops, not now: the brand font may still be loading, and the fallback wraps differently.
  const underline = () => {
    const lr = line.getBoundingClientRect();
    const br = logo.getBoundingClientRect();
    const scale = br.height / h || 1; // the logo may still be finishing its small scale-in
    const uw = Math.min(lr.width / scale, w) * 0.85;
    return { x: (w - uw) / 2, y: (lr.bottom - br.top) / scale + 6, width: uw, height: Math.max(4, th * 0.42), rotation: 0 };
  };

  // The white patch hides the tab printed in the logo while the moving copy is away.
  gsap.set(patch, { x: home.x - 2, y: home.y - 2, width: tw + 4, height: th + 4, rotation: TAB.rot, autoAlpha: 0 });
  gsap.set(strip, { ...home, autoAlpha: 0 });

  const tl = gsap
    .timeline({ onComplete: run.finish })
    .fromTo(logo, { autoAlpha: 0, scale: 0.94 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'power3.out' })
    .to('[data-intro="skip"]', { opacity: 1, duration: 0.25 }, 0.4)
    // The tab lifts out…
    .set([patch, strip], { autoAlpha: 1 }, 0.5)
    .to(strip, { y: home.y - th * 0.9, rotation: -6, duration: 0.25, ease: 'power2.out' }, 0.5)
    // …drops below the tagline and stretches into its underline, as the words rise…
    .to(strip, { x: () => underline().x, y: () => underline().y, width: () => underline().width, height: () => underline().height, rotation: 0, duration: 0.55, ease: 'power3.inOut' }, 0.75)
    .to(words, { y: '0%', duration: 0.55, ease: 'power3.out', stagger: 0.05 }, 1.05)
    // …then snaps back into the logo.
    // Position and angle spring a little; the size eases plainly (a springy size would shrink it to a dot first).
    .to(strip, { x: home.x, y: home.y, rotation: home.rotation, duration: 0.5, ease: 'back.out(1.6)' }, 2.1)
    .to(strip, { width: home.width, height: home.height, duration: 0.4, ease: 'power3.out' }, 2.1)
    .set(patch, { autoAlpha: 0 }, 2.6)
    .call(run.reveal, [], 2.6)
    .to(el, { autoAlpha: 0, duration: 0.5, ease: 'power1.inOut' }, 2.65);

  run.skipRef.current = () => {
    tl.kill();
    run.reveal();
    gsap.to(el, { autoAlpha: 0, duration: 0.25, onComplete: run.finish });
  };
}

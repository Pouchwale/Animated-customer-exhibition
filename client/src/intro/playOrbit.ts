/**
 * Orbit intros: the logo with the brand's pouches orbiting it in depth.
 *  - "classic": the pouches burst out and the white stage closes in a circle onto the logo.
 *  - "pouches": each pouch shrinks into a Step 1 bubble and flies to its place on the page.
 */
import gsap from 'gsap';
import { faceSpot, hideFieldBubbles, makeClone, onScreen, placeClone, waitForBubbles } from './handoff';
import type { IntroRun } from './types';

interface PouchState {
  el: HTMLImageElement;
  base: number; // angle on the orbit
  k: number; // radius multiplier (big = off-screen)
  pop: number; // 0..1 presence scale
  rot: number; // own rotation (deg)
  fade: number; // opacity
}

const EXIT = 2.2; // seconds: when the hold ends

/** Pouches nearest the viewer are drawn this much bigger (see render: 0.6 + 0.55 × depth). */
const FRONT_SCALE = 1.15;

/** A tablet: a touch screen at least 600px on its short side (phones and mouse-driven desktops keep their orbit). */
const isTablet = (vw: number, vh: number) =>
  Math.min(vw, vh) >= 600 && typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/**
 * Orbit size and pouch size. Desktop and phone: as before. Tablet: smaller pouches on an orbit sized from the real
 * logo + tagline, so the nearest pouches pass beside them instead of over them, and the farthest stay on screen.
 */
function orbitGeometry(el: HTMLElement, vw: number, vh: number) {
  const portrait = vh > vw * 1.1;
  if (!isTablet(vw, vh)) {
    const rx = portrait ? vw * 0.31 : Math.min(vw * 0.36, 540);
    const ry = portrait ? Math.min(vh * 0.3, 320) : Math.min(vh * 0.33, rx * 0.52);
    return { rx, ry, pouchH: gsap.utils.clamp(90, 230, Math.min(vw, vh) * 0.24) };
  }
  const pouchH = gsap.utils.clamp(110, 175, Math.min(vw, vh) * 0.165);
  const half = (pouchH * FRONT_SCALE) / 2; // a front pouch's half height (its half width is about 0.75 of that)
  const block = el.querySelector('[data-intro="center"]')?.getBoundingClientRect();
  const bw = (block?.width ?? Math.min(vw * 0.62, 420)) / 2;
  const bh = (block?.height ?? 200) / 2;
  const gap = 16;
  // Wide enough to clear the logo at the sides, tall enough to clear the tagline at the bottom, never off screen.
  const rx = Math.min(vw / 2 - half * 0.75 - gap, Math.max(bw + half * 0.75 + gap * 2, vw * (portrait ? 0.36 : 0.38)));
  const ry = Math.min(vh / 2 - half - gap, Math.max(bh + half + gap, vh * (portrait ? 0.3 : 0.36)));
  return { rx, ry, pouchH };
}

export function playOrbit(el: HTMLElement, run: IntroRun, mode: 'classic' | 'pouches') {
  const q = gsap.utils.selector(el);
  const pouchEls = q('[data-intro="pouch"]') as HTMLImageElement[];

  // ---- Geometry (portrait screens get a taller orbit; tablets get their own, see orbitGeometry) ----
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const { rx, ry, pouchH } = orbitGeometry(el, vw, vh);
  el.style.setProperty('--pouch-h', `${pouchH}px`);

  const orbit = { spin: -1.9 };
  const pouches: PouchState[] = pouchEls.map((p, i) => ({
    el: p,
    base: (i / pouchEls.length) * Math.PI * 2,
    k: 3.4,
    pop: 0,
    rot: gsap.utils.random(-120, 120),
    fade: 1,
  }));

  /** Place every pouch on the tilted orbit; lower = nearer = bigger, brighter, in front. */
  const render = () => {
    for (const p of pouches) {
      const a = p.base + orbit.spin;
      const sin = Math.sin(a);
      const depth = (sin + 1) / 2; // 0 back … 1 front
      const x = Math.cos(a) * rx * p.k;
      const y = sin * ry * p.k;
      const scale = (0.6 + 0.55 * depth) * p.pop;
      const lean = -Math.cos(a) * 9; // tilt into the direction of travel
      p.el.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${(p.rot + lean).toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      p.el.style.zIndex = String(Math.round(depth * 100)); // logo sits at 60: front pouches pass over it
      p.el.style.filter = `brightness(${(0.8 + 0.2 * depth).toFixed(3)}) drop-shadow(5px 6px 0 rgba(17,17,17,${(0.55 + 0.4 * depth).toFixed(2)}))`;
      p.el.style.opacity = p.pop > 0.01 ? p.fade.toFixed(3) : '0';
    }
  };
  render();

  // "pouches": the page mounts early (under the stage) so its bubbles are ready to fly to.
  let targets: HTMLElement[] | null = null;
  const prepare = () => {
    hideFieldBubbles(true);
    run.reveal();
    void waitForBubbles(1800).then((faces) => (targets = faces));
  };

  const tl = gsap.timeline({ onUpdate: render });

  // 1. Logo springs in on the white stage.
  tl.fromTo('[data-intro="logo"]', { autoAlpha: 0, scale: 0.45, rotate: -7, y: 14 }, { autoAlpha: 1, scale: 1, rotate: 0, y: 0, duration: 0.8, ease: 'back.out(1.8)' }, 0.15)

    // 2. Pouches spiral in from off-screen and settle into orbit. The orbit never stops turning.
    .to(pouches, { k: 1, pop: 1, duration: 1.2, ease: 'expo.out', stagger: { each: 0.06, from: 'random' } }, 0.25)
    .to(pouches, { rot: () => gsap.utils.random(-9, 9), duration: 1.25, ease: 'power3.out', stagger: 0.05 }, 0.25)
    .to(orbit, { spin: -0.25, duration: 1.3, ease: 'power3.out' }, 0.25)
    .to(orbit, { spin: '+=0.75', duration: EXIT - 1.55, ease: 'none' }, 1.55)

    // 3. Tagline rises in, letter by letter; the logo takes a small breath.
    .to('[data-intro="char"]', { y: '0%', duration: 0.5, ease: 'power3.out', stagger: 0.022 }, 0.65)
    .to('[data-intro="skip"]', { opacity: 1, duration: 0.25 }, 0.65)
    .to('[data-intro="logo"]', { scale: 1.035, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 1.25)
    .addLabel('exit', EXIT)
    .call(() => exit(), [], 'exit');
  if (mode === 'pouches') tl.call(prepare, [], 0.45);

  let exited = false;
  function exit() {
    if (exited) return;
    exited = true;
    tl.pause();
    gsap.set('[data-intro="skip"]', { autoAlpha: 0 });
    const faces = targets ? onScreen(targets) : [];
    if (mode === 'pouches' && faces.length) pouchesToBubbles(faces);
    else classicExit();
  }

  /** Pouches burst outward; the white stage closes in a circle onto the logo. */
  function classicExit() {
    hideFieldBubbles(false);
    gsap
      .timeline({ onUpdate: render, onComplete: run.finish })
      .to(pouches, { k: 3.6, rot: () => gsap.utils.random(-140, 140), duration: 0.6, ease: 'power3.in', stagger: { each: 0.025, from: 'random' } }, 0)
      .to(orbit, { spin: '+=1', duration: 0.6, ease: 'power2.in' }, 0)
      .call(run.reveal, [], 0.1)
      .fromTo(el, { clipPath: 'circle(150% at 50% 50%)' }, { clipPath: 'circle(0% at 50% 50%)', duration: 0.75, ease: 'power3.inOut' }, 0.3)
      .to('[data-intro="center"]', { scale: 0.85, duration: 0.75, ease: 'power3.inOut' }, 0.3);
  }

  /** Each pouch shrinks into a Step 1 bubble and flies to its place; the white stage fades away. */
  function pouchesToBubbles(faces: HTMLElement[]) {
    // Pair left-to-right so flight paths don't cross.
    const bubbles = faces.map((face) => ({ face, at: faceSpot(face) })).sort((a, b) => a.at.x - b.at.x);
    const onScreen = pouches
      .map((p) => {
        const r = p.el.getBoundingClientRect();
        return { p, x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height };
      })
      .sort((a, b) => a.x - b.x);
    const used = new Set<PouchState>();
    const flights = bubbles.map((b, i) => {
      const pick = onScreen[Math.round((i * (onScreen.length - 1)) / Math.max(1, bubbles.length - 1))];
      const from = pick && !used.has(pick.p) ? pick : null;
      if (from) used.add(from.p);
      const start = from ?? { x: vw / 2, y: vh / 2, h: pouchH };
      return {
        face: b.face,
        pouch: from?.p ?? null,
        clone: makeClone(b.face, el),
        x0: start.x,
        y0: start.y,
        d0: Math.min(start.h * 0.45, b.at.d * 0.6),
        side: i % 2 ? 1 : -1,
        delay: 0.06 + i * 0.05,
      };
    });
    const FLY = 0.95;
    const total = Math.max(...flights.map((f) => f.delay)) + FLY;
    const ease = gsap.parseEase('power2.inOut');
    const grow = gsap.parseEase('back.out(1.7)');
    const clock = { t: 0 };

    const draw = () => {
      render();
      // Read every live position first, then write (no layout thrash).
      const spots = flights.map((f) => faceSpot(f.face));
      flights.forEach((f, i) => {
        const local = gsap.utils.clamp(0, 1, (clock.t - f.delay) / FLY);
        const p = ease(local);
        const to = spots[i];
        const dx = to.x - f.x0;
        const dy = to.y - f.y0;
        const len = Math.hypot(dx, dy) || 1;
        const arc = Math.sin(Math.PI * p) * len * 0.16 * f.side;
        const x = f.x0 + dx * p + (-dy / len) * arc;
        const y = f.y0 + dy * p + (dx / len) * arc;
        const d = f.d0 + (to.d - f.d0) * grow(local);
        placeClone(f.clone, x, y, Math.max(1, d), gsap.utils.clamp(0, 1, local * 6));
      });
    };

    const x = gsap.timeline({
      onUpdate: draw,
      onComplete: () => {
        hideFieldBubbles(false);
        run.finish();
      },
    });
    // The pouch shrinks away as its bubble grows out of it.
    flights.forEach((f) => {
      if (f.pouch) x.to(f.pouch, { pop: 0.3, fade: 0, duration: 0.4, ease: 'power2.in' }, f.delay);
    });
    // Pouches without a bubble burst outward.
    const spare = pouches.filter((p) => !used.has(p));
    if (spare.length) x.to(spare, { k: 3.6, fade: 0, duration: 0.6, ease: 'power3.in' }, 0);
    x.to('[data-intro="center"]', { scale: 0.7, autoAlpha: 0, duration: 0.45, ease: 'power2.in' }, 0)
      .to('[data-intro="field"]', { opacity: 0, duration: 0.7, ease: 'power1.inOut' }, 0.3)
      .to(clock, { t: total, duration: total, ease: 'none' }, 0);
  }

  run.skipRef.current = () => exit();
}

/** Reduced motion: a short, still brand moment, then a plain cut to the page. */
export function playReduced(el: HTMLElement, run: IntroRun) {
  const q = gsap.utils.selector(el);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rx = Math.min(vw * 0.36, 520);
  const ry = Math.min(vh * 0.3, 300);
  el.style.setProperty('--pouch-h', `${gsap.utils.clamp(80, 170, Math.min(vw, vh) * 0.18)}px`);
  (q('[data-intro="pouch"]') as HTMLElement[]).forEach((p, i, all) => {
    const a = (i / all.length) * Math.PI * 2 + 0.4;
    p.style.transform = `translate(-50%, -50%) translate(${Math.cos(a) * rx}px, ${Math.sin(a) * ry}px)`;
    p.style.opacity = '1';
  });
  gsap.set('[data-intro="logo"]', { autoAlpha: 1 });
  gsap.set('[data-intro="char"]', { y: '0%' });
  gsap
    .timeline({ onComplete: run.finish })
    .call(run.reveal, [], 0.6)
    .to(el, { autoAlpha: 0, duration: 0.25 });
}

/**
 * "Logo from bubbles": dots in the brand colours fly in and form the PouchWale logo, which turns
 * crisp. Then it breaks back into dots that pour into the Step 1 bubbles on the page — the same
 * family as the idle logo mode.
 */
import gsap from 'gsap';
import { BRAND_PINK, faceColour, logoSpots } from '../brand/logoDots';
import { faceSpot, hideFieldBubbles, makeClone, onScreen, placeClone, waitForBubbles } from './handoff';
import type { IntroRun } from './types';

type RGB = [number, number, number];
const PALETTE: RGB[] = [
  [243, 227, 63], // yellow
  [254, 69, 135], // pink
  [20, 158, 218], // blue
  [255, 86, 29], // orange
];

interface Dot {
  sx: number; // start (off around the edges)
  sy: number;
  tx: number; // logo spot
  ty: number;
  fx: number; // where it was when the exit began
  fy: number;
  x: number;
  y: number;
  rgb: RGB;
  delay: number;
  bend: number;
  /** Exit: which bubble it pours into, and where inside it (unit circle). */
  target: number;
  ox: number;
  oy: number;
  exitDelay: number;
}

const FORM = 1.15; // seconds for the dots to fly in
const EXIT = 2.45; // when the hold ends

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = gsap.parseEase('power2.inOut');
const pop = gsap.parseEase('back.out(1.8)');
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function playDots(el: HTMLElement, run: IntroRun, logo: HTMLImageElement) {
  const canvas = el.querySelector<HTMLCanvasElement>('[data-intro="dots"]');
  const tagline = el.querySelector<HTMLElement>('[data-intro="tagline"]');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return run.finish();

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);

  // Logo a little above centre, tagline underneath.
  const aspect = logo.naturalWidth / logo.naturalHeight;
  const w = Math.min(vw * 0.74, vh * 0.5 * aspect, 620);
  const h = w / aspect;
  const box = { x: (vw - w) / 2, y: vh * 0.45 - h / 2, w, h };
  const { spots, dot } = logoSpots(logo, vw, vh, box);
  if (tagline) {
    tagline.style.top = `${box.y + h + Math.min(vw * 0.03, 22)}px`;
  }

  const reach = Math.hypot(vw, vh) * 0.62;
  const dots: Dot[] = spots.map((s) => {
    const a = Math.random() * Math.PI * 2;
    const r = reach * (0.8 + Math.random() * 0.5);
    const sx = vw / 2 + Math.cos(a) * r;
    const sy = vh / 2 + Math.sin(a) * r;
    return {
      sx,
      sy,
      tx: s.x,
      ty: s.y,
      fx: sx,
      fy: sy,
      x: sx,
      y: sy,
      rgb: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      delay: Math.random() * 0.35,
      bend: (Math.random() - 0.5) * 0.8,
      target: -1,
      ox: 0,
      oy: 0,
      exitDelay: 0,
    };
  });

  const state = { form: 0, solid: 0, out: 0, explode: 0 };
  let targets: { face: HTMLElement; rgb: RGB; clone: ReturnType<typeof makeClone> }[] = [];
  let faces: HTMLElement[] | null = null;
  let exiting = false;

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    const spotsNow = exiting && targets.length ? targets.map((t) => faceSpot(t.face)) : [];
    const show = 1 - state.solid;
    for (const d of dots) {
      let rgb: RGB;
      let alpha = 1;
      if (!exiting) {
        // Fly in on a curve; colour turns brand pink as it lands.
        const p = easeInOut(clamp01((state.form * FORM - d.delay) / (FORM - 0.35)));
        const dx = d.tx - d.sx;
        const dy = d.ty - d.sy;
        const arc = Math.sin(Math.PI * p) * d.bend;
        d.x = d.sx + dx * p - dy * arc;
        d.y = d.sy + dy * p + dx * arc;
        rgb = mix(d.rgb, BRAND_PINK, p * p * p); // keeps its own colour until it lands
        alpha = clamp01(p * 3);
      } else if (targets.length && d.target >= 0) {
        // Pour into its bubble (which may still be drifting: follow it live).
        const to = spotsNow[d.target];
        const p = easeInOut(clamp01((state.out - d.exitDelay) / 0.7));
        const gx = to.x + d.ox * to.d * 0.38;
        const gy = to.y + d.oy * to.d * 0.38;
        const dx = gx - d.fx;
        const dy = gy - d.fy;
        const arc = Math.sin(Math.PI * p) * d.bend * 0.6;
        d.x = d.fx + dx * p - dy * arc;
        d.y = d.fy + dy * p + dx * arc;
        rgb = mix(BRAND_PINK, targets[d.target].rgb, p);
        alpha = 1 - clamp01((state.out - 0.82) / 0.18);
      } else {
        // No bubbles to go to: burst outward and fade.
        const p = easeInOut(state.explode);
        d.x = d.fx + (d.fx - vw / 2) * 2.2 * p;
        d.y = d.fy + (d.fy - vh / 2) * 2.2 * p;
        rgb = BRAND_PINK;
        alpha = 1 - p;
      }
      alpha *= show; // the crisp logo and its dots cross-fade
      if (alpha <= 0.01) continue;
      ctx.fillStyle = `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, dot, 0, Math.PI * 2);
      ctx.fill();
    }
    if (state.solid > 0.01) {
      ctx.globalAlpha = state.solid;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(logo, box.x, box.y, box.w, box.h);
      ctx.globalAlpha = 1;
    }
    // The real bubbles pop in where the dots poured.
    if (exiting && targets.length) {
      const k = clamp01((state.out - 0.7) / 0.3);
      targets.forEach((t, i) => placeClone(t.clone, spotsNow[i].x, spotsNow[i].y, spotsNow[i].d * (0.55 + 0.45 * pop(k)), clamp01(k * 3)));
    }
  };

  const tl = gsap.timeline({ onUpdate: draw });
  tl.to(state, { form: 1, duration: FORM, ease: 'none' }, 0.1)
    .call(
      () => {
        hideFieldBubbles(true);
        run.reveal();
        void waitForBubbles(1800).then((f) => (faces = f));
      },
      [],
      0.3,
    )
    .to(state, { solid: 1, duration: 0.4, ease: 'power2.out' }, FORM)
    .to('[data-intro="char"]', { y: '0%', duration: 0.5, ease: 'power3.out', stagger: 0.022 }, FORM + 0.05)
    .to('[data-intro="skip"]', { opacity: 1, duration: 0.25 }, 0.6)
    .to(state, { solid: 1, duration: EXIT - FORM - 0.4 }, FORM + 0.4) // hold
    .call(() => exit(), [], EXIT);

  function exit() {
    if (exiting) return;
    tl.pause();
    draw(); // positions as they are now
    exiting = true;
    for (const d of dots) {
      d.fx = d.x;
      d.fy = d.y;
    }
    gsap.set('[data-intro="skip"]', { autoAlpha: 0 });

    const ready = faces ? onScreen(faces) : [];
    if (ready.length) {
      targets = ready.map((face) => ({ face, rgb: faceColour(face), clone: makeClone(face, el) }));
      // Left part of the logo pours into the leftmost bubbles, and so on (no criss-crossing):
      // dots sorted left to right are shared out by bubble size.
      const order = targets.map((t, i) => ({ i, at: faceSpot(t.face) })).sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y);
      const area = order.reduce((s, o) => s + o.at.d * o.at.d, 0);
      const sorted = [...dots].sort((a, b) => a.x - b.x);
      let cursor = 0;
      order.forEach((o, n) => {
        const count = n === order.length - 1 ? sorted.length - cursor : Math.round((sorted.length * o.at.d * o.at.d) / area);
        for (let k = 0; k < count && cursor < sorted.length; k++, cursor++) {
          const d = sorted[cursor];
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random());
          d.target = o.i;
          d.ox = Math.cos(a) * r;
          d.oy = Math.sin(a) * r;
          d.exitDelay = Math.random() * 0.15 + (n / order.length) * 0.12;
        }
      });
    }

    gsap
      .timeline({
        onUpdate: draw,
        onComplete: () => {
          hideFieldBubbles(false);
          run.finish();
        },
      })
      .to(state, { solid: 0, duration: 0.18, ease: 'power1.in' }, 0)
      .to(tagline, { autoAlpha: 0, y: 10, duration: 0.3, ease: 'power2.in' }, 0)
      .to('[data-intro="field"]', { opacity: 0, duration: 0.7, ease: 'power1.inOut' }, 0.25)
      .to(state, { out: 1, duration: 1.05, ease: 'none' }, 0.05)
      .to(state, { explode: 1, duration: 0.8, ease: 'none' }, 0.05);
  }

  run.skipRef.current = () => exit();
}

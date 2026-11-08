/**
 * Idle logo mode: after the kiosk sits untouched for a while, the Step 1 bubbles drift
 * together, burst into dots in their own colours, and the dots fly into the PouchWale logo.
 * The first touch scatters the dots and the bubbles pop back; if nobody touches, the logo
 * turns back into bubbles after the admin-set hold time. Settings come from the admin panel.
 */
import { useEffect, useState } from 'react';
import type { IdleLogoSettings, TransitionSpeed } from '@pw/shared';
import { publicApi } from '../api/client';
import type { BubbleWorld } from './physics';
import { BRAND_PINK, faceColour, loadLogo, logoSpots } from '../brand/logoDots';

/** Seconds per transition (scatter on touch, return to bubbles). */
const SPEED_SECONDS: Record<TransitionSpeed, number> = { slow: 1.3, normal: 0.9, fast: 0.55 };

/** `?idleLogoPreview=1` (admin "Preview" button): logo forms after a few seconds, even if switched off. */
const PREVIEW = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('idleLogoPreview');
const PREVIEW_IDLE_MINUTES = 4 / 60;
const SETTINGS_REFRESH_MS = 60_000;

/** Saved settings, re-read every minute so admin changes reach an open kiosk without a reload. */
export function useIdleLogoSettings(): IdleLogoSettings | null {
  const [settings, setSettings] = useState<IdleLogoSettings | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      publicApi
        .idleLogo()
        .then((next) => alive && setSettings((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next)))
        .catch(() => {
          // Offline or API down: keep the last settings (or stay off).
        });
    void load();
    const timer = window.setInterval(load, SETTINGS_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  if (!settings) return null;
  return PREVIEW ? { ...settings, enabled: true, idleMinutes: PREVIEW_IDLE_MINUTES } : settings;
}

// ---------------------------------------------------------------------------

export type ShowPhase = 'gathering' | 'forming' | 'holding' | 'returning' | 'scattering';

/** How a bubble is drawn on top of its physics position. */
export interface BubbleLook {
  scale: number;
  opacity: number;
}

interface ShowHost {
  canvas: HTMLCanvasElement;
  world: BubbleWorld;
  /** Bubble body elements by key (to read their colours). */
  elements: Map<string, HTMLElement>;
  /** Written by the show, read by the field's paint(). */
  looks: Map<string, BubbleLook>;
  paint(): void;
  reduceMotion: boolean;
  onPhase(phase: ShowPhase | null): void;
}

interface Dot {
  key: string;
  /** Logo spot. */
  tx: number;
  ty: number;
  /** Where the flight started. */
  sx: number;
  sy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Offset inside its bubble (fraction of radius) for the trip back. */
  ox: number;
  oy: number;
  rgb: [number, number, number];
  delay: number;
  bend: number;
  seed: number;
  alpha: number;
  /** Alpha when the scatter began (fades from there). */
  alpha0: number;
  /** Colour progress: 0 = the bubble's own colour, 1 = brand pink. */
  tint: number;
}

/** Once the dots land, they fade into the real logo image so it reads sharply (seconds). */
const SOLIDIFY_SECONDS = 0.6;
/** Gathering time as a share of the admin's animation duration (the rest is the dots flying in). */
const GATHER_SHARE = 0.42;

function colourOf(el: HTMLElement | undefined): [number, number, number] {
  return faceColour(el?.querySelector('[data-bubble-face]'));
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const backOut = (p: number) => {
  const c = 1.9;
  return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2;
};

/** One run of the effect: gather → form → hold → (return | scatter on touch). */
export class LogoShow {
  phase: ShowPhase | null = null;
  private dots: Dot[] = [];
  private dotRadius = 3;
  private raf = 0;
  private phaseStart = 0;
  private prev = 0;
  private img: HTMLImageElement | null = null;
  /** Where the crisp logo is drawn, and how much of it shows (0 = only dots, 1 = only the logo). */
  private box = { x: 0, y: 0, w: 0, h: 0 };
  private solid = 0;
  private solidAtScatter = 0;
  private readonly transition: number;
  private readonly form: number;
  private dpr = 1;

  constructor(
    private readonly host: ShowHost,
    private readonly settings: IdleLogoSettings,
  ) {
    this.transition = SPEED_SECONDS[settings.transitionSpeed] ?? SPEED_SECONDS.normal;
    this.form = settings.formSeconds;
  }

  get active() {
    return this.phase !== null;
  }

  async start() {
    try {
      this.img = await loadLogo();
    } catch {
      return; // No logo, no show.
    }
    const { world, canvas } = this.host;
    if (!world.width || !world.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(world.width * this.dpr);
    canvas.height = Math.round(world.height * this.dpr);
    if (!this.host.reduceMotion) world.attractor = { x: world.width / 2, y: world.height / 2, strength: 0 };
    this.setPhase(this.host.reduceMotion ? 'forming' : 'gathering');
    if (this.host.reduceMotion) this.makeDots();
    this.prev = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Someone touched the screen: dots fly apart from (x, y) and the bubbles pop back. */
  scatter(x?: number, y?: number) {
    if (!this.phase || this.phase === 'scattering') return;
    const { world } = this.host;
    const cx = world.width / 2;
    const cy = world.height / 2;
    const fx = x ?? cx;
    const fy = y ?? cy;
    world.attractor = null;
    if (!this.host.reduceMotion) {
      const kick = 1.15 / this.transition; // faster transition → harder kick
      world.bodies.forEach((b) => {
        let dx = b.x - cx;
        let dy = b.y - cy;
        const d = Math.hypot(dx, dy);
        if (d < 1) {
          const a = b.seed * Math.PI * 2;
          dx = Math.cos(a);
          dy = Math.sin(a);
        } else {
          dx /= d;
          dy /= d;
        }
        const speed = (240 + b.seed * 200) * kick;
        world.impulse(b.key, dx * speed, dy * speed);
      });
      for (const dot of this.dots) {
        let dx = dot.x - fx;
        let dy = dot.y - fy;
        const d = Math.hypot(dx, dy) || 1;
        dx /= d;
        dy /= d;
        const speed = (260 + dot.seed * 720) / this.transition;
        const spin = (dot.seed - 0.5) * 0.9;
        dot.vx = (dx - dy * spin) * speed;
        dot.vy = (dy + dx * spin) * speed;
      }
    }
    this.dots.forEach((d) => (d.alpha0 = d.alpha));
    this.solidAtScatter = this.solid;
    this.setPhase('scattering');
  }

  /** Stop right away and show the bubbles as normal (resize, unmount). */
  cancel() {
    cancelAnimationFrame(this.raf);
    this.finish();
  }

  // ---------------------------------------------------------------------------

  private setPhase(phase: ShowPhase | null) {
    this.phase = phase;
    this.phaseStart = performance.now();
    this.host.onPhase(phase);
  }

  private finish() {
    const { world, looks, canvas } = this.host;
    world.attractor = null;
    looks.clear();
    this.host.paint();
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    this.dots = [];
    this.solid = 0;
    if (this.phase !== null) this.setPhase(null);
  }

  /** Each bubble bursts into dots (more dots for bigger bubbles) that will fly to logo spots. */
  private makeDots() {
    const { world, elements } = this.host;
    if (!this.img) return;
    const { spots, dot, box } = logoSpots(this.img, world.width, world.height);
    this.dotRadius = dot;
    this.box = box;
    const bodies = [...world.bodies.values()];
    if (!bodies.length || !spots.length) return;
    const colours = new Map(bodies.map((b) => [b.key, colourOf(elements.get(b.key))]));
    const totalArea = bodies.reduce((s, b) => s + b.r * b.r, 0);
    // Shuffle so every bubble feeds the whole logo, not one patch of it.
    const order = spots.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let cursor = 0;
    const leftmost = Math.min(...spots.map((s) => s.x));
    const span = Math.max(1, Math.max(...spots.map((s) => s.x)) - leftmost);
    bodies.forEach((b, bi) => {
      const share = bi === bodies.length - 1 ? spots.length - cursor : Math.round((spots.length * b.r * b.r) / totalArea);
      for (let n = 0; n < share && cursor < spots.length; n++, cursor++) {
        const spot = spots[order[cursor]];
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * 0.85;
        const sx = b.x + Math.cos(a) * rr * b.r;
        const sy = b.y + Math.sin(a) * rr * b.r;
        this.dots.push({
          key: b.key,
          tx: spot.x,
          ty: spot.y,
          sx,
          sy,
          x: this.host.reduceMotion ? spot.x : sx,
          y: this.host.reduceMotion ? spot.y : sy,
          vx: 0,
          vy: 0,
          ox: Math.cos(a) * rr,
          oy: Math.sin(a) * rr,
          rgb: colours.get(b.key) ?? BRAND_PINK,
          // A soft left-to-right sweep, with some randomness so it feels organic.
          delay: ((spot.x - leftmost) / span) * 0.22 + Math.random() * 0.12,
          bend: (Math.random() - 0.5) * 0.7,
          seed: Math.random(),
          alpha: this.host.reduceMotion ? 0 : 1,
          alpha0: 1,
          tint: this.host.reduceMotion ? 1 : 0,
        });
      }
    });
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.prev) / 1000, 1 / 20);
    this.prev = now;
    const t = (now - this.phaseStart) / 1000;
    const { world, looks } = this.host;
    const reduce = this.host.reduceMotion;

    switch (this.phase) {
      case 'gathering': {
        const dur = this.form * GATHER_SHARE;
        if (world.attractor) world.attractor.strength = 7 * easeInOut(clamp01(t / (dur * 0.6)));
        if (t >= dur) {
          this.makeDots();
          this.setPhase('forming');
        }
        break;
      }
      case 'forming': {
        const dur = reduce ? 0.6 : this.form * (1 - GATHER_SHARE);
        const pop = reduce ? 0.45 : Math.min(0.32, dur * 0.3);
        const k = clamp01(t / pop);
        world.bodies.forEach((b) => looks.set(b.key, { scale: reduce ? 1 : 1 - 0.75 * easeOut(k), opacity: 1 - k }));
        if (reduce) {
          this.dots.forEach((d) => (d.alpha = clamp01(t / dur)));
        } else {
          const travel = Math.max(0.2, dur * 0.66);
          const spread = Math.max(0.01, dur - travel);
          for (const d of this.dots) {
            const p = easeInOut(clamp01((t - d.delay * spread * 2.9) / travel));
            const dx = d.tx - d.sx;
            const dy = d.ty - d.sy;
            const arc = Math.sin(Math.PI * p) * d.bend;
            d.x = d.sx + dx * p - dy * arc;
            d.y = d.sy + dy * p + dx * arc;
            d.alpha = 1;
            d.tint = p;
          }
        }
        if (t >= dur) this.setPhase('holding');
        break;
      }
      case 'holding': {
        for (const d of this.dots) {
          d.alpha = 1;
          d.tint = 1;
          d.x = d.tx;
          d.y = d.ty;
        }
        this.solid = easeInOut(clamp01(t / SOLIDIFY_SECONDS));
        if (this.settings.holdSeconds > 0 && t >= this.settings.holdSeconds) {
          world.attractor = null;
          this.dots.forEach((d) => {
            d.sx = d.x;
            d.sy = d.y;
          });
          this.setPhase('returning');
        }
        break;
      }
      case 'returning': {
        const dur = this.transition * (reduce ? 0.8 : 1.6);
        const popAt = reduce ? 0.3 : 0.55;
        const k = clamp01((t / dur - popAt) / (1 - popAt));
        this.solid = 1 - clamp01(t / 0.2);
        world.bodies.forEach((b) =>
          looks.set(b.key, reduce ? { scale: 1, opacity: k } : { scale: 0.25 + 0.75 * backOut(k), opacity: clamp01(k * 2) }),
        );
        if (reduce) {
          this.dots.forEach((d) => (d.alpha = 1 - clamp01(t / (dur * 0.6))));
        } else {
          for (const d of this.dots) {
            const b = world.bodies.get(d.key);
            if (!b) {
              d.alpha = 0;
              continue;
            }
            const p = easeInOut(clamp01((t - d.delay * dur * 0.35) / (dur * 0.62)));
            const gx = b.x + d.ox * b.r * 0.8;
            const gy = b.y + d.oy * b.r * 0.8;
            d.x = d.sx + (gx - d.sx) * p;
            d.y = d.sy + (gy - d.sy) * p;
            d.tint = 1 - p; // back to the bubble's own colour
            d.alpha = 1 - clamp01((p - 0.82) / 0.18);
          }
        }
        if (t >= dur) {
          cancelAnimationFrame(this.raf);
          this.finish();
          return;
        }
        break;
      }
      case 'scattering': {
        const dur = this.transition * (reduce ? 0.6 : 1.2);
        const k = clamp01(t / (dur * 0.55));
        world.bodies.forEach((b) =>
          looks.set(b.key, reduce ? { scale: 1, opacity: k } : { scale: 0.35 + 0.65 * backOut(k), opacity: clamp01(k * 1.8) }),
        );
        this.solid = this.solidAtScatter * (1 - clamp01(t / 0.15));
        const drag = Math.exp(-1.6 * dt);
        for (const d of this.dots) {
          if (!reduce) {
            d.x += d.vx * dt;
            d.y += d.vy * dt;
            d.vx *= drag;
            d.vy *= drag;
          }
          d.alpha = d.alpha0 * (1 - clamp01(t / dur));
        }
        if (t >= dur) {
          cancelAnimationFrame(this.raf);
          this.finish();
          return;
        }
        break;
      }
      default:
        cancelAnimationFrame(this.raf);
        return;
    }

    this.host.paint();
    this.draw();
  };

  private draw() {
    const { canvas } = this.host;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const r = this.dotRadius;
    const dotsShow = 1 - this.solid;
    for (const d of this.dots) {
      const alpha = d.alpha * dotsShow;
      if (alpha <= 0.01) continue;
      // Colour: the bubble's own → brand pink as the dot settles into the logo.
      const c = clamp01(d.tint);
      const red = Math.round(d.rgb[0] + (BRAND_PINK[0] - d.rgb[0]) * c);
      const green = Math.round(d.rgb[1] + (BRAND_PINK[1] - d.rgb[1]) * c);
      const blue = Math.round(d.rgb[2] + (BRAND_PINK[2] - d.rgb[2]) * c);
      ctx.fillStyle = `rgba(${red},${green},${blue},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.solid > 0.01 && this.img) {
      ctx.globalAlpha = this.solid;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.img, this.box.x, this.box.y, this.box.w, this.box.h);
      ctx.globalAlpha = 1;
    }
  }
}

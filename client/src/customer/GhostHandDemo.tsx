/**
 * Ghost-hand demo: when nobody has touched the screen for a few seconds and Step 2 is still
 * empty, a hand presses a bubble, drags it into Step 2, lets go, and the bubble floats back.
 * It shows what to do without any text, and changes nothing. Any real touch stops it at once.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import gsap from 'gsap';
import { FACE, HIDE_CLASS, faceSpot, makeClone, placeClone } from '../intro/handoff';
import { LIFT_SCALE, LIFT_SCALE_OVER_LIST } from './Bubble';
import { ACTIVITY_EVENT } from './activity';

/** Quiet time before the first demo, and between demos while it stays quiet (ms). */
const FIRST_DELAY = 4000;
const REPEAT_GAP = 9000;
/** Hand size (px) and where its fingertip is inside it. */
const HAND = 64;
const TIP = { x: (8 / 24) * HAND, y: (2 / 24) * HAND };

interface Props {
  /** Only while it makes sense: Step 2 empty, nothing being dragged, motion allowed. */
  enabled: boolean;
  /** The hand is over Step 2 (light it up as if a real bubble were there). */
  onOver: (over: boolean) => void;
}

const onScreen = (r: DOMRect) => r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;

/** Something else is showing that the demo must not play over. */
function busyElsewhere() {
  if (document.hidden) return true;
  if (document.querySelector('[aria-label="PouchWale intro"]')) return true;
  if (document.documentElement.classList.contains(HIDE_CLASS)) return true;
  const idleLogo = document.querySelector('canvas[data-idle-logo]')?.getAttribute('data-idle-logo');
  return !!idleLogo && idleLogo !== 'off';
}

export function GhostHandDemo({ enabled, onOver }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const hand = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const live = useRef({ enabled, onOver });
  live.current = { enabled, onOver };

  useEffect(() => {
    let last = performance.now();
    let nextGap = FIRST_DELAY;
    let lastKey: string | null = null;
    let stop: ((instant?: boolean) => void) | null = null;
    let mouse: { x: number; y: number } | null = null;

    const activity = (e: Event) => {
      if (e.type === 'pointermove') {
        const p = e as PointerEvent;
        const moved = mouse ? Math.hypot(p.clientX - mouse.x, p.clientY - mouse.y) : 0;
        mouse = { x: p.clientX, y: p.clientY };
        if (moved < 6) return;
      }
      last = performance.now();
      nextGap = FIRST_DELAY;
      stop?.();
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', ACTIVITY_EVENT] as const;
    events.forEach((name) => window.addEventListener(name, activity, { capture: true, passive: true }));

    const timer = window.setInterval(() => {
      if (stop) {
        if (!live.current.enabled || busyElsewhere()) stop(true);
        return;
      }
      const now = performance.now();
      if (!live.current.enabled || busyElsewhere()) {
        last = now; // count the quiet time from when it could actually play
        return;
      }
      if (now - last < nextGap) return;
      const started = play();
      // Nothing suitable on screen right now: try again a bit later.
      if (!started) last = now - nextGap + 1000;
    }, 250);

    /** One demo run. Returns false if there's no bubble or Step 2 to show it with. */
    function play(): boolean {
      const target = document.querySelector<HTMLElement>('[data-demo-target]');
      if (!hand.current || !ring.current || !layer.current) return false;
      const handEl: HTMLDivElement = hand.current;
      const ringEl: HTMLDivElement = ring.current;
      const layerEl: HTMLDivElement = layer.current;
      if (!target || !onScreen(target.getBoundingClientRect())) return false;
      const faces = [...document.querySelectorAll<HTMLElement>(FACE)].filter((f) => onScreen(f.getBoundingClientRect()));
      if (!faces.length) return false;
      const choices = faces.length > 1 ? faces.filter((f) => f.getAttribute('data-bubble-face') !== lastKey) : faces;
      const face = choices[Math.floor(Math.random() * choices.length)];
      const body = face.closest<HTMLElement>('[data-body]');
      if (!body) return false;
      lastKey = face.getAttribute('data-bubble-face');

      const clone = makeClone(face, layerEl);
      clone.el.style.boxShadow = '8px 8px 0 0 #111';
      const s = { approach: 0, press: 0, carry: 0, release: 0, back: 0, hand: 0, lifted: 0, ring: 0 };
      const start = faceSpot(face);
      const from = { x: start.x + 90, y: start.y + 130 };
      const ease = gsap.parseEase('power2.inOut');
      let over = false;
      const setOver = (v: boolean) => {
        if (over === v) return;
        over = v;
        live.current.onOver(v);
      };

      const draw = () => {
        const b = faceSpot(face);
        const tr = target.getBoundingClientRect();
        const t = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 };
        // Where the bubble (and the fingertip holding it) is.
        const out = ease(s.carry);
        const home = ease(s.back);
        const arc = (p: number, ax: number, ay: number, bx: number, by: number) => {
          const dx = bx - ax;
          const dy = by - ay;
          const len = Math.hypot(dx, dy) || 1;
          const lift = Math.sin(Math.PI * p) * Math.min(80, len * 0.18);
          return { x: ax + dx * p + (dy / len) * lift, y: ay + dy * p - (dx / len) * lift };
        };
        const going = arc(out, b.x, b.y, t.x, t.y);
        const at = s.back > 0 ? arc(home, t.x, t.y, b.x, b.y) : going;
        const scale =
          s.back > 0
            ? LIFT_SCALE_OVER_LIST + (1 - LIFT_SCALE_OVER_LIST) * home
            : LIFT_SCALE + (LIFT_SCALE_OVER_LIST - LIFT_SCALE) * Math.max(0, (out - 0.6) / 0.4);
        placeClone(clone, at.x, at.y, b.d * scale, s.lifted * (s.back >= 1 ? 0 : 1));
        // The hand: comes in, holds the bubble (low down, so its name stays readable) while
        // carrying, then lifts off and fades.
        const grip = { x: b.d * 0.12, y: b.d * 0.3 };
        const reach = arc(s.approach, from.x, from.y, b.x + grip.x, b.y + grip.y);
        const holdAt = s.carry > 0 ? { x: going.x + grip.x * scale, y: going.y + grip.y * scale } : reach;
        const off = s.release;
        const hx = holdAt.x + off * 26;
        const hy = holdAt.y + off * 34;
        handEl.style.opacity = s.hand.toFixed(3);
        handEl.style.transform = `translate3d(${(hx - TIP.x).toFixed(1)}px, ${(hy - TIP.y).toFixed(1)}px, 0) scale(${(1 - 0.12 * s.press).toFixed(3)})`;
        handEl.style.transformOrigin = `${TIP.x}px ${TIP.y}px`;
        // A small ripple where the finger presses.
        ringEl.style.opacity = (s.ring > 0 && s.ring < 1 ? 1 - s.ring : 0).toFixed(3);
        ringEl.style.transform = `translate3d(${(b.x + grip.x - 30).toFixed(1)}px, ${(b.y + grip.y - 30).toFixed(1)}px, 0) scale(${(0.3 + s.ring * 1.3).toFixed(3)})`;
        setOver(s.carry > 0.75 && s.release < 0.5);
      };

      const ghost = (on: boolean) => {
        if (on) body.setAttribute('data-demo-ghost', '');
        else body.removeAttribute('data-demo-ghost');
      };

      const tl = gsap.timeline({ onUpdate: draw, onComplete: () => finish() });
      tl.to(s, { hand: 1, duration: 0.3, ease: 'power1.out' }, 0)
        .to(s, { approach: 1, duration: 0.6, ease: 'power2.out' }, 0)
        // Press: the bubble lifts off (its spot stays as a faint ghost, as in a real drag).
        .to(s, { press: 1, duration: 0.18, ease: 'power2.out' }, 0.62)
        .to(s, { ring: 1, duration: 0.5, ease: 'power2.out' }, 0.66)
        .call(() => ghost(true), [], 0.72)
        .to(s, { lifted: 1, duration: 0.08 }, 0.72)
        // Carry it over to Step 2, pause, let go.
        .to(s, { carry: 1, duration: 1.15, ease: 'none' }, 0.86)
        .to(s, { press: 0, duration: 0.2, ease: 'power2.out' }, 2.3)
        .to(s, { release: 1, duration: 0.45, ease: 'power2.out' }, 2.3)
        .to(s, { hand: 0, duration: 0.35, ease: 'power1.in' }, 2.4)
        // …and it floats back home.
        .to(s, { back: 1, duration: 0.95, ease: 'none' }, 2.45)
        .call(() => ghost(false), [], 3.2);

      function finish(instant = false) {
        if (!stop) return;
        stop = null;
        tl.kill();
        setOver(false);
        ghost(false);
        const cleanup = () => {
          clone.el.remove();
          handEl.style.opacity = '0';
          ringEl.style.opacity = '0';
        };
        if (instant) cleanup();
        else gsap.to([clone.el, handEl], { opacity: 0, duration: 0.18, onComplete: cleanup });
        last = performance.now();
        nextGap = REPEAT_GAP;
      }
      stop = (instant?: boolean) => finish(instant);
      draw();
      return true;
    }

    return () => {
      window.clearInterval(timer);
      events.forEach((name) => window.removeEventListener(name, activity, { capture: true }));
      stop?.(true);
    };
  }, []);

  return createPortal(
    <div ref={layer} aria-hidden data-ghost-demo className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      <div ref={ring} className="absolute top-0 left-0 size-[60px] rounded-full border-[3px] border-ink opacity-0" />
      <div ref={hand} className="absolute top-0 left-0 z-[90] opacity-0 will-change-transform" style={{ width: HAND, height: HAND }}>
        <HandIcon />
      </div>
    </div>,
    document.body,
  );
}

/** A pointing hand in the brand's ink-outline style, with a white body so it reads on any bubble. */
function HandIcon() {
  const paths = (
    <>
      <path d="M22 14a8 8 0 0 1-8 8" />
      <path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
      <path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1" />
      <path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10" />
      <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </>
  );
  return (
    <svg
      viewBox="0 0 24 24"
      width={HAND}
      height={HAND}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ overflow: 'visible', filter: 'drop-shadow(3px 3px 0 rgba(17,17,17,0.9))' }}
    >
      <g stroke="#ffffff" strokeWidth={5.5}>
        {paths}
      </g>
      <g fill="#ffffff" stroke="none">
        <path d="M6 14V4a2 2 0 0 1 4 0v5.5a2 2 0 0 1 4 0V10a2 2 0 0 1 4 0v1a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15z" />
      </g>
      <g stroke="#111" strokeWidth={1.7}>
        {paths}
      </g>
    </svg>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { RotateCcw } from 'lucide-react';
import { BUBBLE_HELP_ID, Bubble, LIFT_SCALE } from './Bubble';
import { BubbleWorld, fieldHeight, type Pointer } from './physics';
import type { PrioritiesState } from './usePriorities';
import { LogoShow, useIdleLogoSettings, type BubbleLook, type ShowPhase } from './idleLogo';
import { scrollToTop } from '../scroll/smoothScroll';
import { ACTIVITY_EVENT } from './activity';
import { readTilt } from './tilt/tilt';
import { playImpacts } from './sound/sound';

export const PALETTE_ID = 'palette';
/** One-screen layout (same query as the `fit` variant in index.css): the field fills its column. */
const FILLS =
  typeof window === 'undefined' ? ({ matches: false } as MediaQueryList) : window.matchMedia('(min-width: 744px) and (min-height: 560px)');

interface Props {
  state: PrioritiesState;
  /** Key of the bubble being dragged, if any. */
  activeKey: string | null;
  /** The dragged bubble is inside this field: it moves here as a physics body (no overlay). */
  dragInField: boolean;
  /** True while a workspace item is dragged — the field becomes a "drop to remove" zone. */
  removingDrag: boolean;
  /** Add to the list, flying from this element into Step 2. */
  onAdd: (key: string, from: HTMLElement) => void;
  /** A bubble dragged back from Step 2: put it exactly here (viewport px). */
  placeAt?: { key: string; x: number; y: number; id: number } | null;
}

export function BubbleField({ state, activeKey, dragInField, removingDrag, onAdd, placeAt }: Props) {
  const { bubbles, order, loading, loadError, retry } = state;
  const { setNodeRef, isOver } = useDroppable({ id: PALETTE_ID });
  const reduceMotion = useReducedMotion();
  const dragging = activeKey !== null || removingDrag;

  // ---- Physics world --------------------------------------------------------
  const containerRef = useRef<HTMLDivElement | null>(null);
  const world = useRef(new BubbleWorld());
  const els = useRef(new Map<string, HTMLDivElement>());
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** Pointer strictly inside the field (where a dragged bubble may go). */
  const pointerInside = useRef(false);
  /** Grab offset: keeps the bubble under the finger exactly where it was picked up. */
  const grab = useRef<{ key: string; ox: number; oy: number } | null>(null);
  /** Grab offset measured at the very first touch/click (a drag only starts a few px later). */
  const press = useRef<{ key: string; ox: number; oy: number } | null>(null);
  const hoverKey = useRef<string | null>(null);
  const live = useRef({ dragging, activeKey, dragInField });
  live.current = { dragging, activeKey, dragInField };
  /** The dragged bubble was following the pointer last frame (false while it waits outside the field). */
  const following = useRef(false);
  const lastWidth = useRef(0);
  const lastHeight = useRef(0);
  /** Idle logo mode: per-bubble scale/opacity on top of the physics position. */
  const looks = useRef(new Map<string, BubbleLook>());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const show = useRef<LogoShow | null>(null);
  const [showPhase, setShowPhase] = useState<ShowPhase | null>(null);

  // Refs detach/re-attach on re-renders, so a null ref only forgets the element;
  // bodies are removed in sync() when their bubble is really gone.
  const registerBody = useCallback((key: string, el: HTMLDivElement | null) => {
    if (!el) {
      els.current.delete(key);
      return;
    }
    els.current.set(key, el);
    const w = world.current;
    if (w.width > 0) {
      const b = w.upsert(key, el.offsetWidth / 2);
      el.style.transform = `translate3d(${(b.x - b.r).toFixed(2)}px, ${(b.y - b.r).toFixed(2)}px, 0)`;
    }
  }, []);

  /** Paint every body at its simulated position (no React re-render). */
  const paint = useCallback(() => {
    // A trapped bubble slipping out under the held one stays underneath it until they're apart.
    const under = world.current.passingUnder;
    const over = new Set(under.values());
    world.current.bodies.forEach((b) => {
      const el = els.current.get(b.key);
      if (!el) return;
      const look = looks.current.get(b.key);
      const scale = look && look.scale !== 1 ? ` scale(${look.scale.toFixed(3)})` : '';
      el.style.transform = `translate3d(${(b.x - b.r).toFixed(2)}px, ${(b.y - b.r).toFixed(2)}px, 0)${scale}`;
      el.style.opacity = look ? look.opacity.toFixed(3) : '';
      const z = over.has(b.key) ? '20' : '';
      if (el.style.zIndex !== z) el.style.zIndex = z;
      const passing = under.get(b.key);
      if (passing) {
        if (el.dataset.passingUnder !== passing) el.dataset.passingUnder = passing;
      } else if (el.dataset.passingUnder) delete el.dataset.passingUnder;
    });
  }, []);

  /** Measure the field and bubbles, size the field to fit, add/remove bodies. */
  const sync = useCallback(() => {
    const container = containerRef.current;
    if (!container || els.current.size === 0) return;
    const width = container.clientWidth;
    lastWidth.current = width;
    let height: number;
    if (FILLS.matches) {
      // One-screen layout: the field is as tall as the column leaves it. If the bubbles don't fit
      // in that, they shrink (down to 60%) rather than the page growing.
      container.style.height = '';
      container.style.removeProperty('--bubble-scale');
      height = container.clientHeight;
      lastHeight.current = height;
      const full = [...els.current.values()].map((el) => el.offsetWidth / 2);
      const needed = fieldHeight(width, full, 0);
      if (needed > height) container.style.setProperty('--bubble-scale', Math.max(0.6, Math.sqrt(height / needed)).toFixed(3));
    } else {
      const radii = [...els.current.values()].map((el) => el.offsetWidth / 2);
      const minHeight = window.matchMedia('(min-width: 1024px)').matches ? 420 : 280;
      height = fieldHeight(width, radii, minHeight);
      container.style.height = `${height}px`;
    }
    world.current.setSize(width, height);
    els.current.forEach((el, key) => world.current.upsert(key, el.offsetWidth / 2));
    world.current.bodies.forEach((_, key) => !els.current.has(key) && world.current.remove(key));
    if (reduceMotion) world.current.settle();
    paint();
  }, [paint, reduceMotion]);

  const bodyKeys = bubbles.map((b) => b.key).join('|');
  useLayoutEffect(() => {
    if (loading || loadError) {
      if (containerRef.current) containerRef.current.style.height = '';
      return;
    }
    sync();
  }, [bodyKeys, loading, loadError, sync]);

  // Step 2 → Step 1: the bubble lands where it was dropped (before paint, so it never jumps);
  // its neighbours then make room through the physics.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!placeAt || !container) return;
    const r = container.getBoundingClientRect();
    // Bubbles are drawn inside the field's border, so measure from there.
    world.current.place(placeAt.key, placeAt.x - r.left - container.clientLeft, placeAt.y - r.top - container.clientTop);
    world.current.resolve();
    paint();
  }, [placeAt?.id]); // once per drop

  // Back into the field mid-drag: put the bubble under the finger before this frame paints,
  // in the same commit that hides the floating copy — so it never shows at its old spot.
  useLayoutEffect(() => {
    const g = grab.current;
    const p = pointer.current;
    if (!dragInField || !activeKey || reduceMotion || g?.key !== activeKey || !p) return;
    if (following.current) return;
    world.current.setScale(activeKey, LIFT_SCALE);
    world.current.place(activeKey, p.x + g.ox, p.y + g.oy);
    following.current = true;
    world.current.drive(activeKey, p.x + g.ox, p.y + g.oy);
    world.current.resolve(); // neighbours make room before this frame is drawn
    paint();
  }, [dragInField, activeKey, reduceMotion, paint]);

  // Re-measure when the column width or breakpoint changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const sameWidth = Math.abs(container.clientWidth - lastWidth.current) <= 1;
      const sameHeight = !FILLS.matches || Math.abs(container.clientHeight - lastHeight.current) <= 1;
      if (sameWidth && sameHeight) return;
      show.current?.cancel(); // the logo was laid out for the old size
      sync();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [sync]);

  // Pointer position in field coordinates (mouse always; touch only while dragging).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const container = containerRef.current;
      if (!container || (e.pointerType !== 'mouse' && e.type === 'pointermove' && !live.current.dragging)) return;
      const r = container.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const margin = 60;
      pointerInside.current = x >= 0 && y >= 0 && x <= r.width && y <= r.height;
      pointer.current = x > -margin && y > -margin && x < r.width + margin && y < r.height + margin ? { x, y } : null;
      if (e.type === 'pointerdown') {
        const key = (e.target as Element | null)?.closest<HTMLElement>('[data-body]')?.dataset.body;
        const body = key ? world.current.bodies.get(key) : undefined;
        press.current = key && body ? { key, ox: body.x - x, oy: body.y - y } : null;
      }
    };
    const clear = () => (pointer.current = null);
    const onUp = (e: PointerEvent) => e.pointerType !== 'mouse' && clear();
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    document.documentElement.addEventListener('pointerleave', clear);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      window.removeEventListener('pointerup', onUp);
      document.documentElement.removeEventListener('pointerleave', clear);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // Drag lifecycle: remember the grab offset on pick-up; on release, let go with momentum.
  useEffect(() => {
    const w = world.current;
    if (activeKey) {
      const body = w.bodies.get(activeKey);
      const p = pointer.current;
      // Keep the exact spot that was grabbed under the finger (not where it was ~6 px later).
      grab.current =
        press.current?.key === activeKey
          ? { ...press.current }
          : { key: activeKey, ox: body && p ? body.x - p.x : 0, oy: body && p ? body.y - p.y : 0 };
      return;
    }
    const g = grab.current;
    if (!g) return;
    grab.current = null;
    w.setScale(g.key, 1);
    if (reduceMotion) {
      // No simulation running: drop it exactly where it was released, then tidy overlaps.
      const p = pointer.current;
      if (p && pointerInside.current) w.place(g.key, p.x + g.ox, p.y + g.oy);
      w.settle();
      paint();
    } else {
      w.release();
    }
  }, [activeKey, reduceMotion, paint]);

  // The simulation loop (requestAnimationFrame pauses itself in background tabs).
  useEffect(() => {
    if (reduceMotion || loading || loadError) return;
    let raf = 0;
    let frame = 0;
    let onScreen = true;
    let prev = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const deltaTime = now - prev;
      prev = now;
      // Skip work while the field is scrolled out of view (checked every 20 frames).
      if (frame++ % 20 === 0 && containerRef.current) {
        const r = containerRef.current.getBoundingClientRect();
        onScreen = r.bottom > 0 && r.top < window.innerHeight;
      }
      if (!onScreen) return;
      const time = now / 1000;
      const w = world.current;
      const { dragging: isDragging, activeKey: dragged } = live.current;
      w.held.clear();
      if (hoverKey.current && !isDragging) w.held.add(hoverKey.current);

      // The dragged bubble is a solid body that follows the pointer while it's in the field;
      // neighbours are pushed by real collisions. Outside the field it waits where it left.
      // "In the field" comes from the same source that hides the floating copy (dnd-kit), so
      // exactly one of the two is ever shown.
      const body = dragged ? w.bodies.get(dragged) : undefined;
      const g = grab.current;
      if (dragged && body) {
        const p = pointer.current;
        if (p && live.current.dragInField && g?.key === dragged) {
          w.setScale(dragged, LIFT_SCALE);
          // Coming back in: appear right under the finger (where the floating copy was),
          // instead of sliding over from where it left.
          if (!following.current) w.place(dragged, p.x + g.ox, p.y + g.oy);
          following.current = true;
          w.drive(dragged, p.x + g.ox, p.y + g.oy);
        } else {
          following.current = false;
          w.setScale(dragged, 1);
          w.drive(dragged, body.x, body.y);
        }
      } else {
        following.current = false;
      }

      // Hover: nearby bubbles lean out of the cursor's way.
      const push: Pointer | null = pointer.current && !isDragging ? { ...pointer.current, reach: 34, strength: 1000 } : null;
      // iPad tilt: bubbles roll "downhill" (null when tilt is off or the device is level).
      w.tilt = readTilt();
      w.step(deltaTime / 1000, time, push);
      // Bubble and wall hits → optional sound effects.
      if (w.impacts.length) playImpacts(w.impacts, w.width);
      paint();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion, loading, loadError, paint]);

  // Idle invitation: while the list is empty, a bubble gets a gentle upward nudge
  // every few seconds and bumps its neighbours — real physics, no scripted hop.
  const idle = order.length === 0 && !dragging && !loading && !loadError && !reduceMotion;
  useEffect(() => {
    if (!idle) return;
    const nudge = () => {
      if (show.current) return;
      const keys = [...world.current.bodies.keys()].filter((k) => k !== hoverKey.current);
      if (!keys.length) return;
      const key = keys[Math.floor(Math.random() * keys.length)];
      world.current.impulse(key, (Math.random() - 0.5) * 70, -95 - Math.random() * 40);
    };
    const first = window.setTimeout(nudge, 1400);
    const timer = window.setInterval(nudge, 5000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [idle]);

  // ---- Idle logo mode ---------------------------------------------------------
  // Nobody touches the screen for the admin-set time → the bubbles gather into the logo.
  // The first touch (or key, wheel, mouse move) scatters it and the bubbles carry on.
  const idleLogo = useIdleLogoSettings();
  const idleSettings = useRef(idleLogo);
  idleSettings.current = idleLogo;
  const busy = useRef(false);
  busy.current = dragging;
  const logoOn = !!idleLogo?.enabled && !loading && !loadError;
  const idleMs = (idleLogo?.idleMinutes ?? 0) * 60_000;

  useEffect(() => {
    if (!logoOn) return;
    let last = performance.now();
    let mouse: { x: number; y: number } | null = null;
    const fieldPoint = (e: Event) => {
      const c = containerRef.current;
      if (!c || !('clientX' in e)) return [undefined, undefined] as const;
      const r = c.getBoundingClientRect();
      const p = e as PointerEvent;
      return [p.clientX - r.left - c.clientLeft, p.clientY - r.top - c.clientTop] as const;
    };
    const activity = (e: Event) => {
      if (e.type === 'pointermove') {
        // Ignore tiny jitters (and the synthetic moves some browsers send when the page changes).
        const p = e as PointerEvent;
        const moved = mouse ? Math.hypot(p.clientX - mouse.x, p.clientY - mouse.y) : 0;
        mouse = { x: p.clientX, y: p.clientY };
        if (moved < 6) return;
      }
      last = performance.now();
      show.current?.scatter(...fieldPoint(e));
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', ACTIVITY_EVENT] as const;
    events.forEach((name) => window.addEventListener(name, activity, { capture: true, passive: true }));

    const timer = window.setInterval(() => {
      const now = performance.now();
      if (show.current || document.hidden) return;
      if (busy.current) {
        last = now; // mid-drag: not idle
        return;
      }
      const settings = idleSettings.current;
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (now - last < idleMs || !settings || !container || !canvas) return;
      // The bubbles sit at the top of the page: bring them into view first.
      const r = container.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight * 0.6) scrollToTop();
      const run = new LogoShow(
        {
          canvas,
          world: world.current,
          elements: els.current,
          looks: looks.current,
          paint,
          reduceMotion: !!reduceMotion,
          onPhase: (phase) => {
            setShowPhase(phase);
            if (phase === null && show.current === run) {
              show.current = null;
              last = performance.now(); // the next logo waits a full idle period again
            }
          },
        },
        settings,
      );
      show.current = run;
      void run.start().then(() => {
        if (!run.active && show.current === run) show.current = null; // could not start (e.g. logo failed to load)
      });
    }, 400);

    return () => {
      window.clearInterval(timer);
      events.forEach((name) => window.removeEventListener(name, activity, { capture: true }));
      show.current?.cancel();
      show.current = null;
    };
  }, [logoOn, idleMs, paint, reduceMotion]);

  const toggle = (key: string, el: HTMLElement) => (order.includes(key) ? state.remove(key) : onAdd(key, el));
  // A hovered bubble grows 8% — let the physics know so neighbours keep their distance.
  const onHover = useCallback((key: string | null) => {
    const w = world.current;
    if (hoverKey.current && hoverKey.current !== key) w.setScale(hoverKey.current, 1);
    hoverKey.current = key;
    if (key) w.setScale(key, 1.08);
  }, []);

  return (
    <section aria-labelledby="bubbles-title" className="flex min-h-0 flex-col fit:min-h-0 fit:flex-1">
      <header className="mb-3 flex items-end justify-between gap-3 short:mb-2">
        <div>
          <p className="pw-eyebrow text-pw-pink">Step 1</p>
          <h2 id="bubbles-title" className="pw-display text-2xl">
            Pick what matters
          </h2>
        </div>
      </header>
      {/* Read by screen readers for every bubble (aria-describedby). */}
      <p id={BUBBLE_HELP_ID} hidden>
        Press Space or Enter to add this topic to your ranking, or to take it out again. Bubbles can’t be dragged with the keyboard;
        reorder your ranking in Step 2.
      </p>

      <div
        ref={(el) => {
          setNodeRef(el);
          containerRef.current = el;
        }}
        className={[
          'relative overflow-hidden rounded-[28px] border-2 border-ink transition-colors duration-200 fit:min-h-0 fit:flex-1',
          removingDrag ? (isOver ? 'bg-pw-pink-tint' : 'bg-pw-yellow-tint/60') : 'bg-pw-yellow-tint/45',
        ].join(' ')}
      >
        {loading && <FieldMessage>Loading bubbles…</FieldMessage>}
        {loadError && (
          <FieldMessage>
            <span className="block">{loadError}</span>
            <button type="button" onClick={retry} className="pw-btn pw-btn-ghost mt-3">
              <RotateCcw className="size-4" /> Try again
            </button>
          </FieldMessage>
        )}

        {!loading &&
          !loadError &&
          bubbles.map((b, i) => {
            const rank = order.indexOf(b.key);
            return (
              <Bubble
                key={b.key}
                item={b}
                index={i}
                placedRank={rank === -1 ? null : rank + 1}
                lifted={activeKey === b.key && dragInField && !reduceMotion}
                onToggle={toggle}
                registerBody={registerBody}
                onHover={onHover}
              />
            );
          })}

        <canvas ref={canvasRef} aria-hidden data-idle-logo={showPhase ?? 'off'} className="pointer-events-none absolute inset-0 z-30 h-full w-full" />
        {showPhase && (
          <p className="sr-only" role="status">
            PouchWale. Touch the screen to start.
          </p>
        )}

        <AnimatePresence>
          {removingDrag && (
            <motion.p
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 12, opacity: 0 }}
              className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs font-extrabold uppercase tracking-wide text-ink"
            >
              Drop here to remove
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* While the logo shows, the first touch only wakes the bubbles; it never presses what's underneath. */}
      {showPhase &&
        createPortal(
          <div
            data-idle-logo-overlay
            aria-hidden
            className="fixed inset-0 z-[110] cursor-pointer touch-none"
            onPointerDown={(e) => e.preventDefault()}
            onClick={(e) => e.preventDefault()}
          />,
          document.body,
        )}
    </section>
  );
}

function FieldMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center p-6 text-center text-sm font-bold text-ink-2 lg:min-h-[420px] fit:min-h-0">
      {children}
    </div>
  );
}

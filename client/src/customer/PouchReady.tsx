/**
 * "Your pouch is ready": the moment every topic is ranked. The Step 1 bubbles burst into mini-pouch
 * confetti, the confetti swirls into a big PouchWale pouch, the pouch zips shut and the message stamps
 * in (about 4 s, once per visit). A tap or Esc skips it. It ends by pointing at Step 3, the results.
 * Reduced motion: no confetti or flying, just the sealed pouch and the message fading in and out.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import gsap from 'gsap';
import { ArrowRight } from 'lucide-react';
import type { BrandColor } from '@pw/shared';
import { faceSpot, makeClone, placeClone } from '../intro/handoff';
import { scrollToElement } from '../scroll/smoothScroll';
import { rankAnchorSelector } from './BubbleFlight';
import { CELEBRATING, fx } from './sound/sound';

const HEX: Record<BrandColor, string> = { yellow: '#f3e33f', pink: '#fe4587', blue: '#149eda', orange: '#ff561d' };
const INK = '#111111';
/** Confetti pieces per bubble. */
const PIECES = 9;
/** Timeline marks, seconds. */
const T = { burst: 0.12, burstGap: 0.09, drop: 0.5, swirl: 1.1, zip: 1.9, seal: 2.42, exit: 4.1 };

/** The pouch, drawn in a 240 × 300 box: outline, where its mouth is, and the zip track. */
const BODY = 'M28 40 H212 Q216 40 216 44 L213 252 Q211 284 180 286 H60 Q29 284 27 252 L24 44 Q24 40 28 40 Z';
const MOUTH = { x: 120, y: 40 };
const ZIP = { from: 36, to: 204, y: 58 };

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** A sound must never stop the show (e.g. a page left open across an update): the animation goes on without it. */
function sound(...args: Parameters<typeof fx>) {
  try {
    fx(...args);
  } catch {
    // silent
  }
}

/** A mini pouch for the confetti. */
const pieceSvg = (color: string) =>
  `<svg width="16" height="20" viewBox="0 0 16 20" aria-hidden="true"><path d="M2.5 4.5h11a1 1 0 0 1 1 1V15q0 3.5-3.5 3.5H5Q1.5 18.5 1.5 15V5.5a1 1 0 0 1 1-1Z" fill="${color}" stroke="${INK}" stroke-width="1.4"/><path d="M2 7.5h12" stroke="${INK}" stroke-width="1" opacity=".55"/></svg>`;

const onScreen = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 8 && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
};

/** The nearest ancestor that scrolls on its own (the tablet columns), if any. */
function scrollParent(el: HTMLElement | null) {
  for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

interface Props {
  /** The ranked topics, most important first. */
  ranked: { key: string; color: BrandColor }[];
  reduceMotion: boolean;
  onDone: () => void;
}

export function PouchReady({ ranked, reduceMotion, onDone }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const pouch = useRef<HTMLDivElement>(null);
  const mouth = useRef<SVGEllipseElement>(null);
  const zipClip = useRef<SVGRectElement>(null);
  const slider = useRef<SVGGElement>(null);
  const message = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const confetti = useRef<HTMLDivElement>(null);
  const popLayer = useRef<HTMLDivElement>(null);
  /** End now: `fast` for a skip (tap or Esc). */
  const finish = useRef<(fast: boolean) => void>(() => {});
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const html = document.documentElement;
    html.classList.add(CELEBRATING);
    const layer = confetti.current!;
    const pouchEl = pouch.current!;
    const H = window.innerHeight;
    /** Bubbles hidden after bursting (shown again at the end, or on cleanup at the latest). */
    const hidden: HTMLElement[] = [];
    const everHidden: HTMLElement[] = [];
    const tweens: gsap.core.Animation[] = [];
    let ended = false;
    const tl = gsap.timeline();
    tweens.push(tl);

    // The pouch is centred by the layout: find its mouth before moving it.
    gsap.set(pouchEl, { clearProps: 'transform' });
    const svg = pouchEl.querySelector('svg')!.getBoundingClientRect();
    const k = svg.width / 240;
    const mouthAt = { x: svg.left + MOUTH.x * k, y: svg.top + MOUTH.y * k };

    const resultsSection = () => document.querySelector<HTMLElement>('section[aria-labelledby="suggest-title"]');

    /** Step 3 (the results): bring it into view, so the eye goes there next (then `glowResults`). */
    const pointToResults = () => {
      const results = resultsSection();
      if (!results) return;
      const head = results.querySelector('h2') ?? results;
      if (!onScreen(head)) {
        const column = scrollParent(results);
        if (column) column.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        else scrollToElement(results);
      }
    };

    /** …and make it glow once it has scrolled into place. */
    const glowResults = () => {
      const results = resultsSection();
      if (!results) return;
      const r = results.getBoundingClientRect();
      const ring = document.createElement('div');
      ring.setAttribute('aria-hidden', 'true');
      ring.style.cssText = `position:fixed;left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${Math.min(r.height, H - r.top) + 12}px;border:4px solid #fe4587;border-radius:26px;pointer-events:none;z-index:95`;
      document.body.appendChild(ring);
      const glow = ring.animate(
        [
          { opacity: 0.9, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(1.025)' },
        ],
        { duration: 750, iterations: 2, easing: 'ease-out' },
      );
      glow.onfinish = () => ring.remove();
    };

    /** The burst bubbles pop back into Step 1, each exactly where its real bubble is. */
    const popBack = () => {
      hidden.splice(0).forEach((el, i) => {
        const face = el.querySelector<HTMLElement>('[data-bubble-face]');
        if (!face || !popLayer.current) return el.removeAttribute('data-celebrate-hide');
        const clone = makeClone(face, popLayer.current);
        const p = { s: 0 };
        tweens.push(
          gsap.to(p, {
            s: 1,
            duration: 0.42,
            delay: i * 0.05,
            ease: 'back.out(2.4)',
            onUpdate: () => {
              const at = faceSpot(face);
              placeClone(clone, at.x, at.y, at.d * p.s, 1);
            },
            onComplete: () => {
              el.removeAttribute('data-celebrate-hide');
              clone.el.remove();
            },
          }),
        );
      });
    };

    const exit = (fast: boolean) => {
      if (ended) return;
      ended = true;
      tl.kill();
      if (root.current) root.current.style.pointerEvents = 'none';
      const d = fast ? 0.22 : 0.45;
      const xt = gsap.timeline({ onComplete: () => done.current() });
      tweens.push(xt);
      if (layer.children.length) xt.to(Array.from(layer.children), { opacity: 0, duration: d * 0.6, overwrite: true }, 0);
      // The pouch flies off toward the results and shrinks away.
      const results = document.querySelector('section[aria-labelledby="suggest-title"]')?.getBoundingClientRect();
      const pr = pouchEl.getBoundingClientRect();
      if (results && !fast && !reduceMotion && results.bottom > 0 && results.top < H) {
        xt.to(
          pouchEl,
          {
            x: `+=${results.left + Math.min(results.width, 320) / 2 - (pr.left + pr.width / 2)}`,
            y: `+=${results.top + 80 - (pr.top + pr.height / 2)}`,
            scale: 0.16,
            opacity: 0,
            duration: 0.55,
            ease: 'power2.in',
            overwrite: true,
          },
          0,
        );
      } else xt.to(pouchEl, { opacity: 0, scale: reduceMotion ? 1 : 0.85, duration: d, overwrite: true }, 0);
      xt.to([message.current, action.current], { opacity: 0, duration: d * 0.7, overwrite: true }, 0);
      xt.to(backdrop.current, { opacity: 0, duration: d, overwrite: true }, 0.05);
      xt.call(popBack, [], fast ? 0 : 0.15);
      xt.call(pointToResults, [], fast ? 0.05 : 0.3);
      // Part of this timeline (not a timer), so it's dropped if the page goes away first (e.g. kiosk Start over).
      if (!reduceMotion) xt.call(glowResults, [], (fast ? 0.05 : 0.3) + 0.45);
      xt.to({}, { duration: hidden.length * 0.05 + 0.6 }, 0); // let the bubbles finish popping back
    };
    finish.current = exit;

    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && exit(true);
    // Safety net: whatever happens, the page is never left covered.
    let hardStop = 0;
    const watchdog = window.setTimeout(
      () => {
        exit(true);
        hardStop = window.setTimeout(() => done.current(), 800); // even if the animations themselves are stuck
      },
      ((reduceMotion ? 2.8 : T.exit) + 2.5) * 1000,
    );
    window.addEventListener('keydown', onKey);

    if (reduceMotion) {
      // Calm version: the sealed pouch and the message fade in, stay, and fade out.
      gsap.set(mouth.current, { attr: { ry: 0 } });
      gsap.set(zipClip.current, { attr: { width: ZIP.to - ZIP.from + 8 } });
      gsap.set(slider.current, { x: ZIP.to - ZIP.from });
      tl.fromTo(backdrop.current, { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0);
      tl.fromTo([pouchEl, message.current, action.current], { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.1);
      tl.call(() => sound('ding'), [], 0.1);
      tl.call(() => exit(false), [], 2.8);
    } else {
      tl.fromTo(backdrop.current, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power1.out' }, 0);
      gsap.set([pouchEl, message.current, action.current], { opacity: 0 });

      // 1. The bubbles burst, in rank order, into mini pouches in their own colour.
      ranked.forEach((item, i) => {
        const at = T.burst + i * T.burstGap;
        const el = document.querySelector<HTMLElement>(`[data-body="${CSS.escape(item.key)}"]`);
        const face = el?.querySelector<HTMLElement>('[data-bubble-face]');
        const anchor = document.querySelector<HTMLElement>(rankAnchorSelector(item.key));
        // Off screen (e.g. a phone scrolled to Step 2): burst from its Step 2 row instead.
        const source = face && onScreen(face) ? face : anchor && onScreen(anchor) ? anchor : null;
        tl.call(
          () => {
            if (el && source === face) {
              el.setAttribute('data-celebrate-hide', '');
              hidden.push(el);
              everHidden.push(el);
            }
            sound('pop', i + 1);
          },
          [],
          at,
        );
        if (!source) return;
        const spot = faceSpot(source);
        const color = HEX[item.color];

        const ring = document.createElement('div');
        ring.style.cssText = `position:absolute;left:0;top:0;width:${spot.d}px;height:${spot.d}px;border-radius:50%;border:3px solid ${color};opacity:0`;
        layer.appendChild(ring);
        tl.fromTo(
          ring,
          { x: spot.x - spot.d / 2, y: spot.y - spot.d / 2, scale: 0.7, opacity: 1 },
          { scale: 1.6, opacity: 0, duration: 0.45, ease: 'power2.out' },
          at,
        );

        for (let p = 0; p < PIECES; p++) {
          const piece = document.createElement('div');
          piece.innerHTML = pieceSvg(color);
          piece.style.cssText = 'position:absolute;left:-8px;top:-10px;opacity:0;will-change:transform';
          layer.appendChild(piece);
          // Mostly upward, fanned out.
          const angle = -Math.PI / 2 + (p / (PIECES - 1) - 0.5) * Math.PI * 1.6 + rand(-0.15, 0.15);
          const dist = rand(0.6, 1.3) * Math.max(60, spot.d * 0.9);
          tl.fromTo(
            piece,
            { x: spot.x, y: spot.y, scale: 0.3, rotation: rand(-30, 30), opacity: 1 },
            {
              x: spot.x + Math.cos(angle) * dist,
              y: spot.y + Math.sin(angle) * dist,
              scale: rand(0.9, 1.4),
              rotation: `+=${rand(-160, 160)}`,
              duration: 0.55,
              ease: 'power3.out',
            },
            at,
          );
          // 2. A little flutter, then they swirl up and drop into the pouch's open top.
          const swirl = Math.max(T.swirl + rand(0, 0.3), at + 0.56);
          if (swirl - (at + 0.55) > 0.08) {
            tl.to(piece, { y: `+=${rand(12, 30)}`, rotation: `+=${rand(-50, 50)}`, duration: swirl - (at + 0.55), ease: 'sine.inOut' }, at + 0.55);
          }
          tl.to(piece, { x: mouthAt.x + rand(-26, 26) * k, duration: 0.5, ease: 'power1.inOut' }, swirl);
          tl.to(piece, { y: mouthAt.y - rand(40, 70) * k, duration: 0.3, ease: 'power2.out' }, swirl);
          tl.to(piece, { y: mouthAt.y + 6 * k, duration: 0.2, ease: 'power2.in' }, swirl + 0.3);
          tl.to(piece, { scale: 0.35, rotation: `+=${rand(120, 240)}`, duration: 0.5, ease: 'power1.in' }, swirl);
          tl.to(piece, { opacity: 0, duration: 0.08 }, swirl + 0.44);
        }
      });

      // 3. The big pouch drops in, open at the top, and gulps as the confetti lands in it.
      tl.fromTo(
        pouchEl,
        { y: -H * 0.65, opacity: 1, scale: 0.9, rotation: -4 },
        { y: 0, scale: 1, rotation: 0, duration: 0.65, ease: 'back.out(1.4)' },
        T.drop,
      );
      tl.to(pouchEl, { scaleX: 1.035, scaleY: 0.975, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut' }, T.swirl + 0.55);

      // 4. The zip runs across and the pouch closes…
      tl.call(() => sound('zip'), [], T.zip);
      tl.fromTo(slider.current, { x: 0 }, { x: ZIP.to - ZIP.from, duration: 0.5, ease: 'power2.inOut' }, T.zip);
      tl.fromTo(zipClip.current, { attr: { width: 0 } }, { attr: { width: ZIP.to - ZIP.from + 8 }, duration: 0.5, ease: 'power2.inOut' }, T.zip);
      tl.to(mouth.current, { attr: { ry: 0 }, duration: 0.5, ease: 'power2.inOut' }, T.zip);

      // …and is pressed shut, like a seal.
      tl.call(() => sound('ding'), [], T.seal);
      tl.to(pouchEl, { scaleX: 1.05, scaleY: 0.92, transformOrigin: '50% 100%', duration: 0.09, ease: 'power2.out' }, T.seal);
      tl.to(pouchEl, { scaleX: 1, scaleY: 1, duration: 0.55, ease: 'elastic.out(1, 0.45)' }, T.seal + 0.09);

      // 5. "Your pouch is ready" stamps in, with the way to the results.
      tl.fromTo(
        message.current,
        { opacity: 0, scale: 1.7, rotation: -9 },
        { opacity: 1, scale: 1, rotation: -3, duration: 0.32, ease: 'back.out(2.2)' },
        T.seal + 0.05,
      );
      tl.fromTo(action.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, T.seal + 0.3);
      tl.call(() => exit(false), [], T.exit);
    }

    // A modal dialog: focus goes to its one action now, and back where it was when it closes.
    const focusedBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = root.current;
    action.current?.focus({ preventScroll: true });

    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(watchdog);
      window.clearTimeout(hardStop);
      if (focusedBefore?.isConnected && (document.activeElement === document.body || dialog?.contains(document.activeElement))) {
        focusedBefore.focus({ preventScroll: true });
      }
      tweens.forEach((t) => t.kill());
      everHidden.forEach((el) => el.removeAttribute('data-celebrate-hide'));
      // Back to the starting look (React runs effects twice in development).
      gsap.set([pouchEl, message.current, action.current, slider.current], { clearProps: 'all' });
      gsap.set(mouth.current, { attr: { ry: 17 } });
      gsap.set(zipClip.current, { attr: { width: 0 } });
      layer.replaceChildren();
      popLayer.current?.replaceChildren();
      html.classList.remove(CELEBRATING);
    };
  }, []); // plays once per mount, with the props it started with

  return createPortal(
    <div
      ref={root}
      data-pouch-ready
      role="dialog"
      aria-modal="true"
      aria-label="Your pouch is ready"
      className="fixed inset-0 z-[95] touch-none select-none"
      onPointerDown={(e) => {
        if (!(e.target as Element).closest('button')) finish.current(true);
      }}
    >
      <div ref={backdrop} className="absolute inset-0 bg-ink/45 opacity-0" />
      <p className="sr-only" role="status">
        All topics ranked. Your pouch is ready.
      </p>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6">
        <div ref={pouch} style={{ width: 'min(58vw, 280px, 34dvh)' }} className="opacity-0" aria-hidden>
          <svg viewBox="0 0 240 300" className="block h-auto w-full overflow-visible">
            <defs>
              <clipPath id="pouch-ready-zip">
                <rect ref={zipClip} x={ZIP.from - 4} y={ZIP.y - 10} width="0" height="20" />
              </clipPath>
            </defs>
            {/* Stamp shadow */}
            <path d={BODY} transform="translate(9 9)" fill={INK} />
            {/* The open top: dark inside, it closes to nothing as the zip runs across */}
            <ellipse ref={mouth} cx={MOUTH.x} cy={MOUTH.y} rx="86" ry="17" fill={INK} />
            <path d={BODY} fill={HEX.yellow} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
            {/* Zip: open track (faint), then the closed teeth revealed behind the slider */}
            <path d={`M${ZIP.from} ${ZIP.y} H${ZIP.to}`} stroke={INK} strokeWidth="2" strokeDasharray="2 5" opacity="0.35" />
            <path d={`M${ZIP.from} ${ZIP.y} H${ZIP.to}`} stroke={INK} strokeWidth="7" strokeDasharray="3 3" clipPath="url(#pouch-ready-zip)" />
            <path d="M27 76 H213" stroke={INK} strokeWidth="2.5" opacity="0.3" />
            {/* Tear notches */}
            <path d="M24 92 l9 6 l-9 6" fill="none" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M216 92 l-9 6 l9 6" fill="none" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
            {/* Label with the logo */}
            <rect x="52" y="112" width="136" height="96" rx="16" fill="#ffffff" stroke={INK} strokeWidth="3" />
            <image href="/logo-pink.png" x="66" y="126" width="108" height="68" preserveAspectRatio="xMidYMid meet" />
            {/* The visitor's ranking, in order: one stripe per topic */}
            {ranked.map((item, i) => {
              const w = 136 / ranked.length;
              return (
                <rect
                  key={item.key}
                  x={52 + i * w + 1.5}
                  y="224"
                  width={w - 3}
                  height="13"
                  rx="6"
                  fill={HEX[item.color]}
                  stroke={INK}
                  strokeWidth="2"
                />
              );
            })}
            {/* Bottom gusset */}
            <path d="M46 264 Q120 282 194 264" fill="none" stroke={INK} strokeWidth="3" opacity="0.3" />
            {/* Zip slider (with its pull tab) */}
            <g ref={slider}>
              <rect x={ZIP.from - 8} y={ZIP.y - 10} width="16" height="20" rx="4" fill={INK} />
              <rect x={ZIP.from - 4} y={ZIP.y + 8} width="8" height="15" rx="3" fill={HEX.pink} stroke={INK} strokeWidth="2" />
            </g>
          </svg>
        </div>

        <div ref={message} className="opacity-0" aria-hidden>
          <p className="pw-display rounded-2xl border-[3px] border-ink bg-pw-pink px-5 py-2.5 text-center text-[28px] text-paper shadow-stamp sm:text-4xl">
            Your pouch is ready
          </p>
        </div>

        <button ref={action} type="button" className="pw-btn pw-btn-ghost opacity-0" onClick={() => finish.current(false)}>
          See my recommendations <ArrowRight className="size-4" />
        </button>
      </div>

      <div ref={confetti} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
      <div ref={popLayer} className="pointer-events-none fixed inset-0" aria-hidden />
    </div>,
    document.body,
  );
}

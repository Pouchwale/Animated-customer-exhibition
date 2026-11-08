import { useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import type { IntroStyle } from '@pw/shared';
import { lockScroll, unlockScroll } from '../scroll/smoothScroll';
import { LOGO_SRC, loadLogo } from '../brand/logoDots';
import { hideFieldBubbles } from './handoff';
import { pickIntroStyle } from './introStyle';
import { playOrbit, playReduced } from './playOrbit';
import { playDots } from './playDots';
import { playZip } from './playZip';
import { playTagline } from './playTagline';
import type { IntroRun } from './types';

/** Real brand assets: the PouchWale logo and pouch cut-outs from the brochure renders. */
const POUCHES = [
  { src: '/intro/stand-up-pouch.webp', alt: 'Stand-up pouch' },
  { src: '/intro/center-seal-pouch.webp', alt: 'Center seal pouch' },
  { src: '/intro/spout-pouch.webp', alt: 'Spout pouch' },
  { src: '/intro/3-side-seal-pouch.webp', alt: '3-side seal pouch' },
  { src: '/intro/quad-seal-pouch.webp', alt: 'Quad seal pouch' },
  { src: '/intro/special-shape-pouch.webp', alt: 'Special shape pouch' },
  { src: '/intro/freeze-grade-pouch.webp', alt: 'Freeze-grade pouch' },
  { src: '/intro/vacuum-pouch.webp', alt: 'Vacuum pouch' },
];
const TAGLINE = ['BIG', 'IDEAS,', 'SMALL', 'MOQS'];
/** The "Logo to tagline" intro's line (from pouchwale.com). */
const GROWTH_LINE = ['FUELING', 'BRAND', 'GROWTH', 'THROUGH', 'INNOVATIVE', 'POUCHES'];

/** Waits for the images to be ready (or the timeout), so the show never starts half-loaded. */
function preload(srcs: string[], timeoutMs: number) {
  const all = Promise.all(
    srcs.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.src = src;
          img.decode().then(resolve, resolve);
        }),
    ),
  );
  return Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]);
}

interface Props {
  /** Called when the screen is fully covered and the page can mount underneath. */
  onReveal: () => void;
  /** Called after the intro has finished and gone. */
  onDone: () => void;
}

/**
 * Brand intro shown on every load/reload. The admin picks the style (or lets them take turns):
 * pouches that become the Step 1 bubbles, the logo made of bubbles, the logo's zip opening the
 * page, or the classic orbit.
 */
export function BrandIntro({ onReveal, onDone }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const skipRef = useRef<() => void>(() => {});
  const callbacks = useRef({ onReveal, onDone });
  callbacks.current = { onReveal, onDone };
  const [style, setStyle] = useState<IntroStyle | null>(null);
  const reduce = useRef(typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const logo = useRef<HTMLImageElement | null>(null);
  /** Picked once per intro (effects can run twice in development; "take turns" must not skip). */
  const picking = useRef<Promise<IntroStyle> | null>(null);

  // Cover the page, then load the images and find out which intro to play.
  useLayoutEffect(() => {
    document.getElementById('boot-cover')?.remove();
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = 'hidden';
    lockScroll('intro'); // no smooth-scroll movement behind the intro
    let cancelled = false;
    Promise.all([
      (picking.current ??= reduce.current ? Promise.resolve<IntroStyle>('classic') : pickIntroStyle()),
      loadLogo().catch(() => null),
      preload([LOGO_SRC, ...POUCHES.map((p) => p.src)], 2000),
    ]).then(([picked, img]) => {
      if (cancelled) return;
      logo.current = img;
      // Dots and zip draw the logo themselves; without it, fall back to the orbit.
      setStyle(!img && (picked === 'dots' || picked === 'zip') ? 'pouches' : picked);
    });
    return () => {
      cancelled = true;
      html.style.overflow = prevOverflow;
      unlockScroll('intro');
      hideFieldBubbles(false);
    };
  }, []);

  // Play it.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !style) return;
    const html = document.documentElement;
    let revealed = false;
    let finished = false;
    const run: IntroRun = {
      reveal: () => {
        if (revealed) return;
        revealed = true;
        callbacks.current.onReveal();
      },
      finish: () => {
        if (finished) return;
        finished = true;
        html.style.overflow = '';
        unlockScroll('intro');
        hideFieldBubbles(false);
        run.reveal();
        callbacks.current.onDone();
      },
      skipRef,
    };
    const ctx = gsap.context(() => {
      if (reduce.current) playReduced(el, run);
      else if (style === 'dots' && logo.current) playDots(el, run, logo.current);
      else if (style === 'zip' && logo.current) playZip(el, run, logo.current);
      else if (style === 'tagline') playTagline(el, run);
      else playOrbit(el, run, style === 'classic' ? 'classic' : 'pouches');
    }, el);
    return () => ctx.revert();
  }, [style]);

  // Skip: Esc / Enter / Space anywhere.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        skipRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const orbit = style === 'classic' || style === 'pouches';
  return (
    <div
      ref={root}
      data-intro-style={style ?? 'loading'}
      className="fixed inset-0 z-[100] overflow-hidden select-none"
      role="dialog"
      aria-modal="true"
      aria-label="PouchWale intro"
      onClick={() => skipRef.current()}
    >
      {/* White stage (the zip intro brings its own two halves). */}
      {style !== 'zip' && <div data-intro="field" className="absolute inset-0 bg-paper" />}

      {orbit && (
        <div data-intro="stage" className="absolute inset-0">
          {POUCHES.map((p) => (
            <img
              key={p.src}
              data-intro="pouch"
              src={p.src}
              alt=""
              draggable={false}
              className="absolute top-1/2 left-1/2 h-[var(--pouch-h)] w-auto max-w-none opacity-0 will-change-transform"
            />
          ))}
          <div data-intro="center" className="absolute top-1/2 left-1/2 z-[60] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
            <img data-intro="logo" src={LOGO_SRC} alt="PouchWale" draggable={false} className="h-auto w-[min(62vw,420px)] opacity-0 will-change-transform" />
            <Tagline className="mt-[min(3vw,18px)]" />
          </div>
        </div>
      )}

      {style === 'tagline' && (
        <div className="absolute top-1/2 left-1/2 flex w-[min(62vw,420px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center">
          {/* The box keeps the artwork's ratio, so the tear tab's position is known before the image paints. */}
          <div data-intro="l2t-logo" className="relative aspect-[1894/802] w-full opacity-0 will-change-transform">
            <img src={LOGO_SRC} alt="PouchWale" draggable={false} className="block h-full w-full" />
            <span data-intro="l2t-patch" aria-hidden className="absolute top-0 left-0 rounded-full bg-paper opacity-0" />
            <span data-intro="l2t-strip" aria-hidden className="absolute top-0 left-0 rounded-full bg-pw-pink opacity-0 will-change-transform" />
          </div>
          <p
            data-intro="l2t-line"
            className="pw-display mt-[min(4vw,28px)] flex max-w-[92vw] flex-wrap justify-center gap-x-[0.28em] text-center text-[clamp(16px,2.6vw,26px)] leading-tight text-ink"
            aria-label="Fueling brand growth through innovative pouches"
          >
            {GROWTH_LINE.map((word) => (
              <span key={word} className="inline-flex overflow-hidden pb-[0.08em]" aria-hidden>
                <span data-intro="l2t-word" className="inline-block translate-y-[115%]">
                  {word}
                </span>
              </span>
            ))}
          </p>
        </div>
      )}

      {style === 'dots' && (
        <>
          <canvas data-intro="dots" role="img" aria-label="PouchWale" className="absolute inset-0 h-full w-full" />
          <Tagline data-intro="tagline" className="absolute left-1/2 -translate-x-1/2" />
        </>
      )}

      {style === 'zip' && (
        <>
          {(['top', 'bottom'] as const).map((half) => (
            <div key={half} data-intro="half" data-half={half} className="absolute inset-0 bg-paper will-change-transform">
              <canvas data-intro="zip-body" aria-hidden className="invisible absolute opacity-0" />
              <Tagline data-intro="tagline" className="absolute left-1/2 -translate-x-1/2" />
            </div>
          ))}
          <svg data-intro="zip-track" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-0">
            <polyline fill="none" stroke="#111" strokeWidth="2.5" strokeLinejoin="round" />
            <polyline fill="none" stroke="#111" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
          <img data-intro="zip-full" src={LOGO_SRC} alt="PouchWale" draggable={false} className="absolute opacity-0 will-change-transform" />
          <canvas data-intro="zip-tab" aria-hidden className="invisible absolute top-0 left-0 z-10 opacity-0 will-change-transform" />
        </>
      )}

      <button
        type="button"
        data-intro="skip"
        onClick={(e) => {
          e.stopPropagation();
          skipRef.current();
        }}
        className="pw-btn pw-btn-ghost absolute right-4 bottom-4 z-[90] opacity-0 sm:right-6 sm:bottom-6"
      >
        Skip intro
      </button>
    </div>
  );
}

/** "BIG IDEAS, SMALL MOQS", each letter ready to rise in. */
function Tagline({ className = '', ...rest }: { className?: string; 'data-intro'?: string }) {
  return (
    <p {...rest} className={`pw-display flex gap-[0.28em] text-[clamp(18px,3.2vw,30px)] whitespace-nowrap text-ink ${className}`} aria-label="Big ideas, small MOQs">
      {TAGLINE.map((word) => (
        <span key={word} className="inline-flex overflow-hidden pb-[0.08em]" aria-hidden>
          {[...word].map((ch, i) => (
            <span key={i} data-intro="char" className="inline-block translate-y-[115%]">
              {ch}
            </span>
          ))}
        </span>
      ))}
    </p>
  );
}

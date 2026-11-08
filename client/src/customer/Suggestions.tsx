import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
  type Variants,
} from 'motion/react';
import { ArrowDown, ArrowUp, ChevronDown, RotateCcw, SearchX, Sparkles } from 'lucide-react';
import { weightForRank, type ParameterRecommendation, type PriorityRating, type ScoredOption, type SuggestionResult } from '@pw/shared';
import { DUR, EASE, SPRING, T } from '../motion';
import type { Touched } from './usePriorities';

/**
 * Step 3: for every recommendation parameter the admin set up (Print Type, Material Type, …), the option
 * whose star ratings best fit the customer's Step 2 ranking (higher-ranked topics count more), and why:
 * its stars and reason on each of the customer's priorities.
 */

const reveal: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { ...T.reveal, delay: i * 0.06 },
  }),
};

/**
 * A new recommendation's entrance (the first one, and each time the winner changes), transform + opacity only:
 * the yellow wipe uncovers the header while its lines rise in one after another and the score counts up;
 * then the priority rows cascade in, each row's stars popping in left to right. When the customer only
 * reorders, the rows glide to their new places instead. Reduced motion keeps just the fades.
 */
const headerIn: Variants = { out: {}, in: { transition: { delayChildren: 0.15, staggerChildren: 0.06 } } };
const lineIn: Variants = {
  out: { opacity: 0, y: 8 },
  in: { opacity: 1, y: 0, transition: { ...T.enter, delayChildren: 0.1, staggerChildren: 0.04 } },
};
const rowsIn: Variants = { out: {}, in: { transition: { delayChildren: 0.3, staggerChildren: 0.04 } } };
const rowIn: Variants = {
  out: { opacity: 0, y: 6 },
  in: { opacity: 1, y: 0, transition: { ...T.enter, delayChildren: 0.08, staggerChildren: 0.03 } },
};
/** The pick's name rolls up into place (and the old one rolls out the top), like a departures board. */
const maskIn: Variants = { out: {}, in: {} };
const nameRoll: Variants = { out: { y: '110%' }, in: { y: 0, transition: SPRING.settle } };
const captionIn: Variants = { out: { opacity: 0 }, in: { opacity: 1, transition: T.enter } };
const starIn: Variants = { out: { opacity: 0, scale: 0.5 }, in: { opacity: 1, scale: 1, transition: SPRING.settle } };
/** Rows moving to a new place when the ranking changes. */
const GLIDE = { layout: SPRING.settle };
/** The score starts counting up as its stars pop in. */
const SCORE_DELAY = 0.35;

/** How long the row flash and the stickers stay (ms). */
const FLASH_MS = 1600;
const BADGE_MS = 2200;

/**
 * The Step 3 box keeps one identity from placeholder → loading → result, so it morphs between them
 * (a transform-based layout animation) instead of swapping. Its content fades in once the shape has settled.
 * It is measured only when `box` changes (what it shows), not on every render of the page around it.
 */
const morph = (box: MorphBox) => ({ layoutId: 'step3-box', layoutDependency: box, transition: { layout: SPRING.morph }, style: { borderRadius: 24 } });
/** What the morphing box shows: its view and the data behind it. A new object only when one of them changes. */
type MorphBox = { view: 'placeholder' | 'skeleton' | 'error' | 'empty' | 'result' | 'result-failed'; data: SuggestionResult | null };

function FadeIn({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...T.enter, delay: DUR.fast }}>
      {children}
    </motion.div>
  );
}

interface Props {
  data: SuggestionResult | null;
  /** `data` answers an earlier ranking (the request for the current one is on its way, or failed). */
  stale?: boolean;
  loading: boolean;
  error: string | null;
  hasPriorities: boolean;
  onRetry: () => void;
  /** The priority the customer last added, moved or removed: its row flashes once Step 3 has caught up. */
  touched?: Touched | null;
}

export const Suggestions = memo(function Suggestions({ data, stale = false, loading, error, hasPriorities, onRetry, touched = null }: Props) {
  const flash = useFlash(data, touched);
  // The current ranking's request failed while an earlier result is on screen: that result stays, dimmed, and says so.
  const failed = !!error && !!data;
  const view: MorphBox['view'] = !hasPriorities
    ? 'placeholder'
    : error && !data
      ? 'error'
      : !data
        ? 'skeleton'
        : data.recommendations.length === 0
          ? 'empty'
          : failed
            ? 'result-failed'
            : 'result';
  const box = useMemo<MorphBox>(() => ({ view, data }), [view, data]);
  return (
    <section aria-labelledby="suggest-title" aria-busy={loading} className="@container">
      <header className="mb-3 flex items-end justify-between gap-3 short:mb-2">
        <div>
          <p className="pw-eyebrow text-pw-orange">Step 3</p>
          <h2 id="suggest-title" className="pw-display text-2xl @max-[230px]:text-xl">
            Your recommendations
          </h2>
        </div>
        <AnimatePresence>
          {loading && hasPriorities && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: T.enter }}
              exit={{ opacity: 0, transition: T.exit }}
              className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-ink-3"
            >
              <span className="size-2 animate-ping rounded-full bg-pw-pink" /> Updating
            </motion.span>
          )}
        </AnimatePresence>
      </header>

      {failed && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: T.enter }}
          className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-bold text-ink-2"
        >
          <span role="status">Couldn’t update — showing your previous result.</span>
          <button type="button" className="pw-btn-quiet" onClick={onRetry}>
            <RotateCcw className="size-3.5" strokeWidth={2.5} /> Retry
          </button>
        </motion.p>
      )}

      {view === 'placeholder' ? (
        <Placeholder box={box} />
      ) : view === 'error' ? (
        <motion.div {...morph(box)} className="rounded-3xl border-2 border-ink p-5 text-sm font-bold">
          <FadeIn>
            <p role="alert">{error}</p>
            <button type="button" className="pw-btn pw-btn-ghost mt-3" onClick={onRetry}>
              <RotateCcw className="size-4" /> Try again
            </button>
          </FadeIn>
        </motion.div>
      ) : !data ? (
        <SkeletonCard box={box} />
      ) : view === 'empty' ? (
        <NoMatch box={box} />
      ) : (
        <ol className={['space-y-4 transition-opacity', 'duration-250', loading || stale ? 'opacity-70' : 'opacity-100'].join(' ')}>
          {data.recommendations.map((r, i) => (
            <RecommendationCard key={r.parameterId} rec={r} index={i} flash={flash} box={box} />
          ))}
        </ol>
      )}
    </section>
  );
});

function Placeholder({ box }: { box: MorphBox }) {
  return (
    <motion.div {...morph(box)} className="rounded-3xl border-2 border-dashed border-ink/30 p-6 text-center">
      <FadeIn>
        <Sparkles className="mx-auto size-6 text-pw-pink" />
        <p className="pw-display mt-2 text-lg">Your recommendations show up here</p>
        <p className="mt-1 text-sm font-semibold text-ink-2">Rank the topics in Step 2, one by one — your #1 counts the most.</p>
      </FadeIn>
    </motion.div>
  );
}

function NoMatch({ box }: { box: MorphBox }) {
  return (
    <motion.div
      {...morph(box)}
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border-2 border-dashed border-ink/30 p-6 text-center"
    >
      <FadeIn>
        <SearchX className="mx-auto size-6 text-pw-orange" />
        <p className="pw-display mt-2 text-lg">No recommendation yet</p>
        <p className="mt-1 text-sm font-semibold text-ink-2">Keep ranking topics in Step 2 and we’ll match the right options.</p>
      </FadeIn>
    </motion.div>
  );
}

/** Shaped like the card it turns into (a header block, then priority rows with their stars), so the morph reads as one card arriving. */
function SkeletonCard({ box }: { box: MorphBox }) {
  return (
    <motion.div {...morph(box)} className="overflow-hidden rounded-3xl border-2 border-ink bg-paper" aria-label="Loading recommendations">
      <FadeIn>
        <div className="space-y-2.5 bg-pw-blue/30 p-5 short:p-4">
          {[28, 55, 40].map((w, i) => (
            <div key={i} className="h-3.5 animate-pulse rounded-full bg-ink/10" style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="divide-y divide-ink/10 px-5 py-1 short:px-4">
          {[62, 48, 70].map((w, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2.5 short:py-2">
              <div className="h-3 animate-pulse rounded-full bg-ink/8" style={{ width: `${w}%` }} />
              <div className="h-3 w-20 shrink-0 animate-pulse rounded-full bg-ink/8" />
            </div>
          ))}
        </div>
      </FadeIn>
    </motion.div>
  );
}

function RecommendationCard({ rec, index, flash, box }: { rec: ParameterRecommendation; index: number; flash: Touched | null; box: MorphBox }) {
  const best = rec.recommended;
  const changed = useWinnerChange(best);
  return (
    <motion.li
      {...(index === 0 ? morph(box) : { variants: reveal, initial: 'hidden', animate: 'show', custom: index })}
      className="relative overflow-hidden rounded-3xl border-2 border-ink bg-paper shadow-stamp"
      aria-label={`${rec.name}: we recommend ${best.label}, ${best.stars.toFixed(1)} out of 5 for your priorities`}
    >
      <FadeIn>
        {/* Keyed on the winner: every new pick (the first one too) gets the full entrance; the old one fades out first. */}
        <AnimatePresence mode="wait">
          <motion.div
            key={best.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: T.enter }}
            exit={{ opacity: 0, transition: T.exit }}
          >
            <WinnerHeader name={rec.name} best={best} />
            <PriorityRows best={best} flash={flash} />
          </motion.div>
        </AnimatePresence>
      </FadeIn>

      {/* The pick just changed: a sticker pops on as the new one comes in, then goes. */}
      <AnimatePresence>
        {changed && (
          <motion.span
            key={changed.n}
            aria-hidden
            className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full border-2 border-ink bg-pw-yellow px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-ink shadow-stamp-sm short:right-2.5 short:top-2.5"
            initial={{ opacity: 0, scale: 0.5, rotate: -10 }}
            animate={{ opacity: 1, scale: 1, rotate: -3, transition: { ...SPRING.pop, delay: 0.25 } }}
            exit={{ opacity: 0, scale: 0.9, transition: T.exit }}
          >
            <Sparkles className="size-3 shrink-0" strokeWidth={2.5} />
            {/* Shorter on a narrow Step 3 so it never covers the parameter name: "New match", then "New". */}
            <span className="whitespace-nowrap">
              New<span className="@max-[300px]:hidden"> best</span>
              <span className="@max-[240px]:hidden"> match</span>
            </span>
          </motion.span>
        )}
      </AnimatePresence>
      <span className="sr-only" role="status">
        {changed ? `New best match for ${rec.name}: ${best.label}, replacing ${changed.from}` : ''}
      </span>
    </motion.li>
  );
}

function WinnerHeader({ name, best }: { name: string; best: ScoredOption }) {
  const score = useGlide(best.stars, SCORE_DELAY);
  const delta = useScoreChange(best.stars);
  const scoreText = useTransform(score, (v) => v.toFixed(1));
  return (
    <div className="relative overflow-hidden bg-pw-blue p-5 short:p-4">
      <motion.div
        aria-hidden
        className="absolute inset-0 origin-left bg-pw-yellow"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={T.reveal}
      />
      <motion.div className="relative" variants={headerIn} initial="out" animate="in">
        <motion.p variants={lineIn} className="pw-eyebrow">
          {name}
        </motion.p>
        {/* The mask's padding keeps the display font's tall glyphs from being clipped. */}
        <motion.div variants={maskIn} className="-mb-1 mt-0.5 overflow-hidden py-1">
          <motion.h3
            variants={nameRoll}
            exit={{ y: '-110%', transition: T.exit }}
            className="pw-display text-[26px] sm:text-[28px] short:text-[22px]"
          >
            {best.label}
          </motion.h3>
        </motion.div>
        <motion.p variants={lineIn} className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] font-extrabold">
          <Stars value={score} size="size-4" />
          <span className="tabular-nums">
            <motion.span>{scoreText}</motion.span> / 5
          </span>
          <span className="font-bold">for your priorities</span>
        </motion.p>
        {best.description && (
          <motion.p variants={lineIn} className="mt-1.5 text-sm font-bold short:hidden">
            {best.description}
          </motion.p>
        )}
      </motion.div>

      {/* Same pick, different score: how much it moved, in the sticker spot (a new pick gets "New best match" there). */}
      <AnimatePresence>
        {delta && (
          <motion.span
            key={delta.n}
            aria-hidden
            className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full border-2 border-ink bg-paper px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-ink tabular-nums shadow-stamp-sm short:right-2.5 short:top-2.5"
            initial={{ opacity: 0, y: 6, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: SPRING.pop }}
            exit={{ opacity: 0, y: -4, transition: T.exit }}
          >
            {delta.d > 0 ? <ArrowUp className="size-3 shrink-0" strokeWidth={3} /> : <ArrowDown className="size-3 shrink-0" strokeWidth={3} />}
            <span className="whitespace-nowrap">
              <span className="@max-[240px]:hidden">Score </span>
              {delta.d > 0 ? '+' : '−'}
              {Math.abs(delta.d).toFixed(1)}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
      <span className="sr-only" role="status">
        {delta ? `Score ${delta.d > 0 ? 'up' : 'down'} ${Math.abs(delta.d).toFixed(1)} to ${best.stars.toFixed(1)} out of 5` : ''}
      </span>
    </div>
  );
}

/** Why: every priority with this option's stars and the reason: the customer's ranked ones first (they decide the pick), then the rest. */
function PriorityRows({ best, flash }: { best: ScoredOption; flash: Touched | null }) {
  const firstOther = best.ratings.findIndex((r) => r.rank === null);
  const items: (PriorityRating | 'others')[] = best.ratings.flatMap((r, i) => (i === firstOther ? ['others' as const, r] : [r]));
  // Each ranked priority's share of the score: #1 weighs most (the same weights the scoring uses).
  const total = best.ratings.reduce((sum, r) => sum + (r.rank === null ? 0 : weightForRank(r.rank)), 0) || 1;
  const listRef = useRef<HTMLUListElement>(null);
  const narrow = useNarrow(listRef, NARROW_LIST);
  return (
    <motion.ul
      ref={listRef}
      variants={rowsIn}
      initial="out"
      animate="in"
      className="divide-y divide-ink/10 px-5 py-2 short:px-4 short:py-1"
      aria-label={`Why ${best.label}: how it rates on every priority`}
    >
      {items.map((it, i) =>
        it === 'others' ? (
          <motion.li
            key="others"
            aria-hidden
            layout="position"
            layoutDependency={i}
            transition={GLIDE}
            variants={captionIn}
            className="pt-2 pb-0.5 text-[10px] font-extrabold uppercase tracking-wider text-ink-3 short:pt-1"
          >
            Your other priorities
          </motion.li>
        ) : (
          <PriorityRow key={it.key} it={it} index={i} flash={flash} share={it.rank === null ? 0 : weightForRank(it.rank) / total} narrow={narrow} />
        ),
      )}
    </motion.ul>
  );
}

/** Below this list width (px) the stars go under the name and reasons open on tap. */
const NARROW_LIST = 220;

function PriorityRow({ it, index, flash, share, narrow }: { it: PriorityRating; index: number; flash: Touched | null; share: number; narrow: boolean }) {
  const [open, setOpen] = useState(false);
  const tapToRead = narrow && !!it.reason;
  const label = (
    <span
      className={['block text-sm font-extrabold transition-colors duration-250 short:text-[13px]', it.rank === null ? 'text-ink-2' : 'text-ink'].join(
        ' ',
      )}
    >
      <RollingRank rank={it.rank} />
      {it.label}
      {it.rank === null && <span className="sr-only"> (not in your list)</span>}
      {it.rank !== null && <span className="sr-only">, counts for {Math.round(share * 100)}% of the score</span>}
    </span>
  );
  const stars = (
    <span
      className={[
        'flex shrink-0 items-center transition-[opacity,scale] duration-250',
        it.rank === null ? 'opacity-70' : '',
        'group-hover:scale-105',
      ].join(' ')}
    >
      <Stars value={it.stars} size="size-5" gap />
      <span className="sr-only">{it.stars ? `${it.stars} of 5 stars` : 'not rated'}</span>
    </span>
  );
  return (
    <motion.li
      layout="position"
      layoutDependency={index}
      transition={GLIDE}
      variants={rowIn}
      title={it.rank !== null ? `${it.label} counts for ${Math.round(share * 100)}% of the score` : undefined}
      className={[
        'relative isolate py-2 short:py-1 tiny:py-0.5',
        tapToRead ? '' : 'flex items-center justify-between gap-3',
        // Hover (mouse only): a soft tint behind the row and its stars lift a little.
        'group before:pointer-events-none before:absolute before:-inset-x-3 before:inset-y-0.5 before:-z-20 before:rounded-xl before:bg-ink/[0.04] before:opacity-0 before:transition-opacity before:duration-150 hover:before:opacity-100',
      ].join(' ')}
    >
      {/* Cause and effect: the priority the customer just touched lights up as it lands in its new place. */}
      {flash?.key === it.key && (
        <motion.span
          key={flash.n}
          aria-hidden
          className="pointer-events-none absolute -inset-x-3 inset-y-0.5 -z-10 rounded-xl bg-pw-yellow-tint"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{ duration: FLASH_MS / 1000, times: [0, 0.15, 0.6, 1], ease: 'easeInOut' }}
        />
      )}
      {it.rank !== null && <WeightBar share={share} />}

      {tapToRead ? (
        // Narrow Step 3: name on top, stars under it; the reason opens on tap instead of squeezing beside the stars.
        <>
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full flex-col items-start gap-1 text-left">
            <span className="flex w-full items-start justify-between gap-1">
              {label}
              <ChevronDown
                aria-hidden
                className={['mt-0.5 size-4 shrink-0 text-ink-3 transition-transform duration-250', open ? 'rotate-180' : ''].join(' ')}
              />
            </span>
            {stars}
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.span
                key="reason"
                className="block overflow-hidden text-xs font-semibold leading-snug text-ink-2"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1, transition: T.enter }}
                exit={{ height: 0, opacity: 0, transition: T.exit }}
              >
                <span className="block pt-1">{it.reason}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </>
      ) : (
        <>
          <span className="min-w-0">
            {label}
            {it.reason && <span className="block text-xs font-semibold leading-snug text-ink-2 short:text-[11px] tiny:hidden">{it.reason}</span>}
          </span>
          {stars}
        </>
      )}
    </motion.li>
  );
}

/** The "#2" in front of a priority rolls to "#1" (new number up from below, old one out the top). */
function RollingRank({ rank }: { rank: number | null }) {
  return (
    // clip-path (not overflow) clips the roll without moving the text baseline.
    <span className="relative inline-flex [clip-path:inset(0)]">
      <AnimatePresence initial={false} mode="popLayout">
        {rank !== null && (
          <motion.span
            key={rank}
            className="mr-1 font-bold text-ink-3"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '-100%' }}
            transition={SPRING.settle}
          >
            #{rank}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** How much a ranked priority counts (its share of the score), as a bar along the row's bottom edge. */
function WeightBar({ share }: { share: number }) {
  const reduceMotion = useReducedMotion();
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute bottom-0 left-0 h-[3px] w-full origin-left rounded-full bg-pw-blue tiny:h-[2px]"
      // Reduced motion: shown at its size straight away.
      initial={reduceMotion ? false : { scaleX: 0 }}
      animate={{ scaleX: share }}
      // Grows in after its row has arrived; afterwards it resizes straight away as the ranking changes.
      transition={{ duration: 0.6, ease: EASE.pw, delay: first.current ? 0.5 : 0 }}
    />
  );
}

/** Whether an element is narrower than `max` px (content width), kept up to date as it resizes. */
function useNarrow(ref: React.RefObject<HTMLElement | null>, max: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < max));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, max]);
  return narrow;
}

/** While the pick stays the same: how much its score just moved (rounded like the score), for a couple of seconds. */
function useScoreChange(stars: number): { d: number; n: number } | null {
  const prev = useRef(stars);
  const [delta, setDelta] = useState<{ d: number; n: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    const d = Math.round((stars - prev.current) * 10) / 10;
    prev.current = stars;
    if (d === 0) return;
    setDelta((c) => ({ d, n: (c?.n ?? 0) + 1 }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDelta(null), BADGE_MS);
  }, [stars]);
  return delta;
}

/**
 * The priority the customer just touched, from the moment Step 3 shows the result of that touch until the
 * flash is over. A refresh without a touch (e.g. returning to the tab) flashes nothing.
 */
function useFlash(data: SuggestionResult | null, touched: Touched | null): Touched | null {
  const [flash, setFlash] = useState<Touched | null>(null);
  const seenData = useRef(data);
  const handled = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (data === seenData.current) return; // the touch itself: wait for its result
    seenData.current = data;
    if (!data || !touched || touched.n === handled.current) return;
    handled.current = touched.n;
    setFlash(touched);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  }, [data, touched]);
  return flash;
}

/** When a card's pick changes (not when it first appears): what it was, for a couple of seconds. */
function useWinnerChange(best: ScoredOption): { from: string; n: number } | null {
  const prev = useRef({ id: best.id, label: best.label });
  const [changed, setChanged] = useState<{ from: string; n: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    const before = prev.current;
    prev.current = { id: best.id, label: best.label };
    if (before.id === best.id) return;
    setChanged((c) => ({ from: before.label, n: (c?.n ?? 0) + 1 }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setChanged(null), BADGE_MS);
  }, [best.id, best.label]);
  return changed;
}

/** A number that glides to each new value (from 0 when it first appears), so the score and its stars count up together. */
function useGlide(value: number, delay: number): MotionValue<number> {
  const reduceMotion = useReducedMotion();
  const mv = useMotionValue(reduceMotion ? value : 0);
  useEffect(() => {
    if (reduceMotion) {
      mv.set(value);
      return;
    }
    const run = animate(mv, value, { duration: 0.6, ease: EASE.pw, delay: mv.get() === 0 ? delay : 0 });
    return () => run.stop();
  }, [value, delay, reduceMotion, mv]);
  return mv;
}

/** The lucide "star" icon's outline, in its 24 × 24 box. */
const STAR = 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z';

/** How wide the filled part of star n (1–5) is for a score, in the star's 24-unit box (filled from the left). */
const fillWidth = (value: number, n: number) => Math.max(0, Math.min(1, value - (n - 1))) * 24;

/**
 * Stars like the admin's rating picker: yellow with an ink outline, empty ones faint. Partial stars fill from
 * the left. Each star pops in with its row; given a motion value, the fill follows it as it counts.
 * One SVG per star: the faint outline, then the filled star clipped to the score.
 */
function Stars({ value, size, gap }: { value: number | MotionValue<number>; size: 'size-4' | 'size-5'; gap?: boolean }) {
  const sz = size === 'size-5' ? 'size-5 short:size-4' : size;
  const id = useId();
  return (
    <span className={['flex', gap ? 'gap-1 short:gap-0.5' : 'gap-0.5'].join(' ')} aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <motion.span key={n} variants={starIn} className={`relative ${sz}`}>
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`absolute inset-0 ${sz}`}>
            <clipPath id={`${id}-${n}`}>
              {typeof value === 'number' ? <rect width={fillWidth(value, n)} height={24} /> : <LiveFill value={value} n={n} />}
            </clipPath>
            <path d={STAR} stroke="currentColor" className="fill-paper/40 text-ink/25" />
            <path d={STAR} stroke="currentColor" clipPath={`url(#${id}-${n})`} className="fill-pw-yellow text-ink" />
          </svg>
        </motion.span>
      ))}
    </span>
  );
}

/** The fill of a counting score: its clip follows the motion value. */
function LiveFill({ value, n }: { value: MotionValue<number>; n: number }) {
  const width = useTransform(value, (v) => fillWidth(v, n));
  return <motion.rect width={width} height={24} />;
}

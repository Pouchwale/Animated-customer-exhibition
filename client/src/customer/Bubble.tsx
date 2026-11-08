import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useDndMonitor, useDraggable } from '@dnd-kit/core';
import { animate, motion, useAnimate, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { Check } from 'lucide-react';
import { COLOR_CLASSES, type BubbleItem } from './model';
import { EASE } from '../motion';

const bubbleDragId = (key: string) => `bubble:${key}`;

/** The hidden help text every bubble points screen readers to (rendered once, by the field). */
export const BUBBLE_HELP_ID = 'bubble-help';

/** Visual scale of a lifted bubble, and while it hovers over the priority list. */
export const LIFT_SCALE = 1.1;
export const LIFT_SCALE_OVER_LIST = 1.18;

const SIZE_CLASSES: Record<BubbleItem['size'], string> = {
  1: 'size-[calc(70px*var(--bubble-scale,1))] sm:size-[calc(80px*var(--bubble-scale,1))] tab:size-[calc(72px*var(--bubble-scale,1))]',
  2: 'size-[calc(84px*var(--bubble-scale,1))] sm:size-[calc(96px*var(--bubble-scale,1))] tab:size-[calc(86px*var(--bubble-scale,1))]',
  3: 'size-[calc(100px*var(--bubble-scale,1))] sm:size-[calc(116px*var(--bubble-scale,1))] tab:size-[calc(104px*var(--bubble-scale,1))]',
};

/**
 * Font size in container units so a label never breaks mid-word:
 * the longest word must fit ~80% of the bubble's width.
 */
function labelFontSize(name: string): string {
  const longest = Math.max(4, ...name.split(/\s+/).map((w) => w.length));
  return `max(9.5px, min(17cqw, ${(165 / longest).toFixed(2)}cqw))`;
}

/** The visual circle. Shared by the field, the drag overlay and the flight to Step 2. */
export function BubbleFace({
  item,
  placedRank,
  lifted,
  flat,
  className = '',
}: {
  item: BubbleItem;
  placedRank?: number | null;
  lifted?: boolean;
  /** No own shadow (the caller draws one). */
  flat?: boolean;
  className?: string;
}) {
  const c = COLOR_CLASSES[item.color];
  const placed = placedRank != null;
  return (
    <span
      data-bubble-face={item.key}
      className={[
        'relative flex shrink-0 items-center justify-center rounded-full border-2 border-ink p-1.5 text-center select-none [container-type:inline-size]',
        'font-display font-black uppercase leading-[0.95] tracking-tight',
        // Only opacity animates; colour and shadow change at once (the pop carries the change).
        'transition-opacity duration-250 ease-pw',
        SIZE_CLASSES[item.size],
        placed ? `${c.tint} border-dashed opacity-70` : `${c.fill} ${c.text}`,
        flat ? 'shadow-none' : lifted ? 'shadow-stamp-lg' : placed ? 'shadow-none' : 'shadow-stamp group-hover:shadow-[6px_6px_0_0_#111]',
        className,
      ].join(' ')}
    >
      {/* Flat highlight: reads as a bubble without breaking the brand's no-gradient rule. */}
      {!placed && (
        <span aria-hidden className="pointer-events-none absolute top-[13%] left-[19%] h-[13%] w-[27%] -rotate-[32deg] rounded-full bg-white/45" />
      )}
      <span className="relative line-clamp-3 px-0.5" style={{ fontSize: labelFontSize(item.name) }}>
        {item.name}
      </span>
      {placed && (
        <span className="absolute -top-1 -left-1 flex size-6 items-center justify-center rounded-full border-2 border-ink bg-ink font-display text-xs font-black text-paper">
          {placedRank}
        </span>
      )}
    </span>
  );
}

/**
 * The bubble under the pointer while dragging. It stays a perfect circle; its
 * shadow trails the movement (like a real object lifted off the page) and it
 * swells slightly when it's over the priority list.
 */
export function LiftedBubble({ item, overList, hidden }: { item: BubbleItem; overList: boolean; hidden?: boolean }) {
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  /** Hand-off offset: starts where the field bubble was and eases to the pointer. */
  const handX = useMotionValue(0);
  const handY = useMotionValue(0);
  const wasHidden = useRef(hidden);
  useLayoutEffect(() => {
    const leaving = wasHidden.current && !hidden;
    wasHidden.current = hidden;
    if (!leaving || reduceMotion) return;
    // Leaving the field: begin exactly where the field bubble is, so nothing jumps.
    const face = rootRef.current?.querySelector('[data-bubble-face]');
    const body = document.querySelector(`[data-body="${window.CSS.escape(item.key)}"] [data-bubble-face]`);
    if (!face || !body) return;
    const a = face.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    handX.jump(handX.get() + b.left + b.width / 2 - (a.left + a.width / 2));
    handY.jump(handY.get() + b.top + b.height / 2 - (a.top + a.height / 2));
    const opts = { type: 'spring', stiffness: 520, damping: 42 } as const;
    animate(handX, 0, opts);
    animate(handY, 0, opts);
  }, [hidden, item.key, reduceMotion, handX, handY]);
  const trailX = useMotionValue(8);
  const trailY = useMotionValue(8);
  const shadowX = useSpring(trailX, { stiffness: 300, damping: 22 });
  const shadowY = useSpring(trailY, { stiffness: 300, damping: 22 });
  const last = useRef({ x: 0, y: 0, t: 0 });
  const rest = useRef<number | null>(null);

  useDndMonitor({
    onDragMove({ delta }) {
      if (reduceMotion) return;
      const now = performance.now();
      const dt = Math.max(8, now - last.current.t);
      const vx = ((delta.x - last.current.x) / dt) * 16; // px per frame
      const vy = ((delta.y - last.current.y) / dt) * 16;
      last.current = { x: delta.x, y: delta.y, t: now };
      const clamp = (v: number) => Math.max(-7, Math.min(7, v));
      trailX.set(8 + clamp(-vx * 0.5));
      trailY.set(8 + clamp(-vy * 0.5));
      if (rest.current) window.clearTimeout(rest.current);
      rest.current = window.setTimeout(() => {
        trailX.set(8);
        trailY.set(8);
      }, 90);
    },
  });
  useEffect(() => () => void (rest.current && window.clearTimeout(rest.current)), []);

  return (
    // The overlay box can be a touch larger than the circle; keep the circle centred in it.
    <div ref={rootRef} className="flex h-full w-full cursor-grabbing items-center justify-center" style={{ opacity: hidden ? 0 : 1 }}>
      <motion.div
        className="relative"
        style={{ x: handX, y: handY }}
        initial={{ scale: 1 }}
        animate={{ scale: overList ? LIFT_SCALE_OVER_LIST : LIFT_SCALE }}
        transition={{ type: 'spring', stiffness: 520, damping: 17 }}
      >
        <motion.span aria-hidden className="absolute inset-0 rounded-full bg-ink" style={{ x: shadowX, y: shadowY }} />
        <BubbleFace item={item} flat />
      </motion.div>
    </div>
  );
}

interface BubbleProps {
  item: BubbleItem;
  index: number;
  /** 1-based rank when already in the workspace, else null. */
  placedRank: number | null;
  /** Being dragged around inside the field: shown lifted, in place (no overlay). */
  lifted: boolean;
  /** Click/tap/Enter. Passes the bubble element so additions can fly from it. */
  onToggle: (key: string, el: HTMLElement) => void;
  /** Physics body element (positioned by the field every frame). */
  registerBody: (key: string, el: HTMLDivElement | null) => void;
  onHover: (key: string | null) => void;
}

export function Bubble({ item, index, placedRank, lifted, onToggle, registerBody, onHover }: BubbleProps) {
  const reduceMotion = useReducedMotion();
  const placed = placedRank != null;
  const [popScope, animatePop] = useAnimate<HTMLSpanElement>();
  const wasPlaced = useRef(placed);
  const bodyRef = useCallback((el: HTMLDivElement | null) => registerBody(item.key, el), [item.key, registerBody]);

  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: bubbleDragId(item.key),
    // Every bubble can be moved around the field; placed ones just can't be added twice.
    data: { type: 'bubble', key: item.key },
  });

  // A drag that ends over the bubble itself must not count as a click (which would toggle it).
  const draggedSincePress = useRef(false);
  // Staggered pop-in on first appearance only; later lifts/settles respond instantly.
  const entryDelay = useRef(reduceMotion ? 0 : index * 0.035);
  useEffect(() => {
    if (isDragging) draggedSincePress.current = true;
  }, [isDragging]);

  // Uniform pops only — the circle never squashes.
  useEffect(() => {
    if (wasPlaced.current === placed || reduceMotion || !popScope.current) {
      wasPlaced.current = placed;
      return;
    }
    wasPlaced.current = placed;
    if (placed) {
      animatePop(popScope.current, { scale: [1, 0.86, 1] }, { duration: 0.32, ease: EASE.pw });
    } else {
      animatePop(popScope.current, { scale: [0.85, 1.05, 0.99, 1] }, { duration: 0.45, ease: 'easeOut' });
    }
  }, [placed, reduceMotion, animatePop, popScope]);

  // Keyboard users add with Enter/Space via click; drag listeners stay pointer-only.
  const { onKeyDown: _ignored, ...pointerListeners } = listeners ?? {};
  void _ignored;

  return (
    <div ref={bodyRef} data-body={item.key} className={['absolute top-0 left-0 will-change-transform', lifted ? 'z-20' : ''].join(' ')}>
      <motion.div
        className="group relative"
        initial={reduceMotion ? false : { scale: 0, opacity: 0 }}
        animate={{
          scale: lifted ? LIFT_SCALE : isDragging ? 0.9 : 1,
          opacity: 1,
        }}
        transition={{
          type: 'spring',
          stiffness: 380,
          damping: 20,
          delay: entryDelay.current,
        }}
        onAnimationComplete={() => (entryDelay.current = 0)}
      >
        {/* Ghost while the floating copy is out of the field. Plain style, not an animation, so it
            swaps in the same frame as the floating copy (never both, never neither). */}
        <div style={{ opacity: isDragging && !lifted ? 0.22 : 1 }}>
          <motion.button
            ref={setNodeRef}
            type="button"
            {...attributes}
            {...pointerListeners}
            onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(item.key)}
            onPointerLeave={() => onHover(null)}
            onPointerDown={() => (draggedSincePress.current = false)}
            onClick={(e) => {
              if (draggedSincePress.current) {
                draggedSincePress.current = false;
                return;
              }
              onToggle(item.key, e.currentTarget);
            }}
            // A toggle: the name stays put and aria-pressed says whether it's in the ranking. dnd-kit's own
            // "draggable… arrow keys" text doesn't apply (no keyboard dragging here), so it points to ours.
            aria-pressed={placed}
            aria-label={`Add ${item.name} to priorities`}
            aria-roledescription={undefined}
            aria-describedby={BUBBLE_HELP_ID}
            title={item.description ?? undefined}
            whileHover={reduceMotion ? undefined : { scale: placed ? 1.03 : 1.08 }}
            whileTap={{ scale: 0.93 }}
            transition={{
              type: 'spring',
              stiffness: 420,
              damping: 15,
              mass: 0.8,
            }}
            className={['block touch-none rounded-full outline-offset-4', lifted ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing'].join(
              ' ',
            )}
          >
            <span ref={popScope} className="block">
              <BubbleFace item={item} placedRank={placedRank} lifted={lifted} />
            </span>
          </motion.button>

          {placed && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                type: 'spring',
                stiffness: 600,
                damping: 15,
                delay: 0.1,
              }}
              className="pointer-events-none absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-ink text-paper"
            >
              <Check className="size-3" strokeWidth={3} />
            </motion.span>
          )}
        </div>
      </motion.div>
    </div>
  );
}

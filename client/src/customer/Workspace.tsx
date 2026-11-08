import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { forwardRef, useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { GripVertical, X } from 'lucide-react';
import type { PriorityBreakdown } from '@pw/shared';
import { BubbleFace } from './Bubble';
import { COLOR_CLASSES, type BubbleItem } from './model';
import type { PrioritiesState } from './usePriorities';
import { DUR, EASE, SPRING, T } from '../motion';

export const WORKSPACE_ID = 'workspace';
const slotId = (key: string) => `slot:${key}`;
export const isSlotId = (id: unknown): id is string => typeof id === 'string' && id.startsWith('slot:');
export const keyFromSlot = (id: string) => id.slice('slot:'.length);

/** Press and hold a row this long (ms, without moving) to turn it back into its bubble. */
const HOLD_MS = 320;
const HOLD_TOLERANCE = 8;

const LEVEL_STYLE: Record<PriorityBreakdown['level'], string> = {
  HIGH: 'bg-ink text-paper',
  MEDIUM: 'bg-paper text-ink border border-ink',
  LOW: 'bg-paper text-ink-2 border border-ink/30',
};

interface Props {
  state: PrioritiesState;
  breakdown: PriorityBreakdown[] | undefined;
  /** Palette bubble currently hovering over the workspace. */
  incoming: boolean;
  /** Bubble currently flying into its row: the row waits for it to land. */
  arrivingKey: string | null;
  /** Row currently shown as its bubble (pressed and held, or dragged over Step 1). */
  bubbleKey: string | null;
  /** True while that row is being dragged (the floating bubble follows the pointer instead). */
  bubbleDragging: boolean;
  onHold: (key: string) => void;
  onHoldEnd: (key: string) => void;
}

export function Workspace({ state, breakdown, incoming, arrivingKey, bubbleKey, bubbleDragging, onHold, onHoldEnd }: Props) {
  const { selected } = state;
  const { setNodeRef, isOver } = useDroppable({ id: WORKSPACE_ID });
  const highlight = incoming || isOver;
  const byKey = new Map(breakdown?.map((b) => [b.key, b]));
  // Rows slide into place with transforms only when one is added or removed.
  // A reorder is animated by the drag-and-drop itself, so it must not trigger a second animation.
  const membership = selected
    .map((b) => b.key)
    .sort()
    .join('|');

  return (
    <section aria-labelledby="workspace-title" className="@container flex min-h-0 flex-col fit:min-h-0 fit:flex-1">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 short:mb-2">
        <div>
          <p className="pw-eyebrow text-pw-blue-shade">Step 2</p>
          <h2 id="workspace-title" className="pw-display text-2xl">
            Rank your priorities
          </h2>
        </div>
        <AnimatePresence>
          {selected.length > 0 && (
            <motion.button
              type="button"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={state.clear}
              className="pw-btn-quiet"
            >
              <X className="size-3.5" strokeWidth={2.5} /> Clear all
            </motion.button>
          )}
        </AnimatePresence>
      </header>

      <div
        ref={setNodeRef}
        className={[
          // One-screen layout: fills the column; only scrolls (scrollbar hidden) on very short screens with every topic ranked.
          'relative flex-1 rounded-[28px] border-2 p-3 transition-[background-color,border-color,box-shadow] sm:p-4 @max-[330px]:p-2.5 fit:flex fit:min-h-0 fit:flex-col fit:overflow-y-auto short:p-2.5',
          'duration-250 ease-pw',
          selected.length === 0 ? 'border-dashed' : '',
          highlight ? 'border-pw-pink bg-pw-pink-tint/25 shadow-pop' : 'border-ink bg-paper',
        ].join(' ')}
      >
        {selected.length === 0 ? (
          <EmptyState active={highlight} />
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-extrabold uppercase tracking-wider text-ink-3 tiny:hidden">
              <span>Most important</span>
              <span className="hidden sm:inline @max-[330px]:hidden">Drag to reorder</span>
            </div>
            <SortableContext items={selected.map((b) => slotId(b.key))} strategy={verticalListSortingStrategy}>
              <ol className="relative flex flex-col" aria-label="Your priorities, most important first">
                <AnimatePresence mode="popLayout">
                  {selected.map((item, i) => (
                    <PriorityRow
                      key={item.key}
                      item={item}
                      rank={i + 1}
                      info={byKey.get(item.key)}
                      arriving={item.key === arrivingKey}
                      asBubble={item.key === bubbleKey}
                      bubbleDragging={item.key === bubbleKey && bubbleDragging}
                      membership={membership}
                      onHold={onHold}
                      onHoldEnd={onHoldEnd}
                      onRemove={() => state.remove(item.key)}
                    />
                  ))}
                </AnimatePresence>
              </ol>
            </SortableContext>
            <p className="mt-1 px-1 text-[11px] font-extrabold uppercase tracking-wider text-ink-3 tiny:hidden">Least important</p>
          </>
        )}
        <RankProgress state={state} />
      </div>
    </section>
  );
}

/** "3 of 7 ranked" — customers rank every topic, one by one. */
function RankProgress({ state }: { state: PrioritiesState }) {
  const topics = state.bubbles;
  if (topics.length === 0) return null;
  const done = topics.filter((b) => state.order.includes(b.key)).length;
  const complete = done === topics.length;
  return (
    <div className="mt-3 border-t-2 border-ink/10 px-1 pt-3 short:mt-2 short:pt-2" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs font-extrabold">
        <span className={complete ? 'text-ink' : 'text-ink-2'}>{complete ? 'All topics ranked' : `${done} of ${topics.length} ranked`}</span>
        {!complete && <span className="truncate font-semibold text-ink-3">Next: drag in your #{done + 1} priority</span>}
      </div>
      <div className="mt-1.5 flex gap-1" aria-hidden>
        {topics.map((t, i) => (
          <motion.span
            key={t.key}
            className={['h-1.5 flex-1 rounded-full', i < done ? 'bg-ink' : 'bg-ink/10'].join(' ')}
            initial={false}
            animate={{ scaleY: i < done ? 1 : 0.7 }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ active }: { active: boolean }) {
  return (
    <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-5 py-6 text-center lg:min-h-[420px] fit:h-auto fit:min-h-0 fit:flex-1 short:gap-3 short:py-3">
      <div className="flex w-full max-w-xs flex-col gap-2" aria-hidden>
        {[1, 2, 3].map((n) => (
          <motion.div
            key={n}
            data-demo-target={n === 1 ? '' : undefined}
            animate={active ? { scale: [1, 1.02, 1] } : { scale: 1 }}
            transition={{ duration: 0.6, repeat: active ? Infinity : 0, delay: n * 0.08 }}
            className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-ink/25 px-3 py-2.5"
            style={{ opacity: 1 - (n - 1) * 0.25 }}
          >
            <span className="pw-display flex size-8 items-center justify-center rounded-full border-2 border-dashed border-ink/30 text-base text-ink/40">
              {n}
            </span>
            <span className="h-2.5 flex-1 rounded-full bg-ink/8" />
          </motion.div>
        ))}
      </div>
      <div>
        <p className="pw-display text-xl">{active ? 'Drop it here' : 'Drag bubbles here'}</p>
        <p className="mt-1 text-sm font-semibold text-ink-2">Top of the list = most important to you.</p>
      </div>
    </div>
  );
}

interface RowProps {
  item: BubbleItem;
  rank: number;
  info: PriorityBreakdown | undefined;
  arriving: boolean;
  asBubble: boolean;
  bubbleDragging: boolean;
  onHold: (key: string) => void;
  onHoldEnd: (key: string) => void;
  onRemove: () => void;
  /** Which topics are ranked (changes on add/remove, not on reorder). */
  membership: string;
}

// forwardRef: AnimatePresence "popLayout" (motion system) needs the row element to pop it out of the list.
const PriorityRow = forwardRef<HTMLLIElement, RowProps>(function PriorityRow(
  { item, rank, info, arriving, asBubble, bubbleDragging, onHold, onHoldEnd, onRemove, membership },
  ref,
) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({
    id: slotId(item.key),
    data: { type: 'slot', key: item.key },
    // Neighbours glide aside with a slight overshoot when the order changes.
    transition: { duration: DUR.base * 1000, easing: `cubic-bezier(${EASE.bounce.join(', ')})` },
  });
  const c = COLOR_CLASSES[item.color];
  const top = rank === 1;
  // Pointer/touch drag from anywhere on the row; keyboard drag only from the grip.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  const reduceMotion = useReducedMotion();

  // Press and hold (mouse or finger, without moving) → the row turns back into its bubble.
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** Removes the window listeners waiting for this press to end (if any). */
  const stopWaiting = useRef<(() => void) | null>(null);
  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-no-hold]')) return;
    cancelHold();
    stopWaiting.current?.();
    hold.current = {
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        hold.current = null;
        navigator.vibrate?.(12);
        onHold(item.key);
      }, HOLD_MS),
    };
    const end = () => {
      cancelHold();
      onHoldEnd(item.key);
      stopWaiting.current?.();
    };
    stopWaiting.current = () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      stopWaiting.current = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  // Moving before the hold completes is a normal drag (reorder), not a hold.
  const onPointerMove = (e: React.PointerEvent) => {
    const h = hold.current;
    if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_TOLERANCE) cancelHold();
  };
  // Row removed mid-press: no timer or window listeners left behind, and the press ends with it.
  useEffect(
    () => () => {
      cancelHold();
      if (!stopWaiting.current) return;
      stopWaiting.current();
      onHoldEnd(item.key);
    },
    [], // the row's key never changes (rows are keyed by it)
  );

  return (
    <motion.li
      ref={ref}
      // Transforms only: the row takes its place at once and its neighbours slide (no height animation).
      // Only on add/remove (membership): a reorder is animated by the drag-and-drop itself.
      layout="position"
      layoutDependency={membership}
      // A flown-in bubble's row is already there for it (its content shows when the bubble lands).
      initial={arriving ? false : { opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85, transition: T.exit }}
      transition={{ ...SPRING.settle, opacity: { duration: DUR.fast }, layout: SPRING.settle }}
      className="origin-top"
    >
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        className={['relative pb-2 short:pb-1', asBubble ? 'z-20' : isDragging ? 'z-10' : ''].join(' ')}
      >
        {/* The row's own bubble, popping out of it while pressed (hidden while the floating copy is dragged). */}
        <AnimatePresence>
          {asBubble && !bubbleDragging && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-1 z-20 -translate-y-1/2"
              initial={reduceMotion ? false : { scale: 0.35, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.35, opacity: 0, transition: T.exit }}
              transition={SPRING.pop}
            >
              <BubbleFace item={item} lifted />
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div
          {...pointerListeners}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          initial={false}
          animate={{ opacity: arriving || asBubble ? 0 : 1, scale: asBubble && !bubbleDragging ? 0.94 : 1 }}
          transition={{ duration: DUR.fast }}
          className={[
            'group relative flex touch-none cursor-grab items-center gap-2 rounded-2xl border-2 border-ink bg-paper py-2 pr-2 pl-1.5 select-none active:cursor-grabbing sm:gap-3 @max-[330px]:gap-1.5 @max-[330px]:pr-4 short:py-0.5',
            // Only the lift animates (the stamp shadow changes at once).
            'transition-transform duration-150 ease-bounce',
            isDragging ? 'scale-[1.025] -rotate-[0.6deg] shadow-stamp-lg' : 'shadow-stamp-sm hover:-translate-y-px hover:shadow-stamp',
          ].join(' ')}
        >
          {/* Landing pulse in the bubble's colour (plays when the bubble touches down). */}
          {!arriving && (
            <motion.span
              aria-hidden
              className={['pointer-events-none absolute -inset-0.5 rounded-2xl ring-4', c.ring].join(' ')}
              initial={{ opacity: 0.9, scale: 1 }}
              animate={{ opacity: 0, scale: 1.05 }}
              transition={{ ...T.reveal, delay: 0.04 }}
            />
          )}
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            onKeyDown={onKeyDown as React.KeyboardEventHandler | undefined}
            aria-label={`Move ${item.name}, currently priority ${rank}`}
            className="flex h-10 w-6 shrink-0 touch-manipulation cursor-grab items-center justify-center rounded-lg text-ink-3 hover:bg-ink/5 hover:text-ink active:cursor-grabbing @max-[330px]:w-4"
          >
            <GripVertical className="size-4" />
          </button>

          <motion.span
            key={rank}
            data-rank-anchor={item.key}
            initial={arriving ? { scale: 0 } : { scale: 0.6, rotate: -20 }}
            animate={arriving ? { scale: 0 } : { scale: 1, rotate: 0 }}
            transition={SPRING.pop}
            className={[
              'pw-display flex shrink-0 items-center justify-center rounded-full border-2 border-ink',
              c.fill,
              top
                ? 'size-11 text-2xl @max-[330px]:size-9 @max-[330px]:text-lg short:size-8 short:text-base'
                : 'size-9 text-lg short:size-8 short:text-base',
            ].join(' ')}
            aria-hidden
          >
            {rank}
          </motion.span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={[
                  'truncate font-display font-black uppercase leading-none @max-[330px]:text-[15px] @max-[330px]:leading-tight @max-[330px]:whitespace-normal @max-[330px]:hyphens-auto @max-[330px]:break-words',
                  top ? 'text-lg' : 'text-base',
                ].join(' ')}
              >
                {item.name}
              </span>
              {info && (
                <span className={['shrink-0 rounded-full px-1.5 py-px text-[9px] font-extrabold tracking-wider', LEVEL_STYLE[info.level]].join(' ')}>
                  {info.level}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onRemove}
            data-no-hold
            aria-label={`Remove ${item.name}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-pw-pink-tint hover:text-ink pointer-coarse:size-11 @max-[330px]:absolute @max-[330px]:-top-2 @max-[330px]:-right-2 @max-[330px]:z-10 @max-[330px]:size-7 @max-[330px]:border-2 @max-[330px]:border-ink @max-[330px]:bg-paper @max-[330px]:text-ink @max-[330px]:pointer-coarse:size-8 @max-[330px]:after:absolute @max-[330px]:after:-inset-1.5 @max-[330px]:after:content-['']"
          >
            <X className="size-4" strokeWidth={2.5} />
          </button>
        </motion.div>
      </div>
    </motion.li>
  );
});

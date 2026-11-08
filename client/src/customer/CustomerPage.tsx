import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type Modifier,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS, getEventCoordinates } from '@dnd-kit/utilities';
import { motion, useReducedMotion } from 'motion/react';
import { LIFT_SCALE_OVER_LIST, LiftedBubble } from './Bubble';
import { BubbleFlight, type Flight } from './BubbleFlight';
import { KioskControls } from '../kiosk/KioskControls';
import { BubbleField, PALETTE_ID } from './BubbleField';
import { GhostHandDemo } from './GhostHandDemo';
import { PouchReady } from './PouchReady';
import { MotionControl } from './tilt/MotionControl';
import { SoundToggle } from './sound/SoundToggle';
import { cue } from './sound/sound';
import { orderCue } from './sound/gate';
import { HeaderLogo } from './HeaderLogo';
import { Suggestions } from './Suggestions';
import { usePriorities } from './usePriorities';
import { useSuggestions } from './useSuggestions';
import { WORKSPACE_ID, Workspace, isSlotId, keyFromSlot } from './Workspace';
import { T } from '../motion';

type DragData = { type: 'bubble' | 'slot'; key: string };

/** Keeps the floating bubble centred under the finger/cursor (rows are much wider than bubbles). */
const snapCenterToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  const start = activatorEvent && getEventCoordinates(activatorEvent);
  if (!draggingNodeRect || !start) return transform;
  return {
    ...transform,
    x: transform.x + start.x - draggingNodeRect.left - draggingNodeRect.width / 2,
    y: transform.y + start.y - draggingNodeRect.top - draggingNodeRect.height / 2,
  };
};

/**
 * Dropped anywhere but the list: the bubble flies home with a small overshoot.
 * Translate only — the circle keeps its exact shape (no scaleX/scaleY squeeze).
 */
const RETURN_HOME: DropAnimation = {
  duration: 420,
  easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
  keyframes: ({ transform }) => [
    { transform: CSS.Transform.toString({ ...transform.initial, scaleX: 1, scaleY: 1 }) },
    { transform: CSS.Transform.toString({ ...transform.final, scaleX: 1, scaleY: 1 }) },
  ],
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.22' } } }),
};

/**
 * Pointer inside the workspace → snap to the nearest row (or the empty list).
 * Pointer over the bubble field → a bubble moves around in it; a dragged row is removed.
 * Keyboard (no pointer) → nearest row, for reordering.
 */
const collisionDetection: CollisionDetection = (args) => {
  const slots = args.droppableContainers.filter((c) => isSlotId(c.id));

  if (!args.pointerCoordinates) return closestCenter({ ...args, droppableContainers: slots });

  const within = pointerWithin(args);
  if (within.some((c) => c.id === WORKSPACE_ID || isSlotId(c.id))) {
    if (slots.length === 0) return within.filter((c) => c.id === WORKSPACE_ID);
    return closestCenter({ ...args, droppableContainers: slots }).slice(0, 1);
  }
  const palette = within.find((c) => c.id === PALETTE_ID);
  return palette ? [palette] : [];
};

/** The floating bubble is entirely inside the field (with room for the wall gap). */
function fitsInField(
  r: { left: number; right: number; top: number; bottom: number } | null,
  field: { left: number; right: number; top: number; bottom: number },
) {
  if (!r) return false;
  const pad = 12;
  return r.left >= field.left + pad && r.right <= field.right - pad && r.top >= field.top + pad && r.bottom <= field.bottom - pad;
}

export function CustomerPage() {
  const state = usePriorities();
  const suggestions = useSuggestions(state.selected);
  const [active, setActive] = useState<DragData | null>(null);
  const [overWorkspace, setOverWorkspace] = useState(false);
  const [droppedIntoList, setDroppedIntoList] = useState(false);
  /** Dragged bubble is inside the bubble field: it moves there as a physics body. */
  const [inField, setInField] = useState(false);
  const [droppedInField, setDroppedInField] = useState(false);
  const inFieldRef = useRef(false);
  inFieldRef.current = inField;
  const [flight, setFlight] = useState<Flight | null>(null);
  /** Step 2 row pressed and held: shown as its bubble. */
  const [heldKey, setHeldKey] = useState<string | null>(null);
  /** A dragged Step 2 row is over Step 1: it travels as its bubble. */
  const [slotOverField, setSlotOverField] = useState(false);
  /** Where a bubble dragged back from Step 2 was dropped in Step 1 (viewport px). */
  const [placeAt, setPlaceAt] = useState<{ key: string; x: number; y: number; id: number } | null>(null);
  /** The ghost-hand demo is "dragging" over Step 2. */
  const [demoOver, setDemoOver] = useState(false);
  const activeRef = useRef<DragData | null>(null);
  activeRef.current = active;

  const onHold = (key: string) => setHeldKey(key);
  // Released without dragging: back to a row. (During a drag, drag end resets it.)
  const onHoldEnd = (key: string) => {
    if (activeRef.current?.key === key) return;
    setHeldKey((k) => (k === key ? null : k));
  };
  const reduceMotion = useReducedMotion();

  // Sound (when on): every way the list changes — tap, drag, keyboard, remove, clear.
  // A bubble still flying in pops when it lands instead.
  // "Your pouch is ready": every time the list becomes complete, once the last topic has landed in
  // Step 2 (nothing in the air or in hand). Reordering a complete list doesn't replay it; taking a
  // topic out and ranking it again does. A fully ranked list restored on page load doesn't count.
  const complete = state.bubbles.length > 0 && state.bubbles.every((b) => state.order.includes(b.key));
  const [celebrating, setCelebrating] = useState(false);
  const celebrated = useRef<boolean | null>(null);
  useEffect(() => {
    if (state.loading || state.bubbles.length === 0) return;
    if (celebrated.current === null) {
      celebrated.current = complete;
      return;
    }
    if (!complete) {
      celebrated.current = false; // incomplete again: the next completion celebrates
      return;
    }
    if (celebrated.current || flight || active) return;
    const t = window.setTimeout(() => {
      celebrated.current = true;
      setCelebrating(true);
    }, 280);
    return () => window.clearTimeout(t);
  }, [complete, flight, active, state.loading, state.bubbles.length]);

  const prevOrder = useRef(state.order);
  useEffect(() => {
    const c = orderCue(prevOrder.current, state.order, flight?.item.key ?? null);
    prevOrder.current = state.order;
    if (c) cue(c, state.order.length);
  }, [state.order]); // only when the order changes (the flight is read as it is then)

  /** Add to Step 2 and fly the bubble from (x, y) into its rank circle. */
  const flyIn = (key: string, fromX: number, fromY: number, fromScale: number | null, atIndex?: number) => {
    const item = state.byKey.get(key);
    const face = document.querySelector<HTMLElement>(`[data-body="${window.CSS.escape(key)}"] [data-bubble-face]`);
    state.add(key, atIndex);
    if (reduceMotion || !item || !face) return;
    const size = face.offsetWidth;
    setFlight({ id: performance.now(), item, fromX, fromY, fromScale: fromScale ?? 1, size });
  };

  /** Tap / click / Enter on a bubble in the field. */
  const addFromField = (key: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const face = el.querySelector<HTMLElement>('[data-bubble-face]');
    flyIn(key, r.left + r.width / 2, r.top + r.height / 2, face ? r.width / face.offsetWidth : 1);
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Bubbles and rows are touch-action:none, so a finger drag starts as soon as it moves.
    useSensor(TouchSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const nameOf = (id: unknown) => {
    const key = typeof id === 'string' ? id.replace(/^(bubble|slot):/, '') : '';
    return state.byKey.get(key)?.name ?? 'item';
  };
  const rankOf = (id: unknown) => (isSlotId(id) ? state.order.indexOf(keyFromSlot(id)) + 1 : 0);
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) => (over && isSlotId(over.id) ? `${nameOf(active.id)} is over position ${rankOf(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `${nameOf(active.id)} dropped.` : `${nameOf(active.id)} returned.`),
    onDragCancel: ({ active }) => `Cancelled. ${nameOf(active.id)} was not moved.`,
  };

  const onDragStart = (e: DragStartEvent) => {
    const data = (e.active.data.current as DragData) ?? null;
    setActive(data);
    setInField(data?.type === 'bubble'); // drags always start in the field
    setDroppedInField(false);
  };

  const onDragOver = (e: DragOverEvent) => {
    const data = e.active.data.current as DragData | undefined;
    const id = e.over?.id;
    setOverWorkspace(data?.type === 'bubble' && (id === WORKSPACE_ID || isSlotId(id)));
    setSlotOverField(data?.type === 'slot' && id === PALETTE_ID);
  };

  /**
   * A dragged bubble becomes a field bubble again only once the floating copy fits fully
   * inside the field (else it would snap inward at the edge); it leaves as soon as the
   * pointer leaves the field.
   */
  const onDragMove = (e: DragMoveEvent) => {
    const data = e.active.data.current as DragData | undefined;
    if (data?.type !== 'bubble') return;
    if (e.over?.id !== PALETTE_ID) {
      if (inFieldRef.current) setInField((inFieldRef.current = false));
      return;
    }
    if (inFieldRef.current) return;
    if (reduceMotion || fitsInField(e.active.rect.current.translated, e.over.rect)) setInField((inFieldRef.current = true));
  };

  const onDragEnd = (e: DragEndEvent) => {
    cue('drop'); // let go anywhere (a pop or remove for the same release takes its place)
    setActive(null);
    setOverWorkspace(false);
    setInField(false);
    setSlotOverField(false);
    setHeldKey(null);
    const { over } = e;
    const data = e.active.data.current as DragData | undefined;
    const isBubble = data?.type === 'bubble';
    const alreadyRanked = isBubble && state.order.includes(data.key);
    setDroppedIntoList(isBubble && !alreadyRanked && !!over && (over.id === WORKSPACE_ID || isSlotId(over.id)));
    // Dropped inside the field: it simply stays where it was put (physics takes over).
    setDroppedInField(over?.id === PALETTE_ID);
    if (!over || !data) return;

    if (data.type === 'bubble') {
      const dropped = e.active.rect.current.translated;
      // Let go over the field's edge (not yet fully inside): it settles at the nearest spot inside.
      if (over.id === PALETTE_ID && !inFieldRef.current && dropped && !reduceMotion) {
        setPlaceAt({ key: data.key, x: dropped.left + dropped.width / 2, y: dropped.top + dropped.height / 2, id: performance.now() });
        return;
      }
      if (over.id === PALETTE_ID || alreadyRanked) return;
      const cx = dropped ? dropped.left + dropped.width / 2 : 0;
      const cy = dropped ? dropped.top + dropped.height / 2 : 0;
      if (over.id === WORKSPACE_ID) return flyIn(data.key, cx, cy, LIFT_SCALE_OVER_LIST);
      if (isSlotId(over.id)) {
        const index = state.order.indexOf(keyFromSlot(over.id));
        const below = dropped ? cy > over.rect.top + over.rect.height / 2 : true;
        return flyIn(data.key, cx, cy, LIFT_SCALE_OVER_LIST, below ? index + 1 : index);
      }
      return;
    }

    // A ranked row was dragged. Dropped in Step 1: its bubble lands right where it was let go.
    if (over.id === PALETTE_ID) {
      const start = getEventCoordinates(e.activatorEvent);
      if (start) setPlaceAt({ key: data.key, x: start.x + e.delta.x, y: start.y + e.delta.y, id: performance.now() });
      return state.remove(data.key);
    }
    if (isSlotId(over.id)) state.move(state.order.indexOf(data.key), state.order.indexOf(keyFromSlot(over.id)));
  };

  const onDragCancel = () => {
    setHeldKey(null);
    setSlotOverField(false);
    setDroppedIntoList(false);
    setDroppedInField(false);
    setInField(false);
    setActive(null);
    setOverWorkspace(false);
  };

  const activeBubble = active?.type === 'bubble' ? state.byKey.get(active.key) : undefined;
  // Step 2 → Step 1: a held row, or a row dragged over Step 1, becomes its bubble again.
  const bubbleKey = heldKey ?? (active?.type === 'slot' && slotOverField ? active.key : null);
  const slotBubble = active?.type === 'slot' && bubbleKey === active.key ? state.byKey.get(active.key) : undefined;

  return (
    <div className="min-h-dvh overflow-x-clip select-none fit:flex fit:h-dvh fit:flex-col fit:overflow-hidden">
      <header className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-3 px-4 pt-[max(20px,env(safe-area-inset-top))] sm:px-6 lg:px-8 fit:pt-[max(12px,env(safe-area-inset-top))]">
        <HeaderLogo />
        <div className="flex items-center gap-3">
          <p className="hidden text-[11px] font-extrabold uppercase tracking-wider text-ink-2 md:block">Pouch configurator</p>
          {/* Optional extras: iPad tilt (tilt feature) and bubble sounds (sound feature). */}
          <MotionControl />
          <SoundToggle />
          <KioskControls />
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 fit:flex fit:min-h-0 fit:flex-1 fit:flex-col">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={T.reveal}
          className="pt-6 pb-7 sm:pt-8 sm:pb-9 fit:pt-2 fit:pb-3 short:pt-1 short:pb-2 tab-land:flex tab-land:items-end tab-land:gap-6"
        >
          <h1 className="pw-display text-[40px] sm:text-[56px] xl:text-[64px] fit:text-[40px] short:text-[32px] tab-land:shrink-0">
            Rank what matters<span className="text-pw-pink">.</span>
          </h1>
        </motion.div>

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
          accessibility={{ announcements }}
          // Arranging bubbles inside the field never scrolls the page; dragging out still can.
          autoScroll={{ canScroll: () => !inFieldRef.current }}
        >
          <main className="grid grid-cols-1 gap-8 pb-[max(4rem,env(safe-area-inset-bottom))] tab-narrow:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)_minmax(0,0.9fr)] tab-narrow:gap-4 lg:grid-cols-[minmax(260px,316px)_minmax(0,1fr)_minmax(290px,340px)] lg:gap-6 xl:grid-cols-[minmax(290px,340px)_minmax(0,1fr)_minmax(340px,410px)] xl:gap-7 tab-land:grid-cols-[minmax(260px,316px)_minmax(0,1fr)_minmax(290px,340px)] tab-land:gap-6 fit:min-h-0 fit:flex-1 fit:pb-0">
            {/* Tablets and small laptops: the three steps fit the screen side by side and each column scrolls on its own. */}
            <div className="min-w-0 fit:flex fit:min-h-0 fit:flex-col fit:overflow-hidden fit:pb-[max(12px,env(safe-area-inset-bottom))]">
              <BubbleField
                state={state}
                activeKey={active?.type === 'bubble' ? active.key : null}
                dragInField={inField}
                removingDrag={active?.type === 'slot'}
                onAdd={addFromField}
                placeAt={placeAt}
              />
            </div>

            <div className="min-w-0 fit:flex fit:min-h-0 fit:flex-col fit:overflow-hidden fit:pb-[max(12px,env(safe-area-inset-bottom))]">
              <Workspace
                state={state}
                breakdown={suggestions.data?.breakdown}
                incoming={overWorkspace || demoOver}
                arrivingKey={flight?.item.key ?? null}
                bubbleKey={bubbleKey}
                bubbleDragging={active?.type === 'slot'}
                onHold={onHold}
                onHoldEnd={onHoldEnd}
              />
            </div>

            {/* Step 3 fits the default content; it only scrolls (scrollbar hidden) if an admin adds more recommendation parameters. */}
            <aside className="grid min-w-0 grid-cols-1 items-start gap-10 fit:min-h-0 fit:content-start fit:gap-4 fit:overflow-y-auto fit:overscroll-contain fit:pb-[max(12px,env(safe-area-inset-bottom))]">
              <Suggestions
                data={state.selected.length ? suggestions.data : null}
                stale={suggestions.stale}
                loading={suggestions.loading}
                error={suggestions.error}
                hasPriorities={state.selected.length > 0}
                onRetry={suggestions.retry}
                touched={state.touched}
              />
            </aside>
          </main>

          {/* Accepted drops hand over to the flight (no fly-back); others return home. */}
          {/* Inside the field the real bubble moves (overlay hidden); outside, the overlay carries it. */}
          <DragOverlay
            dropAnimation={droppedIntoList || droppedInField ? null : RETURN_HOME}
            zIndex={60}
            modifiers={active?.type === 'slot' ? [snapCenterToCursor] : undefined}
          >
            {activeBubble && <LiftedBubble item={activeBubble} overList={overWorkspace} hidden={inField && !reduceMotion} />}
            {slotBubble && <LiftedBubble item={slotBubble} overList={false} />}
          </DragOverlay>

          {/* Shows first-time visitors what to do: drag a bubble into Step 2. */}
          <GhostHandDemo
            enabled={state.order.length === 0 && state.bubbles.length > 0 && !active && !flight && !reduceMotion}
            onOver={setDemoOver}
          />

          {flight && (
            <BubbleFlight
              key={flight.id}
              flight={flight}
              onLanded={() => {
                cue('pop', state.order.length);
                setFlight((f) => (f?.id === flight.id ? null : f));
              }}
            />
          )}

          {celebrating && (
            <PouchReady
              ranked={state.order.map((key) => ({ key, color: state.byKey.get(key)?.color ?? 'pink' }))}
              reduceMotion={!!reduceMotion}
              onDone={() => setCelebrating(false)}
            />
          )}
        </DndContext>
      </div>
    </div>
  );
}

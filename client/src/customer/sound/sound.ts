/**
 * Optional bubble sound effects: soft "bloops" when bubbles collide (bump), land in Step 2 (pop),
 * are let go after a drag (drop) or are taken out of Step 2 (remove).
 * ON by default (every page load and after kiosk "Start over"). Browsers only allow audio after the
 * visitor's first touch, click or key, so it starts then (see armSound). The header button turns it off.
 */
import { useSyncExternalStore } from 'react';
import type { Impact } from '../physics';
import { ACTIVITY_EVENT } from '../activity';
import { HIDE_CLASS as INTRO_HANDOFF } from '../../intro/handoff';
import { audioSupported, play, prepare, release, sleep, unlock, wake, waking } from './engine';
import { BumpGate, CUES, CUE_GAP, LIMITS, bumpVolume, isQuietLogoPhase, type Cue } from './gate';
import { POP_STEPS, VOICES } from './synth';

let on = false;
/** On, but audio has not started yet: the next touch, click or key starts it (browsers allow nothing earlier). */
let armed = false;
/** When the first touch started audio (ms). Just after it, the browser may still be starting audio up. */
let unlockedAt = -Infinity;
/** Right after the first touch: play even while audio is still starting (else the very first pop could be lost). */
const starting = () => performance.now() - unlockedAt < 1000;
const subscribers = new Set<() => void>();
const gate = new BumpGate();
/** Last touch, click, key or tilt (ms). */
let lastActivity = 0;

export const soundSupported = audioSupported;

/** Whether sound is on (re-renders on change). */
export function useSoundOn() {
  return useSyncExternalStore(
    subscribe,
    () => on,
    () => false,
  );
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => void subscribers.delete(fn);
}

/** Switch sound on or off. Switch it on from a click/tap handler: iPad Safari only starts audio in a user gesture. */
export function setSoundOn(next: boolean) {
  if (next === on) return;
  if (next) {
    if (!unlock()) return;
    on = true;
    const now = performance.now();
    lastActivity = now;
    gate.reset(now);
    listen(true);
    play('on', 0, 0.4, 1, 0, true); // confirmation bloop
  } else {
    on = false;
    armed = false;
    listen(false);
    window.clearTimeout(cueTimer);
    cueTimer = 0;
    pending = null;
    release();
  }
  subscribers.forEach((fn) => fn());
}

/**
 * Sound on by default: on at once (the button shows "Sound on"), audio starts with the visitor's
 * first touch, click or key. Called when the page mounts, so each visitor (after "Start over") starts
 * with sound on, even if the previous one turned it off.
 */
export function armSound() {
  if (on || !audioSupported()) return;
  on = true;
  armed = true;
  const now = performance.now();
  lastActivity = now;
  gate.reset(now);
  listen(true);
  subscribers.forEach((fn) => fn());
  warmUp();
}

/**
 * Get audio ready before the first touch, once the intro is gone and the page is idle (making the audio
 * context can take a few hundred ms on some computers; that must not freeze the first touch).
 */
function warmUp() {
  const tryNow = () => {
    if (!armed) return;
    if (document.querySelector('[aria-label="PouchWale intro"]') || document.documentElement.classList.contains(INTRO_HANDOFF)) {
      window.setTimeout(tryNow, 500);
      return;
    }
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(() => armed && prepare(), { timeout: 2000 });
    else if (armed) prepare();
  };
  window.setTimeout(tryNow, 800);
}

// ---- "Your pouch is ready" ------------------------------------------------------

/** Set on <html> while the "pouch is ready" moment plays: its own sounds only, no bumps or cues. */
export const CELEBRATING = 'celebrating';

/** A sound for the "pouch is ready" moment, played as asked (not merged like cues). `step`: pop pitch, 1–8. */
export function fx(name: 'pop' | 'zip' | 'ding', step = 1) {
  if (!on || document.hidden) return;
  gate.holdOff(performance.now());
  if (name === 'pop') play('pop', Math.min(POP_STEPS.length, Math.max(1, step)) - 1, 0.34, 0.98 + Math.random() * 0.04, 0, starting());
  else play(name, 0, name === 'zip' ? 0.3 : 0.36, 1, 0, starting());
}

// ---- Silence while something else is on screen -------------------------------

let quietCheckedAt = -Infinity;
let quietCached = false;

/** The intro, the idle logo show or a hidden page: no sounds. Re-checked at most every 250 ms. */
function quiet(now: number, fresh = false) {
  if (!fresh && now - quietCheckedAt < 250) return quietCached;
  quietCheckedAt = now;
  const html = document.documentElement;
  quietCached =
    document.hidden ||
    html.classList.contains(INTRO_HANDOFF) ||
    html.classList.contains(CELEBRATING) ||
    !!document.querySelector('[aria-label="PouchWale intro"]') ||
    isQuietLogoPhase(document.querySelector('canvas[data-idle-logo]')?.getAttribute('data-idle-logo'));
  return quietCached;
}

// ---- Bumps ---------------------------------------------------------------------

/** Contacts from the last physics step; `width` is the field width in px (for stereo pan). */
export function playImpacts(impacts: readonly Impact[], width: number): void {
  if (!on) return;
  const now = performance.now();
  // Only while someone is using the screen: idle nudges and the ghost-hand demo stay silent.
  const armed = now - lastActivity < LIMITS.activeMs && !quiet(now);
  const i = gate.pick(impacts, now, armed);
  if (i < 0) return;
  const im = impacts[i];
  const wall = im.b === null;
  // Bigger bubbles sound lower; a little randomness so repeats don't sound robotic.
  const rate = Math.min(1.25, Math.max(0.8, Math.sqrt(46 / im.r))) * (wall ? 0.88 : 1) * (0.96 + Math.random() * 0.08);
  const pan = width > 0 ? Math.max(-1, Math.min(1, (im.x / width) * 2 - 1)) * 0.35 : 0;
  play('bump', Math.floor(Math.random() * VOICES.bump.length), 0.36 * bumpVolume(im.speed, im.dragged, wall), rate, pan);
}

// ---- Pop / drop / remove ------------------------------------------------------

/** Requests this close together merge into the most important one (pop > remove > drop). */
const MERGE_MS = 30;
let pending: Cue | null = null;
let pendingStep = 0;
let cueTimer = 0;
const lastCue: Record<Cue, number> = { drop: -Infinity, remove: -Infinity, pop: -Infinity };

/**
 * An interface sound. `ranked`: for 'pop', how many bubbles are ranked now (each one pops a step higher).
 * A drop into Step 2 followed by the bubble's landing pop are two cues, ~0.7 s apart.
 */
export function cue(name: Cue, ranked = 1) {
  if (!on) return;
  if (!pending || CUES.indexOf(name) > CUES.indexOf(pending)) {
    pending = name;
    pendingStep = ranked;
  }
  if (!cueTimer) cueTimer = window.setTimeout(flushCue, MERGE_MS);
}

function flushCue() {
  cueTimer = 0;
  const name = pending;
  pending = null;
  if (!name || !on) return;
  const now = performance.now();
  if (quiet(now, true) || now - lastCue[name] < CUE_GAP[name]) return;
  lastCue[name] = now;
  gate.holdOff(now);
  const jitter = 0.98 + Math.random() * 0.04;
  if (name === 'pop') play('pop', Math.min(POP_STEPS.length, Math.max(1, pendingStep)) - 1, 0.42, jitter, 0, starting());
  else if (name === 'drop') play('drop', Math.floor(Math.random() * VOICES.drop.length), 0.38, jitter, 0, starting());
  else play('remove', 0, 0.3, jitter, 0, starting());
}

// ---- iPad: wake audio on the next touch; sleep while hidden ---------------------

const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;
const ACTIVITY = ['pointermove', 'wheel', 'touchstart', ACTIVITY_EVENT] as const;

function onGesture() {
  lastActivity = performance.now();
  // Sound on by default: this first touch is the earliest moment the browser lets audio start.
  if (armed && !document.hidden) {
    if (unlock()) {
      armed = false;
      unlockedAt = performance.now();
    }
    return;
  }
  // iOS suspends or interrupts audio (calls, lock screen, app switch); only a touch may resume it.
  if (!document.hidden && waking()) wake();
}

function onActivity() {
  lastActivity = performance.now();
}

function onVisibility() {
  if (document.hidden) sleep();
  else wake();
}

const onPageHide = () => sleep();

function listen(enable: boolean) {
  const opts = { capture: true, passive: true };
  if (enable) {
    GESTURES.forEach((e) => window.addEventListener(e, onGesture, opts));
    ACTIVITY.forEach((e) => window.addEventListener(e, onActivity, opts));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
  } else {
    GESTURES.forEach((e) => window.removeEventListener(e, onGesture, opts));
    ACTIVITY.forEach((e) => window.removeEventListener(e, onActivity, opts));
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
  }
}

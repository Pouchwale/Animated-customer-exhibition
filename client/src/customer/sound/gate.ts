/**
 * Which bubble contacts get a sound, and how often sounds may play. Pure logic (no Web Audio),
 * so it is unit-tested in node.
 */
import type { Impact } from '../physics';

export const LIMITS = {
  /** Slowest contact (px/s) that bumps: drifting bubbles and idle nudges stay silent. */
  minSpeed: 110,
  /** Contacts with the dragged bubble need a firmer hit (it shoulders bubbles aside all the time). */
  dragMinSpeed: 150,
  /** Contact speed (px/s) for full bump volume. */
  loudSpeed: 520,
  /**
   * A bump needs a bubble arriving from free flight: one that had no contact for this long (ms).
   * Piled-up bubbles (tilt) and a bubble being pushed along touch constantly, so they stay quiet.
   */
  calmMs: 250,
  /** The same two bubbles (or a bubble and the wall) sound at most once per this (ms). */
  pairMs: 900,
  /** Shortest time between two bumps (ms). */
  gapMs: 80,
  /** Token bucket: a short burst, then at most this many bumps per second. */
  burst: 3,
  perSecond: 6,
  /** Bumps wait this long after a pop / drop / remove (ms), so they don't pile onto it. */
  afterCueMs: 160,
  /** Bumps only this soon after a touch, key or tilt (ms): nothing plays while nobody is there. */
  activeMs: 3500,
  /** After sound is turned on, listen this long before bumping (ms), to learn which bubbles are piled up. */
  warmMs: 300,
};

/** Interface cues, highest priority last. Cues requested together merge into the highest one. */
export const CUES = ['drop', 'remove', 'pop'] as const;
export type Cue = (typeof CUES)[number];

/** Minimum time between two plays of the same cue (ms). */
export const CUE_GAP: Record<Cue, number> = { drop: 120, remove: 150, pop: 120 };

/** Idle-logo phases that must stay silent (the bubbles are gathering into, or showing, the logo). */
export function isQuietLogoPhase(phase: string | null | undefined) {
  return phase === 'gathering' || phase === 'forming' || phase === 'holding' || phase === 'returning';
}

/**
 * The cue for a change of the ranked list: 'pop' when a bubble was added (unless it is still
 * flying in; it pops when it lands), 'remove' when one was taken out.
 */
export function orderCue(prev: readonly string[], next: readonly string[], flying: string | null): Cue | null {
  if (next.some((k) => k !== flying && !prev.includes(k))) return 'pop';
  if (prev.some((k) => !next.includes(k))) return 'remove';
  return null;
}

/** Bump volume 0..1 for a contact. */
export function bumpVolume(speed: number, dragged: boolean, wall: boolean) {
  const min = dragged ? LIMITS.dragMinSpeed : LIMITS.minSpeed;
  const v = Math.min(1, Math.max(0, (speed - min) / (LIMITS.loudSpeed - min)));
  return (0.3 + 0.7 * Math.sqrt(v)) * (dragged ? 0.75 : 1) * (wall ? 0.85 : 1);
}

const NEVER = -1e12;

/**
 * Picks at most one contact per physics step to sound, and rate-limits bumps.
 * Allocation-free after the first sight of each bubble (called up to every frame).
 */
export class BumpGate {
  /** Bubble key → slot; slot 0 is the wall. */
  private readonly ids = new Map<string, number>();
  private cap = 16;
  /** Last contact of each bubble (ms). */
  private lastContact = new Float64Array(this.cap).fill(NEVER);
  /** Last bump of each pair (ms), indexed a * cap + b. */
  private pairPlayed = new Float64Array(this.cap * this.cap).fill(NEVER);
  private tokens = LIMITS.burst;
  private refilledAt = 0;
  private lastBump = NEVER;
  private quietUntil = 0;

  /** Sound was just turned on: start with a full burst, and listen for a moment first. */
  reset(now: number) {
    this.tokens = LIMITS.burst;
    this.refilledAt = now;
    this.quietUntil = now + LIMITS.warmMs;
  }

  /** A pop / drop / remove just played: bumps wait a little. */
  holdOff(now: number) {
    this.quietUntil = Math.max(this.quietUntil, now + LIMITS.afterCueMs);
  }

  /**
   * Track this step's contacts and return the index of the one to sound, or -1.
   * With `armed` false it only tracks (e.g. nobody is using the screen).
   */
  pick(impacts: readonly Impact[], now: number, armed: boolean): number {
    let best = -1;
    let bestScore = 0;
    let bestPair = 0;
    for (let i = 0; i < impacts.length; i++) {
      const im = impacts[i];
      if (im.speed < (im.dragged ? LIMITS.dragMinSpeed : LIMITS.minSpeed)) continue;
      const a = this.slot(im.a);
      const b = im.b === null ? 0 : this.slot(im.b);
      const fresh = now - this.lastContact[a] >= LIMITS.calmMs || (b !== 0 && now - this.lastContact[b] >= LIMITS.calmMs);
      const pair = a < b ? a * this.cap + b : b * this.cap + a;
      if (!fresh || now - this.pairPlayed[pair] < LIMITS.pairMs) continue;
      const score = im.dragged ? im.speed * 0.8 : im.speed;
      if (score > bestScore) {
        best = i;
        bestScore = score;
        bestPair = pair;
      }
    }
    // Every contact (heard or not) makes its bubbles "busy" for a while.
    for (let i = 0; i < impacts.length; i++) {
      const im = impacts[i];
      this.lastContact[this.slot(im.a)] = now;
      if (im.b !== null) this.lastContact[this.slot(im.b)] = now;
    }
    if (best < 0 || !armed || now < this.quietUntil || now - this.lastBump < LIMITS.gapMs) return -1;
    this.tokens = Math.min(LIMITS.burst, this.tokens + ((now - this.refilledAt) / 1000) * LIMITS.perSecond);
    this.refilledAt = now;
    if (this.tokens < 1) return -1;
    this.tokens -= 1;
    this.lastBump = now;
    this.pairPlayed[bestPair] = now;
    return best;
  }

  private slot(key: string) {
    let id = this.ids.get(key);
    if (id !== undefined) return id;
    id = this.ids.size + 1;
    if (id >= this.cap) this.grow();
    this.ids.set(key, id);
    return id;
  }

  /** More bubbles than slots (an admin added many): double the tables, keeping what's known. */
  private grow() {
    const old = this.cap;
    const cap = old * 2;
    const last = new Float64Array(cap).fill(NEVER);
    last.set(this.lastContact);
    const pairs = new Float64Array(cap * cap).fill(NEVER);
    for (let a = 0; a < old; a++) for (let b = 0; b < old; b++) pairs[a * cap + b] = this.pairPlayed[a * old + b];
    this.cap = cap;
    this.lastContact = last;
    this.pairPlayed = pairs;
  }
}

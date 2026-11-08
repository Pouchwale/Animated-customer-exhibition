/**
 * Tiny circle-physics world for the bubble field. Pure logic, no DOM:
 * gentle wandering, wall bounces, elastic circle-circle collisions, a soft
 * "personal space" between neighbours, cursor push, and a user-driven
 * (kinematic) body for dragging and throwing. Units: px and seconds.
 */

interface Body {
  key: string;
  x: number; // centre
  y: number;
  vx: number;
  vy: number;
  /** Radius of the circle at rest. */
  r: number;
  /** Visual scale (e.g. 1.1 while lifted); collisions use r × scale. */
  scale: number;
  seed: number;
}

export interface Pointer {
  x: number;
  y: number;
  /** Extra reach beyond each body's radius. */
  reach: number;
  /** Peak push acceleration, px/s². */
  strength: number;
}

/** A contact during the last step (for sound effects). */
export interface Impact {
  /** Bubble keys; b is null when a hits a wall. */
  a: string;
  b: string | null;
  /** Closing speed along the contact normal, px/s (only ≥ PHYSICS.minImpact is recorded). */
  speed: number;
  /** Where it happened, field px. */
  x: number;
  y: number;
  /** Radius of the smaller body, px (bigger bubbles can sound lower). */
  r: number;
  /** One of the two is the bubble being dragged. */
  dragged: boolean;
}

export const PHYSICS = {
  /** Gap kept between bubbles. */
  gap: 5,
  /** Gap from the walls — room for the rank badge and check mark just outside the circle. */
  wall: 10,
  /** Beyond contact, neighbours closer than this ease apart to find their own space. */
  personalSpace: 16,
  personalPush: 70,
  /** Wandering acceleration and linear drag → drift speed ≈ wander / drag. */
  wander: 16,
  drag: 0.9,
  /** Extra drag per px/s of speed, so throws glide then settle instead of pinballing. */
  speedDrag: 0.004,
  maxSpeed: 520,
  /** Fastest a released bubble may be thrown. */
  maxThrow: 520,
  /** Seconds a dropped bubble waits before it starts drifting again. */
  settle: 2,
  /** Frames a squeezing-out bubble is stuck before it slips out underneath the held one. */
  passUnderFrames: 16,
  /** New free spots a squeezing-out bubble may pick when its spot gets taken, before pausing. */
  maxReplans: 4,
  /** Speed cap (px/s) of a squeezing-out bubble as felt by others in collisions. */
  maxGlide: 360,
  /** Seconds before the same bubble may squeeze out again (stops back-and-forth loops). */
  relocateCooldown: 0.8,
  /** How tightly a dragged bubble follows the pointer (higher = snappier). */
  follow: 38,
  /** Bounciness of bubble-bubble and bubble-wall contacts (0–1). */
  restitution: 0.62,
  wallRestitution: 0.5,
  /** Bounciness when the dragged bubble meets another: a soft push, not a knock. */
  dragRestitution: 0.05,
  /** Collision solver passes per step. */
  iterations: 3,
  /** Packing density used to size the field (share of area covered by bubbles). */
  density: 0.46,
  /** Device tilt: acceleration (px/s²) at full tilt (tilt vector length 1). */
  tiltGravity: 700,
  /** Under tilt, contacts slower than this many steps of tilt gravity are resting: no bounce, no impact. */
  restSteps: 3,
  /** Collision solver passes per step under tilt (piles need more to settle without jitter). */
  tiltIterations: 8,
  /** Under tilt, bubbles this close (px past touching) still stop pressing into each other. */
  restSlop: 0.5,
  /** As a tilt eases off, personal space grows by up to this (px) and pushes this much harder (px/s²)… */
  relaxSpace: 60,
  relaxPush: 120,
  /** …fading out at this rate (per second; 0.15 ≈ 7 s after a full tilt). */
  relaxFade: 0.15,
  /** Under tilt, seconds a bubble put down from Step 2 keeps its spot while neighbours make room. */
  landing: 0.25,
  /** Slowest contact (px/s) recorded in `impacts`. */
  minImpact: 20,
};

/** Deterministic 0..1 from a string, so first layout is stable between visits. */
function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Height that fits these radii comfortably at this width. */
export function fieldHeight(width: number, radii: number[], minHeight: number): number {
  if (width <= 0 || radii.length === 0) return minHeight;
  const area = radii.reduce((sum, r) => sum + Math.PI * (r + PHYSICS.gap) ** 2, 0);
  const largest = Math.max(...radii) * 2 + PHYSICS.wall * 2 + 8;
  return Math.round(Math.max(minHeight, largest, area / (width * PHYSICS.density)));
}

const radiusOf = (b: Body) => b.r * b.scale;

export class BubbleWorld {
  readonly bodies = new Map<string, Body>();
  width = 0;
  height = 0;
  /** Bodies with infinite mass that ignore wandering (e.g. hovered, so they're easy to grab). */
  readonly held = new Set<string>();
  /** The body the user is dragging, and where they want it. */
  private driven: { key: string; x: number; y: number } | null = null;
  /** Smoothed speed of the pointer target while dragging — what a release throws with. */
  private throwV = { x: 0, y: 0 };
  private lastTarget: { x: number; y: number } | null = null;
  /** Just-dropped bubbles: seconds until they start wandering again (they stay where they were put). */
  private readonly settling = new Map<string, number>();
  /** Bubbles that just finished squeezing out: seconds before they may be moved that way again. */
  private readonly cooldown = new Map<string, number>();
  /** Offset from the pointer while letting a bubble trapped against a wall slip past (eases back to 0). */
  /** Frames each squeezing-out bubble has been stuck behind the dragged one. */
  private readonly stuckFrames = new Map<string, number>();
  /**
   * Trapped bubbles slipping out underneath the held (lifted) bubble: key → the held bubble's key.
   * Only these two may overlap, and only until they're apart.
   */
  readonly passingUnder = new Map<string, string>();
  /** How many times a squeezing-out bubble has had to pick a new free spot this time. */
  private readonly replans = new Map<string, number>();
  /** Wedged bubbles squeezing out to a free spot (target + seconds left). */
  private readonly relocating = new Map<string, { x: number; y: number; t: number; left?: number }>();
  /** Consecutive frames a bubble has been wedged (against walls) by the dragged one. */
  private readonly wedged = new Map<string, number>();
  private readonly wedgedNow = new Set<string>();
  /** Idle logo mode: every bubble is pulled toward this point (and stops wandering). */
  attractor: { x: number; y: number; strength: number } | null = null;
  /**
   * Device tilt: which way "down" is, in field axes (+x right, +y down), each component −1..1
   * (length 1 = full tilt). null = level or tilt off. Ignored while the attractor is set.
   */
  tilt: { x: number; y: number } | null = null;
  /** Contacts during the last step(), for sound effects. Cleared at the start of each step. */
  readonly impacts: Impact[] = [];
  /** Under tilt: contacts slower than this (px/s) are bodies resting on each other. 0 when level. */
  private restSpeed = 0;
  /** Under tilt: unit vector pointing "downhill". */
  private readonly fall = { x: 0, y: 0 };
  /** Recent strongest tilt (fades linearly), for easing a pile apart once the tilt eases off. */
  private tiltPeak = 0;
  /** Under tilt: a bubble just put down by place(), keeping its spot for `t` more seconds while neighbours make room. */
  private anchored: { key: string; t: number } | null = null;
  /** Under tilt: where each free body was headed this step, before collisions moved it. */
  private readonly predicted = new Map<Body, { x: number; y: number }>();

  setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.bodies.forEach((b) => this.clamp(b));
  }

  /** Adds a body at a free spot, or updates the radius of an existing one. */
  upsert(key: string, r: number): Body {
    const existing = this.bodies.get(key);
    if (existing) {
      existing.r = r;
      this.clamp(existing);
      return existing;
    }
    const seed = hash01(key);
    const { x, y } = this.freeSpot(r, seed);
    const angle = hash01(key, 7) * Math.PI * 2;
    const body: Body = { key, x, y, vx: Math.cos(angle) * 12, vy: Math.sin(angle) * 12, r, scale: 1, seed };
    this.bodies.set(key, body);
    return body;
  }

  remove(key: string) {
    this.bodies.delete(key);
    this.passingUnder.delete(key);
    this.settling.delete(key);
    this.held.delete(key);
    this.relocating.delete(key);
    this.wedged.delete(key);
    if (this.driven?.key === key) this.driven = null;
  }

  setScale(key: string, scale: number) {
    const b = this.bodies.get(key);
    if (b) b.scale = scale;
  }

  /** Instant velocity change, e.g. an idle "nudge". */
  impulse(key: string, dvx: number, dvy: number) {
    const b = this.bodies.get(key);
    if (!b) return;
    b.vx += dvx;
    b.vy += dvy;
  }

  /** Drag: the body follows (x, y) smoothly and shoulders others aside with infinite mass. */
  drive(key: string, x: number, y: number) {
    if (this.driven?.key !== key) {
      this.throwV = { x: 0, y: 0 };
      this.lastTarget = null;
    }
    this.driven = { key, x, y };
  }

  /** Let go of the dragged body. It keeps its momentum (a throw), capped at maxThrow. */
  release() {
    const b = this.driven && this.bodies.get(this.driven.key);
    this.driven = null;
    this.lastTarget = null;
    this.wedged.clear();
    if (!b) return;
    // Throw with the pointer's own recent speed, not the last frame's collision nudges
    // (those made bubbles fling off in odd directions).
    b.vx = this.throwV.x * 0.85;
    b.vy = this.throwV.y * 0.85;
    this.throwV = { x: 0, y: 0 };
    this.settling.set(b.key, PHYSICS.settle);
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > PHYSICS.maxThrow) {
      b.vx *= PHYSICS.maxThrow / speed;
      b.vy *= PHYSICS.maxThrow / speed;
    }
  }

  /** Move a body straight to a spot (no animation) — used when motion is reduced. */
  place(key: string, x: number, y: number) {
    const b = this.bodies.get(key);
    if (!b) return;
    b.x = x;
    b.y = y;
    b.vx = 0;
    b.vy = 0;
    if (this.driven?.key === key) {
      this.driven = { key, x, y };
      this.lastTarget = null;
    } else if (this.restSpeed > 0) {
      // Under tilt, it lands right here: for a moment its neighbours make room, then it rolls on.
      this.anchored = { key, t: PHYSICS.landing };
    }
    this.clamp(b);
  }

  /**
   * Advance the simulation.
   * @param dt seconds since last step (clamped for stability)
   * @param t  running time in seconds (drives the smooth wandering)
   */
  step(dt: number, t: number, pointer: Pointer | null, ambient = true) {
    dt = Math.min(Math.max(dt, 0), 1 / 30);
    if (dt === 0) return;
    this.impacts.length = 0;
    if (this.anchored && ((this.anchored.t -= dt) <= 0 || !this.tilt || this.attractor)) this.anchored = null;
    // Device tilt (the idle logo's gathering wins over it).
    const tilt = this.attractor ? null : this.tilt;
    const len = tilt ? Math.hypot(tilt.x, tilt.y) : 0;
    const tiltLen = Math.min(1, len);
    this.fall.x = len > 0 ? tilt!.x / len : 0;
    this.fall.y = len > 0 ? tilt!.y / len : 0;
    const gx = this.fall.x * tiltLen * PHYSICS.tiltGravity;
    const gy = this.fall.y * tiltLen * PHYSICS.tiltGravity;
    this.restSpeed = tiltLen * PHYSICS.tiltGravity * dt * PHYSICS.restSteps;
    // Strong tilt drowns out the gentle wandering (no sliding to and fro along the low wall).
    const wanderShare = Math.max(0, 1 - 2 * tiltLen);
    // As a tilt eases off, the piled-up bubbles ease apart again for a few seconds.
    this.tiltPeak = Math.max(tiltLen, this.tiltPeak - PHYSICS.relaxFade * dt);
    const relax = this.attractor ? 0 : this.tiltPeak - tiltLen;

    this.applyPersonalSpace(dt, relax);
    for (const [key, left] of this.cooldown) {
      if (left - dt <= 0) this.cooldown.delete(key);
      else this.cooldown.set(key, left - dt);
    }
    const drivenBody = this.driven ? this.bodies.get(this.driven.key) : undefined;
    const drivenFrom = drivenBody ? { x: drivenBody.x, y: drivenBody.y } : null;
    this.updatePassingUnder(dt);

    for (const b of this.bodies.values()) {
      let reloc = this.relocating.get(b.key);
      // Its free spot got taken meanwhile: head for another one (forcing the way into a taken
      // spot jams bubbles together). After a few tries, give up for a moment.
      if (reloc && this.spotTaken(b, reloc)) {
        const tries = (this.replans.get(b.key) ?? 0) + 1;
        if (tries <= PHYSICS.maxReplans) {
          this.replans.set(b.key, tries);
          reloc = { ...this.nearestFreeSpot(b), t: Math.max(reloc.t, 0.8) };
          this.relocating.set(b.key, reloc);
        } else {
          this.relocating.delete(b.key);
          this.replans.delete(b.key);
          this.cooldown.set(b.key, PHYSICS.relocateCooldown);
          reloc = undefined;
        }
      }
      if (reloc) {
        // Glide toward the free spot (the dragged bubble still has right of way).
        // Ease toward it at a calm, capped pace: a fast slide shoves its neighbours along in jumps.
        const k = 1 - Math.exp(-9 * dt);
        let mx = (reloc.x - b.x) * k;
        let my = (reloc.y - b.y) * k;
        const ml = Math.hypot(mx, my);
        const cap = PHYSICS.maxGlide * dt;
        if (ml > cap) {
          mx *= cap / ml;
          my *= cap / ml;
        }
        let nx = b.x + mx;
        let ny = b.y + my;
        if (drivenBody && drivenBody !== b && this.passingUnder.get(b.key) === drivenBody.key) {
          // Slipping out underneath the held bubble: straight on to its free spot.
          const min = radiusOf(b) + PHYSICS.wall;
          nx = Math.min(Math.max(nx, min), Math.max(min, this.width - min));
          ny = Math.min(Math.max(ny, min), Math.max(min, this.height - min));
        } else if (drivenBody && drivenBody !== b) {
          const contact = radiusOf(b) + radiusOf(drivenBody) + PHYSICS.gap;
          const min = radiusOf(b) + PHYSICS.wall;
          // Slide around the dragged bubble — never push it off the finger.
          const dx = nx - drivenBody.x;
          const dy = ny - drivenBody.y;
          const d = Math.hypot(dx, dy);
          if (d < contact) {
            // Orbit along its edge toward the free spot (by the distance it wanted to travel),
            // so it gets round even when the spot is straight behind the dragged bubble.
            const rx = b.x - drivenBody.x;
            const ry = b.y - drivenBody.y;
            const rd = Math.hypot(rx, ry) || 1;
            const ux = rx / rd;
            const uy = ry / rd;
            const mx = nx - b.x;
            const my = ny - b.y;
            const tangential = -uy * mx + ux * my;
            const side = Math.abs(tangential) > 0.05 ? Math.sign(tangential) : b.seed > 0.5 ? 1 : -1;
            const angle = Math.atan2(uy, ux) + (side * Math.hypot(mx, my)) / contact;
            nx = drivenBody.x + Math.cos(angle) * contact;
            ny = drivenBody.y + Math.sin(angle) * contact;
          }
          nx = Math.min(Math.max(nx, min), Math.max(min, this.width - min));
          ny = Math.min(Math.max(ny, min), Math.max(min, this.height - min));
          // Is it stuck? (A wall, or a bubble wedged against one, on the far side: no way round.)
          const ox = drivenBody.x - nx;
          const oy = drivenBody.y - ny;
          const od = Math.hypot(ox, oy);
          let squeeze = od < contact ? contact - od : 0;
          for (const o of this.bodies.values()) {
            if (o === b || o === drivenBody || !this.againstWall(o)) continue;
            const overlap = radiusOf(o) + radiusOf(b) + PHYSICS.gap - Math.hypot(o.x - nx, o.y - ny);
            if (overlap > 0.5) squeeze = Math.max(squeeze, overlap);
          }
          // Under tilt, also stuck: touching the dragged bubble and getting no closer to its spot (the
          // dragged one keeps shoving it back into a corner of the pile).
          const left = Math.hypot(reloc.x - b.x, reloc.y - b.y);
          const touching = Math.hypot(b.x - drivenBody.x, b.y - drivenBody.y) < contact + 1.5;
          const blocked = this.restSpeed > 0 && reloc.left !== undefined && reloc.left - left < 0.5 && touching;
          reloc.left = left;
          // Only once it has really been stuck for a few frames (not a brief touch mid-drag).
          const stuck = (squeeze > 0 && od > 0.001 && od < contact + 6) || blocked ? (this.stuckFrames.get(b.key) ?? 0) + 1 : 0;
          this.stuckFrames.set(b.key, stuck);
          // Truly trapped (a wall or wedged bubbles on the far side): rather than pull the held
          // bubble off the finger, it slips out underneath it — the held one is lifted above the page.
          if (stuck >= PHYSICS.passUnderFrames) {
            this.passingUnder.set(b.key, drivenBody.key);
            this.stuckFrames.delete(b.key);
          }
        }
        // Its speed as others feel it in collisions: real, but never a wild spike.
        const glide = Math.min(1, PHYSICS.maxGlide / Math.max(0.001, Math.hypot(nx - b.x, ny - b.y) / dt));
        b.vx = ((nx - b.x) / dt) * glide;
        b.vy = ((ny - b.y) / dt) * glide;
        b.x = nx;
        b.y = ny;
        reloc.t -= dt;
        if (reloc.t <= 0 || Math.hypot(reloc.x - b.x, reloc.y - b.y) < 1.5) {
          this.relocating.delete(b.key);
          this.replans.delete(b.key);
          this.cooldown.set(b.key, PHYSICS.relocateCooldown);
          b.vx *= 0.3;
          b.vy *= 0.3;
        }
        continue;
      }
      if (this.driven?.key === b.key) {
        // Track the pointer's speed (smoothed) for the throw on release.
        const target = { x: this.driven.x, y: this.driven.y };
        if (this.lastTarget) {
          const blend = 1 - Math.exp(-14 * dt);
          this.throwV.x += ((target.x - this.lastTarget.x) / dt - this.throwV.x) * blend;
          this.throwV.y += ((target.y - this.lastTarget.y) / dt - this.throwV.y) * blend;
        }
        this.lastTarget = target;
        // Ease toward the pointer: snappy, with just enough smoothing to hide input jitter.
        const k = 1 - Math.exp(-PHYSICS.follow * dt);
        const nx = b.x + (target.x - b.x) * k;
        const ny = b.y + (target.y - b.y) * k;
        b.vx = b.vx * 0.5 + ((nx - b.x) / dt) * 0.5;
        b.vy = b.vy * 0.5 + ((ny - b.y) / dt) * 0.5;
        b.x = nx;
        b.y = ny;
        this.clamp(b);
        continue;
      }

      if (this.held.has(b.key) || this.anchored?.key === b.key) {
        const hold = Math.exp(-14 * dt);
        b.vx *= hold;
        b.vy *= hold;
      } else {
        if (this.attractor) {
          // Spring toward the gathering point, with extra damping so they settle into a cluster.
          const a = this.attractor;
          b.vx += (a.x - b.x) * a.strength * dt;
          b.vy += (a.y - b.y) * a.strength * dt;
          const calm = Math.exp(-2.2 * dt);
          b.vx *= calm;
          b.vy *= calm;
        } else if (ambient) {
          // Smooth, slowly turning heading: sum of slow sines per bubble. A just-dropped bubble
          // eases back into it, so it stays where it was put.
          const settle = this.settling.get(b.key);
          if (settle !== undefined) {
            if (settle - dt <= 0) this.settling.delete(b.key);
            else this.settling.set(b.key, settle - dt);
          }
          const calm = settle === undefined ? 1 : 1 - Math.max(0, settle) / PHYSICS.settle;
          const s = b.seed * 100;
          const heading = (Math.sin(t * 0.21 + s) + Math.sin(t * 0.13 + s * 1.7)) * Math.PI;
          b.vx += Math.cos(heading) * PHYSICS.wander * calm * calm * wanderShare * dt;
          b.vy += Math.sin(heading) * PHYSICS.wander * calm * calm * wanderShare * dt;
        }
        // Device tilt: roll "downhill".
        b.vx += gx * dt;
        b.vy += gy * dt;
        if (pointer) {
          const dx = b.x - pointer.x;
          const dy = b.y - pointer.y;
          const reach = pointer.reach + radiusOf(b);
          const d = Math.hypot(dx, dy);
          // Only neighbours lean away; the bubble under the cursor itself stays put (e.g. one just dropped).
          if (d < reach && d >= radiusOf(b)) {
            const push = (1 - d / reach) * pointer.strength * dt;
            b.vx += (dx / d) * push;
            b.vy += (dy / d) * push;
          }
        }
        const speed = Math.hypot(b.vx, b.vy);
        const decay = Math.exp(-(PHYSICS.drag + speed * PHYSICS.speedDrag) * dt);
        b.vx *= decay;
        b.vy *= decay;
      }

      const speed = Math.hypot(b.vx, b.vy);
      if (speed > PHYSICS.maxSpeed) {
        b.vx *= PHYSICS.maxSpeed / speed;
        b.vy *= PHYSICS.maxSpeed / speed;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      this.bounceOffWalls(b, true);
      if (tiltLen > 0 && !this.isFixed(b)) this.predicted.set(b, { x: b.x, y: b.y });
    }

    const passes = tiltLen > 0 ? PHYSICS.tiltIterations : PHYSICS.iterations;
    for (let i = 0; i < passes; i++) this.solveCollisions(i === 0);
    // Squeezed against a wall, a held or dragged bubble yields too: nothing may overlap, ever.
    this.wedgedNow.clear();
    this.separateStrict();
    // Under tilt, a body the solver had to push back keeps no speed into what stopped it
    // (else a deep pile keeps pressing in, and creeps and rattles).
    for (const [b, p] of this.predicted) {
      const cx = b.x - p.x;
      const cy = b.y - p.y;
      const c = Math.hypot(cx, cy);
      const vn = c > 0.001 ? (b.vx * cx + b.vy * cy) / c : 0;
      if (vn < 0) {
        b.vx -= (vn * cx) / c;
        b.vy -= (vn * cy) / c;
      }
    }
    this.predicted.clear();
    // The dragged bubble's velocity is what it actually did after collisions — a bubble held
    // up by a jam is stalled (and won't be flung when released).
    if (drivenBody && drivenFrom) {
      drivenBody.vx = (drivenBody.x - drivenFrom.x) / dt;
      drivenBody.vy = (drivenBody.y - drivenFrom.y) / dt;
    }
    // No body ever carries a wild speed into the next frame's collisions (a bubble put down
    // under the finger "moved" a long way in one frame; that must not fling its neighbours).
    for (const b of this.bodies.values()) {
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > PHYSICS.maxSpeed) {
        b.vx *= PHYSICS.maxSpeed / speed;
        b.vy *= PHYSICS.maxSpeed / speed;
      }
    }
    this.trackWedges();
  }

  /** Clear overlaps right now (e.g. after a bubble is put down on top of others), before it's drawn. */
  resolve() {
    for (let i = 0; i < PHYSICS.iterations; i++) this.solveCollisions(false);
    this.separateStrict();
  }

  /** Run without ambient motion until nothing overlaps (used for reduced motion). */
  settle(steps = 120) {
    for (let i = 0; i < steps; i++) {
      this.solveCollisions(false);
      this.bodies.forEach((b) => this.bounceOffWalls(b));
    }
    this.bodies.forEach((b) => {
      b.vx = 0;
      b.vy = 0;
    });
  }

  // ---------------------------------------------------------------------------

  private isFixed(b: Body) {
    return this.held.has(b.key) || this.driven?.key === b.key || this.relocating.has(b.key) || this.anchored?.key === b.key;
  }

  /**
   * Inverse masses for a contact. The dragged bubble always wins: it is never pushed by a
   * neighbour (not even one squeezing out to a free spot), so it stays under the finger.
   * Other fixed bodies (hovered, relocating) don't move for free ones.
   */
  private masses(a: Body, b: Body): [number, number] {
    const d = this.driven?.key ?? this.anchored?.key;
    if (a.key === d) return [0, 1 / (b.r * b.r)];
    if (b.key === d) return [1 / (a.r * a.r), 0];
    return [this.invMass(a), this.invMass(b)];
  }

  /** If the dragged bubble keeps getting stopped by a wedged neighbour, send that neighbour to the nearest free spot. */
  private trackWedges() {
    // A dragged bubble that has stalled short of the pointer is blocked by whatever it is
    // touching on the side it's heading; those neighbours count as wedged too.
    const drv = this.driven && this.bodies.get(this.driven.key);
    if (this.driven && drv) {
      let tx = this.driven.x - drv.x;
      let ty = this.driven.y - drv.y;
      if (this.restSpeed > 0) {
        // Under tilt, a neighbour sent away just falls back: only count a stall short of where the
        // bubble can actually go (a finger past the wall isn't blocked by a neighbour).
        const min = radiusOf(drv) + PHYSICS.wall;
        tx = Math.min(Math.max(this.driven.x, min), Math.max(min, this.width - min)) - drv.x;
        ty = Math.min(Math.max(this.driven.y, min), Math.max(min, this.height - min)) - drv.y;
      }
      const short = Math.hypot(tx, ty);
      // Stalled = barely gaining on the pointer (sliding sideways around a blocker counts too).
      const gaining = (drv.vx * tx + drv.vy * ty) / Math.max(short, 0.001);
      if (short > 8 && gaining < 40) {
        for (const o of this.bodies.values()) {
          if (o === drv || this.relocating.has(o.key) || this.held.has(o.key)) continue;
          const dx = o.x - drv.x;
          const dy = o.y - drv.y;
          const touching = Math.hypot(dx, dy) - radiusOf(o) - radiusOf(drv) - PHYSICS.gap < 1.5;
          if (touching && dx * tx + dy * ty > 0) this.wedgedNow.add(o.key);
        }
      }
    }
    for (const key of [...this.wedged.keys()]) if (!this.wedgedNow.has(key)) this.wedged.delete(key);
    for (const key of this.wedgedNow) {
      if (this.relocating.has(key) || this.cooldown.has(key)) continue;
      const frames = (this.wedged.get(key) ?? 0) + 1;
      this.wedged.set(key, frames);
      const b = this.bodies.get(key);
      if (frames < 5 || !b) continue;
      this.wedged.delete(key);
      this.relocating.set(key, { ...this.nearestFreeSpot(b), t: 1.6 });
    }
  }

  /**
   * Closest spot to b where it fits. The dragged bubble counts as occupying its whole route
   * (from where it is to where the pointer is), so blockers clear the way, not just the end.
   */
  private nearestFreeSpot(b: Body) {
    const r = radiusOf(b);
    const others = [...this.bodies.values()]
      .filter((o) => o !== b)
      .map((o) => {
        const route = this.driven?.key === o.key ? this.driven : null;
        const target = this.relocating.get(o.key) ?? route;
        return {
          x0: route ? o.x : (target?.x ?? o.x),
          y0: route ? o.y : (target?.y ?? o.y),
          x: target?.x ?? o.x,
          y: target?.y ?? o.y,
          r: radiusOf(o),
        };
      });
    /** Distance from (x, y) to the segment a→b (a point when a = b). */
    const toSegment = (x: number, y: number, o: { x0: number; y0: number; x: number; y: number }) => {
      const sx = o.x - o.x0;
      const sy = o.y - o.y0;
      const len = sx * sx + sy * sy;
      const t = len > 0 ? Math.min(1, Math.max(0, ((x - o.x0) * sx + (y - o.y0) * sy) / len)) : 0;
      return Math.hypot(x - (o.x0 + sx * t), y - (o.y0 + sy * t));
    };
    const min = r + PHYSICS.wall;
    const clearance = (x: number, y: number) =>
      Math.min(...others.map((o) => toSegment(x, y, o) - o.r - r - PHYSICS.gap));
    // Packed field: if nothing fits outright, head for the roomiest spot and let neighbours shuffle.
    let best = { x: b.x, y: b.y, room: -Infinity };
    const maxRing = Math.hypot(this.width, this.height);
    for (let ring = 12; ring < maxRing; ring += 12) {
      const steps = Math.max(12, Math.round(ring / 8));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2 + b.seed;
        const x = Math.min(Math.max(b.x + Math.cos(a) * ring, min), Math.max(min, this.width - min));
        const y = Math.min(Math.max(b.y + Math.sin(a) * ring, min), Math.max(min, this.height - min));
        const room = clearance(x, y);
        if (room >= 2) return { x, y };
        if (room > best.room + 0.5) best = { x, y, room };
      }
    }
    return { x: best.x, y: best.y };
  }

  /** Pairs that may overlap right now (a bubble slipping out under the held one). */
  private passing(a: Body, b: Body) {
    return this.passingUnder.get(a.key) === b.key || this.passingUnder.get(b.key) === a.key;
  }

  /** End finished pass-unders; one that stopped half-way eases out from under (no jolt). */
  private updatePassingUnder(dt: number) {
    for (const [key, overKey] of this.passingUnder) {
      const b = this.bodies.get(key);
      const over = this.bodies.get(overKey);
      if (!b || !over) {
        this.passingUnder.delete(key);
        continue;
      }
      const dx = b.x - over.x;
      const dy = b.y - over.y;
      const d = Math.hypot(dx, dy);
      const contact = radiusOf(b) + radiusOf(over) + PHYSICS.gap;
      // (Under tilt, once let go and no longer overlapping, collisions take over the last few px:
      // gravity would keep the pair pressed just short of a full gap, passing for ever.)
      const done = this.restSpeed > 0 && this.driven?.key !== overKey && d >= contact - PHYSICS.gap;
      if (d >= contact - 0.5 || done) {
        this.passingUnder.delete(key);
        continue;
      }
      // Under tilt, the pile's weight holds it underneath: it glides out to a free spot (again).
      if (this.restSpeed > 0 && !this.relocating.has(key)) this.relocating.set(key, { ...this.nearestFreeSpot(b), t: 1.6 });
      if (!this.relocating.has(key)) {
        const step = Math.min(contact - d, 240 * dt);
        const ux = d > 0.001 ? dx / d : Math.cos(b.seed * Math.PI * 2);
        const uy = d > 0.001 ? dy / d : Math.sin(b.seed * Math.PI * 2);
        b.x += ux * step;
        b.y += uy * step;
        this.clamp(b);
      }
    }
  }

  /** Touching a wall (so it can't simply move further that way). */
  private againstWall(b: Body) {
    const min = radiusOf(b) + PHYSICS.wall + 1;
    return b.x <= min || b.y <= min || b.x >= this.width - min || b.y >= this.height - min;
  }

  /** Is another (free) bubble now sitting where b is heading? */
  private spotTaken(b: Body, spot: { x: number; y: number }) {
    for (const o of this.bodies.values()) {
      if (o === b || o.key === this.driven?.key || this.relocating.has(o.key)) continue;
      if (Math.hypot(o.x - spot.x, o.y - spot.y) < radiusOf(o) + radiusOf(b) + PHYSICS.gap - 2) return true;
    }
    return false;
  }

  private invMass(b: Body) {
    return this.isFixed(b) ? 0 : 1 / (b.r * b.r);
  }

  /**
   * Neighbours that are close (but not touching) drift apart gently.
   * @param relax 0–1: just after a tilt, they keep further apart and push harder (a pile spreads out).
   */
  private applyPersonalSpace(dt: number, relax = 0) {
    const space = PHYSICS.personalSpace + relax * PHYSICS.relaxSpace;
    const push = PHYSICS.personalPush + relax * PHYSICS.relaxPush;
    const list = [...this.bodies.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (this.passing(a, b)) continue;
        const contact = radiusOf(a) + radiusOf(b) + PHYSICS.gap;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= contact + space || d < 0.001) continue;
        const strength = Math.min(1, 1 - (d - contact) / space) * push * dt;
        const nx = dx / d;
        const ny = dy / d;
        if (!this.isFixed(a)) {
          a.vx -= nx * strength;
          a.vy -= ny * strength;
        }
        if (!this.isFixed(b)) {
          b.vx += nx * strength;
          b.vy += ny * strength;
        }
      }
    }
  }

  private solveCollisions(withImpulse: boolean) {
    const list = [...this.bodies.values()];
    const tilted = this.restSpeed > 0;
    // Under tilt, work up from the low side, so each pass props up the whole pile.
    if (tilted) list.sort((p, q) => (q.x - p.x) * this.fall.x + (q.y - p.y) * this.fall.y);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (this.passing(a, b)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = radiusOf(a) + radiusOf(b) + PHYSICS.gap;
        const distSq = dx * dx + dy * dy;
        // Under tilt, bodies just touching count too: a pile only rests once nothing presses inward.
        const reach = tilted ? min + PHYSICS.restSlop : min;
        if (distSq >= reach * reach) continue;

        const d = Math.sqrt(distSq);
        // Exactly coincident centres: pick a stable per-pair direction so they fan out.
        const angle = d > 0.001 ? 0 : hash01(a.key + '|' + b.key) * Math.PI * 2;
        const nx = d > 0.001 ? dx / d : Math.cos(angle);
        const ny = d > 0.001 ? dy / d : Math.sin(angle);
        const [ia, ib] = this.masses(a, b);
        const total = ia + ib;
        if (total === 0) continue;

        // 1. Separate so circles never overlap.
        const overlap = Math.max(0, min - d);
        a.x -= nx * overlap * (ia / total);
        a.y -= ny * overlap * (ia / total);
        b.x += nx * overlap * (ib / total);
        b.y += ny * overlap * (ib / total);
        if (tilted && overlap > 0) {
          // Pressed against a wall, one of them can't give way: the other takes the rest.
          this.clamp(a);
          this.clamp(b);
          const rest = min - Math.hypot(b.x - a.x, b.y - a.y);
          if (rest > 0.01 && ib > 0) {
            b.x += nx * rest;
            b.y += ny * rest;
            this.clamp(b);
          }
          const left = min - Math.hypot(b.x - a.x, b.y - a.y);
          if (left > 0.01 && ia > 0) {
            a.x -= nx * left;
            a.y -= ny * left;
            this.clamp(a);
          }
        }

        // 2. Elastic bounce along the contact normal. (Under tilt, later passes also stop bodies
        // pressing into each other, so a pile rests instead of jittering.)
        if (!tilted && !withImpulse) continue;
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn >= 0) continue; // already separating
        if (!withImpulse) {
          this.stopPressing(a, b, nx, ny, ia, ib);
          continue;
        }
        // The dragged bubble shoulders others aside softly; a bouncy hit knocks them flying.
        const dragged = a.key === this.driven?.key || b.key === this.driven?.key;
        // Resting under tilt: no bounce and no sound.
        const resting = -vn < this.restSpeed;
        if (-vn >= PHYSICS.minImpact && !resting) {
          const ra = radiusOf(a);
          this.impacts.push({
            a: a.key,
            b: b.key,
            speed: -vn,
            x: a.x + nx * ra,
            y: a.y + ny * ra,
            r: Math.min(a.r, b.r),
            dragged,
          });
        }
        const bounce = resting ? 0 : dragged ? PHYSICS.dragRestitution : PHYSICS.restitution;
        const impulse = (-(1 + bounce) * vn) / total;
        a.vx -= impulse * ia * nx;
        a.vy -= impulse * ia * ny;
        b.vx += impulse * ib * nx;
        b.vy += impulse * ib * ny;
      }
    }
    this.bodies.forEach((b) => this.clamp(b));
  }

  /**
   * Last word on overlaps, ignoring who is held or dragged: split by mass, and if a
   * wall blocks one bubble, the other takes the rest of the correction.
   */
  private separateStrict() {
    const list = [...this.bodies.values()];
    const gapOf = (a: Body, b: Body) => Math.hypot(b.x - a.x, b.y - a.y) - (radiusOf(a) + radiusOf(b) + PHYSICS.gap);
    // One sideways nudge per bubble per frame: repeated passes used to stack them into a fling.
    const nudged = new Set<string>();
    // Under tilt, the dragged bubble (or one just put down): it never gives way here.
    const drag = this.restSpeed > 0 ? (this.driven?.key ?? this.anchored?.key) : undefined;
    for (let pass = 0; pass < 60; pass++) {
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (this.passing(a, b)) continue;
          const overlap = -gapOf(a, b);
          if (overlap <= 0.01) continue;
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          const angle = d > 0.001 ? 0 : hash01(a.key + '|' + b.key) * Math.PI * 2;
          const nx = d > 0.001 ? (b.x - a.x) / d : Math.cos(angle);
          const ny = d > 0.001 ? (b.y - a.y) / d : Math.sin(angle);
          if (pass >= 8 && (a.key === drag || b.key === drag)) {
            // Under tilt the dragged bubble never yields (gravity keeps a jam pressing in, so "a hair
            // short" would become a long way off the finger): a neighbour still jammed against it
            // slips out underneath it; a last hair of overlap is just pushed off.
            const [held, other, dir] = a.key === drag ? [a, b, 1] : [b, a, -1];
            if (overlap > 1) {
              this.slipUnder(other, held);
            } else {
              other.x += nx * dir * overlap;
              other.y += ny * dir * overlap;
              this.clamp(other);
              this.stopPressing(held, other, nx * dir, ny * dir, 0, 1);
            }
            moved = true;
            continue;
          }
          // The free bubble gives way first; held/dragged ones only if there's no other option.
          // Early passes let free bubbles give way first; if a jam persists, everyone yields
          // equally (the dragged bubble stops a hair short) so the solver always converges.
          const [ma, mb] = pass < 8 ? this.masses(a, b) : [0, 0];
          const ia = ma === 0 && mb === 0 ? 1 / (a.r * a.r) : ma;
          const ib = ma === 0 && mb === 0 ? 1 / (b.r * b.r) : mb;
          a.x -= nx * overlap * (ia / (ia + ib));
          a.y -= ny * overlap * (ia / (ia + ib));
          b.x += nx * overlap * (ib / (ia + ib));
          b.y += ny * overlap * (ib / (ia + ib));
          this.clamp(a);
          this.clamp(b);
          let rest = -gapOf(a, b);
          if (rest > 0.01 && pass >= 8) {
            // Late passes: plain symmetric relaxation — whichever bubble can still move takes the rest.
            b.x += nx * rest;
            b.y += ny * rest;
            this.clamp(b);
            rest = -gapOf(a, b);
            if (rest > 0.01) {
              a.x -= nx * rest;
              a.y -= ny * rest;
              this.clamp(a);
            }
          } else if (rest > 0.01) {
            // A wall is in the way. The free bubble slips sideways around the other one
            // (like a real bubble squeezed against glass) instead of blocking it.
            // Under tilt, never the dragged one (a pile in a corner would slide it off the finger).
            const [mover, other, dir] =
              a.key === drag ? [b, a, 1] : b.key === drag ? [a, b, -1] : this.isFixed(a) ? [b, a, 1] : this.isFixed(b) ? [a, b, -1] : [b, a, 1];
            const tx = -ny * dir;
            const ty = nx * dir;
            const along = (mover.x - other.x) * tx + (mover.y - other.y) * ty;
            const side = Math.abs(along) > 0.5 ? Math.sign(along) : hash01(mover.key) > 0.5 ? 1 : -1;
            mover.x += tx * side * rest * 1.2;
            mover.y += ty * side * rest * 1.2;
            // Two free bubbles pressed against a wall in a tilted pile (or one still easing apart, with
            // no drag going on) just rest: a kick would feed itself every frame, a constant rattle.
            const pile = !this.isFixed(other) && (this.restSpeed > 0 || (this.tiltPeak > 0 && !this.driven));
            if (!nudged.has(mover.key) && !pile) {
              // Top up to a gentle slide speed (adding every frame used to snowball into a fling).
              nudged.add(mover.key);
              const slide = (mover.vx * tx + mover.vy * ty) * side;
              if (slide < 90) {
                mover.vx += tx * side * (90 - slide);
                mover.vy += ty * side * (90 - slide);
              }
            }
            this.clamp(mover);
            rest = -gapOf(a, b);
            if (rest > 0.01) {
              if (other.key === this.driven?.key) this.wedgedNow.add(mover.key);
              // Truly cornered: the other one gives way along the contact line (under tilt, not the
              // dragged one: the late passes let the trapped bubble slip under it instead).
              if (other.key !== drag) {
                other.x -= nx * dir * rest;
                other.y -= ny * dir * rest;
                this.clamp(other);
              }
            }
          }
          // Under tilt, a pair pulled apart must also stop pressing together, or the pull builds up.
          if (this.restSpeed > 0) this.stopPressing(a, b, nx, ny, ia, ib);
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  /** A bubble trapped against the held one slips out underneath it, to a free spot. */
  private slipUnder(b: Body, held: Body) {
    this.passingUnder.set(b.key, held.key);
    if (!this.relocating.has(b.key)) this.relocating.set(b.key, { ...this.nearestFreeSpot(b), t: 1.6 });
  }

  /** Cancel the speed at which a and b close in along (nx, ny), split by inverse mass (no bounce). */
  private stopPressing(a: Body, b: Body, nx: number, ny: number, ia: number, ib: number) {
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (vn >= 0 || ia + ib === 0) return;
    const k = vn / (ia + ib);
    a.vx += k * ia * nx;
    a.vy += k * ia * ny;
    b.vx -= k * ib * nx;
    b.vy -= k * ib * ny;
  }

  private bounceOffWalls(b: Body, record = false) {
    const min = radiusOf(b) + PHYSICS.wall;
    const maxX = this.width - min;
    const maxY = this.height - min;
    const hitX = b.x < min ? -b.vx : b.x > maxX ? b.vx : 0;
    const hitY = b.y < min ? -b.vy : b.y > maxY ? b.vy : 0;
    if (record) {
      const speed = Math.max(hitX, hitY);
      if (speed >= PHYSICS.minImpact && speed >= this.restSpeed) {
        const dragged = b.key === this.driven?.key;
        this.impacts.push({ a: b.key, b: null, speed, x: b.x, y: b.y, r: b.r, dragged });
      }
    }
    // Resting against a low wall under tilt: no bounce (no endless micro-bouncing).
    const ex = hitX > 0 && hitX < this.restSpeed ? 0 : PHYSICS.wallRestitution;
    const ey = hitY > 0 && hitY < this.restSpeed ? 0 : PHYSICS.wallRestitution;
    if (b.x < min) {
      b.x = min;
      b.vx = Math.abs(b.vx) * ex;
    } else if (b.x > maxX) {
      b.x = maxX;
      b.vx = -Math.abs(b.vx) * ex;
    }
    if (b.y < min) {
      b.y = min;
      b.vy = Math.abs(b.vy) * ey;
    } else if (b.y > maxY) {
      b.y = maxY;
      b.vy = -Math.abs(b.vy) * ey;
    }
  }

  /** Keep inside the walls, and drop any speed pushing into a wall (no stored-up launches). */
  private clamp(b: Body) {
    const min = radiusOf(b) + PHYSICS.wall;
    const maxX = Math.max(min, this.width - min);
    const maxY = Math.max(min, this.height - min);
    if (b.x <= min) {
      b.x = min;
      if (b.vx < 0) b.vx = 0;
    } else if (b.x >= maxX) {
      b.x = maxX;
      if (b.vx > 0) b.vx = 0;
    }
    if (b.y <= min) {
      b.y = min;
      if (b.vy < 0) b.vy = 0;
    } else if (b.y >= maxY) {
      b.y = maxY;
      if (b.vy > 0) b.vy = 0;
    }
  }

  /** Best non-overlapping spot from a deterministic set of candidates. */
  private freeSpot(r: number, seed: number) {
    const min = r + PHYSICS.wall;
    const spanX = Math.max(0, this.width - 2 * min);
    const spanY = Math.max(0, this.height - 2 * min);
    let best = { x: min + spanX / 2, y: min + spanY / 2, clearance: -Infinity };
    for (let i = 0; i < 160; i++) {
      const x = min + hash01(String(seed), i * 2 + 1) * spanX;
      const y = min + hash01(String(seed), i * 2 + 2) * spanY;
      let clearance = Infinity;
      for (const o of this.bodies.values()) {
        clearance = Math.min(clearance, Math.hypot(o.x - x, o.y - y) - radiusOf(o) - r - PHYSICS.gap);
      }
      if (clearance >= 0) return { x, y };
      if (clearance > best.clearance) best = { x, y, clearance };
    }
    return { x: best.x, y: best.y };
  }
}

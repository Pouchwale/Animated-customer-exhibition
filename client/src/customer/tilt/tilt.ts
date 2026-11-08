/**
 * iPad tilt input: which way is "down" for the bubbles, from the motion sensors.
 *
 * - deviceorientation (beta/gamma, the same signs in every browser) → the direction of gravity in
 *   screen axes, corrected for the screen's rotation (portrait, landscape left/right, upside down).
 * - Measured from a neutral pose (a kiosk iPad on a stand is already tilted) that slowly follows the
 *   current pose, so a held angle settles back to "level". A small deadzone; full effect at 28°.
 * - State lives in this module, so tilt stays on across the kiosk "Start over" (a remount, no reload).
 */
import { useSyncExternalStore } from 'react';
import { signalActivity } from '../activity';

/** Which way "down" is, in screen/field axes (+x right, +y down), each component −1..1. */
export interface TiltVector {
  x: number;
  y: number;
}

/** Degrees of tilt ignored (sensor noise, a slightly uneven stand)… */
const DEADZONE = 3;
/** …and the tilt that gives the full effect. */
const FULL = 28;
/** Seconds: sensor smoothing (kills jitter). */
const SMOOTH = 0.08;
/** Seconds: slower smoothing, to tell a moving device from a resting one. */
const SETTLE = 0.6;
/**
 * How the neutral pose follows the current one, time constant `FOLLOW` s × (1 + (offset / SPAN°)²):
 * quickly for small offsets (a stand set 6° off settles in ~3 s), slowly for big tilts (a held 12°
 * fades in ~7 s, 25° in ~20 s). So a brief tilt doesn't shift "level" (no roll the other way on the
 * way back), and a held one still settles.
 */
const FOLLOW = 2;
const SPAN = 6;
/** Tilting counts as using the screen when the device turns by this much (°)… */
const MOVING = 2.5;
/** …or tilts the bubbles at least this hard (0–1). At most one signal per this many ms. */
const ROLLING = 0.25;
const ACTIVITY_GAP = 500;

type Vec3 = { x: number; y: number; z: number };

function set(v: Vec3, x: number, y: number, z: number) {
  const l = Math.hypot(x, y, z) || 1;
  v.x = x / l;
  v.y = y / l;
  v.z = z / l;
}

/** Move v a share k of the way to (x, y, z), keeping it a unit vector. */
function blend(v: Vec3, x: number, y: number, z: number, k: number) {
  set(v, v.x + (x - v.x) * k, v.y + (y - v.y) * k, v.z + (z - v.z) * k);
}

/** Sensor readings → tilt vector. No DOM, so it can be tested. */
export class TiltFilter {
  /** The tilt vector (direction × strength). */
  readonly out: TiltVector = { x: 0, y: 0 };
  /** 0–1: 0 = level (or within the deadzone), 1 = full tilt. */
  strength = 0;
  /** The device is being turned right now (not just held). */
  moving = false;
  /** Gravity in the portrait screen frame (x right, y down the screen, z out of the screen): smoothed… */
  private readonly fast: Vec3 = { x: 0, y: 0, z: -1 };
  /** …smoothed slowly (for `moving`)… */
  private readonly slow: Vec3 = { x: 0, y: 0, z: -1 };
  /** …and the neutral pose, where the bubbles lie still. */
  private readonly neutral: Vec3 = { x: 0, y: 0, z: -1 };
  private last = -Infinity;

  /** The next reading starts afresh and becomes the neutral pose. */
  reset() {
    this.last = -Infinity;
  }

  /**
   * @param beta  front-back tilt, degrees (W3C deviceorientation)
   * @param gamma left-right tilt, degrees
   * @param angle screen rotation, degrees (screen.orientation.angle)
   * @param time  seconds
   */
  update(beta: number, gamma: number, angle: number, time: number) {
    const b = (beta * Math.PI) / 180;
    const g = (gamma * Math.PI) / 180;
    // Gravity in the device's portrait frame (rotation Z-X'-Y'' by alpha, beta, gamma).
    const gx = Math.cos(b) * Math.sin(g);
    const gy = Math.sin(b);
    const gz = -Math.cos(b) * Math.cos(g);
    const gap = time - this.last;
    this.last = time;
    if (gap > 1) {
      // Just turned on, or the sensor was paused (page hidden): start from the pose it's in now.
      set(this.fast, gx, gy, gz);
      set(this.slow, gx, gy, gz);
      set(this.neutral, gx, gy, gz);
    } else {
      const dt = Math.max(0, gap);
      blend(this.fast, gx, gy, gz, 1 - Math.exp(-dt / SMOOTH));
      blend(this.slow, gx, gy, gz, 1 - Math.exp(-dt / SETTLE));
      const f = this.fast;
      const n = this.neutral;
      const offset = Math.acos(Math.min(1, f.x * n.x + f.y * n.y + f.z * n.z)) / ((SPAN * Math.PI) / 180);
      blend(n, f.x, f.y, f.z, 1 - Math.exp(-dt / (FOLLOW * (1 + offset * offset))));
    }
    const f = this.fast;
    const n = this.neutral;
    this.moving = f.x * this.slow.x + f.y * this.slow.y + f.z * this.slow.z < Math.cos((MOVING * Math.PI) / 180);

    // Turn the neutral pose to "lying flat" (the shortest rotation taking it to (0, 0, −1)) and see
    // where gravity points now: the in-plane part is the tilt, its length the sine of the angle.
    const k = (n.x * f.x + n.y * f.y) / Math.max(0.05, 1 - n.z);
    const rx = f.x + n.x * f.z - n.x * k;
    const ry = f.y + n.y * f.z - n.y * k;
    const s = Math.hypot(rx, ry);
    const away = n.x * f.x + n.y * f.y + n.z * f.z; // cos of the angle from neutral
    const degrees = away < 0 ? 90 : (Math.asin(Math.min(1, s)) * 180) / Math.PI;
    this.strength = s > 1e-6 ? Math.min(1, Math.max(0, (degrees - DEADZONE) / (FULL - DEADZONE))) : 0;
    const ux = s > 1e-6 ? (rx / s) * this.strength : 0;
    const uy = s > 1e-6 ? (ry / s) * this.strength : 0;
    // Portrait frame → the screen as it is shown now.
    const turn = ((Math.round(angle / 90) % 4) + 4) % 4;
    this.out.x = turn === 0 ? ux : turn === 1 ? uy : turn === 2 ? -ux : -uy;
    this.out.y = turn === 0 ? uy : turn === 1 ? -ux : turn === 2 ? -uy : ux;
  }
}

// ---- Browser glue ------------------------------------------------------------------------------

/**
 * none: no usable sensor (no API, not HTTPS, a desktop with no readings) · ask: iOS needs a tap on
 * "Allow motion" · denied: iOS said no · ready: readings available.
 */
export type TiltSupport = 'none' | 'ask' | 'denied' | 'ready';
export interface TiltState {
  support: TiltSupport;
  /** Tilt moves the bubbles. */
  on: boolean;
}

type OrientationApi = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
const api: OrientationApi | undefined = typeof window === 'undefined' ? undefined : window.DeviceOrientationEvent;
// iOS only sends motion over HTTPS; Chrome needs a secure context too.
const usable = !!api && window.isSecureContext;
// iOS (WebKit) sends no readings until a tap allows it. Chromium has requestPermission() too, but
// sends readings (or, on a desktop, nulls) without asking: there, just listen for real ones.
const askFirst = usable && typeof api?.requestPermission === 'function' && !('userAgentData' in navigator);
const needsPermission = askFirst && navigator.maxTouchPoints > 0; // (no sensors on a Mac)
const probe = usable && !askFirst;

let state: TiltState = { support: needsPermission ? 'ask' : 'none', on: false };
const listeners = new Set<() => void>();
function update(next: Partial<TiltState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const filter = new TiltFilter();
let users = 0;
let listening = false;
let lastSignal = -Infinity;

function screenAngle() {
  const legacy = (window as { orientation?: number }).orientation;
  return screen.orientation?.angle ?? legacy ?? 0;
}

function onOrientation(e: DeviceOrientationEvent) {
  const { beta, gamma } = e;
  // Desktops without sensors send nothing, or nulls (or a lone 0/0).
  if (beta == null || gamma == null) return;
  if (state.support !== 'ready') {
    if (beta === 0 && gamma === 0) return;
    update({ support: 'ready' });
  }
  if (!state.on) return;
  const now = performance.now();
  filter.update(beta, gamma, screenAngle(), now / 1000);
  // Someone tilting the iPad is using the screen (but a resting iPad's sensor noise is not).
  if ((filter.moving || filter.strength > ROLLING) && now - lastSignal >= ACTIVITY_GAP) {
    lastSignal = now;
    signalActivity();
  }
}

/** Listen while a control is mounted and the sensor may be read (iOS: only once allowed). */
function sync() {
  const want = users > 0 && (probe || state.support === 'ready');
  if (want === listening) return;
  listening = want;
  if (want) {
    filter.reset();
    window.addEventListener('deviceorientation', onOrientation);
  } else {
    window.removeEventListener('deviceorientation', onOrientation);
  }
}

/** Current tilt, or null when tilt is off, unavailable, or the device is level. Called every frame. */
export function readTilt(): TiltVector | null {
  return listening && state.on && filter.strength > 0 ? filter.out : null;
}

/** The tilt control is on screen: read the sensor (returns the cleanup). */
export function watchTilt(): () => void {
  if (!probe && !needsPermission) return () => {};
  users++;
  sync();
  return () => {
    users--;
    sync();
  };
}

/** Tilt on or off (the next reading becomes the new neutral pose). */
export function setTiltOn(on: boolean) {
  filter.reset();
  update({ on });
}

/**
 * iOS: ask for motion access. Call it straight from the tap (iOS only asks from a user gesture).
 * Resolves to whether it was allowed.
 */
export function allowMotion(): Promise<boolean> {
  let asked: Promise<'granted' | 'denied'>;
  try {
    asked = api?.requestPermission?.() ?? Promise.resolve('denied');
  } catch {
    asked = Promise.resolve('denied');
  }
  return asked.then(
    (answer) => {
      const granted = answer === 'granted';
      filter.reset();
      update(granted ? { support: 'ready', on: true } : { support: 'denied', on: false });
      sync();
      return granted;
    },
    () => {
      update({ support: 'denied', on: false });
      return false;
    },
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const snapshot = () => state;

export function useTiltState(): TiltState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Web Audio output: one lazily created AudioContext → master gain → gentle compressor → speakers.
 * Never throws: without Web Audio every call is a no-op.
 */
import { VOICES, renderVoice, type Voice } from './synth';

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/** Sounding at once, at most (any voice), and at most this many of them bumps. */
const MAX_VOICES = 4;
const MAX_BUMP_VOICES = 3;
const MASTER = 0.75;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let buffers: Record<Voice, AudioBuffer[]> | null = null;
/** Faded out (sound off or page hidden); suspended shortly after. */
let asleep = true;
let suspendTimer = 0;
/** End times (context seconds) of the voices that may still be sounding, and which are bumps. */
const ends = new Float64Array(MAX_VOICES);
const bumps = new Uint8Array(MAX_VOICES);

function AudioCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

export const audioSupported = () => !!AudioCtor();

function create(): boolean {
  const Ctor = AudioCtor();
  if (!Ctor) return false;
  const c = new Ctor({ latencyHint: 'interactive' });
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  master = c.createGain();
  master.gain.value = 0;
  master.connect(comp);
  comp.connect(c.destination);
  // Every voice is rendered once, then each sound is just a buffer playback. They are rendered one at
  // a time when the page is idle (never one long pause); a voice needed sooner is rendered on the spot by play().
  buffers = {} as Record<Voice, AudioBuffer[]>;
  const queue = Object.keys(VOICES) as Voice[];
  const next = () => {
    if (!buffers || ctx !== c) return;
    const v = queue.shift();
    if (!v) return;
    if (!buffers[v] && VOICES[v]) buffers[v] = renderBuffers(c, v);
    whenIdle(next);
  };
  ctx = c;
  whenIdle(next);
  return true;
}

/** Run when the page is idle (or soon, where requestIdleCallback is missing, e.g. older Safari). */
function whenIdle(fn: () => void) {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 500 });
  else window.setTimeout(fn, 16);
}

/**
 * Make the audio context ahead of time, while the page is idle: on some computers that takes a few
 * hundred ms, which must not freeze the visitor's first touch. It waits suspended (browsers allow
 * that); unlock() resumes it inside the first touch, which is instant.
 */
export function prepare(): void {
  if (ctx) return;
  try {
    create();
  } catch {
    // No Web Audio: unlock() will report it.
  }
}

function renderBuffers(c: AudioContext, voice: Voice): AudioBuffer[] {
  return VOICES[voice].map((v) => {
    const data = renderVoice(v.parts, v.length, c.sampleRate);
    const buf = c.createBuffer(1, data.length, c.sampleRate);
    buf.getChannelData(0).set(data);
    return buf;
  });
}

/**
 * Sound switched on. Call it from a click/tap handler: iPad Safari only starts audio inside a
 * user gesture. Returns false if Web Audio is unavailable.
 */
export function unlock(): boolean {
  try {
    // Before audio starts: play through the iPad's silent switch / Silent Mode (Safari 16.4+),
    // since the visitor asked for sound. The volume buttons still apply.
    setAudioSession('playback');
    if (!ctx && !create()) {
      setAudioSession('auto');
      return false;
    }
    wake();
    return true;
  } catch {
    setAudioSession('auto');
    return false;
  }
}

/** Fade back in and resume (after unlock, when the page shows again, or on the next touch after an iOS interruption). */
export function wake() {
  if (!ctx || !master) return;
  try {
    window.clearTimeout(suspendTimer);
    asleep = false;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(MASTER, ctx.currentTime);
    if (ctx.state !== 'running') void Promise.resolve(ctx.resume()).catch(() => {}); // refused outside a gesture on iOS: the next touch retries
    // iOS: a (silent) sound started inside a gesture unlocks output.
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    silent.connect(ctx.destination);
    silent.start(0);
  } catch {
    // Not allowed yet: the next touch tries again.
  }
}

/** Audio is on but not running (iOS suspended or interrupted it): the next touch should wake it. */
export const waking = () => !!ctx && !asleep && ctx.state !== 'running';

/** Fade out, then suspend (no click, and the audio hardware can rest). For a hidden page. */
export function sleep(then?: () => void) {
  if (!ctx || !master) return;
  const c = ctx;
  asleep = true;
  try {
    master.gain.cancelScheduledValues(c.currentTime);
    master.gain.setTargetAtTime(0, c.currentTime, 0.015);
  } catch {
    // ignore
  }
  window.clearTimeout(suspendTimer);
  suspendTimer = window.setTimeout(() => {
    try {
      void Promise.resolve(c.suspend()).catch(() => {});
    } catch {
      // ignore
    }
    then?.();
  }, 120);
}

/** Sound switched off: sleep, then give the silent switch back its say. */
export function release() {
  sleep(() => setAudioSession('auto'));
}

function setAudioSession(type: 'playback' | 'auto') {
  try {
    const session = (navigator as AudioSessionNavigator).audioSession;
    if (session && session.type !== type) session.type = type;
  } catch {
    // Not supported: the silent switch keeps muting Web Audio.
  }
}

/**
 * Play a voice now. Returns false when it was dropped: voice cap, no context, asleep, or the
 * context isn't running (sounds never queue up). `starting`: may start while the context is still
 * starting up (the switch-on bloop, right after unlock()).
 */
export function play(voice: Voice, variant: number, gain: number, rate = 1, pan = 0, starting = false): boolean {
  if (!ctx || !master || !buffers || asleep || (ctx.state !== 'running' && !starting)) return false;
  const now = ctx.currentTime;
  const isBump = voice === 'bump';
  let soundingBumps = 0;
  let free = -1;
  for (let i = 0; i < MAX_VOICES; i++) {
    if (ends[i] > now) soundingBumps += bumps[i];
    else if (free < 0) free = i;
  }
  if (free < 0 || (isBump && soundingBumps >= MAX_BUMP_VOICES)) return false;
  // A voice added after the buffers were made (e.g. a page left open across an update): make it now.
  if (!buffers[voice] && VOICES[voice]) buffers[voice] = renderBuffers(ctx, voice);
  const list = buffers[voice];
  if (!list?.length) return false;
  const buf = list[Math.min(list.length - 1, Math.max(0, variant))];
  try {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    let out: AudioNode = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    out.connect(master);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      if (out !== g) out.disconnect();
    };
    src.start(now);
    ends[free] = now + buf.duration / rate;
    bumps[free] = isBump ? 1 : 0;
    return true;
  } catch {
    return false;
  }
}

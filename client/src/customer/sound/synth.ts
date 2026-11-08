/**
 * "Bloop" voices, rendered once to sample buffers (cheaper than live oscillators per sound).
 * Pure: returns Float32Arrays, so it is unit-tested in node.
 */

/** One bloop: a sine that glides quickly from `from` to `to` Hz, with a soft attack and a short decay. */
interface Bloop {
  from: number;
  to: number;
  /** Glide time constant, seconds. */
  glide: number;
  /** Decay time constant, seconds. */
  decay: number;
  /** Second-harmonic level (0..1): a little body, so it carries on small tablet speakers. */
  body: number;
  /** Start within the voice, seconds. */
  at?: number;
  /** Relative level within the voice. */
  level?: number;
}

const ATTACK = 0.006;
const FADE = 0.012;

/** Render bloops into one buffer of `length` seconds, peak-normalised to 0.9. Starts and ends at exactly 0 (no clicks). */
export function renderVoice(parts: readonly Bloop[], length: number, sampleRate: number): Float32Array {
  const n = Math.max(1, Math.round(length * sampleRate));
  const out = new Float32Array(n);
  for (const p of parts) {
    const start = Math.round((p.at ?? 0) * sampleRate);
    const level = p.level ?? 1;
    // Past ~12 decay times a part is silent (e^-12 ≈ 6e-6): stop there (the zip's tiny ticks).
    const end = Math.min(n, start + Math.ceil(p.decay * 12 * sampleRate));
    let phase = 0;
    for (let i = start; i < end; i++) {
      const t = (i - start) / sampleRate;
      const f = p.to + (p.from - p.to) * Math.exp(-t / p.glide);
      phase += (2 * Math.PI * f) / sampleRate;
      const attack = t < ATTACK ? Math.sin((Math.PI / 2) * (t / ATTACK)) ** 2 : 1;
      const env = attack * Math.exp(-t / p.decay) * level;
      out[i] += env * (Math.sin(phase) + p.body * Math.exp(-t / p.decay) * Math.sin(2 * phase));
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const fade = Math.round(FADE * sampleRate);
  for (let i = 0; i < n; i++) {
    const tail = n - 1 - i;
    const f = tail < fade ? Math.sin((Math.PI / 2) * (tail / fade)) ** 2 : 1;
    out[i] = peak > 0 ? (out[i] / peak) * 0.9 * f : 0;
  }
  return out;
}

/** Pentatonic steps (semitones) for the pop: each newly ranked bubble pops a little higher. */
export const POP_STEPS = [0, 2, 4, 7, 9, 12, 14, 16];
const semi = (s: number) => 2 ** (s / 12);

/** The voices, each with a few variants (picked at random so repeats don't sound robotic). Lengths in seconds. */
export const VOICES = {
  /** A collision: short and light. Pitched per bubble size at play time. */
  bump: [1.42, 1.5, 1.6].map((up, i) => ({
    length: 0.1 + i * 0.01,
    parts: [{ from: 520, to: 520 * up, glide: 0.022, decay: 0.028 + i * 0.003, body: 0.12 }],
  })),
  /** Added to Step 2: a round bloop, one step higher for each ranked bubble. */
  pop: POP_STEPS.map((s) => ({
    length: 0.17,
    parts: [{ from: 270 * semi(s), to: 500 * semi(s), glide: 0.032, decay: 0.05, body: 0.18 }],
  })),
  /** Let go of a dragged bubble: low and soft. */
  drop: [1.35, 1.45].map((up) => ({
    length: 0.15,
    parts: [{ from: 230, to: 230 * up, glide: 0.03, decay: 0.045, body: 0.35 }],
  })),
  /** Taken out of Step 2: the bloop in reverse, gliding down. */
  remove: [{ length: 0.16, parts: [{ from: 560, to: 310, glide: 0.04, decay: 0.05, body: 0.15 }] }],
  /** "Your pouch is ready": the zip running shut, a quick run of soft rising ticks. */
  zip: [
    {
      length: 0.26,
      parts: Array.from({ length: 13 }, (_, i) => ({
        from: 800 + i * 40,
        to: 1000 + i * 30,
        glide: 0.004,
        decay: 0.006,
        body: 0.1,
        at: i * 0.016,
        level: 0.55 + (i / 13) * 0.45,
      })),
    },
  ],
  /** …and a short soft bell once it is sealed. */
  ding: [
    {
      length: 0.26,
      parts: [
        { from: 880, to: 880, glide: 0.01, decay: 0.085, body: 0.05 },
        { from: 1320, to: 1320, glide: 0.01, decay: 0.06, body: 0, level: 0.35 },
        { from: 2640, to: 2640, glide: 0.01, decay: 0.03, body: 0, level: 0.12 },
      ],
    },
  ],
  /** Sound switched on: two quick rising bloops. */
  on: [
    {
      length: 0.25,
      parts: [
        { from: 300, to: 540, glide: 0.03, decay: 0.045, body: 0.15 },
        { from: 400, to: 760, glide: 0.03, decay: 0.05, body: 0.15, at: 0.085, level: 0.9 },
      ],
    },
  ],
} satisfies Record<string, { length: number; parts: Bloop[] }[]>;

export type Voice = keyof typeof VOICES;

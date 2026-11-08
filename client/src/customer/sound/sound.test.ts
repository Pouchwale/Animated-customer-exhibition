import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BubbleWorld, fieldHeight, type Impact } from '../physics';
import { BumpGate, LIMITS, bumpVolume, isQuietLogoPhase, orderCue } from './gate';
import { VOICES, renderVoice } from './synth';

const hit = (a: string, b: string | null, speed: number, dragged = false): Impact => ({ a, b, speed, x: 100, y: 100, r: 40, dragged });

/** Feed one impact list per 60 fps frame; returns the times (ms) that bumped. */
function feed(gate: BumpGate, frames: (t: number) => Impact[], seconds: number, armed = true) {
  const played: number[] = [];
  for (let f = 0; f < seconds * 60; f++) {
    const t = 1000 + (f * 1000) / 60;
    const list = frames(t);
    if (list.length && gate.pick(list, t, armed) >= 0) played.push(t);
  }
  return played;
}

test('a firm hit between two calm bubbles bumps; a soft one does not', () => {
  const g = new BumpGate();
  assert.equal(g.pick([hit('a', 'b', LIMITS.minSpeed - 1)], 1000, true), -1);
  assert.equal(g.pick([hit('c', 'd', 300)], 2000, true), 0);
  assert.equal(new BumpGate().pick([hit('a', 'b', LIMITS.dragMinSpeed - 1, true)], 1000, true), -1, 'dragged contacts need a firmer hit');
});

test('the same two bubbles touching repeatedly bump once', () => {
  const g = new BumpGate();
  const played = feed(g, () => [hit('a', 'b', 260)], 3);
  assert.equal(played.length, 1);
});

test('the same pair bumps again only after they were apart for a while', () => {
  const g = new BumpGate();
  // Two hits 1.2 s apart, nothing in between.
  const played = feed(g, (t) => (Math.abs(t - 1200) < 8 || Math.abs(t - 2400) < 8 ? [hit('a', 'b', 260)] : []), 2);
  assert.equal(played.length, 2);
});

test('the strongest contact of a step wins: one bump per step', () => {
  const g = new BumpGate();
  const list = [hit('a', 'b', 150), hit('c', 'd', 400), hit('e', null, 200)];
  assert.equal(g.pick(list, 1000, true), 1);
});

test('bumps are rate limited: a short burst, then a steady trickle', () => {
  const g = new BumpGate();
  let n = 0;
  // A fresh pair hits hard every frame for 4 s.
  const played = feed(g, () => [hit(`x${n++}`, `y${n}`, 400)], 4);
  const firstSecond = played.filter((t) => t < 2000).length;
  assert.ok(firstSecond <= LIMITS.burst + LIMITS.perSecond, `first second: ${firstSecond}`);
  assert.ok(played.length <= LIMITS.burst + LIMITS.perSecond * 4, `total: ${played.length}`);
  for (let i = 1; i < played.length; i++) assert.ok(played[i] - played[i - 1] >= LIMITS.gapMs - 0.01, 'minimum gap between bumps');
});

test('silent while not armed (nobody using the screen), right after a UI cue, and while warming up', () => {
  const g = new BumpGate();
  assert.equal(g.pick([hit('a', 'b', 400)], 1000, false), -1);
  g.holdOff(2000);
  assert.equal(g.pick([hit('c', 'd', 400)], 2050, true), -1);
  assert.equal(g.pick([hit('e', 'f', 400)], 2000 + LIMITS.afterCueMs + 400, true), 0);
  const w = new BumpGate();
  w.reset(5000);
  assert.equal(w.pick([hit('a', 'b', 400)], 5100, true), -1);
});

test('copes with many bubbles (tables grow)', () => {
  const g = new BumpGate();
  for (let i = 0; i < 100; i++) g.pick([hit(`k${i}`, `k${i + 1}`, 30)], 1000 + i, true);
  assert.equal(g.pick([hit('k5', 'zz', 400)], 9000, true), 0);
});

test('bump volume grows with speed and stays within 0..1', () => {
  assert.ok(bumpVolume(LIMITS.minSpeed, false, false) < bumpVolume(400, false, false));
  assert.ok(bumpVolume(5000, false, false) <= 1);
  assert.ok(bumpVolume(400, true, false) < bumpVolume(400, false, false), 'pushing with the dragged bubble is softer');
});

test('list changes: pop for an add (unless it is flying in), remove for a removal', () => {
  assert.equal(orderCue(['a'], ['a', 'b'], null), 'pop');
  assert.equal(orderCue(['a'], ['a', 'b'], 'b'), null, 'pops when the flight lands');
  assert.equal(orderCue(['a', 'b'], ['a'], null), 'remove');
  assert.equal(orderCue(['a', 'b', 'c'], [], null), 'remove', 'clear all: one cue');
  assert.equal(orderCue(['a', 'b'], ['b', 'a'], null), null, 'reorder: the drop cue covers it');
});

test('idle logo: silent while gathering, forming, holding and returning', () => {
  for (const p of ['gathering', 'forming', 'holding', 'returning']) assert.ok(isQuietLogoPhase(p));
  for (const p of ['scattering', 'off', null, undefined]) assert.ok(!isQuietLogoPhase(p));
});

test('voices: short, start and end at zero, no clicks', () => {
  const rate = 48000;
  for (const [name, variants] of Object.entries(VOICES)) {
    for (const v of variants) {
      const data = renderVoice(v.parts, v.length, rate);
      assert.ok(v.length >= 0.08 && v.length <= 0.26, `${name} length ${v.length}`);
      assert.equal(data[0], 0, `${name} starts at 0`);
      assert.ok(Math.abs(data[data.length - 1]) < 1e-6, `${name} ends at 0`);
      let peak = 0;
      let jump = 0;
      for (let i = 0; i < data.length; i++) {
        peak = Math.max(peak, Math.abs(data[i]));
        if (i) jump = Math.max(jump, Math.abs(data[i] - data[i - 1]));
      }
      assert.ok(peak <= 0.9 + 1e-6 && peak > 0.5, `${name} peak ${peak}`);
      // A sine up to ~1.6 kHz moves at most ~0.2 per sample at 48 kHz: anything bigger would be a click.
      assert.ok(jump < 0.25, `${name} sample jump ${jump}`);
    }
  }
});

// The physics as it runs in the field: what the gate lets through.
const radii = [58, 58, 50, 50, 50, 43, 43, 43, 36, 36];
function run(seconds: number, each: (w: BubbleWorld, t: number) => void, from = 0) {
  const w = new BubbleWorld();
  w.setSize(330, fieldHeight(330, radii, 420));
  radii.forEach((r, i) => w.upsert(`b${i}`, r));
  const g = new BumpGate();
  let played = 0;
  for (let f = 0; f < seconds * 60; f++) {
    const t = f / 60;
    each(w, t);
    w.step(1 / 60, t, null);
    if (w.impacts.length && g.pick(w.impacts, t * 1000, true) >= 0 && t >= from) played++;
  }
  return played / (seconds - from);
}

test('physics: drifting bubbles and piled-up bubbles under tilt stay quiet', () => {
  assert.equal(run(30, () => {}, 2), 0, 'drift');
  for (const tilt of [{ x: 0, y: 1 }, { x: 0, y: 0.4 }, { x: 0.5, y: 0.5 }]) {
    const rate = run(20, (w) => (w.tilt = tilt), 6);
    assert.ok(rate <= 0.1, `resting pile under tilt ${JSON.stringify(tilt)}: ${rate.toFixed(2)} bumps/s`);
  }
});

test('physics: dragging through the crowd bumps, but never machine-guns', () => {
  const rate = run(10, (w, t) => {
    const span = w.width - 120;
    const p = (t * 700) % (2 * span);
    w.drive('b0', 60 + (p < span ? p : 2 * span - p), w.height / 2 + Math.sin(t * 2.3) * (w.height / 3));
  }, 1);
  assert.ok(rate > 0.5 && rate <= LIMITS.perSecond, `${rate.toFixed(2)} bumps/s`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TiltFilter } from './tilt';

const DEG = Math.PI / 180;

/** beta/gamma (degrees) for a gravity direction in the portrait screen frame (x right, y down, z out of the screen). */
function anglesFor(x: number, y: number, z: number): [number, number] {
  const l = Math.hypot(x, y, z);
  return [Math.asin(y / l) / DEG, Math.atan2(x, -z) / DEG];
}

/** Gravity for a device leaning back `pitch`° from upright-flat… then turned `roll`° clockwise in its own plane. */
function pose(pitch: number, roll = 0): [number, number] {
  const s = Math.sin(pitch * DEG);
  return anglesFor(s * Math.sin(roll * DEG), s * Math.cos(roll * DEG), -Math.cos(pitch * DEG));
}

/** Feed a pose at 60 Hz for `seconds`, starting at `from`. */
function hold(f: TiltFilter, [beta, gamma]: [number, number], seconds: number, from: number, angle = 0) {
  const n = Math.round(seconds * 60);
  for (let i = 1; i <= n; i++) f.update(beta, gamma, angle, from + i / 60);
  return from + seconds;
}

test('lying flat: tilting the right edge down rolls right, the top up rolls down', () => {
  const f = new TiltFilter();
  let t = hold(f, [0, 0], 0.5, 0);
  assert.equal(f.strength, 0);
  // (Read after 0.4 s: smoothing has caught up, the neutral pose has barely started to follow.)
  t = hold(f, [0, 20], 0.4, t);
  assert.ok(f.out.x > 0.6 && Math.abs(f.out.y) < 0.02, `right: ${JSON.stringify(f.out)}`);
  assert.ok(Math.abs(f.strength - (20 - 3) / 25) < 0.06, `20° ≈ 68% (${f.strength.toFixed(2)})`);
  t = hold(f, [0, 0], 0.4, t);
  t = hold(f, [20, 0], 0.4, t);
  assert.ok(f.out.y > 0.6 && Math.abs(f.out.x) < 0.05, `down: ${JSON.stringify(f.out)}`);
  t = hold(f, [-20, -20], 0.4, t);
  assert.ok(f.out.x < -0.4 && f.out.y < -0.4, `up-left: ${JSON.stringify(f.out)}`);
});

test('a few degrees do nothing; about 28° is full tilt', () => {
  const f = new TiltFilter();
  let t = hold(f, [0, 0], 0.5, 0);
  t = hold(f, [2, -2], 1, t);
  assert.equal(f.strength, 0, 'inside the deadzone');
  hold(f, [0, 32], 0.4, t);
  assert.equal(f.strength, 1);
  assert.ok(Math.abs(Math.hypot(f.out.x, f.out.y) - 1) < 1e-9);
});

test('screen rotation: "down" follows the picture, not the hardware', () => {
  // The device's right edge goes down (gamma +20).
  const cases: [number, { x: number; y: number }][] = [
    [0, { x: 1, y: 0 }], // portrait: right
    [90, { x: 0, y: -1 }], // landscape, device turned anticlockwise: its right edge is the top of the picture
    [-90, { x: 0, y: 1 }], // landscape the other way: its right edge is the bottom
    [270, { x: 0, y: 1 }],
    [180, { x: -1, y: 0 }], // upside down
  ];
  for (const [angle, want] of cases) {
    const f = new TiltFilter();
    const t = hold(f, [0, 0], 0.5, 0, angle);
    hold(f, [0, 20], 1, t, angle);
    const len = Math.hypot(f.out.x, f.out.y);
    assert.ok(Math.abs(f.out.x / len - want.x) < 0.01 && Math.abs(f.out.y / len - want.y) < 0.01, `angle ${angle}: ${JSON.stringify(f.out)}`);
  }
});

test('on a stand: tilt is measured from the resting angle, not from flat', () => {
  const f = new TiltFilter();
  let t = hold(f, pose(70), 1, 0); // leaning back 20° from upright
  assert.equal(f.strength, 0, 'resting on the stand is level');
  hold(f, pose(70, 15), 0.4, t); // turned clockwise like a steering wheel: right edge down
  assert.ok(f.out.x > 0.35 && Math.abs(f.out.y) < 0.1, `rolls right: ${JSON.stringify(f.out)}`);
  const g = new TiltFilter();
  t = hold(g, pose(70), 1, 0);
  hold(g, pose(50), 0.4, t); // leaned further back: the top edge goes down
  assert.ok(g.out.y < -0.5 && Math.abs(g.out.x) < 0.02, `rolls to the top: ${JSON.stringify(g.out)}`);
});

test('a held angle slowly becomes the new level; small offsets settle fast', () => {
  const f = new TiltFilter();
  let t = hold(f, [0, 0], 0.5, 0);
  t = hold(f, [0, 22], 5, t);
  assert.ok(f.strength > 0.5, `still tilting after 5 s (${f.strength.toFixed(2)})`);
  hold(f, [0, 22], 25, t);
  assert.equal(f.strength, 0, 'settled after 30 s');
  // A stand put back 6° off its old angle: level again within a few seconds.
  const g = new TiltFilter();
  t = hold(g, [60, 0], 0.5, 0);
  hold(g, [66, 0], 4, t);
  assert.equal(g.strength, 0, 'a small offset settles within 4 s');
});

test('a brief tilt does not shift "level": no roll the other way on the way back', () => {
  for (const seconds of [1, 3, 5]) {
    const f = new TiltFilter();
    let t = hold(f, [0, 0], 0.5, 0);
    t = hold(f, [0, 25], seconds, t);
    let reverse = 0;
    for (let i = 1; i <= 120; i++) {
      f.update(0, 0, 0, t + i / 60);
      if (i > 30) reverse = Math.max(reverse, -f.out.x); // after smoothing has caught up
    }
    assert.ok(reverse < 0.1, `after ${seconds} s at 25°: rolls back the other way at ${reverse.toFixed(2)}`);
  }
});

test('smoothing: sensor jitter neither tilts nor counts as moving; turning the device does', () => {
  const f = new TiltFilter();
  let t = hold(f, [40, 5], 0.5, 0);
  for (let i = 1; i <= 120; i++) {
    const jitter = i % 2 ? 0.4 : -0.4;
    f.update(40 + jitter, 5 - jitter, 0, t + i / 60);
    assert.ok(!f.moving && f.strength === 0, `jitter at ${i}: moving ${f.moving}, strength ${f.strength}`);
  }
  t += 2;
  let moved = false;
  for (let i = 1; i <= 30; i++) {
    f.update(40, 5 + i, 0, t + i / 60); // turning at 60°/s
    moved ||= f.moving;
  }
  assert.ok(moved, 'turning the device counts as moving');
});

test('after a pause (page hidden), it starts again from the current pose', () => {
  const f = new TiltFilter();
  const t = hold(f, [0, 0], 0.5, 0);
  hold(f, [10, 25], 1, t + 30);
  assert.equal(f.strength, 0);
});

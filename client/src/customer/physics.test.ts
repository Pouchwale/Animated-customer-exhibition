import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BubbleWorld, PHYSICS, fieldHeight } from './physics';

const radii = [58, 58, 58, 48, 48, 48, 48, 48, 40, 40, 40];

function crowdedWorld(width = 320) {
  const w = new BubbleWorld();
  w.setSize(width, fieldHeight(width, radii, 280));
  radii.forEach((r, i) => w.upsert(`b${i}`, r));
  return w;
}

/** Smallest gap between any two bubbles — except a trapped one slipping out under the held one. */
function minClearance(w: BubbleWorld) {
  const list = [...w.bodies.values()];
  let min = Infinity;
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (w.passingUnder.get(a.key) === b.key || w.passingUnder.get(b.key) === a.key) continue;
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y) - a.r * a.scale - b.r * b.scale);
    }
  return min;
}

test('bubbles never overlap while floating', () => {
  const w = crowdedWorld();
  for (let i = 0; i < 600; i++) {
    w.step(1 / 60, i / 60, null);
    assert.ok(minClearance(w) > -0.75, `overlap at step ${i}: ${minClearance(w).toFixed(2)}`);
  }
});

test('bubbles stay inside the field', () => {
  const w = crowdedWorld();
  for (let i = 0; i < 600; i++) w.step(1 / 60, i / 60, { x: 160, y: 200, reach: 60, strength: 2600 });
  for (const b of w.bodies.values()) {
    assert.ok(b.x - b.r >= PHYSICS.wall - 0.01 && b.x + b.r <= w.width - PHYSICS.wall + 0.01, `${b.key} x out of bounds`);
    assert.ok(b.y - b.r >= PHYSICS.wall - 0.01 && b.y + b.r <= w.height - PHYSICS.wall + 0.01, `${b.key} y out of bounds`);
  }
});

test('two bubbles on a collision course bounce apart', () => {
  const w = new BubbleWorld();
  w.setSize(600, 300);
  const a = w.upsert('a', 40);
  const b = w.upsert('b', 40);
  Object.assign(a, { x: 200, y: 150, vx: 120, vy: 0 });
  Object.assign(b, { x: 300, y: 150, vx: -120, vy: 0 });
  for (let i = 0; i < 40; i++) w.step(1 / 60, 0, null, false);
  assert.ok(a.vx < 0 && b.vx > 0, `expected rebound, got a.vx=${a.vx.toFixed(1)} b.vx=${b.vx.toFixed(1)}`);
  assert.ok(Math.abs(a.vx) < 120, 'some energy is lost (not perfectly elastic)');
});

test('a held (hovered) bubble stays put when others hit it', () => {
  const w = new BubbleWorld();
  w.setSize(600, 300);
  const held = w.upsert('held', 50);
  const hitter = w.upsert('hitter', 40);
  Object.assign(held, { x: 300, y: 150, vx: 0, vy: 0 });
  Object.assign(hitter, { x: 180, y: 150, vx: 200, vy: 0 });
  w.held.add('held');
  for (let i = 0; i < 60; i++) w.step(1 / 60, 0, null, false);
  assert.ok(Math.hypot(held.x - 300, held.y - 150) < 0.5, 'held bubble moved');
  assert.ok(hitter.vx <= 0, 'hitter bounced back');
});

test('the cursor pushes nearby bubbles away', () => {
  const w = new BubbleWorld();
  w.setSize(600, 300);
  const b = w.upsert('b', 40);
  Object.assign(b, { x: 300, y: 150, vx: 0, vy: 0 });
  for (let i = 0; i < 20; i++) w.step(1 / 60, 0, { x: 260, y: 150, reach: 40, strength: 1200 }, false);
  assert.ok(b.x > 300, 'moved away from the pointer');
});

test('the field grows to fit more bubbles and first placement does not overlap', () => {
  assert.ok(fieldHeight(320, [...radii, 50, 50], 280) > fieldHeight(320, radii, 280));
  const w = crowdedWorld(700); // roomy
  assert.ok(minClearance(w) >= PHYSICS.gap - 0.01, 'initial layout overlaps');
});

test('settle() removes overlaps without ambient motion (reduced motion)', () => {
  const w = new BubbleWorld();
  w.setSize(320, 520);
  radii.forEach((r, i) => {
    const b = w.upsert(`b${i}`, r);
    Object.assign(b, { x: 160, y: 260 }); // all stacked on one point
  });
  w.settle();
  assert.ok(minClearance(w) > -0.5, `still overlapping: ${minClearance(w).toFixed(2)}`);
});

test('dragging moves a bubble anywhere and shoulders neighbours aside', () => {
  const w = new BubbleWorld();
  w.setSize(600, 400);
  const dragged = w.upsert('dragged', 40);
  const other = w.upsert('other', 40);
  Object.assign(dragged, { x: 100, y: 200, vx: 0, vy: 0 });
  Object.assign(other, { x: 300, y: 200, vx: 0, vy: 0 });
  dragged.scale = 1.1;
  for (let i = 0; i < 90; i++) {
    w.drive('dragged', 100 + i * 4, 200); // sweep right, straight through "other"
    w.step(1 / 60, 0, null, false);
    const gap = Math.hypot(dragged.x - other.x, dragged.y - other.y) - 40 * 1.1 - 40;
    assert.ok(gap > -0.75, `overlap while dragging at step ${i}: ${gap.toFixed(2)}`);
  }
  assert.ok(Math.abs(dragged.x - 456) < 10, `dragged bubble followed the pointer, with a slight smoothing lag (x=${dragged.x.toFixed(1)})`);
  assert.ok(Math.abs(other.y - 200) > 30 || other.x > 500, 'the other bubble was pushed out of the way');
});

test('a dropped bubble stays where it is put (no snapping back)', () => {
  const w = new BubbleWorld();
  w.setSize(600, 400);
  const b = w.upsert('b', 40);
  Object.assign(b, { x: 100, y: 100, vx: 0, vy: 0 });
  for (let i = 0; i < 60; i++) {
    w.drive('b', 420, 300);
    w.step(1 / 60, 0, null, false);
  }
  w.release();
  for (let i = 0; i < 120; i++) w.step(1 / 60, 0, null, false);
  assert.ok(Math.hypot(b.x - 420, b.y - 300) < 12, `stayed near the drop point (${b.x.toFixed(0)}, ${b.y.toFixed(0)})`);
});

test('releasing mid-swing throws the bubble, then it glides to a stop', () => {
  const w = new BubbleWorld();
  w.setSize(1200, 400);
  const b = w.upsert('b', 40);
  Object.assign(b, { x: 100, y: 200, vx: 0, vy: 0 });
  for (let i = 0; i < 20; i++) {
    w.drive('b', 100 + i * 8, 200); // ~480 px/s
    w.step(1 / 60, 0, null, false);
  }
  w.release();
  assert.ok(b.vx > 200, `released with momentum (vx=${b.vx.toFixed(0)})`);
  const x0 = b.x;
  for (let i = 0; i < 240; i++) w.step(1 / 60, 0, null, false);
  assert.ok(b.x > x0 + 60, 'glided onward after release');
  assert.ok(Math.hypot(b.vx, b.vy) < 25, 'and came to rest');
});

test('bubbles brought close ease apart into their own space', () => {
  const w = new BubbleWorld();
  w.setSize(600, 400);
  const a = w.upsert('a', 40);
  const b = w.upsert('b', 40);
  Object.assign(a, { x: 260, y: 200, vx: 0, vy: 0 });
  Object.assign(b, { x: 345, y: 200, vx: 0, vy: 0 }); // 85px apart: just past contact (85)
  for (let i = 0; i < 120; i++) w.step(1 / 60, 0, null, false);
  const gap = Math.hypot(a.x - b.x, a.y - b.y) - 80;
  assert.ok(gap > PHYSICS.gap + PHYSICS.personalSpace * 0.6, `eased apart (gap ${gap.toFixed(1)}px)`);
});

test('pushing a bubble into a wall never squeezes them into an overlap', () => {
  const w = new BubbleWorld();
  w.setSize(400, 300);
  const dragged = w.upsert('dragged', 40);
  const pinned = w.upsert('pinned', 40);
  Object.assign(dragged, { x: 200, y: 150, vx: 0, vy: 0 });
  Object.assign(pinned, { x: 340, y: 150, vx: 0, vy: 0 }); // touching the right wall
  for (let i = 0; i < 90; i++) {
    w.drive('dragged', 390, 150); // keep shoving it into the wall
    w.step(1 / 60, 0, null, false);
    const gap = Math.hypot(dragged.x - pinned.x, dragged.y - pinned.y) - 80;
    assert.ok(gap > -1, `overlap at step ${i}: ${gap.toFixed(2)}`);
  }
});

test('a bubble trapped in a corner slips aside so a dragged bubble can take the spot', () => {
  const w = new BubbleWorld();
  w.setSize(400, 300);
  const dragged = w.upsert('dragged', 40);
  const corner = w.upsert('corner', 40);
  Object.assign(dragged, { x: 150, y: 120, vx: 0, vy: 0 });
  Object.assign(corner, { x: 340, y: 240, vx: 0, vy: 0 }); // tucked in the bottom-right corner
  const target = { x: 330, y: 230 };
  for (let i = 0; i < 120; i++) {
    w.drive('dragged', target.x, target.y);
    w.step(1 / 60, 0, null, false);
    const gap = Math.hypot(dragged.x - corner.x, dragged.y - corner.y) - 80;
    // It may slip out underneath the held bubble; otherwise they never overlap.
    if (w.passingUnder.get('corner') !== 'dragged') assert.ok(gap > -1, `overlap at step ${i}: ${gap.toFixed(2)}`);
  }
  assert.ok(
    Math.hypot(dragged.x - target.x, dragged.y - target.y) < 15,
    `dragged bubble reached the corner (${dragged.x.toFixed(0)}, ${dragged.y.toFixed(0)})`,
  );
});

test('dragging straight through a crowded field never causes an overlap anywhere', () => {
  for (const width of [320, 340, 700]) {
    const w = crowdedWorld(width);
    const keys = [...w.bodies.keys()];
    const dragged = keys[0];
    // Sweep a zig-zag through the whole field, including into corners.
    const path: [number, number][] = [];
    for (let i = 0; i <= 240; i++) {
      const t = i / 240;
      path.push([20 + t * (w.width - 40), 20 + Math.abs(Math.sin(t * Math.PI * 3)) * (w.height - 40)]);
    }
    path.forEach(([x, y], i) => {
      w.drive(dragged, x, y);
      w.setScale(dragged, 1.1);
      w.step(1 / 60, i / 60, null);
      assert.ok(minClearance(w) > -1, `width ${width}, step ${i}: overlap ${minClearance(w).toFixed(2)}px`);
    });
  }
});

test('in a packed field, a dragged bubble reaches any spot it is held over, without overlaps', () => {
  const packed = [58, 58, 58, 48, 48, 48, 48, 48, 40, 40, 40, 40];
  for (let run = 0; run < 12; run++) {
    for (const width of [336, 700]) {
      const w = new BubbleWorld();
      w.setSize(width, fieldHeight(width, packed, 420));
      packed.forEach((r, i) => w.upsert(`b${i}`, r));
      for (let i = 0; i < 60 + run * 37; i++) w.step(1 / 60, i / 60, null); // a different layout each run
      const target = { x: w.width * (0.15 + (run % 7) * 0.12), y: w.height * (0.1 + (run % 5) * 0.2) };
      // Up to 4 s: in a field this packed, neighbours squeeze out at a calm pace (no jumps).
      for (let i = 0; i < 240; i++) {
        w.drive('b1', target.x, target.y);
        w.setScale('b1', 1.1);
        w.step(1 / 60, 10 + i / 60, null);
        assert.ok(minClearance(w) > -1, `run ${run}/${width}: overlap at step ${i}`);
      }
      const b = w.bodies.get('b1')!;
      const edge = b.r * 1.1 + PHYSICS.wall;
      const reachable = { x: Math.min(Math.max(target.x, edge), w.width - edge), y: Math.min(Math.max(target.y, edge), w.height - edge) };
      assert.ok(
        Math.hypot(b.x - reachable.x, b.y - reachable.y) < 14,
        `run ${run}/${width}: stopped ${Math.hypot(b.x - reachable.x, b.y - reachable.y).toFixed(0)}px short`,
      );
    }
  }
});

// ---- Device tilt ------------------------------------------------------------------------------

/** iPad landscape field (7 bubbles in the 308 px column). */
function ipadWorld() {
  const sizes = [52, 52, 43, 43, 52, 43, 43];
  const w = new BubbleWorld();
  w.setSize(308, fieldHeight(308, sizes, 420));
  sizes.forEach((r, i) => w.upsert(`b${i}`, r));
  return w;
}

/** Run with a fixed tilt; `each` sees the world after every step. */
function tilted(w: BubbleWorld, tilt: { x: number; y: number } | null, seconds: number, from = 0, each?: (i: number) => void, fps = 60) {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    w.tilt = tilt;
    w.step(1 / fps, from + i / fps, null);
    each?.(i);
  }
  return from + seconds;
}

/** Mean distance of the bubbles from the bottom wall, as a share of the field height. */
const heightShare = (w: BubbleWorld) => [...w.bodies.values()].reduce((s, b) => s + (w.height - b.y) / w.height, 0) / w.bodies.size;

test('tilting rolls the bubbles to the low side', () => {
  for (const [tilt, side] of [
    [{ x: 0, y: 1 }, (w: BubbleWorld, b: { x: number; y: number }) => w.height - b.y],
    [{ x: -1, y: 0 }, (_w: BubbleWorld, b: { x: number; y: number }) => b.x],
    [{ x: 0.7, y: -0.7 }, (w: BubbleWorld, b: { x: number; y: number }) => w.width - b.x + b.y],
  ] as const) {
    const w = ipadWorld();
    const t = tilted(w, null, 2);
    const before = [...w.bodies.values()].reduce((s, b) => s + side(w, b), 0);
    tilted(w, tilt, 3, t);
    const after = [...w.bodies.values()].reduce((s, b) => s + side(w, b), 0);
    assert.ok(after < before * 0.75, `${JSON.stringify(tilt)}: moved toward the low side (${before.toFixed(0)} → ${after.toFixed(0)})`);
  }
  // Downhill: some bubbles rest on the bottom wall.
  const w = ipadWorld();
  tilted(w, { x: 0, y: 1 }, 3);
  const onFloor = [...w.bodies.values()].filter((b) => w.height - b.y - b.r - PHYSICS.wall < 1).length;
  assert.ok(onFloor >= 2, `${onFloor} bubbles on the bottom wall`);
});

test('bubbles never overlap under sustained and changing tilt', () => {
  const tilts = [{ x: 0, y: 1 }, { x: -0.7, y: 0.7 }, { x: 1, y: 0 }, { x: 0.2, y: -0.3 }, { x: 0, y: -1 }, null];
  for (const make of [ipadWorld, () => crowdedWorld(320)]) {
    const w = make();
    let t = 0;
    for (const tilt of tilts) {
      const check = (i: number) =>
        assert.ok(minClearance(w) > -0.75, `overlap with tilt ${JSON.stringify(tilt)} at step ${i}: ${minClearance(w).toFixed(2)}`);
      t = tilted(w, tilt, 2, t, check);
    }
  }
});

test('tilt never moves the dragged bubble', () => {
  const w = ipadWorld();
  let t = tilted(w, null, 1);
  // Held still near the top while everything else rolls down past it.
  const target = { x: 150, y: 90 };
  const key = 'b2';
  for (let i = 0; i < 60; i++) {
    w.drive(key, target.x, target.y);
    w.setScale(key, 1.1);
    w.step(1 / 60, t + i / 60, null);
  }
  t += 1;
  const b = w.bodies.get(key)!;
  t = tilted(w, { x: 0.3, y: 1 }, 3, t, () => {
    w.drive(key, target.x, target.y);
    // (Within a pixel: bubbles brushing past can nudge it a hair, as when level — gravity never does.)
    assert.ok(Math.hypot(b.x - target.x, b.y - target.y) < 1, `dragged bubble moved to (${b.x.toFixed(1)}, ${b.y.toFixed(1)})`);
  });
  // Dragged down into the pile and held there: it stays under the finger, without overlaps.
  const low = { x: 120, y: w.height - 70 };
  tilted(w, { x: 0, y: 1 }, 3, t, (i) => {
    const k = Math.min(1, i / 60);
    w.drive(key, target.x + (low.x - target.x) * k, target.y + (low.y - target.y) * k);
    assert.ok(minClearance(w) > -1, `overlap at step ${i}`);
  });
  assert.ok(Math.hypot(b.x - low.x, b.y - low.y) < 2, `held at the bottom of the pile (${b.x.toFixed(1)}, ${b.y.toFixed(1)})`);
});

test('under tilt, a dragged bubble held down in the pile stays under the finger', () => {
  // Layouts where a bubble squeezing out of a corner used to slide the dragged one 45–97 px away.
  const cases: [{ x: number; y: number }, number][] = [
    [{ x: 0, y: 0.6 }, 9],
    [{ x: 0, y: 0.6 }, 20],
    [{ x: -1, y: 0 }, 10],
    [{ x: -1, y: 0 }, 25],
  ];
  for (const [tilt, run] of cases) {
    const w = ipadWorld();
    let t = 0;
    const step = () => {
      w.tilt = tilt;
      w.step(1 / 60, t, null);
      t += 1 / 60;
    };
    for (let i = 0; i < 90 + run * 13; i++) step(); // a different pile each time
    const key = `b${run % 7}`;
    const b = w.bodies.get(key)!;
    const go = (from: { x: number; y: number }, to: { x: number; y: number }, n: number) => {
      for (let i = 1; i <= n; i++) {
        w.setScale(key, 1.1);
        w.drive(key, from.x + ((to.x - from.x) * i) / n, from.y + ((to.y - from.y) * i) / n);
        step();
      }
    };
    const top = { x: w.width * 0.5, y: w.height * 0.22 };
    const spot = tilt.y ? { x: w.width * 0.4, y: w.height * 0.8 } : { x: w.width * 0.25, y: w.height * 0.5 };
    go({ x: b.x, y: b.y }, top, 60);
    go(top, top, 60);
    go(top, spot, 60 + (run % 3) * 30); // down into the pile
    for (let i = 0; i < 120; i++) {
      go(spot, spot, 1);
      const off = Math.hypot(b.x - spot.x, b.y - spot.y);
      if (i >= 30) assert.ok(off < 5, `${JSON.stringify(tilt)} #${run}, step ${i}: ${off.toFixed(0)} px from the finger`);
    }
  }
});

test('under tilt, a bubble put down from Step 2 lands exactly where it was let go', () => {
  for (const tilt of [
    { x: 0, y: 0.55 },
    { x: -0.55, y: 0 },
  ]) {
    const w = ipadWorld();
    const t = tilted(w, tilt, 3); // piled up
    // Drop it onto the pile (straight onto other bubbles), as dragging a Step 2 row back does.
    const spot = tilt.y ? { x: w.width / 2, y: w.height * 0.75 } : { x: w.width * 0.25, y: w.height / 2 };
    const b = w.bodies.get('b0')!;
    w.place('b0', spot.x, spot.y);
    w.resolve();
    assert.ok(
      Math.hypot(b.x - spot.x, b.y - spot.y) < 0.5,
      `${JSON.stringify(tilt)}: landed ${Math.hypot(b.x - spot.x, b.y - spot.y).toFixed(1)} px away`,
    );
    assert.ok(minClearance(w) > -0.75, 'neighbours made room (or slip out from under it)');
    // It keeps that spot for a moment while the pile makes room…
    let at = tilted(w, tilt, 0.15, t);
    assert.ok(
      Math.hypot(b.x - spot.x, b.y - spot.y) < 0.5,
      `${JSON.stringify(tilt)}: nudged ${Math.hypot(b.x - spot.x, b.y - spot.y).toFixed(1)} px right after landing`,
    );
    // …then it is an ordinary bubble again: it rolls downhill, and nothing stays overlapped.
    const downhill = (q: { x: number; y: number }) => q.x * tilt.x + q.y * tilt.y;
    at = tilted(w, tilt, 3, at);
    assert.ok(downhill(b) >= downhill(spot) - 0.5, 'then rolls on downhill (or rests on the pile)');
    assert.ok(minClearance(w) > -0.75 && w.passingUnder.size === 0, 'all apart again');
  }
});

test('a resting pile is quiet: no hard impacts, no jitter', () => {
  for (const fps of [30, 60, 120]) {
    for (const make of [ipadWorld, () => crowdedWorld(320)]) {
      const w = make();
      const t = tilted(w, { x: 0, y: 1 }, 6, 0, undefined, fps); // settled (a tall pile can still shift once or twice early on)
      const last = new Map([...w.bodies.values()].map((b) => [b.key, { x: b.x, y: b.y }]));
      let hard = 0;
      let moved = 0;
      const measure = () => {
        hard += w.impacts.filter((im) => im.speed > 40).length;
        for (const b of w.bodies.values()) {
          const p = last.get(b.key)!;
          moved = Math.max(moved, Math.hypot(b.x - p.x, b.y - p.y));
          last.set(b.key, { x: b.x, y: b.y });
        }
      };
      tilted(w, { x: 0, y: 1 }, 2, t, measure, fps);
      assert.equal(hard, 0, `${fps} fps, ${w.bodies.size} bubbles: impacts above 40 px/s while resting`);
      assert.ok(moved < 0.25, `${fps} fps, ${w.bodies.size} bubbles: resting bubbles still move ${moved.toFixed(2)} px per frame`);
    }
  }
});

test('level again, a pile spreads back out', () => {
  const w = ipadWorld();
  let t = tilted(w, null, 2);
  const level = heightShare(w);
  t = tilted(w, { x: 0, y: 1 }, 3, t);
  const piled = heightShare(w);
  assert.ok(piled < level - 0.1, `piled up first (${level.toFixed(2)} → ${piled.toFixed(2)})`);
  tilted(w, null, 4, t, (i) => assert.ok(minClearance(w) > -0.75, `overlap while spreading at step ${i}`));
  const spread = heightShare(w);
  assert.ok(
    spread > piled + 0.08 && spread > level - 0.08,
    `spread out again (${piled.toFixed(2)} → ${spread.toFixed(2)}, level ${level.toFixed(2)})`,
  );
});

test('the idle logo gathering ignores tilt', () => {
  const w = ipadWorld();
  w.attractor = { x: w.width / 2, y: w.height / 2, strength: 4 };
  tilted(w, { x: 0, y: 1 }, 4);
  const cy = [...w.bodies.values()].reduce((s, b) => s + b.y, 0) / w.bodies.size;
  assert.ok(Math.abs(cy - w.height / 2) < 30, `gathered around the middle, not at the bottom (mean y ${cy.toFixed(0)} of ${w.height})`);
});

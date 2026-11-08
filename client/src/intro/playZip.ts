/**
 * "Zip opens": the zip pull in the PouchWale logo comes loose, slides across the screen like a
 * real pouch zipper, and the screen opens along that line — POUCH goes up, WALE goes down —
 * revealing the page.
 */
import gsap from 'gsap';
import type { IntroRun } from './types';

interface ZipLogo {
  /** The logo without its zip pull. */
  body: HTMLCanvasElement;
  /** Just the zip pull. */
  tab: HTMLCanvasElement;
  /** Where the pull sits in the logo (natural px) and how much it's tilted (degrees). */
  tabBox: { x: number; y: number; w: number; h: number };
  tilt: number;
  /** The gap between POUCH and WALE (natural px): the zip line. */
  zipY: number;
}

/**
 * Cut the zip pull out of the logo image: it's the separate pink piece between POUCH and WALE.
 * Found by flood-filling from where it sits, so a re-exported logo still works. null if not found.
 */
function splitZipLogo(img: HTMLImageElement): ZipLogo | null {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const src = document.createElement('canvas');
  src.width = W;
  src.height = H;
  const ctx = src.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, W, H);
  const a = image.data;
  const solid = (x: number, y: number) => a[(y * W + x) * 4 + 3] > 24;

  // Search area for the pull (between the two rows of letters, in the middle).
  const x0 = Math.round(W * 0.33);
  const x1 = Math.round(W * 0.5);
  const y0 = Math.round(H * 0.38);
  const y1 = Math.round(H * 0.56);
  let seed: [number, number] | null = null;
  const cx = Math.round(W * 0.418);
  const cy = Math.round(H * 0.47);
  for (let r = 0; r < 40 && !seed; r++) {
    for (let dy = -r; dy <= r && !seed; dy++) {
      for (let dx = -r; dx <= r && !seed; dx++) if (solid(cx + dx, cy + dy)) seed = [cx + dx, cy + dy];
    }
  }
  if (!seed) return null;

  const mask = new Uint8Array(W * H);
  const stack = [seed];
  let minX = W;
  let minY = H;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const i = y * W + x;
    if (mask[i] || !solid(x, y)) continue;
    // Reaching the edge of the search area means it's joined to a letter: not a separate pull.
    if (x <= x0 || x >= x1 || y <= y0 || y >= y1) return null;
    mask[i] = 1;
    count++;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  if (count < 200) return null;

  // Tilt of the pull from its shape (principal axis).
  const mx = sx / count;
  const my = sy / count;
  const tilt = (0.5 * Math.atan2(2 * (sxy / count - mx * my), sxx / count - mx * mx - (syy / count - my * my)) * 180) / Math.PI;

  // The pull alone.
  const pad = 2;
  const tabBox = { x: minX - pad, y: minY - pad, w: maxX - minX + 1 + pad * 2, h: maxY - minY + 1 + pad * 2 };
  const tab = document.createElement('canvas');
  tab.width = tabBox.w;
  tab.height = tabBox.h;
  const tctx = tab.getContext('2d');
  const piece = tctx?.createImageData(tabBox.w, tabBox.h);
  // The logo without it (and its soft edge).
  for (let y = tabBox.y; y < tabBox.y + tabBox.h; y++) {
    for (let x = tabBox.x; x < tabBox.x + tabBox.w; x++) {
      const i = y * W + x;
      const near = mask[i] || mask[i - 1] || mask[i + 1] || mask[i - W] || mask[i + W];
      if (!near) continue;
      if (mask[i] && piece) {
        const j = ((y - tabBox.y) * tabBox.w + (x - tabBox.x)) * 4;
        for (let c = 0; c < 4; c++) piece.data[j + c] = a[i * 4 + c];
      }
      a[i * 4 + 3] = 0;
    }
  }
  if (piece) tctx!.putImageData(piece, 0, 0);
  ctx.putImageData(image, 0, 0);

  // The zip line: middle of the empty band between the two rows of letters.
  let best = { start: -1, len: 0 };
  let run = { start: -1, len: 0 };
  for (let y = Math.round(H * 0.4); y < Math.round(H * 0.62); y++) {
    let empty = true;
    for (let x = 0; x < W && empty; x += 2) if (a[(y * W + x) * 4 + 3] > 24) empty = false;
    if (empty) {
      if (run.start < 0) run = { start: y, len: 0 };
      run.len++;
      if (run.len > best.len) best = { ...run };
    } else run = { start: -1, len: 0 };
  }
  const zipY = best.len > 0 ? best.start + best.len / 2 : my;

  return { body: src, tab, tabBox, tilt, zipY };
}

const TOOTH = 8; // px between zip teeth
const TOOTH_DEPTH = 3.5;
const SEAM = 1;

export function playZip(el: HTMLElement, run: IntroRun, logo: HTMLImageElement) {
  const q = gsap.utils.selector(el);
  const halves = q('[data-intro="half"]') as HTMLElement[];
  const bodies = q('[data-intro="zip-body"]') as HTMLCanvasElement[];
  const taglines = q('[data-intro="tagline"]') as HTMLElement[];
  const full = el.querySelector<HTMLImageElement>('[data-intro="zip-full"]');
  const tabEl = el.querySelector<HTMLCanvasElement>('[data-intro="zip-tab"]');
  const track = el.querySelector<SVGSVGElement>('[data-intro="zip-track"]');
  const edges = track ? [...track.querySelectorAll('polyline')] : [];
  if (halves.length !== 2 || !full || !tabEl || !track) return run.finish();

  const split = splitZipLogo(logo);
  const W = logo.naturalWidth;
  const H = logo.naturalHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // ---- Layout: logo a little above centre, tagline under it ----
  const lw = Math.min(vw * 0.72, 600, vh * 0.5 * (W / H));
  const lh = (lw * H) / W;
  const s = lw / W;
  const left = (vw - lw) / 2;
  const top = vh * 0.44 - lh / 2;
  const zipY = top + (split?.zipY ?? H * 0.5) * s;
  for (const c of [full, ...bodies]) {
    Object.assign(c.style, { left: `${left}px`, top: `${top}px`, width: `${lw}px`, height: `${lh}px` });
  }
  for (const c of bodies) {
    c.width = Math.round(lw * dpr);
    c.height = Math.round(lh * dpr);
    const g = c.getContext('2d');
    g?.drawImage(split?.body ?? logo, 0, 0, c.width, c.height);
  }
  for (const t of taglines) t.style.top = `${top + lh + Math.min(vw * 0.03, 20)}px`;

  // The pull: cut from the logo, or a plain pink pull if the logo has none to cut.
  const tabW = split ? split.tabBox.w * s : lw * 0.09;
  const tabH = split ? split.tabBox.h * s : lw * 0.03;
  tabEl.width = Math.round(tabW * dpr);
  tabEl.height = Math.round(tabH * dpr);
  Object.assign(tabEl.style, { width: `${tabW}px`, height: `${tabH}px` });
  const tg = tabEl.getContext('2d');
  if (tg && split) tg.drawImage(split.tab, 0, 0, tabEl.width, tabEl.height);
  else if (tg) {
    tg.fillStyle = '#fe4587';
    tg.beginPath();
    tg.roundRect(0, 0, tabEl.width, tabEl.height, tabEl.height / 2);
    tg.fill();
  }
  const home = split
    ? { x: left + (split.tabBox.x + split.tabBox.w / 2) * s, y: top + (split.tabBox.y + split.tabBox.h / 2) * s }
    : { x: vw / 2, y: zipY };
  const tab = { x: home.x, y: home.y, rot: 0, scale: 1 };
  const zip = { front: -1e6, open: 0 };

  const drawTab = () => {
    tabEl.style.transform = `translate3d(${(tab.x - tabW / 2).toFixed(2)}px, ${(tab.y - tabH / 2).toFixed(2)}px, 0) rotate(${tab.rot.toFixed(2)}deg) scale(${tab.scale.toFixed(3)})`;
  };

  /** Both halves' zip edges: interlocking teeth, opened into a V behind the pull. */
  const drawZip = () => {
    const topPts: string[] = [];
    const botPts: string[] = [];
    const n = Math.ceil(vw / TOOTH);
    const lift = zip.open * (zipY + vh * 0.7);
    const drop = zip.open * (vh - zipY + vh * 0.7);
    for (let i = n; i >= 0; i--) {
      const x = Math.min(vw, i * TOOTH);
      const tooth = (i % 2 ? 1 : -1) * TOOTH_DEPTH;
      const gap = x < zip.front ? Math.min((zip.front - x) * 0.6, vh * 1.6) : 0;
      // The halves overlap by a hair, so no seam shows while the zip is closed.
      topPts.push(`${x.toFixed(1)}px ${(zipY + tooth - gap / 2 + SEAM).toFixed(1)}px`);
      botPts.push(`${x.toFixed(1)}px ${(zipY + tooth + gap / 2 - SEAM).toFixed(1)}px`);
    }
    halves[0].style.clipPath = `polygon(0px 0px, ${vw}px 0px, ${topPts.join(', ')})`;
    halves[1].style.clipPath = `polygon(0px ${vh}px, ${vw}px ${vh}px, ${botPts.join(', ')})`;
    halves[0].style.transform = `translate3d(0, ${(-lift).toFixed(1)}px, 0)`;
    halves[1].style.transform = `translate3d(0, ${drop.toFixed(1)}px, 0)`;
    const toSvg = (pts: string[], dy: number) =>
      pts
        .map((p) => {
          const [x, y] = p.split(' ').map((v) => parseFloat(v));
          return `${x},${(y + dy).toFixed(1)}`;
        })
        .join(' ');
    edges[0]?.setAttribute('points', toSvg(topPts, -lift));
    edges[1]?.setAttribute('points', toSvg(botPts, drop));
    drawTab();
  };
  drawZip();

  const tl = gsap.timeline({ onUpdate: drawZip, onComplete: run.finish });
  // 1. The whole logo springs in; the tagline rises under it.
  tl.fromTo(full, { autoAlpha: 0, scale: 0.45, rotate: -7, y: 14 }, { autoAlpha: 1, scale: 1, rotate: 0, y: 0, duration: 0.8, ease: 'back.out(1.8)' }, 0.15)
    .call(run.reveal, [], 0.3)
    .to('[data-intro="char"]', { y: '0%', duration: 0.5, ease: 'power3.out', stagger: 0.022 }, 0.65)
    .to('[data-intro="skip"]', { opacity: 1, duration: 0.25 }, 0.65)

    // 2. The pull comes loose (the logo stays, minus its pull) and the zipper appears.
    .addLabel('unzip', 1.35)
    .set(bodies, { autoAlpha: 1 }, 'unzip')
    .set(full, { autoAlpha: 0 }, 'unzip')
    .set(tabEl, { autoAlpha: 1 }, 'unzip')
    .to(tab, { y: zipY, rot: -(split?.tilt ?? 0), scale: 1.3, duration: 0.32, ease: 'back.out(2.4)' }, 'unzip')
    .to(track, { opacity: 1, duration: 0.25 }, 'unzip')

    // 3. It slides to the left end, then runs right, opening the zip behind it.
    .to(tab, { x: Math.max(tabW * 0.7, 24), duration: 0.42, ease: 'power2.inOut' }, 'unzip+=0.32')
    .set(zip, { front: Math.max(tabW * 0.7, 24) }, 'unzip+=0.74')
    .to(tab, { x: vw + tabW, duration: 0.85, ease: 'power1.in' }, 'unzip+=0.74')
    .to(zip, { front: vw + tabW, duration: 0.85, ease: 'power1.in' }, 'unzip+=0.74')

    // 4. Both halves fly apart: POUCH up, WALE down.
    .addLabel('fly', 'unzip+=1.55')
    .set('[data-intro="skip"]', { autoAlpha: 0 }, 'fly')
    .to(zip, { open: 1, duration: 0.55, ease: 'power3.in' }, 'fly');

  run.skipRef.current = () => {
    if (tl.time() < tl.labels.fly) tl.seek('fly');
  };
}

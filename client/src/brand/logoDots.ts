/**
 * The PouchWale logo as a grid of dots: shared by the intro ("Logo from bubbles") and the
 * idle logo mode, so both draw the logo the same way.
 */

export const LOGO_SRC = '/logo-pink.png';
export const BRAND_PINK: [number, number, number] = [254, 69, 135];

/** Dot count scales with the logo's size: chunky dots on a small area, finer ones on a big screen. */
const MIN_DOTS = 900;
const MAX_DOTS = 2600;

let logoImage: Promise<HTMLImageElement> | null = null;

/** The logo image, loaded once. */
export function loadLogo(): Promise<HTMLImageElement> {
  logoImage ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      logoImage = null;
      reject(new Error('Logo image failed to load'));
    };
    img.src = LOGO_SRC;
  });
  return logoImage;
}

interface LogoBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Dot centres on a grid over the logo's filled pixels, with the logo centred in a
 * width × height area (or placed in `box` when given).
 */
export function logoSpots(img: HTMLImageElement, width: number, height: number, box?: LogoBox) {
  const aspect = img.naturalWidth / img.naturalHeight;
  const w = box?.w ?? Math.min(width * 0.88, height * 0.8 * aspect, 980);
  const h = box?.h ?? w / aspect;
  const at = box ?? { x: (width - w) / 2, y: (height - h) / 2, w, h };
  const dots = Math.min(MAX_DOTS, Math.max(MIN_DOTS, (w * h) / 30));
  const step = Math.max(2.6, Math.sqrt((w * h * 0.55) / dots));
  const cols = Math.ceil(w / step);
  const rows = Math.ceil(h / step);
  const scratch = document.createElement('canvas');
  scratch.width = cols;
  scratch.height = rows;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { spots: [], dot: 0, box: at };
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, cols, rows);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const left = at.x + (w - cols * step) / 2;
  const top = at.y + (h - rows * step) / 2;
  const spots: { x: number; y: number }[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (data[(y * cols + x) * 4 + 3] > 110) spots.push({ x: left + (x + 0.5) * step, y: top + (y + 0.5) * step });
    }
  }
  return { spots, dot: step * 0.48, box: at };
}

/** A bubble face's fill colour as [r, g, b] (brand pink if it can't be read). */
export function faceColour(face: Element | null | undefined): [number, number, number] {
  const m = face ? getComputedStyle(face).backgroundColor.match(/\d+(\.\d+)?/g) : null;
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : BRAND_PINK;
}

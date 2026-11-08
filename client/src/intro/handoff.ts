/**
 * Hand-off from the intro to the page: intro bubbles fly to the real Step 1 bubbles, which stay
 * hidden until the intro ones land exactly on top of them.
 */

/** Selector for every Step 1 bubble face on the page. */
export const FACE = '[data-body] [data-bubble-face]';
/** Class on <html> while the intro hands over to the page (the Step 1 bubbles are hidden; see index.css). */
export const HIDE_CLASS = 'intro-handoff';

/** Hide (or show again) the page's Step 1 bubbles while intro bubbles fly to them. */
export function hideFieldBubbles(hidden: boolean) {
  document.documentElement.classList.toggle(HIDE_CLASS, hidden);
}

/**
 * The Step 1 bubble faces, once they're on the page (they load from the API).
 * Resolves with [] if they don't show up in time. Check which are on screen with
 * `onScreen` when the hand-off starts (they pop in with a little animation first).
 */
export function waitForBubbles(timeoutMs: number): Promise<HTMLElement[]> {
  return new Promise((resolve) => {
    const started = performance.now();
    let last = -1;
    const check = () => {
      const faces = [...document.querySelectorAll<HTMLElement>(FACE)];
      if (faces.length > 0 && faces.length === last) return resolve(faces);
      last = faces.length;
      if (performance.now() - started > timeoutMs) return resolve([]);
      window.setTimeout(check, 60);
    };
    check();
  });
}

/** The faces that are on screen (and have their full size) right now. */
export function onScreen(faces: HTMLElement[]) {
  return faces.filter((f) => {
    if (!f.isConnected) return false;
    const r = f.getBoundingClientRect();
    return r.width > 8 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  });
}

/** Where a face is right now (viewport px): centre and diameter. */
export function faceSpot(face: HTMLElement) {
  const r = face.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, d: r.width };
}

/**
 * An exact copy of a bubble face for the intro to fly. Positioned by `placeClone`
 * (centre + diameter), so it lines up with the real one pixel for pixel when it lands.
 */
export function makeClone(face: HTMLElement, parent: HTMLElement) {
  const clone = face.cloneNode(true) as HTMLElement;
  clone.removeAttribute('data-bubble-face');
  clone.setAttribute('aria-hidden', 'true');
  clone.style.position = 'absolute';
  clone.style.left = '0';
  clone.style.top = '0';
  clone.style.margin = '0';
  clone.style.transformOrigin = '50% 50%';
  clone.style.willChange = 'transform, opacity';
  clone.style.zIndex = '80';
  clone.style.opacity = '0';
  parent.appendChild(clone);
  return { el: clone, size: face.offsetWidth || face.getBoundingClientRect().width };
}

export function placeClone(clone: { el: HTMLElement; size: number }, x: number, y: number, d: number, opacity = 1) {
  const s = d / clone.size;
  clone.el.style.transform = `translate3d(${(x - clone.size / 2).toFixed(2)}px, ${(y - clone.size / 2).toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
  clone.el.style.opacity = opacity.toFixed(3);
}

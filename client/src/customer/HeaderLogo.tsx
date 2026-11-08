/**
 * The customer page header logo. Its colour cycles through the brand colourways that read on the white header
 * (pink → blue → orange, the same colours as the design system's assets/brand logos). The logo artwork is used as a
 * mask over one block of colour and only that colour animates (`.pw-logo-cycle` in index.css): a single element, no
 * image swaps, so it never fades, flickers or jumps. Pink only for reduced-motion users.
 */
export function HeaderLogo() {
  // About 20% bigger than before (h-9 / sm:h-11). Very short windows (≤740px tall, e.g. a 1280×720 laptop) keep
  // the old 44px so the page still fits one screen there. The box keeps the artwork's ratio (1894×802).
  return (
    <span
      role="img"
      aria-label="PouchWale"
      className="pw-logo-cycle block aspect-[1894/802] h-11 shrink-0 sm:h-[52px] [@media(max-height:740px)]:sm:h-11"
    />
  );
}

/**
 * "Someone is using the screen" without touching it (e.g. tilting the iPad).
 * Idle features (ghost-hand demo, idle logo, kiosk auto-reset) listen for it
 * alongside touches, clicks and keys.
 */
export const ACTIVITY_EVENT = 'pw:activity';

export function signalActivity() {
  window.dispatchEvent(new Event(ACTIVITY_EVENT));
}

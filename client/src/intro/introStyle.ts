/**
 * Which intro animation plays. The admin picks one style, or "rotate" (each load shows the
 * next of the new styles). `?intro=<style>` plays a given style (the admin Preview links).
 */
import { ROTATING_INTROS, isIntroChoice as isChoice, isIntroStyle as isStyle, type IntroChoice, type IntroStyle } from '@pw/shared';
import { publicApi } from '../api/client';

const SETTING_KEY = 'pw-intro-setting';
const TURN_KEY = 'pw-intro-turn';
/** Never hold the intro up for the network: past this, use the last known setting. */
const FETCH_TIMEOUT_MS = 700;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the setting is simply re-read next time.
  }
}

/** The admin's current choice (falls back to the last one seen, then to "rotate"). */
async function currentChoice(): Promise<IntroChoice> {
  const fetched = publicApi
    .intro()
    .then((s) => {
      if (isChoice(s.style)) write(SETTING_KEY, s.style);
      return s.style;
    })
    .catch(() => null);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
  const style = await Promise.race([fetched, timeout]);
  if (isChoice(style)) return style;
  const saved = read(SETTING_KEY);
  return isChoice(saved) ? saved : 'rotate';
}

/** The style to play now. */
export async function pickIntroStyle(): Promise<IntroStyle> {
  const forced = new URLSearchParams(window.location.search).get('intro');
  if (isStyle(forced)) return forced;
  const choice = await currentChoice();
  if (choice !== 'rotate') return choice;
  const turn = Number(read(TURN_KEY)) || 0;
  write(TURN_KEY, String((turn + 1) % ROTATING_INTROS.length));
  return ROTATING_INTROS[turn % ROTATING_INTROS.length];
}

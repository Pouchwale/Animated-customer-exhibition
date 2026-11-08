import { useEffect } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { armSound, setSoundOn, soundSupported, useSoundOn } from './sound';

/** Sound on/off button for the page header. On by default; hidden without Web Audio. */
export function SoundToggle() {
  const on = useSoundOn();
  // On for every visitor: page load, and kiosk "Start over" (which remounts the page). Audio itself
  // starts with the first touch, click or key.
  useEffect(() => armSound(), []);
  if (!soundSupported()) return null;
  const label = on ? 'Sound on' : 'Sound off';
  const Icon = on ? Volume2 : VolumeX;
  return (
    <button
      type="button"
      // A toggle: a fixed name, with aria-pressed saying on or off (the visible text still reads "Sound on/off").
      aria-pressed={on}
      aria-label="Sound"
      // Switched on inside the tap itself: iPad Safari only starts audio from a user gesture.
      onClick={() => setSoundOn(!on)}
      className="pw-btn pw-btn-ghost !py-1.5 whitespace-nowrap aria-pressed:bg-pw-yellow-tint max-lg:!px-3"
    >
      <Icon className="size-4" aria-hidden />
      {/* Icon only below lg (phones, iPad portrait): the header is crowded there. */}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

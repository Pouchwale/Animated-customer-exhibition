import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Lock } from 'lucide-react';
import { INTRO_CHOICES, type IntroChoice, type IntroSettings } from '@pw/shared';
import { adminApi } from '../api/client';
import { useAsync } from './useCrud';
import { ErrorNotice, Loading, SaveBar, SectionHeader, useAdmin } from './ui';

const loadIntro = () => adminApi.intro.get();

const CHOICES: Record<IntroChoice, { title: string; text: string }> = {
  rotate: { title: 'Take turns', text: 'Each load shows the next of the three new intros.' },
  pouches: { title: 'Pouches become the bubbles', text: 'The orbiting pouches turn into the Step 1 bubbles and fly to their places.' },
  dots: { title: 'Logo from bubbles', text: 'Coloured dots form the logo, then pour into the Step 1 bubbles.' },
  zip: { title: 'Zip opens', text: 'The zip pull in the logo slides across and the screen opens along it.' },
  tagline: { title: 'Logo to tagline', text: 'The tear tab lifts out of the logo and underlines "Fueling brand growth through innovative pouches".' },
  classic: { title: 'Classic orbit', text: 'The original: pouches orbit the logo, then a circle closes onto it.' },
};

/** Which intro animation plays when the page loads (or a visitor taps Start over). */
export function IntroSection() {
  const { user, notify, reportError } = useAdmin();
  const isAdmin = user.role === 'ADMIN';
  const { items: saved, setData, loading, error, reload } = useAsync<IntroSettings | null>(loadIntro, null);
  const [style, setStyle] = useState<IntroChoice>('rotate');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (saved) setStyle(saved.style);
  }, [saved]);

  if (loading) return <Loading text="Loading intro setting…" />;
  if (error || !saved) return <ErrorNotice text={error ?? 'Could not load the intro setting.'} onRetry={() => void reload()} />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      setData(await adminApi.intro.save({ style }));
      notify('Intro saved. It plays from the next page load.');
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  const changed = style !== saved.style;
  return (
    <section>
      <SectionHeader title="Intro animation" description="Plays every time the customer page loads, and when a visitor taps Start over." />

      {!isAdmin && (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-pw-blue-tint/40 px-3 py-2 text-sm font-bold">
          <Lock className="size-4" /> Only admins can change the intro.
        </p>
      )}

      <form onSubmit={submit} className="max-w-2xl space-y-3 rounded-2xl border-2 border-ink bg-paper p-4 shadow-stamp-sm sm:p-6">
        <div role="radiogroup" aria-label="Intro animation" className="space-y-2">
          {INTRO_CHOICES.map((choice) => {
            const active = style === choice;
            return (
              <div
                key={choice}
                className={`flex flex-wrap items-center gap-3 rounded-xl border-2 px-3 py-2.5 transition-colors duration-[140ms] ${
                  active ? 'border-ink bg-pw-yellow-tint' : 'border-ink/15'
                }`}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={!isAdmin}
                  onClick={() => setStyle(choice)}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                >
                  <span
                    aria-hidden
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-ink ${active ? 'bg-ink' : 'bg-paper'}`}
                  >
                    {active && <span className="size-2 rounded-full bg-pw-yellow" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-extrabold">{CHOICES[choice].title}</span>
                    <span className="block text-xs font-semibold text-ink-2">{CHOICES[choice].text}</span>
                  </span>
                </button>
                {choice !== 'rotate' && (
                  <a href={`/?intro=${choice}`} target="_blank" rel="noopener" className="pw-btn-quiet shrink-0" aria-label={`Preview ${CHOICES[choice].title}`}>
                    <ExternalLink className="size-3.5" /> Preview
                  </a>
                )}
              </div>
            );
          })}
        </div>
        {isAdmin && <SaveBar saving={saving} disabled={!changed} onCancel={changed ? () => setStyle(saved.style) : undefined} />}
      </form>
    </section>
  );
}

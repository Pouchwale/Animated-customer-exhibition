import { useEffect, useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { IDLE_LOGO_LIMITS, TRANSITION_SPEEDS, type IdleLogoSettings, type TransitionSpeed } from '@pw/shared';
import { adminApi } from '../api/client';
import { useAsync } from './useCrud';
import { ErrorNotice, Field, Loading, NumberInput, SaveBar, SectionHeader, Toggle, useAdmin } from './ui';

const loadSettings = () => adminApi.idleLogo.get();

const SPEED_LABELS: Record<TransitionSpeed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };

/** Problems with the form, by field (checked before saving; the API checks again). */
function check(s: IdleLogoSettings): Partial<Record<keyof IdleLogoSettings, string>> {
  const errors: Partial<Record<keyof IdleLogoSettings, string>> = {};
  const { idleMinutes, formSeconds, holdSeconds } = IDLE_LOGO_LIMITS;
  if (!(s.idleMinutes >= idleMinutes.min && s.idleMinutes <= idleMinutes.max))
    errors.idleMinutes = `Between ${idleMinutes.min} and ${idleMinutes.max} minutes`;
  if (!(s.formSeconds >= formSeconds.min && s.formSeconds <= formSeconds.max))
    errors.formSeconds = `Between ${formSeconds.min} and ${formSeconds.max} seconds`;
  if (!(Number.isInteger(s.holdSeconds) && s.holdSeconds >= holdSeconds.min && s.holdSeconds <= holdSeconds.max))
    errors.holdSeconds = `Whole seconds, ${holdSeconds.min} to ${holdSeconds.max}`;
  return errors;
}

/** Idle logo mode: when the kiosk is left alone, the bubbles form the PouchWale logo. */
export function IdleLogoTab() {
  const { user, notify, reportError } = useAdmin();
  const isAdmin = user.role === 'ADMIN';
  const { items: saved, setData, loading, error, reload } = useAsync<IdleLogoSettings | null>(loadSettings, null);
  const [draft, setDraft] = useState<IdleLogoSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => setDraft(saved), [saved]);

  if (loading) return <Loading text="Loading idle logo settings…" />;
  if (error || !saved || !draft) return <ErrorNotice text={error ?? 'Could not load the settings.'} onRetry={() => void reload()} />;

  const errors = check(draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof IdleLogoSettings>(key: K, value: IdleLogoSettings[K]) => setDraft({ ...draft, [key]: value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!draft || Object.keys(check(draft)).length) return;
    setSaving(true);
    try {
      const next = await adminApi.idleLogo.save(draft);
      setData(next);
      setTried(false);
      notify('Idle logo settings saved. Open kiosks pick them up within a minute.');
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (key: keyof IdleLogoSettings) => (tried && errors[key] ? <span className="text-pw-pink-shade">{errors[key]}</span> : undefined);
  const off = !isAdmin || !draft.enabled;

  return (
    <section>
      <SectionHeader
        title="Idle logo"
        description="When nobody touches the screen for a while, the bubbles drift together and form the PouchWale logo. The first touch scatters them and the page works as normal."
      />

      {!isAdmin && (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-pw-blue-tint/40 px-3 py-2 text-sm font-bold">
          <Lock className="size-4" /> Only admins can change these settings.
        </p>
      )}

      <form onSubmit={submit} noValidate className="max-w-2xl space-y-5 rounded-2xl border-2 border-ink bg-paper p-4 shadow-stamp-sm sm:p-6">
        <Toggle checked={draft.enabled} onChange={(v) => set('enabled', v)} label="Idle logo mode" disabled={!isAdmin} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Idle time (minutes)" hint={fieldError('idleMinutes') ?? 'No touch for this long, then the logo forms. 0.5 = 30 seconds.'}>
            <NumberInput
              value={draft.idleMinutes}
              onChange={(v) => set('idleMinutes', v)}
              min={IDLE_LOGO_LIMITS.idleMinutes.min}
              max={IDLE_LOGO_LIMITS.idleMinutes.max}
              step={0.5}
              disabled={off}
            />
          </Field>

          <Field label="Animation duration (seconds)" hint={fieldError('formSeconds') ?? 'How long the bubbles take to gather and form the logo.'}>
            <NumberInput
              value={draft.formSeconds}
              onChange={(v) => set('formSeconds', v)}
              min={IDLE_LOGO_LIMITS.formSeconds.min}
              max={IDLE_LOGO_LIMITS.formSeconds.max}
              step={0.5}
              disabled={off}
            />
          </Field>

          <Field
            label="Logo stays for (seconds)"
            hint={fieldError('holdSeconds') ?? 'Then it turns back into bubbles. 0 = until someone touches the screen.'}
          >
            <NumberInput
              value={draft.holdSeconds}
              onChange={(v) => set('holdSeconds', v)}
              min={IDLE_LOGO_LIMITS.holdSeconds.min}
              max={IDLE_LOGO_LIMITS.holdSeconds.max}
              step={1}
              disabled={off}
            />
          </Field>

          <div>
            <span className="pw-label" id="transition-speed">
              Transition speed
            </span>
            <div role="radiogroup" aria-labelledby="transition-speed" className="flex gap-1.5">
              {TRANSITION_SPEEDS.map((speed) => {
                const active = draft.transitionSpeed === speed;
                return (
                  <button
                    key={speed}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={off}
                    onClick={() => set('transitionSpeed', speed)}
                    className={`min-h-11 flex-1 rounded-full border-2 border-ink px-3 text-sm font-extrabold transition-colors duration-[140ms] disabled:opacity-50 ${
                      active ? 'bg-ink text-paper' : 'bg-paper text-ink hover:bg-pw-yellow-tint'
                    }`}
                  >
                    {SPEED_LABELS[speed]}
                  </button>
                );
              })}
            </div>
            <span className="mt-1 block text-xs font-semibold text-ink-2">How fast the bubbles scatter on touch and come back.</span>
          </div>
        </div>

        {isAdmin && <SaveBar saving={saving} disabled={!changed} onCancel={changed ? () => (setDraft(saved), setTried(false)) : undefined} />}
      </form>
    </section>
  );
}

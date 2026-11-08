import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Check, Loader2, X } from 'lucide-react';
import type { AdminUser } from '@pw/shared';
import { ApiRequestError } from '../api/client';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Turns any thrown value into readable text, including API validation details. */
export function errorText(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const details = Array.isArray(err.details)
      ? (err.details as Array<{ path?: unknown; message?: unknown }>)
          .map((d) => [d.path, d.message].filter(Boolean).join(': '))
          .filter(Boolean)
      : [];
    return details.length ? `${err.message} — ${details.join('; ')}` : err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

// ---------------------------------------------------------------------------
// Admin context: current user, toasts, auth loss
// ---------------------------------------------------------------------------

type ToastKind = 'success' | 'error';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface AdminContextValue {
  user: AdminUser;
  notify: (text: string, kind?: ToastKind) => void;
  /** Shows the error as a toast; a 401 sends the user back to the login screen. */
  reportError: (err: unknown) => void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used inside <AdminProvider>');
  return ctx;
}

export function AdminProvider({
  user,
  onAuthLost,
  children,
}: {
  user: AdminUser;
  onAuthLost: () => void;
  children: ReactNode;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const notify = useCallback(
    (text: string, kind: ToastKind = 'success') => {
      const id = nextId.current++;
      setToasts((ts) => [...ts.slice(-3), { id, kind, text }]);
      window.setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3000);
    },
    [dismiss],
  );

  const reportError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiRequestError && err.status === 401) {
        onAuthLost();
        return;
      }
      notify(errorText(err), 'error');
    },
    [notify, onAuthLost],
  );

  return (
    <AdminContext.Provider value={{ user, notify, reportError }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex max-w-lg items-start gap-2 rounded-xl border-2 border-ink px-4 py-2.5 text-sm font-bold shadow-stamp ${
              t.kind === 'error' ? 'bg-pw-orange text-paper' : 'bg-pw-yellow text-ink'
            }`}
          >
            {t.kind === 'error' ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            ) : (
              <Check className="mt-0.5 size-4 shrink-0" />
            )}
            <span className="flex-1">{t.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="shrink-0">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </AdminContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Form primitives
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="pw-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs font-semibold text-ink-2">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-sm font-bold text-ink disabled:opacity-50"
    >
      <span
        className={`relative inline-block h-6 w-11 rounded-full border-2 border-ink transition-colors duration-[140ms] ${
          checked ? 'bg-pw-blue' : 'bg-paper'
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full border-2 border-ink bg-paper transition-[left] duration-[140ms] ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </span>
      {label}
    </button>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  id,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <input
      id={id}
      type="number"
      className="pw-input"
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => {
        const n = e.target.value === '' ? 0 : Number(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
    />
  );
}

/** Two-step destructive button: first click asks, second click runs. */
export function ConfirmButton({
  onConfirm,
  label,
  question,
  icon,
  disabled,
}: {
  onConfirm: () => Promise<void> | void;
  label: string;
  question: string;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!asking) return;
    const t = window.setTimeout(() => setAsking(false), 6000);
    return () => window.clearTimeout(t);
  }, [asking]);

  if (!asking) {
    return (
      <button type="button" className="pw-btn-quiet hover:text-pw-orange-shade" disabled={disabled} onClick={() => setAsking(true)}>
        {icon}
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-xl bg-pw-orange-tint px-2 py-1 text-xs font-bold text-ink">
      {question}
      <button
        type="button"
        className="rounded-full border-2 border-ink bg-pw-orange px-2.5 py-0.5 text-paper disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {busy ? 'Deleting…' : 'Yes, delete'}
      </button>
      <button type="button" className="underline" onClick={() => setAsking(false)} disabled={busy}>
        Cancel
      </button>
    </span>
  );
}

export function SaveBar({
  saving,
  onCancel,
  submitLabel = 'Save',
  disabled,
}: {
  saving: boolean;
  onCancel?: () => void;
  submitLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <button type="submit" className="pw-btn pw-btn-primary" disabled={saving || disabled}>
        {saving && <Loader2 className="size-4 animate-spin" />}
        {saving ? 'Saving…' : submitLabel}
      </button>
      {onCancel && (
        <button type="button" className="pw-btn pw-btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      )}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="pw-display text-2xl sm:text-3xl">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm font-semibold text-ink-2">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm font-bold text-ink-2">
      <Loader2 className="size-4 animate-spin" />
      {text}
    </div>
  );
}

export function ErrorNotice({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-ink bg-pw-orange-tint px-4 py-3 text-sm font-bold">
      <AlertTriangle className="size-4" />
      <span className="flex-1">{text}</span>
      {onRetry && (
        <button type="button" className="pw-btn pw-btn-ghost" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-ink/40 px-4 py-8 text-center text-sm font-bold text-ink-2">
      {children}
    </div>
  );
}

/** White form panel used for create/edit. */
export function FormPanel({ title, children, onSubmit }: { title: string; children: ReactNode; onSubmit: () => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="rounded-2xl border-2 border-ink bg-paper p-4 shadow-stamp sm:p-5"
    >
      <h3 className="pw-display mb-4 text-xl">{title}</h3>
      <div className="space-y-4">{children}</div>
    </form>
  );
}

export const colorBg: Record<string, string> = {
  yellow: 'bg-pw-yellow',
  pink: 'bg-pw-pink',
  blue: 'bg-pw-blue',
  orange: 'bg-pw-orange',
};

export function Chip({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'on' | 'off' | 'blue' }) {
  const tones = {
    plain: 'bg-paper text-ink',
    on: 'bg-pw-yellow text-ink',
    off: 'bg-ink/5 text-ink-2 border-ink/30',
    blue: 'bg-pw-blue text-paper',
  };
  return (
    <span className={`inline-flex items-center rounded-full border-2 border-ink px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Up/down arrows that move an item in a list (topics, recommendation parameters and their options, the "Try it" ranking). */
export function MoveButtons({
  label,
  first,
  last,
  disabled,
  onMove,
}: {
  label: string;
  first: boolean;
  last: boolean;
  disabled?: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <span className="inline-flex">
      <button
        type="button"
        className="pw-btn-quiet !px-2"
        disabled={first || disabled}
        onClick={() => onMove(-1)}
        aria-label={`Move ${label} up`}
        title="Move up"
      >
        <ArrowUp className="size-3.5" />
      </button>
      <button
        type="button"
        className="pw-btn-quiet !px-2"
        disabled={last || disabled}
        onClick={() => onMove(1)}
        aria-label={`Move ${label} down`}
        title="Move down"
      >
        <ArrowDown className="size-3.5" />
      </button>
    </span>
  );
}

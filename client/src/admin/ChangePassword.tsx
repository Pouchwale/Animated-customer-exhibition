import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, CircleCheck, KeyRound, Loader2, X } from 'lucide-react';
import { PASSWORD_RULES, passwordProblems } from '@pw/shared';
import { adminApi, ApiRequestError } from '../api/client';
import { errorText, useAdmin } from './ui';

/** Header button: opens the Change password dialog (every role can change their own password). */
export function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={opener} type="button" className="pw-btn pw-btn-ghost !py-1.5" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <KeyRound className="size-4" />
        {/* Icon only on phones (the name stays for screen readers). */}
        <span className="sr-only sm:not-sr-only">Change password</span>
      </button>
      {open && (
        <ChangePasswordDialog
          onClose={() => {
            setOpen(false);
            opener.current?.focus();
          }}
        />
      )}
    </>
  );
}

interface Errors {
  current?: string;
  next?: string[];
  confirm?: string;
  /** Anything not tied to one field (too many attempts, network…). */
  form?: string;
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const { user, notify, reportError } = useAdmin();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [done, setDone] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  useEffect(() => currentRef.current?.focus(), []);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const close = () => {
    if (busy) return;
    if (done) notify('Password changed.');
    onClose();
  };

  // Esc closes; Tab stays inside the dialog.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>('input:not([hidden]), button')].filter((el) => !el.hasAttribute('disabled'));
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    // Check here first for instant, specific messages (the API checks the same rules again).
    const found: Errors = {};
    if (!current) found.current = 'Enter your current password.';
    const problems = passwordProblems(next, user.email);
    if (next && next === current) problems.push('Choose a password different from your current one.');
    if (problems.length) found.next = problems;
    if (!confirm) found.confirm = 'Type the new password again.';
    else if (confirm !== next) found.confirm = 'The two new passwords do not match.';
    setErrors(found);
    if (found.current) return currentRef.current?.focus();
    if (found.next) return nextRef.current?.focus();
    if (found.confirm) return confirmRef.current?.focus();

    setBusy(true);
    try {
      await adminApi.changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        reportError(err); // session ended: back to the sign-in screen
        return;
      }
      const details = err instanceof ApiRequestError && Array.isArray(err.details) ? (err.details as Array<{ path?: string; message?: string }>) : [];
      const onField = (path: string) => details.filter((d) => d.path === path && d.message).map((d) => d.message!);
      const server: Errors = {};
      if (onField('currentPassword').length) server.current = onField('currentPassword')[0];
      if (onField('newPassword').length) server.next = onField('newPassword');
      if (!server.current && !server.next) server.form = errorText(err);
      setErrors(server);
      if (server.current) {
        setCurrent('');
        currentRef.current?.focus();
      } else if (server.next) nextRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const longEnough = next.trim().length >= PASSWORD_RULES.minLength;
  const differs = next.length > 0 && next !== current;
  const matches = confirm.length > 0 && confirm === next;
  const type = show ? 'text' : 'password';

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-ink/45 p-4" onKeyDown={onKeyDown}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        className="my-auto w-full max-w-md rounded-2xl border-2 border-ink bg-paper p-5 shadow-stamp-lg sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="pw-eyebrow text-pw-pink">{user.email}</p>
            <h2 id="change-password-title" className="pw-display mt-1 text-3xl">
              Change password
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label="Close"
            className="-m-1 flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-ink/5"
          >
            <X className="size-5" />
          </button>
        </div>

        {done ? (
          <div className="mt-5">
            <p role="status" className="flex items-start gap-2 rounded-xl border-2 border-ink bg-pw-yellow px-3 py-3 text-sm font-bold">
              <CircleCheck className="mt-0.5 size-4 shrink-0" />
              <span>
                Your password has been changed. Use the new password next time you sign in. Any other device signed in to this account has been signed
                out.
              </span>
            </p>
            <button ref={doneRef} type="button" className="pw-btn pw-btn-primary mt-5 w-full" onClick={close}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="mt-4">
            {/* Lets password managers save the new password for the right account. */}
            <input type="email" name="username" autoComplete="username" value={user.email} readOnly hidden />

            {errors.form && (
              <p role="alert" className="mb-4 flex items-start gap-2 rounded-xl border-2 border-ink bg-pw-orange-tint px-3 py-2 text-sm font-bold">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {errors.form}
              </p>
            )}

            <div className="space-y-4">
              <div>
                <label className="block">
                  <span className="pw-label">Current password</span>
                  <input
                    ref={currentRef}
                    className="pw-input"
                    type={type}
                    name="current-password"
                    autoComplete="current-password"
                    value={current}
                    maxLength={200}
                    aria-invalid={!!errors.current}
                    aria-describedby={errors.current ? 'cp-current-error' : undefined}
                    onChange={(e) => {
                      setCurrent(e.target.value);
                      setErrors((x) => ({ ...x, current: undefined, form: undefined }));
                    }}
                  />
                </label>
                {errors.current && <FieldError id="cp-current-error">{errors.current}</FieldError>}
              </div>

              <div>
                <label className="block">
                  <span className="pw-label">New password</span>
                  <input
                    ref={nextRef}
                    className="pw-input"
                    type={type}
                    name="new-password"
                    autoComplete="new-password"
                    value={next}
                    maxLength={200}
                    aria-invalid={!!errors.next}
                    aria-describedby={errors.next ? 'cp-rules cp-next-error' : 'cp-rules'}
                    onChange={(e) => {
                      setNext(e.target.value);
                      setErrors((x) => ({ ...x, next: undefined, form: undefined }));
                    }}
                  />
                </label>
                <ul id="cp-rules" className="mt-2 space-y-1 text-xs font-bold" aria-label="Password rules">
                  <Rule met={longEnough}>At least {PASSWORD_RULES.minLength} characters</Rule>
                  <Rule met={differs}>Different from your current password</Rule>
                </ul>
                {errors.next && (
                  <FieldError id="cp-next-error">
                    {errors.next.map((m) => (
                      <span key={m} className="block">
                        {m}
                      </span>
                    ))}
                  </FieldError>
                )}
              </div>

              <div>
                <label className="block">
                  <span className="pw-label">Confirm new password</span>
                  <input
                    ref={confirmRef}
                    className="pw-input"
                    type={type}
                    name="confirm-password"
                    autoComplete="new-password"
                    value={confirm}
                    maxLength={200}
                    aria-invalid={!!errors.confirm}
                    aria-describedby={errors.confirm ? 'cp-confirm-error' : undefined}
                    onChange={(e) => {
                      setConfirm(e.target.value);
                      setErrors((x) => ({ ...x, confirm: undefined, form: undefined }));
                    }}
                  />
                </label>
                {errors.confirm ? (
                  <FieldError id="cp-confirm-error">{errors.confirm}</FieldError>
                ) : (
                  confirm.length > 0 && (
                    <ul className="mt-2 text-xs font-bold">
                      <Rule met={matches}>{matches ? 'Passwords match' : 'Passwords do not match yet'}</Rule>
                    </ul>
                  )
                )}
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-ink-2">
                <input type="checkbox" className="size-4 accent-ink" checked={show} onChange={(e) => setShow(e.target.checked)} />
                Show passwords
              </label>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button type="submit" className="pw-btn pw-btn-primary flex-1" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                {busy ? 'Changing…' : 'Change password'}
              </button>
              <button type="button" className="pw-btn pw-btn-ghost" onClick={close} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Rule({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-1.5 ${met ? 'text-ink' : 'text-ink-3'}`}>
      {met ? (
        <Check className="size-3.5 text-pw-blue-shade" aria-hidden />
      ) : (
        <span aria-hidden className="mx-[3px] size-2 rounded-full border-2 border-current" />
      )}
      <span>
        {children}
        <span className="sr-only">{met ? ' (done)' : ' (not yet)'}</span>
      </span>
    </li>
  );
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <span id={id} role="alert" className="mt-1.5 block text-xs font-bold text-pw-pink-shade">
      {children}
    </span>
  );
}

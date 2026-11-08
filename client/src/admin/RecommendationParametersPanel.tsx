import { useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Lock, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import {
  RATING_LIMITS,
  TEXT_LIMITS,
  slugify,
  type OptionRatingsInput,
  type Parameter,
  type SuggestionOption,
  type SuggestionOptionDraft,
  type SuggestionParameter,
  type SuggestionParameterDraft,
} from '@pw/shared';
import { adminApi } from '../api/client';
import { Chip, ConfirmButton, EmptyState, ErrorNotice, Field, FormPanel, Loading, MoveButtons, SaveBar, Toggle, useAdmin } from './ui';

const byOrder = <T extends { sortOrder: number }>(xs: T[]) => [...xs].sort((a, b) => a.sortOrder - b.sortOrder);

/** Move item at `index` by `dir` and renumber sortOrder 1..n. */
function moved<T extends { id: string; sortOrder: number }>(xs: T[], index: number, dir: -1 | 1): T[] {
  const next = [...xs];
  const [item] = next.splice(index, 1);
  next.splice(index + dir, 0, item);
  return next.map((x, i) => ({ ...x, sortOrder: i + 1 }));
}

interface Props {
  parameters: SuggestionParameter[];
  setParameters: (update: (xs: SuggestionParameter[]) => SuggestionParameter[]) => void;
  /** Priority topics (customer bubbles), sorted by priority index. */
  topics: Parameter[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Recommendation parameters (e.g. Print Type), their options, and each option's 1–5 star rating and reason per topic. */
export function RecommendationParametersPanel({ parameters, setParameters, topics, loading, error, reload }: Props) {
  const { user, notify, reportError } = useAdmin();
  const isAdmin = user.role === 'ADMIN';
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = byOrder(parameters);
  const replace = (p: SuggestionParameter) => setParameters((xs) => xs.map((x) => (x.id === p.id ? { ...p, options: byOrder(p.options) } : x)));
  const toggleExpanded = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function save(draft: SuggestionParameterDraft, id?: string) {
    try {
      if (id) {
        const saved = await adminApi.suggestionParameters.update(id, draft);
        replace(saved);
        notify(`Saved "${saved.name}"`);
      } else {
        const saved = await adminApi.suggestionParameters.create(draft);
        setParameters((xs) => [...xs, { ...saved, options: byOrder(saved.options ?? []) }]);
        setExpanded((s) => new Set(s).add(saved.id));
        notify(`Added "${saved.name}" — now add its options`);
      }
      setEditing(null);
    } catch (err) {
      reportError(err);
      throw err;
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const before = list;
    const next = moved(list, index, dir);
    setParameters(() => next);
    setBusyId(list[index].id);
    try {
      const saved = await adminApi.suggestionParameters.reorder(next.map((p) => p.id));
      setParameters(() => saved.map((p) => ({ ...p, options: byOrder(p.options) })));
    } catch (err) {
      setParameters(() => before);
      reportError(err);
    } finally {
      setBusyId(null);
    }
  }

  async function setEnabled(p: SuggestionParameter, enabled: boolean) {
    setBusyId(p.id);
    try {
      replace(await adminApi.suggestionParameters.update(p.id, { enabled }));
      notify(enabled ? `"${p.name}" is recommended again` : `"${p.name}" is no longer recommended`);
    } catch (err) {
      reportError(err);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(p: SuggestionParameter) {
    try {
      await adminApi.suggestionParameters.remove(p.id);
      setParameters((xs) => xs.filter((x) => x.id !== p.id));
      notify(`Deleted "${p.name}"`);
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h3 className="pw-display text-xl">Parameters &amp; options</h3>
        {isAdmin && editing !== 'new' && (
          <button type="button" className="pw-btn pw-btn-primary" onClick={() => setEditing('new')}>
            <Plus className="size-4" /> Add parameter
          </button>
        )}
      </div>

      {!isAdmin && (
        <p className="mb-5 flex items-center gap-2 rounded-xl bg-pw-blue-tint px-3 py-2 text-sm font-bold">
          <Lock className="size-4" /> Only admins can change recommendations.
        </p>
      )}

      {editing === 'new' && (
        <div className="mb-6">
          <ParameterForm onSave={(d) => save(d)} onCancel={() => setEditing(null)} />
        </div>
      )}

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice text={error} onRetry={reload} />
      ) : list.length === 0 ? (
        <EmptyState>No recommendation parameters yet. Add one, such as “Print Type”, then add its options.</EmptyState>
      ) : (
        <ol className="space-y-3">
          {list.map((p, i) =>
            editing === p.id ? (
              <li key={p.id}>
                <ParameterForm initial={p} onSave={(d) => save(d, p.id)} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={p.id} className={`rounded-2xl border-2 border-ink bg-paper ${p.enabled ? '' : 'opacity-75'}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <span
                    className="pw-display flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-pw-yellow text-lg"
                    title={`Position ${i + 1}`}
                  >
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(p.id)}
                    aria-expanded={expanded.has(p.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {expanded.has(p.id) ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="font-extrabold">{p.name}</span>
                      <span className="text-xs font-semibold text-ink-3">{p.key}</span>
                      <span className="text-xs font-bold text-ink-2">
                        {p.options.length} option{p.options.length === 1 ? '' : 's'}
                      </span>
                      {!p.enabled && <Chip tone="off">Hidden</Chip>}
                    </span>
                  </button>

                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-1">
                      <Toggle
                        checked={p.enabled}
                        disabled={busyId === p.id}
                        onChange={(v) => setEnabled(p, v)}
                        label={p.enabled ? 'Shown' : 'Hidden'}
                      />
                      <MoveButtons
                        label={p.name}
                        disabled={busyId !== null}
                        first={i === 0}
                        last={i === list.length - 1}
                        onMove={(dir) => move(i, dir)}
                      />
                      <button type="button" className="pw-btn-quiet" onClick={() => setEditing(p.id)}>
                        <Pencil className="size-3.5" /> Edit
                      </button>
                      <ConfirmButton
                        label="Delete"
                        icon={<Trash2 className="size-3.5" />}
                        question={`Delete “${p.name}” and its ${p.options.length} option${p.options.length === 1 ? '' : 's'}?`}
                        onConfirm={() => remove(p)}
                      />
                    </div>
                  )}
                </div>

                {p.description && <p className="-mt-1 px-4 pb-3 pl-16 text-sm font-semibold text-ink-2">{p.description}</p>}

                {expanded.has(p.id) && <OptionsEditor param={p} topics={topics} isAdmin={isAdmin} onParamChange={replace} />}
              </li>
            ),
          )}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parameter form
// ---------------------------------------------------------------------------

function ParameterForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: SuggestionParameter;
  onSave: (draft: SuggestionParameterDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || null,
        enabled,
        ...(initial ? {} : { key: key.trim() || undefined }),
      });
    } catch {
      /* shown as a toast */
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPanel title={initial ? `Edit ${initial.name}` : 'New recommendation parameter'} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            className="pw-input"
            required
            maxLength={TEXT_LIMITS.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Print Type"
          />
        </Field>
        {initial ? (
          <Field label="Key" hint="Fixed once created.">
            <input className="pw-input" value={initial.key} disabled />
          </Field>
        ) : (
          <Field label="Key (optional)" hint="Used internally. Can’t be changed later.">
            <input
              className="pw-input"
              maxLength={TEXT_LIMITS.key}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={name.trim() ? slugify(name) : 'print-type'}
            />
          </Field>
        )}
      </div>

      <Field label="Description (optional)" hint="For your team only.">
        <input className="pw-input" maxLength={TEXT_LIMITS.description} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <Toggle checked={enabled} onChange={setEnabled} label={enabled ? 'Recommended to customers' : 'Hidden from customers'} />

      <SaveBar saving={saving} onCancel={onCancel} submitLabel={initial ? 'Save parameter' : 'Add parameter'} disabled={!name.trim()} />
    </FormPanel>
  );
}

// ---------------------------------------------------------------------------
// Options editor
// ---------------------------------------------------------------------------

function OptionsEditor({
  param,
  topics,
  isAdmin,
  onParamChange,
}: {
  param: SuggestionParameter;
  topics: Parameter[];
  isAdmin: boolean;
  onParamChange: (p: SuggestionParameter) => void;
}) {
  const { notify, reportError } = useAdmin();
  const options = byOrder(param.options);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [scoring, setScoring] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);

  const withOptions = (opts: SuggestionOption[]) => onParamChange({ ...param, options: opts });

  async function add() {
    const label = newLabel.trim();
    if (!label || adding) return;
    setAdding(true);
    try {
      const o = await adminApi.suggestionParameters.addOption(param.id, { label, description: null, enabled: true });
      withOptions([...options, o]);
      setNewLabel('');
      setScoring(o.id);
      notify(`Added “${o.label}” to ${param.name} — now rate it on each priority`);
    } catch (err) {
      reportError(err);
    } finally {
      setAdding(false);
    }
  }

  async function update(o: SuggestionOption, patch: Partial<SuggestionOptionDraft>) {
    setBusy(o.id);
    try {
      const saved = await adminApi.suggestionParameters.updateOption(o.id, patch);
      withOptions(options.map((x) => (x.id === o.id ? saved : x)));
      return true;
    } catch (err) {
      reportError(err);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = moved(options, index, dir);
    withOptions(next);
    setBusy(options[index].id);
    try {
      onParamChange(
        await adminApi.suggestionParameters.reorderOptions(
          param.id,
          next.map((o) => o.id),
        ),
      );
    } catch (err) {
      withOptions(options);
      reportError(err);
    } finally {
      setBusy(null);
    }
  }

  async function remove(o: SuggestionOption) {
    try {
      await adminApi.suggestionParameters.removeOption(o.id);
      withOptions(options.filter((x) => x.id !== o.id).map((x, i) => ({ ...x, sortOrder: i + 1 })));
      notify(`Deleted “${o.label}”`);
    } catch (err) {
      reportError(err);
    }
  }

  const onAddKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void add();
    }
  };

  return (
    <div className="border-t-2 border-ink/10 px-4 py-3">
      {options.length === 0 ? (
        <p className="py-2 text-sm font-bold text-ink-2">No options yet{isAdmin ? ' — add the first one below.' : '.'}</p>
      ) : (
        <ol className="divide-y-2 divide-ink/5">
          {options.map((o, i) => {
            const rated = [...o.ratings].filter((r) => r.stars > 0).sort((a, b) => b.stars - a.stars);
            const nameOf = (key: string) => topics.find((t) => t.key === key)?.name ?? key;
            return (
              <li key={o.id} className="py-2">
                {editing === o.id ? (
                  <OptionEditRow
                    option={o}
                    busy={busy === o.id}
                    onSave={async (patch) => {
                      if (await update(o, patch)) setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="w-6 shrink-0 text-right text-sm font-extrabold tabular-nums text-ink-3">{i + 1}.</span>
                    <span className="min-w-0 flex-1">
                      <span className={`font-bold ${o.enabled ? '' : 'text-ink-3 line-through decoration-ink/30'}`}>{o.label}</span>
                      {!o.enabled && <span className="ml-2 text-xs font-bold text-ink-3">Never recommended</span>}
                      {o.description && <span className="block text-xs font-semibold text-ink-2">{o.description}</span>}
                      {rated.length === 0 ? (
                        <span className="block text-xs font-bold italic text-pw-orange-shade">Not rated yet — it can’t be recommended.</span>
                      ) : (
                        <span className="mt-1 flex flex-wrap gap-1" aria-label={`${o.label} ratings`}>
                          {rated.map((r) => (
                            <span
                              key={r.topicKey}
                              title={r.reason ?? 'No reason yet'}
                              className={[
                                'inline-flex items-center gap-0.5 rounded-full border-2 px-1.5 py-px text-[11px] font-extrabold',
                                r.reason ? 'border-ink/15' : 'border-dashed border-pw-orange/60',
                              ].join(' ')}
                            >
                              {nameOf(r.topicKey)} <span className="tabular-nums">{r.stars}</span>
                              <Star className="size-3 fill-pw-yellow text-ink" aria-hidden />
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        className="pw-btn-quiet"
                        aria-expanded={scoring === o.id}
                        onClick={() => setScoring((s) => (s === o.id ? null : o.id))}
                      >
                        <Star className="size-3.5" /> {isAdmin ? 'Ratings' : 'View ratings'}
                      </button>
                      {isAdmin && (
                        <>
                          <Toggle
                            checked={o.enabled}
                            disabled={busy === o.id}
                            onChange={(v) => void update(o, { enabled: v })}
                            label={o.enabled ? 'Shown' : 'Hidden'}
                          />
                          <MoveButtons
                            label={o.label}
                            disabled={busy !== null}
                            first={i === 0}
                            last={i === options.length - 1}
                            onMove={(dir) => move(i, dir)}
                          />
                          <button type="button" className="pw-btn-quiet" onClick={() => setEditing(o.id)}>
                            <Pencil className="size-3.5" /> Edit
                          </button>
                          <ConfirmButton
                            label="Delete"
                            icon={<Trash2 className="size-3.5" />}
                            question={`Delete “${o.label}”?`}
                            onConfirm={() => remove(o)}
                          />
                        </>
                      )}
                    </span>
                  </div>
                )}
                {scoring === o.id && (
                  <RatingsEditor
                    option={o}
                    topics={topics}
                    readOnly={!isAdmin}
                    busy={busy === o.id}
                    onSave={async (ratings) => {
                      if (await update(o, { ratings })) {
                        setScoring(null);
                        notify(`Saved the ratings for “${o.label}”`);
                      }
                    }}
                    onCancel={() => setScoring(null)}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {isAdmin && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="w-6 shrink-0 text-right text-sm font-extrabold tabular-nums text-ink-3">{options.length + 1}.</span>
          <input
            className="pw-input min-w-0 flex-1"
            maxLength={TEXT_LIMITS.label}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={onAddKey}
            placeholder={`New ${param.name} option, e.g. ${param.key.includes('print') ? 'Digital Printing' : 'Option name'}`}
            aria-label={`New ${param.name} option`}
          />
          <button type="button" className="pw-btn pw-btn-ghost" onClick={() => void add()} disabled={!newLabel.trim() || adding}>
            {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add option
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The option's ratings: for every priority topic, 1–5 stars (× = not rated, so it doesn't count for it) and
 * the reason customers see next to the stars. Save stores them all; Cancel discards the changes.
 */
function RatingsEditor({
  option,
  topics,
  readOnly,
  busy,
  onSave,
  onCancel,
}: {
  option: SuggestionOption;
  topics: Parameter[];
  readOnly: boolean;
  busy: boolean;
  onSave: (ratings: OptionRatingsInput) => Promise<void>;
  onCancel: () => void;
}) {
  type Draft = Record<string, { stars: number; reason: string }>;
  const initial: Draft = Object.fromEntries(option.ratings.map((r) => [r.topicKey, { stars: r.stars, reason: r.reason ?? '' }]));
  const [draft, setDraft] = useState<Draft>(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  // Active topics, plus a hidden topic it is still rated on.
  const rows = topics.filter((t) => t.active || draft[t.key]?.stars);
  const set = (key: string, patch: Partial<Draft[string]>) =>
    setDraft((d) => ({ ...d, [key]: { ...(d[key] ?? { stars: 0, reason: '' }), ...patch } }));

  return (
    <form
      className="mt-2 ml-9 rounded-xl border-2 border-ink/15 bg-pw-yellow-tint/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(Object.fromEntries(Object.entries(draft).map(([k, r]) => [k, { stars: r.stars, reason: r.reason.trim() || null }])));
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      {!readOnly && (
        <p className="mb-2 text-xs font-semibold text-ink-2">
          How well “{option.label}” serves each priority, and why: customers see the stars and your reason. Add, rename or reorder the priorities in{' '}
          <a href="#parameters" className="underline">
            Priority topics
          </a>
          .
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm font-bold text-ink-2">No active priority topics yet — add them in the Priority topics tab.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-extrabold uppercase tracking-wide text-ink-3">
              <th className="pb-1.5 font-extrabold">Priority</th>
              <th className="pb-1.5 font-extrabold">Stars</th>
              <th className="w-full pb-1.5 pl-3 font-extrabold">Why — customers see this</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const r = draft[t.key] ?? { stars: 0, reason: '' };
              return (
                <tr key={t.key} className="border-t border-ink/10">
                  <td className="py-1.5 pr-3 font-bold whitespace-nowrap">
                    {t.name}
                    {!t.active && <span className="block text-[11px] font-semibold text-ink-3">hidden topic</span>}
                  </td>
                  <td className="py-1.5">
                    <StarPicker
                      label={`${option.label} on ${t.name}`}
                      value={r.stars}
                      disabled={readOnly}
                      onChange={(stars) => set(t.key, { stars })}
                    />
                  </td>
                  <td className="py-1.5 pl-3">
                    <input
                      className="pw-input !py-1.5"
                      value={r.reason}
                      maxLength={RATING_LIMITS.reasonMax}
                      disabled={readOnly || r.stars === 0}
                      placeholder={r.stars ? 'e.g. Lowest cost per pouch on big runs' : 'Rate it first'}
                      aria-label={`Why ${option.label} gets ${r.stars} stars for ${t.name}`}
                      onChange={(e) => set(t.key, { reason: e.target.value })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {!readOnly && (
          <button type="submit" className="pw-btn pw-btn-primary" disabled={busy || !dirty}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save ratings
          </button>
        )}
        <button type="button" className="pw-btn pw-btn-ghost" onClick={onCancel} disabled={busy}>
          <X className="size-4" /> {readOnly ? 'Close' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}

/** 1–5 stars; × clears it (not rated). */
function StarPicker({ label, value, disabled, onChange }: { label: string; value: number; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <span role="radiogroup" aria-label={label} className="flex items-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          disabled={disabled}
          onClick={() => onChange(n)}
          className="rounded-full p-0.5 disabled:cursor-default"
        >
          <Star className={`size-5 ${n <= value ? 'fill-pw-yellow text-ink' : 'fill-transparent text-ink/25'}`} strokeWidth={2} />
        </button>
      ))}
      {!disabled && (
        <button
          type="button"
          className="ml-0.5 rounded-full p-1 text-ink-3 hover:bg-ink/5 disabled:opacity-30"
          disabled={value === 0}
          onClick={() => onChange(0)}
          aria-label="Not rated"
          title="Not rated"
        >
          <X className="size-3.5" />
        </button>
      )}
    </span>
  );
}

function OptionEditRow({
  option,
  busy,
  onSave,
  onCancel,
}: {
  option: SuggestionOption;
  busy: boolean;
  onSave: (patch: { label: string; description: string | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(option.label);
  const [description, setDescription] = useState(option.description ?? '');
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (label.trim()) void onSave({ label: label.trim(), description: description.trim() || null });
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <Field label="Option" className="min-w-40 flex-1">
        <input className="pw-input" required maxLength={TEXT_LIMITS.label} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
      </Field>
      <Field label="Note (optional)" className="min-w-40 flex-[2]">
        <input className="pw-input" maxLength={TEXT_LIMITS.description} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <button type="submit" className="pw-btn pw-btn-primary" disabled={busy || !label.trim()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
      </button>
      <button type="button" className="pw-btn pw-btn-ghost" onClick={onCancel} disabled={busy}>
        <X className="size-4" /> Cancel
      </button>
    </form>
  );
}

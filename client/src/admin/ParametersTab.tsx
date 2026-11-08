import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { BRAND_COLORS, PARAMETER_CATEGORIES, TEXT_LIMITS, slugify, type Parameter } from '@pw/shared';
import { adminApi } from '../api/client';
import { useCrud } from './useCrud';
import {
  Chip,
  colorBg,
  ConfirmButton,
  EmptyState,
  ErrorNotice,
  Field,
  FormPanel,
  Loading,
  MoveButtons,
  NumberInput,
  SaveBar,
  SectionHeader,
  Toggle,
  useAdmin,
} from './ui';

type Draft = Omit<Parameter, 'id'>;

const SIZE_LABELS: Record<1 | 2 | 3, string> = { 1: 'Small', 2: 'Medium', 3: 'Large' };

const emptyDraft = (sortOrder: number): Draft => ({
  key: '',
  name: '',
  description: '',
  category: 'quality',
  size: 2,
  color: 'yellow',
  sortOrder,
  active: true,
});

export function ParametersTab() {
  const crud = useCrud(adminApi.parameters);
  const { user, notify, reportError } = useAdmin();
  // Deleting a topic also deletes its star ratings and reasons: admins only (editors can hide it instead).
  const canDelete = user.role === 'ADMIN';
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [moving, setMoving] = useState(false);

  const sorted = [...crud.items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const nextSort = sorted.length ? Math.max(...sorted.map((p) => p.sortOrder)) + 1 : 1;

  /** Move a topic up/down and renumber the whole priority list 1..n. */
  async function move(index: number, dir: -1 | 1) {
    const next = [...sorted];
    const [item] = next.splice(index, 1);
    next.splice(index + dir, 0, item);
    setMoving(true);
    try {
      for (const [i, p] of next.entries()) {
        if (p.sortOrder !== i + 1) await crud.update(p.id, { sortOrder: i + 1 });
      }
    } catch (err) {
      reportError(err);
      void crud.reload();
    } finally {
      setMoving(false);
    }
  }

  async function save(draft: Draft, id?: string) {
    try {
      const body = {
        ...draft,
        name: draft.name.trim(),
        description: draft.description?.trim() || null,
      };
      if (id) {
        // Key is immutable after creation.
        const { key: _key, ...rest } = body;
        void _key;
        await crud.update(id, rest);
        notify(`Saved "${body.name}"`);
      } else {
        await crud.create({ ...body, key: body.key.trim() || slugify(body.name) });
        notify(`Added "${body.name}" — customers can now rank it`);
      }
      setEditing(null);
    } catch (err) {
      reportError(err);
      throw err;
    }
  }

  return (
    <section>
      <SectionHeader
        title="Priority topics"
        description="The topics customers rank, one by one, in order of importance (Price, MOQ, Delivery Type…). Each is a bubble on the customer page; only active topics are shown. The number is the topic's position in this list."
        action={
          editing !== 'new' && (
            <button type="button" className="pw-btn pw-btn-primary" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Add topic
            </button>
          )
        }
      />

      {editing === 'new' && (
        <div className="mb-6">
          <ParameterForm initial={emptyDraft(nextSort)} isNew onSave={(d) => save(d)} onCancel={() => setEditing(null)} />
        </div>
      )}

      {crud.loading ? (
        <Loading />
      ) : crud.error ? (
        <ErrorNotice text={crud.error} onRetry={crud.reload} />
      ) : sorted.length === 0 ? (
        <EmptyState>No priority topics yet. Add the first one so customers can rank it.</EmptyState>
      ) : (
        <ul className="divide-y-2 divide-ink/10 rounded-2xl border-2 border-ink">
          {sorted.map((p, index) =>
            editing === p.id ? (
              <li key={p.id} className="p-3 sm:p-4">
                <ParameterForm initial={p} onSave={(d) => save(d, p.id)} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="pw-display flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-pw-yellow text-base tabular-nums" title={`Position ${index + 1}`}>
                  {index + 1}
                </span>
                <span
                  aria-hidden
                  className={`shrink-0 rounded-full border-2 border-ink ${colorBg[p.color]} ${
                    p.size === 3 ? 'size-8' : p.size === 2 ? 'size-6' : 'size-4'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-extrabold">{p.name}</span>
                    <code className="rounded bg-ink/5 px-1.5 py-0.5 text-xs font-bold text-ink-2">{p.key}</code>
                    {!p.active && <Chip tone="off">Hidden</Chip>}
                  </div>
                  {p.description && <p className="mt-0.5 truncate text-xs font-semibold text-ink-2">{p.description}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-ink-2">
                  <Chip>{p.category}</Chip>
                  <Chip>{SIZE_LABELS[p.size]}</Chip>
                </div>
                <div className="flex items-center gap-1">
                  <MoveButtons label={p.name} disabled={moving} first={index === 0} last={index === sorted.length - 1} onMove={(dir) => move(index, dir)} />
                  <button type="button" className="pw-btn-quiet" onClick={() => setEditing(p.id)}>
                    <Pencil className="size-3.5" /> Edit
                  </button>
                  {canDelete && (
                    <ConfirmButton
                      label="Delete"
                      icon={<Trash2 className="size-3.5" />}
                      question={`Delete "${p.name}" for good? This also permanently deletes every star rating and reason for this topic. To keep them, hide it instead (Edit → Hidden).`}
                      onConfirm={async () => {
                        try {
                          await crud.remove(p.id);
                          notify(`Deleted "${p.name}"`);
                        } catch (err) {
                          reportError(err);
                        }
                      }}
                    />
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function ParameterForm({
  initial,
  isNew,
  onSave,
  onCancel,
}: {
  initial: Draft;
  isNew?: boolean;
  onSave: (draft: Draft) => Promise<void>;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>({ ...initial, description: initial.description ?? '' });
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  return (
    <FormPanel
      title={isNew ? 'New priority topic' : `Edit ${initial.name}`}
      onSubmit={async () => {
        setSaving(true);
        try {
          await onSave(d);
        } catch {
          /* error already shown */
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            className="pw-input"
            required
            maxLength={TEXT_LIMITS.name}
            value={d.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Special Colour"
          />
        </Field>
        {isNew ? (
          <Field label="Key" hint="Links the topic to its star ratings in Recommendations. Cannot be changed later.">
            <input
              className="pw-input font-mono"
              maxLength={TEXT_LIMITS.key}
              pattern="[a-z0-9-]+"
              title="Lowercase letters, numbers and dashes"
              value={d.key}
              onChange={(e) => set('key', e.target.value.toLowerCase())}
              placeholder={d.name.trim() ? slugify(d.name) : 'auto from name'}
            />
          </Field>
        ) : (
          <Field label="Key" hint="Keys are fixed once created.">
            <input className="pw-input font-mono" value={d.key} disabled />
          </Field>
        )}
      </div>

      <Field label="Description" hint="Optional. Shown as a tooltip on the bubble.">
        <input
          className="pw-input"
          maxLength={TEXT_LIMITS.description}
          value={d.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Category">
          <select className="pw-input" value={d.category} onChange={(e) => set('category', e.target.value as Draft['category'])}>
            {PARAMETER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bubble size">
          <select className="pw-input" value={d.size} onChange={(e) => set('size', Number(e.target.value) as 1 | 2 | 3)}>
            {([1, 2, 3] as const).map((s) => (
              <option key={s} value={s}>
                {SIZE_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Position" hint="Lower numbers appear first. Use the arrows in the list to reorder.">
          <NumberInput value={d.sortOrder} min={0} onChange={(v) => set('sortOrder', Math.round(v))} />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <div>
          <span className="pw-label">Bubble colour</span>
          <div className="flex gap-2" role="radiogroup" aria-label="Bubble colour">
            {BRAND_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={d.color === c}
                aria-label={c}
                title={c}
                onClick={() => set('color', c)}
                className={`size-9 rounded-full border-2 border-ink ${colorBg[c]} transition-transform duration-[140ms] ${
                  d.color === c ? 'scale-110 shadow-stamp-sm ring-2 ring-ink ring-offset-2' : 'hover:scale-105'
                }`}
              />
            ))}
          </div>
        </div>
        <Toggle checked={d.active} onChange={(v) => set('active', v)} label={d.active ? 'Visible to customers' : 'Hidden'} />
      </div>

      <SaveBar saving={saving} onCancel={onCancel} submitLabel={isNew ? 'Add topic' : 'Save changes'} />
    </FormPanel>
  );
}

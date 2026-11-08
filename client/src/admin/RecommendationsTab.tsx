import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlaskConical, Plus, RotateCcw, Star, X } from 'lucide-react';
import { recommend, type Parameter, type SuggestionParameter } from '@pw/shared';
import { adminApi } from '../api/client';
import { useAsync } from './useCrud';
import { RecommendationParametersPanel } from './RecommendationParametersPanel';
import { MoveButtons, SectionHeader } from './ui';

const loadParameters = () => adminApi.suggestionParameters.list();
const loadTopics = () => adminApi.parameters.list();

/**
 * Everything Step 3 recommends: each parameter (e.g. Print Type), its options, and every option's 1–5 star
 * rating and reason per priority topic. "Try it" shows what a customer would see for any ranking, using the
 * very same scoring as the customer page (`recommend()`).
 */
export function RecommendationsTab() {
  const params = useAsync(loadParameters, [] as SuggestionParameter[]);
  const topicsLoad = useAsync(loadTopics, [] as Parameter[]);
  const topics = useMemo(() => [...topicsLoad.items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), [topicsLoad.items]);
  const setParameters = useCallback((update: (xs: SuggestionParameter[]) => SuggestionParameter[]) => params.setData((xs) => update(xs)), [params]);

  return (
    <section>
      <SectionHeader
        title="Recommendations"
        description="What Step 3 recommends. Rate every option 1–5 stars on each priority topic and say why: the option whose stars best fit the customer's ranking is recommended (higher-ranked topics count more), and customers see the stars and reasons."
      />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <RecommendationParametersPanel
          parameters={params.items}
          setParameters={setParameters}
          topics={topics}
          loading={params.loading || topicsLoad.loading}
          error={params.error ?? topicsLoad.error}
          reload={() => {
            void params.reload();
            void topicsLoad.reload();
          }}
        />
        <TryIt parameters={params.items} topics={topics.filter((t) => t.active)} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// "Try it": the same scoring the customer page uses (shared recommend()), in the browser.
// ---------------------------------------------------------------------------

function TryIt({ parameters, topics }: { parameters: SuggestionParameter[]; topics: Parameter[] }) {
  const defaultOrder = useMemo(() => topics.map((t) => t.key), [topics]);
  const [ranking, setRanking] = useState<string[]>(defaultOrder);
  useEffect(() => setRanking(defaultOrder), [defaultOrder]);
  const nameOf = (key: string) => topics.find((t) => t.key === key)?.name ?? key;
  const { recommendations } = recommend(
    parameters,
    ranking.map((key) => ({ key, label: nameOf(key) })),
    topics,
  );
  const shown = parameters.filter((p) => p.enabled);

  return (
    <aside className="h-fit rounded-2xl border-2 border-ink bg-pw-yellow-tint/40 p-4 xl:sticky xl:top-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="pw-display flex items-center gap-2 text-xl">
          <FlaskConical className="size-5" /> Try it
        </h3>
        <button type="button" className="pw-btn-quiet" onClick={() => setRanking(defaultOrder)} disabled={ranking.join() === defaultOrder.join()}>
          <RotateCcw className="size-3.5" /> Reset
        </button>
      </div>
      <p className="mt-1 text-xs font-semibold text-ink-2">
        Rank the topics like a customer would and see what we&rsquo;d recommend, and why. Nothing is saved.
      </p>

      <RankingEditor topics={topics} ranking={ranking} setRanking={setRanking} />

      <h4 className="pw-label mt-4">We&rsquo;d recommend</h4>
      {ranking.length === 0 ? (
        <p className="text-sm font-bold text-ink-2">Rank at least one topic.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm font-bold text-ink-2">No active recommendation parameters.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((param) => {
            const rec = recommendations.find((r) => r.parameterId === param.id);
            return (
              <li key={param.id} className="rounded-lg bg-paper px-3 py-2 text-sm">
                <span className="block text-xs font-extrabold uppercase tracking-wide text-ink-3">{param.name}</span>
                {rec ? (
                  <>
                    <span className="flex items-baseline justify-between gap-2 font-extrabold">
                      {rec.recommended.label}
                      <span className="inline-flex items-center gap-0.5 tabular-nums">
                        {rec.recommended.stars.toFixed(1)} <Star className="size-3.5 fill-pw-yellow text-ink" aria-label="stars" />
                      </span>
                    </span>
                    <ul className="mt-1 space-y-0.5 text-xs font-semibold text-ink-2" aria-label="Why">
                      {rec.recommended.ratings
                        .filter((r) => r.rank !== null)
                        .slice(0, 3)
                        .map((r) => (
                          <li key={r.key}>
                            #{r.rank} {r.label}: <b className="text-ink">{r.stars ? `${r.stars}★` : 'not rated'}</b>
                            {r.reason && ` — ${r.reason}`}
                          </li>
                        ))}
                    </ul>
                    {rec.others[0] && (
                      <span className="mt-1 block text-xs font-semibold text-ink-3">
                        then {rec.others[0].label} ({rec.others[0].stars.toFixed(1)}★)
                      </span>
                    )}
                  </>
                ) : (
                  <span className="block text-xs font-semibold italic text-ink-2">No option is rated on these topics yet.</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/** A ranking like a customer's for "Try it": reorder with arrows, take topics out, add them back. */
function RankingEditor({
  topics,
  ranking,
  setRanking,
}: {
  topics: Parameter[];
  ranking: string[];
  setRanking: (update: (r: string[]) => string[]) => void;
}) {
  const nameOf = (key: string) => topics.find((t) => t.key === key)?.name ?? key;
  const unranked = topics.filter((t) => !ranking.includes(t.key));
  const move = (i: number, dir: -1 | 1) =>
    setRanking((r) => {
      const next = [...r];
      const [x] = next.splice(i, 1);
      next.splice(i + dir, 0, x);
      return next;
    });
  return (
    <>
      {topics.length === 0 ? (
        <p className="mt-3 text-sm font-bold text-ink-2">No active priority topics.</p>
      ) : (
        <ol className="mt-3 space-y-1">
          {ranking.map((key, i) => (
            <li key={key} className="flex items-center gap-2 rounded-lg bg-paper px-2 py-1 text-sm font-bold">
              <span className="pw-display w-5 text-center tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{nameOf(key)}</span>
              <MoveButtons label={nameOf(key)} first={i === 0} last={i === ranking.length - 1} onMove={(dir) => move(i, dir)} />
              <button
                type="button"
                className="pw-btn-quiet !px-2"
                aria-label={`Remove ${nameOf(key)} from the ranking`}
                onClick={() => setRanking((r) => r.filter((k) => k !== key))}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ol>
      )}
      {unranked.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unranked.map((t) => (
            <button
              key={t.key}
              type="button"
              className="pw-btn-quiet border-2 border-dashed border-ink/30"
              onClick={() => setRanking((r) => [...r, t.key])}
            >
              <Plus className="size-3" /> {t.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

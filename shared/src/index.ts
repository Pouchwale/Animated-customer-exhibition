/**
 * Shared contract between the API (server) and the web app (client).
 * Keep this file dependency-free: plain types and a few constants.
 */

// ---------------------------------------------------------------------------
// Parameters (the bubbles)
// ---------------------------------------------------------------------------

export const BRAND_COLORS = ['yellow', 'pink', 'blue', 'orange'] as const;
export type BrandColor = (typeof BRAND_COLORS)[number];

export const PARAMETER_CATEGORIES = ['commercial', 'quality', 'material', 'logistics', 'design'] as const;
export type ParameterCategory = (typeof PARAMETER_CATEGORIES)[number];

/** Text field limits, shared by the API validation and the admin forms. */
export const TEXT_LIMITS = {
  /** Topic and recommendation parameter names (also the label of a ranked priority). */
  name: 40,
  /** Option labels. */
  label: 60,
  description: 200,
  /** Topic and recommendation parameter keys. */
  key: 60,
} as const;

/** The key made from a name when none is given: "Delivery Time" → "delivery-time" ("parameter" if nothing is left). */
export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TEXT_LIMITS.key) || 'parameter';

export interface Parameter {
  id: string;
  /** Stable machine key, e.g. "price". Used by option ratings and the customer's ranking. Immutable after creation. */
  key: string;
  name: string;
  description: string | null;
  category: ParameterCategory;
  /** Visual importance of the bubble: 1 = small, 2 = medium, 3 = large. */
  size: 1 | 2 | 3;
  color: BrandColor;
  sortOrder: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Priority-based recommendations
//   Topics (the `Parameter` bubbles: Price, MOQ, Delivery Type, …) are ranked by the customer.
//   Recommendation parameters (Print Type, Material Type, …) and their options are set up by the
//   admin, who rates every option 1–5 stars per topic. For each parameter the option that best fits
//   the customer's ranking is recommended; higher-ranked topics count for more.
// ---------------------------------------------------------------------------

/** One ranked topic from Step 2. Index in the array = priority (0 = highest). */
export interface PriorityInput {
  /** Topic key. A key that isn't an active topic (e.g. a "custom:" bubble from an old page) is accepted but never counts. */
  key: string;
  /** Label as the customer sees it (may be renamed). */
  label: string;
}

export interface SuggestionRequest {
  priorities: PriorityInput[];
}

export type PriorityLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/** How well an option serves one priority topic: 1–5 stars, and the reason customers see. */
export interface OptionRating {
  /** A priority topic's key (Step 1 bubble), e.g. "price". */
  topicKey: string;
  stars: number;
  reason: string | null;
}

/** An option of a recommendation parameter, e.g. "Flexo Printing" under "Print Type". */
export interface SuggestionOption {
  id: string;
  parameterId: string;
  label: string;
  /** Short selling line shown with the recommendation. */
  description: string | null;
  /** Position within its parameter (1 = first). Breaks ties between equally good options. */
  sortOrder: number;
  /** Disabled options are never recommended. */
  enabled: boolean;
  /** Its star rating per priority topic. A topic it isn't rated on counts as 0 stars for it. */
  ratings: OptionRating[];
}

/** A recommendation parameter, e.g. "Print Type". */
export interface SuggestionParameter {
  id: string;
  /** Stable machine key, e.g. "print-type". Immutable after creation. */
  key: string;
  name: string;
  description: string | null;
  /** Display order (1 = shown first). */
  sortOrder: number;
  /** Disabled parameters are not recommended. */
  enabled: boolean;
  /** Ordered by sortOrder. */
  options: SuggestionOption[];
}

/** Writable fields. New parameters/options are appended at the end; reorder via the reorder endpoints. */
export interface SuggestionParameterDraft {
  /** Optional on create (defaults to a slug of the name); ignored on update. */
  key?: string;
  name: string;
  description: string | null;
  enabled: boolean;
}

/** Topic key → stars (0 = not rated) and the reason customers see. */
export type OptionRatingsInput = Record<string, { stars: number; reason: string | null }>;

export interface SuggestionOptionDraft {
  label: string;
  description: string | null;
  enabled: boolean;
  /** Replaces all of the option's ratings when given. */
  ratings?: OptionRatingsInput;
}

export const RATING_LIMITS = { maxStars: 5, reasonMax: 140 } as const;

/** How an option does on one of the customer's ranked priorities. */
export interface PriorityRating {
  /** The customer's rank (1-based), or null when it isn't in their list: shown for information, doesn't count. */
  rank: number | null;
  key: string;
  label: string;
  /** 0 = this option isn't rated on it. */
  stars: number;
  reason: string | null;
}

export interface ScoredOption {
  id: string;
  label: string;
  description: string | null;
  /** Weighted average of its stars over the customer's ranked priorities (0–5, one decimal). */
  stars: number;
  /** The same as a percentage: round(stars × 20), from the rounded stars. */
  matchPercent: number;
  /**
   * Its rating on every priority topic: first the customer's ranked ones (in their order; these decide the
   * winner), then the other active topics in admin order (rank null). The why.
   */
  ratings: PriorityRating[];
}

/** A priority topic as recommend() needs it, to also list the topics the customer didn't rank. */
export interface RecommendTopic {
  key: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

/** The recommendation for one parameter. */
export interface ParameterRecommendation {
  parameterId: string;
  key: string;
  name: string;
  description: string | null;
  /** The best-fitting option. */
  recommended: ScoredOption;
  /** The other enabled options, best first. */
  others: RunnerUpOption[];
}

/** A runner-up: enough to say "then Gravure Printing (3.5★)". */
export interface RunnerUpOption {
  id: string;
  label: string;
  /** Same scale as `ScoredOption.stars`. */
  stars: number;
}

export interface PriorityBreakdown {
  rank: number; // 1-based
  key: string;
  label: string;
  level: PriorityLevel;
  weight: number;
}

export interface SuggestionResult {
  engine: string;
  generatedAt: string;
  /** One row per ranked topic (Step 2 shows weight and level). */
  breakdown: PriorityBreakdown[];
  /** Enabled parameters in admin order; parameters none of the customer's topics is rated on are left out. */
  recommendations: ParameterRecommendation[];
}

// ---------------------------------------------------------------------------
// Priority weights (fixed): higher-ranked topics count for more
// ---------------------------------------------------------------------------

/** Points per rank. Index 0 = priority 1. */
export const PRIORITY_WEIGHTS = [100, 80, 60, 40, 20] as const;
/** Points for any rank beyond PRIORITY_WEIGHTS. */
export const FALLBACK_WEIGHT = 10;

/** Points for a 1-based rank. */
export function weightForRank(rank: number): number {
  return PRIORITY_WEIGHTS[rank - 1] ?? FALLBACK_WEIGHT;
}

/** Ranks 1–2 are HIGH, 3–4 MEDIUM, the rest LOW (shown in Step 2). */
export function levelForRank(rank: number): PriorityLevel {
  if (rank <= 2) return 'HIGH';
  if (rank <= 4) return 'MEDIUM';
  return 'LOW';
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The recommendation for every enabled parameter, from the customer's ranking (array order = priority).
 * Pure (never changes its inputs), so the server and the admin "Try it" use the very same rules:
 * - an option's fit = Σ weight(rank) × stars ÷ Σ weight(rank) over the customer's ranked topics that count and that
 *   any enabled option of the parameter is rated on (a topic the option isn't rated on counts as 0 stars);
 * - best fit wins; ties go to more stars on the customer's higher-ranked topic, then to admin order;
 * - a parameter none of the counted topics is rated on is left out.
 */
export function recommend(
  parameters: SuggestionParameter[],
  priorities: PriorityInput[],
  /**
   * All priority topics. When given, only ranked keys that are active topics here count (a page left open for hours
   * may still send a topic the admin has since hidden), and the active ones the customer didn't rank are listed after
   * theirs (for information only). Without it, every ranked key counts.
   */
  allTopics?: RecommendTopic[],
): Pick<SuggestionResult, 'breakdown' | 'recommendations'> {
  const ranked = priorities.map((p, i) => ({ rank: i + 1, key: p.key, label: p.label, weight: weightForRank(i + 1) }));
  const breakdown: PriorityBreakdown[] = ranked.map((t) => ({
    rank: t.rank,
    key: t.key,
    label: t.label,
    level: levelForRank(t.rank),
    weight: t.weight,
  }));

  const active = allTopics && new Set(allTopics.filter((t) => t.active).map((t) => t.key));
  // Topics that don't count are skipped and the rest renumbered: a hidden #1 makes the customer's #2 their #1
  // (full weight), as if the hidden topic had never been ranked.
  const counted = active
    ? ranked.filter((t) => active.has(t.key)).map((t, i) => ({ ...t, rank: i + 1, weight: weightForRank(i + 1) }))
    : ranked;
  // The active topics the customer didn't rank, in admin order: shown too, but they don't count.
  const rankedKeys = new Set(priorities.map((p) => p.key));
  const rest = (allTopics ?? []).filter((t) => t.active && !rankedKeys.has(t.key)).sort((a, b) => a.sortOrder - b.sortOrder);

  const recommendations: ParameterRecommendation[] = [];
  for (const parameter of parameters.filter((p) => p.enabled).sort((a, b) => a.sortOrder - b.sortOrder)) {
    const options = parameter.options.filter((o) => o.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
    const rated = new Set(options.flatMap((o) => o.ratings.filter((r) => r.stars > 0).map((r) => r.topicKey)));
    const topics = counted.filter((t) => rated.has(t.key));
    if (!topics.length) continue;
    const total = topics.reduce((sum, t) => sum + t.weight, 0);

    const scored = options
      .map((o) => {
        const byKey = new Map(o.ratings.map((r) => [r.topicKey, r]));
        const ratings: PriorityRating[] = topics.map((t) => {
          const r = byKey.get(t.key);
          return { rank: t.rank, key: t.key, label: t.label, stars: r?.stars ?? 0, reason: r?.reason ?? null };
        });
        const fit = ratings.reduce((sum, r, i) => sum + topics[i]!.weight * r.stars, 0) / total;
        return { o, byKey, ratings, stars: round1(fit), fit };
      })
      .sort((a, b) => {
        if (b.fit !== a.fit) return b.fit - a.fit;
        for (let i = 0; i < topics.length; i++) {
          const d = b.ratings[i]!.stars - a.ratings[i]!.stars;
          if (d !== 0) return d;
        }
        return a.o.sortOrder - b.o.sortOrder;
      });

    const best = scored[0]!;
    const unranked: PriorityRating[] = rest.map((t) => {
      const r = best.byKey.get(t.key);
      return { rank: null, key: t.key, label: t.name, stars: r?.stars ?? 0, reason: r?.reason ?? null };
    });
    recommendations.push({
      parameterId: parameter.id,
      key: parameter.key,
      name: parameter.name,
      description: parameter.description,
      recommended: {
        id: best.o.id,
        label: best.o.label,
        description: best.o.description,
        stars: best.stars,
        matchPercent: Math.round(best.stars * 20),
        ratings: [...best.ratings, ...unranked],
      },
      others: scored.slice(1).map((x): RunnerUpOption => ({ id: x.o.id, label: x.o.label, stars: x.stars })),
    });
  }
  return { breakdown, recommendations };
}

// ---------------------------------------------------------------------------
// Idle logo mode (admin-configured): idle bubbles gather and form the PouchWale logo
// ---------------------------------------------------------------------------

export const TRANSITION_SPEEDS = ['slow', 'normal', 'fast'] as const;
export type TransitionSpeed = (typeof TRANSITION_SPEEDS)[number];
export const isTransitionSpeed = (v: unknown): v is TransitionSpeed => (TRANSITION_SPEEDS as readonly unknown[]).includes(v);

export interface IdleLogoSettings {
  enabled: boolean;
  /** Minutes without any touch, click or key before the logo forms. */
  idleMinutes: number;
  /** Seconds the bubbles take to gather and form the logo. */
  formSeconds: number;
  /** Speed of the scatter (on touch) and the return to bubbles. */
  transitionSpeed: TransitionSpeed;
  /** Seconds the logo stays before turning back into bubbles. 0 = until someone touches the screen. */
  holdSeconds: number;
}

export const IDLE_LOGO_LIMITS = {
  idleMinutes: { min: 0.1, max: 60 },
  formSeconds: { min: 1, max: 10 },
  holdSeconds: { min: 0, max: 600 },
} as const;

// ---------------------------------------------------------------------------
// Intro animation (admin-configured)
// ---------------------------------------------------------------------------

/** The intro animations. "classic" is the original orbit with a circular reveal; "tagline" is logo → tagline. */
export const INTRO_STYLES = ['pouches', 'dots', 'zip', 'tagline', 'classic'] as const;
export type IntroStyle = (typeof INTRO_STYLES)[number];
export const isIntroStyle = (v: unknown): v is IntroStyle => (INTRO_STYLES as readonly unknown[]).includes(v);
/** What the admin can choose: one style, or "rotate" (each load shows the next new style). */
export const INTRO_CHOICES = ['rotate', ...INTRO_STYLES] as const;
export type IntroChoice = (typeof INTRO_CHOICES)[number];
export const isIntroChoice = (v: unknown): v is IntroChoice => (INTRO_CHOICES as readonly unknown[]).includes(v);
/** Styles "rotate" takes turns between. */
export const ROTATING_INTROS: readonly IntroStyle[] = ['pouches', 'dots', 'zip'];

export interface IntroSettings {
  style: IntroChoice;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type AdminRole = 'ADMIN' | 'EDITOR';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

/** Rules for a new admin password. bcrypt only reads the first 72 bytes, so longer ones are refused. */
export const PASSWORD_RULES = {
  minLength: 12,
  maxBytes: 72,
  /** Different characters needed (stops "aaaaaaaaaaaa"). */
  minDistinct: 5,
} as const;

/** Body of POST /api/auth/password. The "confirm" field is checked in the form. */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * What is wrong with a new password (empty = fine). Shared by the form (live hints) and the API.
 * `email` is the account's own email address, which may not be used as the password.
 */
export function passwordProblems(password: string, email?: string): string[] {
  const problems: string[] = [];
  const trimmed = password.trim();
  if (trimmed.length < PASSWORD_RULES.minLength) problems.push(`Use at least ${PASSWORD_RULES.minLength} characters.`);
  if (new TextEncoder().encode(password).length > PASSWORD_RULES.maxBytes) problems.push(`Use at most ${PASSWORD_RULES.maxBytes} characters.`);
  if (new Set(trimmed).size < PASSWORD_RULES.minDistinct && trimmed.length >= PASSWORD_RULES.minLength) {
    problems.push('Too repetitive: mix in more different characters.');
  }
  if (email && trimmed.toLowerCase() === email.trim().toLowerCase()) problems.push('Do not use your email address as the password.');
  return problems;
}

/** Shape of every error response from the API. */
export interface ApiError {
  error: string;
  details?: unknown;
}

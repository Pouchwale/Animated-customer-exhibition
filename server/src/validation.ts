/** Request body schemas (zod v4). Text limits come from `TEXT_LIMITS` (shared with the admin forms) and mirror docs/API.md. */
import { z } from 'zod';
import {
  IDLE_LOGO_LIMITS,
  INTRO_CHOICES,
  TRANSITION_SPEEDS,
  BRAND_COLORS,
  PARAMETER_CATEGORIES,
  RATING_LIMITS,
  TEXT_LIMITS,
  passwordProblems,
} from '@pw/shared';

const trimmed = (max: number) => z.string().trim().min(1, 'Required').max(max);

const parameterKey = z
  .string()
  .trim()
  .min(1)
  .max(TEXT_LIMITS.key)
  .regex(/^[a-z0-9]+(?:[-_:][a-z0-9]+)*$/, 'Use lowercase letters, numbers, "-", "_" or ":"');

// ---- Public ---------------------------------------------------------------

/** Step 2 ranking → Step 3 recommendations. Array order = priority order. */
export const suggestionRequestSchema = z.object({
  priorities: z
    .array(z.object({ key: z.string().trim().min(1).max(TEXT_LIMITS.key), label: trimmed(TEXT_LIMITS.name) }))
    .min(1, 'Select at least one priority')
    .max(50, 'At most 50 priorities')
    .refine((items) => new Set(items.map((i) => i.key)).size === items.length, 'Each priority can only appear once'),
});

export const loginSchema = z.object({
  email: z.email('Enter a valid email').max(200),
  password: z.string().min(1, 'Enter your password').max(200),
});

/** Change your own password. Rules on the new one live in `passwordProblems` (shared with the form). */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(200),
    newPassword: z.string().max(200),
  })
  .superRefine((body, ctx) => {
    for (const message of passwordProblems(body.newPassword)) ctx.addIssue({ code: 'custom', path: ['newPassword'], message });
    if (body.newPassword === body.currentPassword) {
      ctx.addIssue({ code: 'custom', path: ['newPassword'], message: 'Choose a password different from your current one.' });
    }
  });

// ---- Admin ----------------------------------------------------------------

// Update schemas are `.partial()` of a base WITHOUT defaults: zod keeps `.default()` inside
// `.partial()`, which would silently reset omitted fields on update. Defaults are added on create only.
const sortOrder = z.number().int().min(0).max(10000);

const parameterBase = z.object({
  name: trimmed(TEXT_LIMITS.name),
  description: z.string().trim().max(TEXT_LIMITS.description).nullable().optional(),
  category: z.enum(PARAMETER_CATEGORIES),
  size: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  color: z.enum(BRAND_COLORS),
  sortOrder,
  active: z.boolean(),
});
export const parameterCreateSchema = parameterBase.extend({
  key: parameterKey.optional(),
  size: parameterBase.shape.size.default(2),
  sortOrder: sortOrder.default(0),
  active: z.boolean().default(true),
});
// Key is immutable after creation (option ratings and customers' rankings refer to it); unknown fields such as `key`/`id` are stripped.
export const parameterUpdateSchema = parameterBase.partial();

/** A complete new order: every id exactly once. Checked against the stored set by the service. */
export const reorderSchema = z.object({
  ids: z
    .array(z.string().trim().min(1).max(64))
    .max(1000)
    .refine((ids) => new Set(ids).size === ids.length, 'Each id can only appear once'),
});

// ---- Recommendation parameters & options -------------------------------------

const description = z
  .string()
  .trim()
  .max(TEXT_LIMITS.description)
  .nullish()
  .transform((x) => x || null);

const suggestionParameterBase = z.object({
  name: trimmed(TEXT_LIMITS.name),
  description,
  enabled: z.boolean(),
});
export const suggestionParameterCreateSchema = suggestionParameterBase.extend({
  key: parameterKey.optional(),
  enabled: z.boolean().default(true),
});
// Key is immutable after creation; unknown fields (key, id, sortOrder, options) are stripped.
export const suggestionParameterUpdateSchema = suggestionParameterBase.partial();

/** Topic key → 0–5 stars (0 = not rated) and the reason customers see. Replaces all of the option's ratings. */
const optionRatings = z.record(
  parameterKey,
  z.object({
    stars: z.number().int('Whole stars only').min(0, 'Minimum 0 stars').max(RATING_LIMITS.maxStars, 'Maximum 5 stars'),
    reason: z
      .string()
      .trim()
      .max(RATING_LIMITS.reasonMax)
      .nullish()
      .transform((x) => x || null),
  }),
);

const suggestionOptionBase = z.object({
  label: trimmed(TEXT_LIMITS.label),
  description,
  enabled: z.boolean(),
  ratings: optionRatings,
});
export const suggestionOptionCreateSchema = suggestionOptionBase.extend({
  enabled: z.boolean().default(true),
  ratings: optionRatings.default({}),
});
/** Partial: when ratings are given they replace all of the option's ratings. */
export const suggestionOptionUpdateSchema = suggestionOptionBase.partial();

/** Idle logo mode: any subset of fields (missing ones keep their saved value). */
const IDLE = IDLE_LOGO_LIMITS;
export const idleLogoSettingsSchema = z
  .object({
    enabled: z.boolean(),
    idleMinutes: z
      .number()
      .min(IDLE.idleMinutes.min, `At least ${IDLE.idleMinutes.min} minutes`)
      .max(IDLE.idleMinutes.max, `At most ${IDLE.idleMinutes.max} minutes`),
    formSeconds: z
      .number()
      .min(IDLE.formSeconds.min, `At least ${IDLE.formSeconds.min} second`)
      .max(IDLE.formSeconds.max, `At most ${IDLE.formSeconds.max} seconds`),
    transitionSpeed: z.enum(TRANSITION_SPEEDS),
    holdSeconds: z.number().int('Use whole seconds').min(IDLE.holdSeconds.min).max(IDLE.holdSeconds.max, `At most ${IDLE.holdSeconds.max} seconds`),
  })
  .partial();

/** Intro animation: one style, or "rotate". */
export const introSettingsSchema = z.object({ style: z.enum(INTRO_CHOICES) });

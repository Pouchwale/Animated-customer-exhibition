# API reference

Base URL: `/api` (Vite proxies `/api` → `http://127.0.0.1:4000` in development).
All bodies are JSON, up to 100 kB. Types referenced below live in [shared/src/index.ts](../shared/src/index.ts).

Every response carries an `X-Request-Id` header: the request's own `X-Request-Id` when it is sane (up to 128 letters,
digits or `_ . : @ -`), otherwise a new UUID. The server logs show the same id.

Errors always look like `{ "error": "Human readable message", "details"?: … }`:

| Status | When |
|---|---|
| 400 | Validation failed, or a reorder doesn't list every id exactly once (`details` = list of `{ path, message }`). Also a body that isn't valid JSON |
| 401 | Not signed in / session expired / password changed since sign-in |
| 403 | Signed in but role not allowed |
| 404 | Resource or API path not found |
| 409 | Unique conflict, e.g. duplicate parameter key (`details` = list of `{ path, message }`, one per field the database names) |
| 409 | "Please try again": the write clashed with another one at the same moment |
| 413 | Body larger than 100 kB |
| 415 / 400 | Unsupported charset or `Content-Encoding` (415), or a body that can't be read (400) |
| 429 | Too many failed sign-ins or wrong current passwords; in production, too many requests (below) |
| 500 | Unexpected error: always "Something went wrong. Please try again." (no message or stack trace leaked; logged with the request id) |

**Rate limit (production only):** at most 600 requests per minute per IP across `/api`, then 429 with the standard
`RateLimit` and `RateLimit-Policy` headers and `Retry-After`. `/health` and `/ready` are never limited. The client IP
depends on `TRUST_PROXY` (see the README).

## Public (customer)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | — | `{ ok: true }`: liveness, the process answers (no database) |
| GET | `/ready` | — | `{ ok: true }` (200) when the database answers within 2 s, else `{ ok: false }` (503) |
| GET | `/parameters` | — | `Parameter[]` (active only, ordered by `sortOrder`) |
| POST | `/suggestions` | `SuggestionRequest` (the Step 2 ranking) | `SuggestionResult` (recommended option per parameter) |
| GET | `/idle-logo` | — | `IdleLogoSettings` (idle logo mode, read by the customer page) |
| GET | `/intro` | — | `IntroSettings` (which intro animation to play) |

`/idle-logo` and `/intro` only read. When the settings row is missing they return the defaults and write nothing; the
seed creates the rows.

Validation:
- `priorities`: 1–50 items in priority order (index 0 = most important), `key` 1–60 chars, `label` 1–40 chars,
  keys must be unique (400 otherwise).
- A key that isn't an active topic (hidden, unknown, or an old `custom:` key) is accepted but never counts toward the
  score. `breakdown` still lists it.

Customers receive, per recommendation parameter, the options ranked by fit (best first):
- `recommended`: the best option, with `stars` (0–5, one decimal), `matchPercent` and `ratings`. Its `ratings` say
  why: first its stars and reason on each of the customer's counted priorities, in their order, then the other active
  topics the customer didn't rank, in admin order, with `rank: null` (information only, they don't count).
- `others`: the other enabled options, best first, as `{ id, label, stars }` only.

## Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | `AdminUser`, sets `pw_session` cookie |
| POST | `/auth/logout` | — | 204, clears cookie |
| GET | `/auth/me` | — | `AdminUser` or 401 |
| POST | `/auth/password` | `{ currentPassword, newPassword }` | `AdminUser`, sets a fresh `pw_session` cookie (session required, any role) |

- Session = signed JWT (`JWT_SECRET`, 8h) in an `httpOnly`, `sameSite=strict` cookie on path `/api` (`Secure` when
  `HTTPS` is on, the production default). It carries the account's `tokenVersion`; a session with an older version
  gets 401.
- Passwords hashed with bcrypt (cost 12). Login rate-limited (10 failed attempts / 15 min per IP). Same error for
  unknown email and wrong password.
- The admin is the only account the seed creates, from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. In production the seed
  refuses a placeholder or weak `ADMIN_PASSWORD`; in development it prints a warning. Changing those later does not
  change an existing account's password; use **Change password** in the admin panel.
- **Change password:** users change only their own password.
  - The current password must be correct. A wrong one gets 400 with details `[{ path: 'currentPassword' }]`, and wrong
    attempts are limited to 5 per 15 min per account.
  - The new password must have at least 12 characters (spaces at either end don't count) and at most 72 bytes (bcrypt's
    limit), with at least 5 different characters. It can't be the account's email or the current password. These rules
    are in `passwordProblems()` in `shared/`, so the form and the API use the same ones.
  - On success the hash is replaced and `tokenVersion` goes up by one. Every other session of that account stops
    working, the old password no longer signs in, and the browser that made the change gets a new cookie.

## Admin (requires session)

Updates (PUT) are partial: omitted fields keep their stored values, and unknown fields (`id`, `key`…) are ignored.
Every successful write here (topics included) clears the recommendation cache, so customers see the change on their
next request.

Roles:
- `EDITOR` manages the topics (the priority list): create, edit, reorder and hide them. It can read the
  recommendation parameters and the settings. No editor account is seeded; the role is still in the code.
- `ADMIN` can do everything an editor can, **plus**:
  - delete topics (this also deletes every star rating and reason for that topic, so hiding is usually better);
  - change recommendation parameters and options (they go live immediately);
  - change the intro animation and the idle logo mode settings.

| Method | Path | Role | Body | Returns |
|---|---|---|---|---|
| GET | `/admin/parameters` | EDITOR | — | `Parameter[]` — the topics, including inactive |
| POST | `/admin/parameters` | EDITOR | `Omit<Parameter,'id'>` (`key` optional → slug of name) | `Parameter` (201) |
| PUT | `/admin/parameters/:id` | EDITOR | partial (key cannot change) | `Parameter` |
| DELETE | `/admin/parameters/:id` | **ADMIN** | — | 204 (also deletes every rating and reason for that topic) |
| GET | `/admin/suggestion-parameters` | EDITOR | — | `SuggestionParameter[]` (in order, options ordered, each with its `ratings`: topic key, 1–5 stars, reason) |
| POST | `/admin/suggestion-parameters` | **ADMIN** | `SuggestionParameterDraft` (`key` optional → slug of name) | `SuggestionParameter` (201, added last) |
| PUT | `/admin/suggestion-parameters/:id` | **ADMIN** | partial draft (the key cannot change) | `SuggestionParameter` |
| DELETE | `/admin/suggestion-parameters/:id` | **ADMIN** | — | 204 (also deletes its options) |
| POST | `/admin/suggestion-parameters/reorder` | **ADMIN** | `{ ids }` (every parameter id, in the new order) | `SuggestionParameter[]` |
| POST | `/admin/suggestion-parameters/:id/options` | **ADMIN** | `SuggestionOptionDraft` | `SuggestionOption` (201, added last) |
| POST | `/admin/suggestion-parameters/:id/options/reorder` | **ADMIN** | `{ ids }` (every option id of that parameter) | `SuggestionParameter` |
| PUT | `/admin/suggestion-options/:id` | **ADMIN** | partial `SuggestionOptionDraft` | `SuggestionOption` |
| DELETE | `/admin/suggestion-options/:id` | **ADMIN** | — | 204 |
| GET | `/admin/idle-logo` | EDITOR | — | `IdleLogoSettings` |
| PUT | `/admin/idle-logo` | **ADMIN** | partial `IdleLogoSettings` | `IdleLogoSettings` |
| GET | `/admin/intro` | EDITOR | — | `IntroSettings` |
| PUT | `/admin/intro` | **ADMIN** | `{ style }`: one of `rotate`, `pouches`, `dots`, `zip`, `classic` | `IntroSettings` |

Idle logo settings (one record, created by the seed; until it exists, reads return these defaults and write nothing).
The intro setting works the same way, with `rotate` as its default.

| Field | Type | Range | Default | Meaning |
|---|---|---|---|---|
| `enabled` | boolean | — | `true` | Idle logo mode on or off. |
| `idleMinutes` | number | 0.1–60 | `1` | Minutes without a touch, click or key before the logo forms. |
| `formSeconds` | number | 1–10 | `3` | Seconds the bubbles take to gather and form the logo. |
| `transitionSpeed` | `slow` | `normal` | `fast` | — | `normal` | Speed of the scatter on touch and the return to bubbles. |
| `holdSeconds` | integer | 0–600 | `20` | Seconds the logo stays before turning back into bubbles. `0` = until someone touches the screen. |

Recommendation parameter & option validation:
- `name` is 1–40 characters, an option `label` 1–60, and descriptions up to 200 (empty becomes null).
- Keys are unique (409). Option labels are unique within their parameter (409).
- `ratings` maps topic keys to `{ stars, reason }`: whole stars 0–5 (0 = not rated, not stored) and a reason of up to
  140 characters (empty becomes null). On PUT, given `ratings` replace all of the option's ratings. An unknown topic
  key gets 400. Deleting a topic deletes its ratings.
- A reorder body must list every id exactly once (400 otherwise; `details` names each missing or unknown id).

## Recommendation parameters & options

What gets recommended is configured in the database. Each **parameter** (e.g. Print Type) has **options**
(e.g. Flexo, Gravure, Digital, Hybrid, Offset Printing). The admin rates every option **1–5 stars on each priority
topic** and writes the **reason** customers see next to the stars ("Lowest cost per pouch on very large runs"). The
topics are the customer's priority list (Price, MOQ, Delivery Type, Development Charges, Print Quality, Special Colour,
Quantity Range…), managed in Admin → Priority topics.

The seed creates two parameters, Print Type and Material Type, only when none exist, so admin edits and deletions are
never undone. Disabled parameters and options are never recommended.

## Recommendation engine

The engine lives in `server/src/engine/`, behind a `SuggestionProvider` interface. Today the only provider is
`priority-weighted` (`RECOMMENDER` env var; the old value `rule-based` is still accepted). Its scoring is
`recommend(parameters, priorities, allTopics)` in `shared/src/index.ts`, which the admin "Try it" panel also uses, so
the two always agree. Both pass every topic as `allTopics`.

The data it needs (parameters, options, ratings and topics) is cached in memory for up to 60 s, and cleared as soon
as any admin write succeeds.

1. **Weights** (fixed, `PRIORITY_WEIGHTS` and `FALLBACK_WEIGHT` in `shared/src/index.ts`). Priorities 1–5 get
   100, 80, 60, 40 and 20 points, and lower priorities get 10, so higher-ranked topics count for more.
2. **Levels.** Ranks 1–2 are HIGH, 3–4 MEDIUM and the rest LOW. Step 2 shows these in `breakdown`, one row per
   ranked key.
3. **Fit** (per enabled parameter, in admin order). A ranked key counts only if it is an active topic (hidden, unknown
   and old `custom:` keys never do, though `breakdown` still lists them), and only if at least one enabled option of
   the parameter is rated on it. For every enabled option:
   `stars = Σ weight(rank) × stars(option, topic) ÷ Σ weight(rank)` (0–5, one decimal); a topic the option isn't
   rated on counts as 0 stars. `matchPercent = round(stars × 20)`, from the rounded stars.
4. **Winner.** Options sort by fit. Ties go to more stars on the customer's #1 topic, then #2, and so on, then the
   admin's option order. `recommended` is the first and `others` holds the rest as `{ id, label, stars }`.
5. **Why.** The recommended option's `ratings` list the customer's counted topics in rank order, each with the
   option's stars and reason. Then come the other active topics the customer didn't rank, in admin order, with
   `rank: null` (information only). The customer page shows them under the recommendation, the unranked ones under
   "Your other priorities".
6. **Left out.** A parameter is omitted when it has no enabled options, or none of the counted topics is rated on it.

Example with the seeded data: Price #1, MOQ #2, Print Quality #3 recommends **Flexo Printing** under Print Type:
(100×4 + 80×3 + 60×5) ÷ 240 = 3.9 stars, ahead of Hybrid (3.8), Gravure (3.7), Digital and Offset (3.5).

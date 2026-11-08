import type {
  AdminUser,
  ChangePasswordInput,
  IdleLogoSettings,
  IntroSettings,
  Parameter,
  SuggestionOption,
  SuggestionOptionDraft,
  SuggestionParameter,
  SuggestionParameterDraft,
  SuggestionRequest,
  SuggestionResult,
} from '@pw/shared';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * No usable answer from the API: offline or unreachable (`network`), too slow (`timeout`), or a reply that
 * isn't the API's JSON (`not-json`, e.g. a venue Wi-Fi sign-in page).
 */
export class ApiUnreachableError extends Error {
  name = 'ApiUnreachableError';
  constructor(
    message: string,
    public reason: 'network' | 'timeout' | 'not-json',
  ) {
    super(message);
  }
}

/** Every request gives up after this long (ms), so a stalled Wi-Fi never leaves a screen waiting forever. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** How long to wait (ms) before automatic retry number `n` (0-based) after a failure: 2, 4, 8, then every 15 s. */
export const retryDelay = (n: number) => Math.min(15_000, 2000 * 2 ** n);

/** What customers see when the API can't be reached, instead of the browser's own text ("Failed to fetch", "Load failed"). */
export const CANT_REACH = 'Can’t reach PouchWale right now. Check the Wi-Fi — we’ll keep trying.';

/** Worth retrying by itself: unreachable, timed out, server trouble or rate limited (not a request the server rejected). */
export function isTransient(e: unknown): boolean {
  if (e instanceof ApiUnreachableError) return true;
  return e instanceof ApiRequestError && (e.status >= 500 || e.status === 408 || e.status === 429);
}

/** An error as customer-facing text: no raw browser or server wording when PouchWale is unreachable or down. */
export function customerErrorText(e: unknown, fallback: string): string {
  if (e instanceof ApiUnreachableError || (e instanceof ApiRequestError && e.status >= 500)) return CANT_REACH;
  return (e instanceof Error && e.message) || fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Own controller for the timeout, following the caller's signal too (by hand: AbortSignal.any needs Safari 17.4+).
  const ac = new AbortController();
  const caller = init.signal;
  const cancel = () => ac.abort();
  if (caller?.aborted) ac.abort();
  else caller?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...init,
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (res.status === 204) return undefined as T;
    let body: { error?: string; details?: unknown };
    try {
      body = await res.json();
    } catch (e) {
      // Cancelled while the body was still arriving: that's a cancel, not an empty result.
      if (e instanceof Error && e.name === 'AbortError') throw e;
      // A success that isn't JSON is not the API answering (Step 3 used to crash on the `{}` this once returned).
      if (res.ok) throw new ApiUnreachableError('The server sent an unexpected reply. Check the connection and try again.', 'not-json');
      body = {};
    }
    if (!res.ok) {
      throw new ApiRequestError(body?.error ?? `Request failed (${res.status})`, res.status, body?.details);
    }
    return body as T;
  } catch (e) {
    if (timedOut) throw new ApiUnreachableError('The server took too long to answer. Try again.', 'timeout');
    // fetch() itself failed: offline, or the server can't be reached.
    if (e instanceof TypeError) throw new ApiUnreachableError('Can’t reach the server. Check the connection and try again.', 'network');
    throw e;
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', cancel);
  }
}

const json = (method: string, data?: unknown): RequestInit => ({
  method,
  body: data === undefined ? undefined : JSON.stringify(data),
});

// ---- Customer (public) ----------------------------------------------------
export const publicApi = {
  parameters: () => request<Parameter[]>('/parameters'),
  /** Step 2 ranking in → recommended option per parameter out. */
  suggest: (body: SuggestionRequest, signal?: AbortSignal) => request<SuggestionResult>('/suggestions', { ...json('POST', body), signal }),
  /** Idle logo mode settings (set in the admin panel). */
  idleLogo: () => request<IdleLogoSettings>('/idle-logo'),
  /** Which intro animation to play (set in the admin panel). */
  intro: () => request<IntroSettings>('/intro'),
};

// ---- Admin (cookie session) -------------------------------------------------
type Draft<T> = Omit<T, 'id'>;

function crud<T extends { id: string }, D = Draft<T>>(base: string) {
  return {
    list: () => request<T[]>(base),
    create: (data: D) => request<T>(base, json('POST', data)),
    update: (id: string, data: Partial<D>) => request<T>(`${base}/${id}`, json('PUT', data)),
    remove: (id: string) => request<void>(`${base}/${id}`, json('DELETE')),
  };
}

export const adminApi = {
  login: (email: string, password: string) => request<AdminUser>('/auth/login', json('POST', { email, password })),
  logout: () => request<void>('/auth/logout', json('POST')),
  me: () => request<AdminUser>('/auth/me'),
  /** Change your own password. Other signed-in devices are signed out; this one stays signed in. */
  changePassword: (data: ChangePasswordInput) => request<AdminUser>('/auth/password', json('POST', data)),
  parameters: crud<Parameter, Omit<Parameter, 'id'>>('/admin/parameters'),
  /** Recommendation parameters (e.g. Print Type) and their options. Read: EDITOR; write: ADMIN. */
  suggestionParameters: {
    list: () => request<SuggestionParameter[]>('/admin/suggestion-parameters'),
    create: (data: SuggestionParameterDraft) => request<SuggestionParameter>('/admin/suggestion-parameters', json('POST', data)),
    update: (id: string, data: Partial<SuggestionParameterDraft>) =>
      request<SuggestionParameter>(`/admin/suggestion-parameters/${id}`, json('PUT', data)),
    remove: (id: string) => request<void>(`/admin/suggestion-parameters/${id}`, json('DELETE')),
    /** Full new order of every parameter id. Returns the whole list. */
    reorder: (ids: string[]) => request<SuggestionParameter[]>('/admin/suggestion-parameters/reorder', json('POST', { ids })),
    addOption: (parameterId: string, data: SuggestionOptionDraft) =>
      request<SuggestionOption>(`/admin/suggestion-parameters/${parameterId}/options`, json('POST', data)),
    updateOption: (optionId: string, data: Partial<SuggestionOptionDraft>) =>
      request<SuggestionOption>(`/admin/suggestion-options/${optionId}`, json('PUT', data)),
    removeOption: (optionId: string) => request<void>(`/admin/suggestion-options/${optionId}`, json('DELETE')),
    /** Full new order of this parameter's option ids. Returns the updated parameter. */
    reorderOptions: (parameterId: string, ids: string[]) =>
      request<SuggestionParameter>(`/admin/suggestion-parameters/${parameterId}/options/reorder`, json('POST', { ids })),
  },
  /** Intro animation. Read: EDITOR; save: ADMIN. */
  intro: {
    get: () => request<IntroSettings>('/admin/intro'),
    save: (data: IntroSettings) => request<IntroSettings>('/admin/intro', json('PUT', data)),
  },
  /** Idle logo mode. Read: EDITOR; save: ADMIN. */
  idleLogo: {
    get: () => request<IdleLogoSettings>('/admin/idle-logo'),
    save: (data: Partial<IdleLogoSettings>) => request<IdleLogoSettings>('/admin/idle-logo', json('PUT', data)),
  },
};

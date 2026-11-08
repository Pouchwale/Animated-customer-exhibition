/**
 * Keep-alive "cron job": Render's free web services go to sleep after 15 minutes without incoming requests, and the
 * next visitor then waits about a minute while it wakes up. Every few minutes the server requests its own public
 * health page; that request comes in through Render's front door like a visitor's, so the service never goes idle.
 *
 * On by itself on Render (RENDER_EXTERNAL_URL), off elsewhere; KEEP_ALIVE_URL overrides or (false) turns it off.
 */
export interface KeepAliveOptions {
  url: string;
  everyMs: number;
  /** For tests. */
  fetchImpl?: typeof fetch;
  log?: Pick<Console, 'log' | 'warn'>;
}

const TIMEOUT_MS = 15_000;

export function startKeepAlive({ url, everyMs, fetchImpl = fetch, log = console }: KeepAliveOptions) {
  let failing = false;
  const ping = async () => {
    try {
      const res = await fetchImpl(url, { headers: { 'user-agent': 'PouchWale keep-alive' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      if (failing) log.log('[keep-alive] reachable again');
      failing = false;
    } catch (err) {
      // Logged once per outage, not every few minutes.
      if (!failing) log.warn(`[keep-alive] ping failed (${(err as Error).message}); will keep trying`);
      failing = true;
    }
  };
  const timer = setInterval(() => void ping(), everyMs);
  timer.unref(); // never keeps the process alive on its own (clean shutdown)
  log.log(`[keep-alive] pinging ${url} every ${Math.round(everyMs / 60_000)} min`);
  return { ping, stop: () => clearInterval(timer) };
}

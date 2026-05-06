// Sentry helper for Supabase Edge Functions (Deno).
//
// Pattern: wrap each function's request handler in withSentry(name, handler).
// Captures unhandled errors with the function name as a tag, re-throws so
// the runtime still 500s. No-op when SENTRY_DSN is missing.
//
// Tag every event with:
//   - source: function name (used by Sentry alert rules to detect "2
//     consecutive failures from same source")
//   - kind: 'edge-function'

import * as Sentry from 'npm:@sentry/deno@8.42.0';

const dsn = Deno.env.get('SENTRY_DSN');
let initialized = false;

function ensureInit() {
  if (!dsn || initialized) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    environment: Deno.env.get('SENTRY_ENV') ?? 'local',
  });
  initialized = true;
}

ensureInit();

export function captureException(
  err: unknown,
  source: string,
  extra?: Record<string, unknown>,
): void {
  // Always console.error — Edge Function logs are still our first line of
  // defense even when Sentry is wired.
  console.error(`[${source}]`, err, extra ?? '');
  if (!dsn) return;
  Sentry.withScope((scope) => {
    scope.setTag('source', source);
    scope.setTag('kind', 'edge-function');
    if (extra) scope.setContext('extra', extra);
    Sentry.captureException(err);
  });
}

// Use for non-error events that still warrant alerting (e.g. cost cap
// exceeded, scraper degraded for N days). Same fanout as captureException
// but at warning level so Sentry's alert rules can distinguish.
export function captureWarning(
  message: string,
  source: string,
  extra?: Record<string, unknown>,
): void {
  console.warn(`[${source}] ${message}`, extra ?? '');
  if (!dsn) return;
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setTag('source', source);
    scope.setTag('kind', 'edge-function');
    if (extra) scope.setContext('extra', extra);
    Sentry.captureMessage(message);
  });
}

// Wraps a Deno.serve handler so any thrown error is captured + tagged
// before the runtime returns a 500.
export function withSentry(
  source: string,
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      captureException(err, source);
      // Try to flush before the request response so the event lands.
      if (dsn) {
        try {
          await Sentry.flush(1000);
        } catch {
          /* swallow */
        }
      }
      return new Response(
        JSON.stringify({ ok: false, error: 'internal error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  };
}

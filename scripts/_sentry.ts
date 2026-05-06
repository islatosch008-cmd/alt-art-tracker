// Tiny Sentry wrapper for Node-side scripts. No-op when SENTRY_DSN is unset
// (dev hasn't wired it yet) so scripts still run cleanly without it.
//
// Usage at the top of a script:
//   import { initSentry, captureException, flushSentry } from './_sentry.ts';
//   initSentry('import-pokemon-cards');
//
//   main().catch(async (e) => {
//     captureException(e, { script: 'import-pokemon-cards' });
//     await flushSentry();
//     process.exit(1);
//   });

import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;
let initialized = false;

export function initSentry(scriptName: string): void {
  if (!dsn || initialized) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    environment: process.env.NODE_ENV ?? 'development',
    initialScope: { tags: { script: scriptName } },
  });
  initialized = true;
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!dsn || !initialized) {
    // Always log to console too — Sentry-disabled isn't silence.
    console.error(err, context ?? '');
    return;
  }
  Sentry.withScope((scope) => {
    if (context) scope.setContext('extra', context);
    Sentry.captureException(err);
  });
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!dsn || !initialized) return;
  await Sentry.flush(timeoutMs);
}

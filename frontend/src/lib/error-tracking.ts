/**
 * Hook point for Sentry (or any error tracker): wire it in here when a
 * DSN is configured. Left as a console-only no-op rather than an unused
 * dependency, since there's no account to actually send to in this
 * environment — mirrors the backend's AllExceptionsFilter.
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error("Unhandled error", error, context);
}

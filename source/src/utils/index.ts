/**
 * Misc utility helpers shared across the app.
 */

/** Sleep for `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Generate a short random id, used for local message ids. */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

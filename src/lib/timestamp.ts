/**
 * Timestamps. NIP-01: `created_at` is Unix seconds for every event
 * kind. The app's wall clock is milliseconds (Date.now), so the seconds
 * conversion lives here — the one definition, imported everywhere an
 * event is created. Display has its own clock (formatTimestamp).
 */

/** Now, as NIP-01 event seconds. */
export const nowSec = (): number => Math.floor(Date.now() / 1000);

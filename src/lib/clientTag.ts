/**
 * The client tag stamped on published events — the one place that decides.
 *
 * TODO: drive this from an app setting (never / always / custom string).
 * Until then the app sends no client tag: it is published metadata, and
 * metadata is a leak until it is a deliberate choice.
 */
export const clientTag = (): string | undefined => undefined;

/**
 * The one gate for every event-sourced URL: parse, require https, no
 * credentials. Remote content in this app is https or it does not load
 * — no scheme-relative `//host/x`, no `data:`, no `http:` downgrade, no
 * embedded user:pass. Callers render or fetch only what this returns;
 * undefined means reject (show nothing / surface an error).
 */
export const sanitizeUrl = (input: string | undefined): string | undefined => {
  if (!input) return undefined;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  if (url.username || url.password) return undefined;
  return url.toString();
};

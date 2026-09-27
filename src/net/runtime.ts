/**
 * Runtime detection for the egress seam: is the UI running inside the Tauri
 * desktop shell (all egress through bundled Tor via invoke) or the web build
 * (browser transports + tor gate)?
 */
export const isDesktop = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

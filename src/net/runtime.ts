/**
 * Runtime detection — the single source of truth for "are we in the Tauri
 * desktop shell?" Every file that needs to branch on runtime imports this.
 * Never inline the check elsewhere (see AGENTS.md, one correct way).
 */
export const isDesktop = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

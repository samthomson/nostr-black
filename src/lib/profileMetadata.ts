/**
 * Kind 0 (profile metadata) editing — the merge that must never nuke.
 *
 * A profile event holds fields from every app its owner ever used. An
 * editor that writes only its own fields erases the rest. Here the new
 * content is always the parsed current content with the edited keys
 * overlaid and cleared keys removed; every other key passes through
 * untouched. Content that exists but does not parse is a hard stop,
 * surfaced — never a silent rewrite from empty.
 */

export interface ProfileEdit {
  /** New value for a field; empty string clears it. */
  [field: string]: string;
}

export type ProfileEditResult =
  | { ok: true; content: string; changed: string[] }
  | { ok: false; error: 'unparseable' };

/** The kind 0 fields this app offers for editing. Anything else in the
 * content is preserved, never offered, never dropped. */
export const EDITABLE_PROFILE_FIELDS = [
  'display_name',
  'name',
  'about',
  'picture',
  'banner',
  'website',
  'nip05',
] as const;

export const editedProfileContent = (
  currentContent: string,
  edits: ProfileEdit,
): ProfileEditResult => {
  // No event yet (fresh identity): everything is additive, nothing to lose.
  let base: Record<string, unknown> = {};
  if (currentContent.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(currentContent);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, error: 'unparseable' };
      }
      base = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, error: 'unparseable' };
    }
  }

  const next: Record<string, unknown> = { ...base };
  const changed: string[] = [];
  for (const [field, raw] of Object.entries(edits)) {
    const value = raw.trim();
    if (value === '') {
      if (field in next) {
        delete next[field];
        changed.push(field);
      }
      continue;
    }
    if (next[field] !== value) {
      next[field] = value;
      changed.push(field);
    }
  }

  return { ok: true, content: JSON.stringify(next), changed };
};

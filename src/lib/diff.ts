/**
 * Diffs between two texts, git-diff style. `diffText` is character-level
 * for typical note edits — a one-character change marks only that
 * character — with a word-level fallback for texts long enough that the
 * character LCS table would dominate memory. `diffLines` is line-level,
 * producing aligned side-by-side rows. Deterministic — same inputs, same
 * output.
 */

export type DiffOp = 'same' | 'add' | 'del';

export interface DiffSegment {
  op: DiffOp;
  text: string;
}

/** Beyond this many unit pairs a full LCS table dominates memory and time
 * for no readable gain — fall back to a whole-text replacement. */
const MAX_CELLS = 4_000_000;

/** Longest-common-subsequence diff over string units, merged to minimal runs. */
const diffUnits = (a: readonly string[], b: readonly string[]): readonly DiffSegment[] => {
  if (a.length * b.length > MAX_CELLS) {
    const segments: DiffSegment[] = [];
    if (a.length) segments.push({ op: 'del', text: a.join('') });
    if (b.length) segments.push({ op: 'add', text: b.join('') });
    return segments;
  }

  // LCS lengths, filled bottom-right to top-left.
  const cols = b.length + 1;
  const table = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }

  // Walk the table, emitting the longest common subsequence with the
  // differing runs split into deletions and additions. Adjacent segments
  // of one op merge so output stays compact.
  const segments: DiffSegment[] = [];
  const push = (op: DiffOp, text: string): void => {
    const last = segments[segments.length - 1];
    if (last && last.op === op) last.text += text;
    else segments.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      push('del', a[i]);
      i += 1;
    } else {
      push('add', b[j]);
      j += 1;
    }
  }
  while (i < a.length) push('del', a[i++]);
  while (j < b.length) push('add', b[j++]);
  return segments;
};

export const diffText = (a: string, b: string): readonly DiffSegment[] => {
  if (a.length * b.length <= MAX_CELLS) {
    // Character precision: `[...s]` splits on code points, so surrogate
    // pairs (emoji) stay whole.
    return diffUnits([...a], [...b]);
  }
  // Word-level fallback: runs of whitespace and non-whitespace.
  return diffUnits(a.match(/\s+|\S+/gu) ?? [], b.match(/\s+|\S+/gu) ?? []);
};

/** One aligned row of a side-by-side diff. */
export interface DiffRow {
  kind: 'same' | 'del' | 'add' | 'change';
  /** Left-side text (same, del, or the old half of a change). */
  left?: string;
  /** Right-side text (same, add, or the new half of a change). */
  right?: string;
  /** Char-level diff between left and right, for change rows. */
  segments?: readonly DiffSegment[];
}

export const diffLines = (a: string, b: string): readonly DiffRow[] => {
  const al = a.split('\n');
  const bl = b.split('\n');

  // Line-level LCS, so unchanged lines stay aligned as context.
  const cols = bl.length + 1;
  const table = new Uint32Array((al.length + 1) * cols);
  for (let i = al.length - 1; i >= 0; i--) {
    for (let j = bl.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        al[i] === bl[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }

  type OpLine = { op: 'same' | 'del' | 'add'; text: string };
  const ops: OpLine[] = [];
  let i = 0;
  let j = 0;
  while (i < al.length && j < bl.length) {
    if (al[i] === bl[j]) {
      ops.push({ op: 'same', text: al[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      ops.push({ op: 'del', text: al[i] });
      i += 1;
    } else {
      ops.push({ op: 'add', text: bl[j] });
      j += 1;
    }
  }
  while (i < al.length) ops.push({ op: 'del', text: al[i++] });
  while (j < bl.length) ops.push({ op: 'add', text: bl[j++] });

  // Align each run of deletions with the following run of additions,
  // pairing them index-wise into change rows; any excess stays delete/add.
  const rows: DiffRow[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.op === 'same') {
      rows.push({ kind: 'same', left: op.text, right: op.text });
      k += 1;
    } else if (op.op === 'del') {
      const dels: string[] = [];
      while (k < ops.length && ops[k].op === 'del') dels.push(ops[k++].text);
      const adds: string[] = [];
      while (k < ops.length && ops[k].op === 'add') adds.push(ops[k++].text);
      const paired = Math.min(dels.length, adds.length);
      for (let m = 0; m < paired; m++) {
        rows.push({ kind: 'change', left: dels[m], right: adds[m], segments: diffText(dels[m], adds[m]) });
      }
      for (let m = paired; m < dels.length; m++) rows.push({ kind: 'del', left: dels[m] });
      for (let m = paired; m < adds.length; m++) rows.push({ kind: 'add', right: adds[m] });
    } else {
      rows.push({ kind: 'add', right: op.text });
      k += 1;
    }
  }
  return rows;
};

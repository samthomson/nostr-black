import { useEffect, useRef } from 'react';

/**
 * Moving brand background: a wordsearch grid — every square holds one
 * character from "nostr.black" (dot included). Rows slide left/right for a
 * phase, columns slide up/down the next, alternating forever; letters
 * continuously permute through the grid.
 *
 * Continuity mechanism: the grid is a mutable 2D array. During a phase,
 * each line of the active axis animates a fractional slide (rigid line,
 * marquee margins cover the ±1 travel); at the phase end the array itself
 * is shifted by one cell — a visual identity, since the letters already
 * sit exactly where the shifted array draws them. Nothing is ever
 * re-derived from moving coordinates, so no jumps, no gaps, no overlaps:
 * lines are rigid (spacing always one cell) and at rest every letter sits
 * on the strict lattice.
 *
 * Each letter carries a brightness variant that travels with it.
 *
 * Robustness: first frame drawn synchronously; prefers-reduced-motion
 * renders the static grid; canvas is a z-0 sibling under the content.
 */
const WORD = 'nostr.black';
const PHASE_MS = 2600;
const MARGIN = 2; // cells of overhang — covers a ±1 slide invisibly

const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Deterministic pseudo-random in [0,1) from an int seed. */
const rand = (seed: number): number => (((seed * 2654435761) % 1000) + 1000) / 1000 % 1;

/** A small palette of brightness variants. */
const INKS = Array.from({ length: 6 }, (_, i) => `hsla(240, 6%, 70%, ${(0.06 + i * 0.032).toFixed(3)})`);

export const MovingBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let cell = 0;
    let cols = 0;
    let rows = 0;
    /** The grid: chars[r][c] and their ink indices. Slid phases shift these. */
    let chars: string[][] = [];
    let inks: number[][] = [];

    const buildGrid = () => {
      cols = Math.ceil(width / cell) + MARGIN * 2;
      rows = Math.ceil(height / cell) + MARGIN * 2;
      chars = [];
      inks = [];
      for (let r = 0; r < rows; r++) {
        const row: string[] = [];
        const inkRow: number[] = [];
        for (let c = 0; c < cols; c++) {
          // Screen coordinates of the cell (margin-adjusted).
          const sr = r - MARGIN;
          const sc = c - MARGIN;
          row.push(WORD[(((sc + 3 * sr) % WORD.length) + WORD.length) % WORD.length]);
          inkRow.push((((sc * 7 + sr * 13) % INKS.length) + INKS.length) % INKS.length);
        }
        chars.push(row);
        inks.push(inkRow);
      }
    };

    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cell = Math.max(14, Math.round(width / 53));
      buildGrid();
      ctx.font = `${Math.round(cell * 0.62)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    };

    /** Shift one grid line by ±1 with wraparound (marquee fold). */
    const shiftRow = (r: number, dir: number) => {
      if (dir === 0) return;
      const line = chars[r];
      const ink = inks[r];
      const out: string[] = new Array(line.length);
      const outInk: number[] = new Array(ink.length);
      for (let c = 0; c < line.length; c++) {
        // Sliding right (dir=+1): cell c now holds what was at c−1.
        const src = dir > 0 ? (c - 1 + line.length) % line.length : (c + 1) % line.length;
        out[c] = line[src];
        outInk[c] = ink[src];
      }
      chars[r] = out;
      inks[r] = outInk;
    };

    const shiftCol = (c: number, dir: number) => {
      if (dir === 0) return;
      const n = rows;
      const out: string[] = new Array(n);
      const outInk: number[] = new Array(n);
      for (let r = 0; r < n; r++) {
        const src = dir > 0 ? (r - 1 + n) % n : (r + 1) % n;
        out[r] = chars[src][c];
        outInk[r] = inks[src][c];
      }
      for (let r = 0; r < n; r++) {
        chars[r][c] = out[r];
        inks[r][c] = outInk[r];
      }
    };

    /** Per-line direction for a phase: some idle, else ±1. */
    const direction = (line: number, phase: number): number => {
      if (rand(phase * 131 + line * 7) < 0.3) return 0;
      return rand(phase * 197 + line * 13) < 0.5 ? -1 : 1;
    };

    const draw = (axis: 'h' | 'v' | null, progress: number, phase: number) => {
      ctx.clearRect(0, 0, width, height);
      for (let r = 0; r < rows; r++) {
        const rowSlide =
          axis === 'h' ? direction(r, phase) * easeInOut(progress) * cell : 0;
        const y = (r - MARGIN) * cell;
        for (let c = 0; c < cols; c++) {
          const colSlide =
            axis === 'v' ? direction(c, phase) * easeInOut(progress) * cell : 0;
          const x = (c - MARGIN) * cell + rowSlide;
          const yy = y + colSlide;
          if (x < -cell || x > width + cell || yy < -cell || yy > height + cell) continue;
          ctx.fillStyle = INKS[inks[r][c]];
          ctx.fillText(chars[r][c], x, yy);
        }
      }
    };

    measure();

    if (reduced) {
      draw(null, 0, 0);
      const onResize = () => {
        measure();
        draw(null, 0, 0);
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    draw('h', 0, 0); // first frame synchronously

    let raf = 0;
    let phase = 0;
    let phaseStart = performance.now();

    const frame = (now: number) => {
      const t = Math.min(1, (now - phaseStart) / PHASE_MS);
      const axis = phase % 2 === 0 ? 'h' : 'v';
      draw(axis, t, phase);

      if (t >= 1) {
        // Commit: fold the completed slide into the grid. This is a visual
        // identity — the letters already sit where the shifted grid draws
        // them — so nothing on screen moves at the commit.
        if (axis === 'h') {
          for (let r = 0; r < rows; r++) shiftRow(r, direction(r, phase));
        } else {
          for (let c = 0; c < cols; c++) shiftCol(c, direction(c, phase));
        }
        phase += 1;
        phaseStart = now;
        draw(phase % 2 === 0 ? 'h' : 'v', 0, phase); // identity frame
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onResize = () => {
      measure();
      draw(null, 0, phase);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
};

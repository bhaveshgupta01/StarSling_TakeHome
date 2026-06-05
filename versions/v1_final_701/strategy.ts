// Strategy: placement + shooting. Pure functions over the server `state` — we
// re-derive belief from `state.yourShots` each turn rather than hand-maintaining
// a redundant struct (guide §15 #8). The "UPDATE" of the closed loop IS this
// recompute. SHOT_LEVEL env selects the ladder rung (DEFAULT 4 — the best).
//
// Levels: 2 = hunt(parity)+target(neighbors) · 3 = +direction lock & sink-retire
//         4 = probability density (the default; L2/L3 remain as a documented
//         progression and a never-null safety fallback if density finds nothing).

const DEFAULT_LENGTHS: Record<string, number> = {
  CARRIER: 5,
  BATTLESHIP: 4,
  CRUISER: 3,
  SUBMARINE: 3,
  DESTROYER: 2,
};

import { FIXED_LAYOUTS } from "./fingerprints.ts";
import { DANGER_MAPS } from "./danger_maps.ts";

const SHOT_LEVEL = Number(process.env.SHOT_LEVEL ?? "4");
const FINGERPRINT = (process.env.FINGERPRINT ?? "on") === "on";
// Opponents place ships non-adjacent (data: 0/992 touching) → exploit the halo.
const ENEMY_NOTOUCH = (process.env.ENEMY_NOTOUCH ?? "on") === "on";
// "bottom" biases placement toward high row indices — heatmaps show opponents
// sweep top-down (rows 0-6 hot, rows 8-9 nearly untouched), so bottom ships get
// hit last → fewer of our ships sunk before we win. "random" = uniform baseline.
const PLACEMENT = process.env.PLACEMENT ?? "bottom";
// Spread ships so a found ship doesn't reveal neighbors (opponent target-mode
// wastes shots on water instead of chain-sinking). Adjacency is legal; this is
// a tactic, not a rule. Default on.
const NO_TOUCH = (process.env.NO_TOUCH ?? "on") === "on";
// Smart placement: place ships on the current opponent's lowest-danger cells
// (learned per-opponent shot-timing from the archive) to minimise expected ship
// loss during our ~40-shot win. Falls back to bottom-bias for unknown opponents.
const SMART_PLACE = (process.env.SMART_PLACE ?? "on") === "on";

// Max of N uniform draws in [0,max] — skews toward `max` (the bottom). N from
// PLACEMENT_SKEW. Default 3: concentrates ships in the coldest rows (8–9). This
// only helps because NO_TOUCH prevents the chain-sinks that made SKEW=3 lose
// when clustering was allowed — together they cut ships-lost 42→35.
const SKEW = Number(process.env.PLACEMENT_SKEW ?? "3");
function biasedRow(max: number): number {
  let r = 0;
  for (let i = 0; i < SKEW; i++) r = Math.max(r, Math.floor(Math.random() * (max + 1)));
  return r;
}

type Cell = { row: number; col: number };
const key = (r: number, c: number) => `${r},${c}`;
const NEIGHBORS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

function boardDims(state: any): { R: number; C: number } {
  return {
    R: state?.board?.gridRows ?? 10,
    C: state?.board?.gridCols ?? 10,
  };
}

function shipClasses(state: any): { class: string; length: number }[] {
  const sc = state?.board?.shipClasses;
  if (Array.isArray(sc) && sc.length) return sc;
  return Object.entries(DEFAULT_LENGTHS).map(([cls, length]) => ({
    class: cls,
    length,
  }));
}

// ---------------------------------------------------------------- PLACEMENT

// Enumerate every on-board (orientation, position) for a ship of length `len`.
function shipPositions(len: number, R: number, C: number) {
  const out: { horiz: boolean; r: number; c: number; cells: Cell[] }[] = [];
  for (const horiz of [true, false]) {
    const rMax = horiz ? R - 1 : R - len;
    const cMax = horiz ? C - len : C - 1;
    for (let r = 0; r <= rMax; r++) {
      for (let c = 0; c <= cMax; c++) {
        const cells: Cell[] = [];
        for (let i = 0; i < len; i++)
          cells.push(horiz ? { row: r, col: c + i } : { row: r + i, col: c });
        out.push({ horiz, r, c, cells });
      }
    }
  }
  return out;
}

function touchesUsed(cells: Cell[], used: Set<string>): boolean {
  return cells.some((cell) =>
    [-1, 0, 1].some((dr) =>
      [-1, 0, 1].some((dc) => used.has(key(cell.row + dr, cell.col + dc))),
    ),
  );
}

// Per-opponent damage-minimising placement: for each ship (largest first), pick
// among the lowest-danger legal+no-touch positions (light randomness to stay
// unpredictable). This is the in-run "engineer the placement from memory" step.
function smartLayout(state: any, danger: number[][]): any[] {
  const { R, C } = boardDims(state);
  const ships = [...shipClasses(state)].sort((a, b) => b.length - a.length);
  const used = new Set<string>();
  const placements: any[] = [];

  for (const ship of ships) {
    let pool = shipPositions(ship.length, R, C).filter(
      (p) => !p.cells.some((c) => used.has(key(c.row, c.col))) && !touchesUsed(p.cells, used),
    );
    if (!pool.length) {
      // no no-touch spot left — relax to just non-overlapping
      pool = shipPositions(ship.length, R, C).filter(
        (p) => !p.cells.some((c) => used.has(key(c.row, c.col))),
      );
    }
    const scored = pool
      .map((p) => ({ p, s: p.cells.reduce((a, c) => a + (danger[c.row]?.[c.col] ?? 0), 0) }))
      .sort((a, b) => a.s - b.s);
    // randomise among the safest few (≤8) to avoid a fully fixed layout
    const k = Math.min(8, scored.length);
    const pick = scored[Math.floor(Math.random() * k)].p;
    pick.cells.forEach((c) => used.add(key(c.row, c.col)));
    placements.push({
      shipClass: ship.class,
      orientation: pick.horiz ? "HORIZONTAL" : "VERTICAL",
      startRow: pick.r,
      startCol: pick.c,
    });
  }
  return placements;
}

export function chooseLayout(state: any): any[] {
  const { R, C } = boardDims(state);
  const opp = state?.opponent?.displayName;
  if (SMART_PLACE && opp && DANGER_MAPS[opp]) return smartLayout(state, DANGER_MAPS[opp]);

  const ships = [...shipClasses(state)].sort((a, b) => b.length - a.length);
  const used = new Set<string>();
  const placements: any[] = [];

  for (const ship of ships) {
    let placed = false;
    for (let attempt = 0; attempt < 2000 && !placed; attempt++) {
      const horiz = Math.random() < 0.5;
      const len = ship.length;
      const bias = PLACEMENT === "bottom";
      let r: number, c: number, cells: Cell[];
      if (horiz) {
        r = bias ? biasedRow(R - 1) : Math.floor(Math.random() * R);
        c = Math.floor(Math.random() * (C - len + 1));
        cells = Array.from({ length: len }, (_, i) => ({ row: r, col: c + i }));
      } else {
        // vertical ship occupies rows r..r+len-1; bias its TOP so the ship sits low
        r = bias ? biasedRow(R - len) : Math.floor(Math.random() * (R - len + 1));
        c = Math.floor(Math.random() * C);
        cells = Array.from({ length: len }, (_, i) => ({ row: r + i, col: c }));
      }
      if (cells.some((cell) => used.has(key(cell.row, cell.col)))) continue;
      if (
        NO_TOUCH &&
        attempt < 1500 && // relax near the retry cap so placement always succeeds
        cells.some((cell) =>
          [-1, 0, 1].some((dr) =>
            [-1, 0, 1].some((dc) => used.has(key(cell.row + dr, cell.col + dc))),
          ),
        )
      )
        continue;
      cells.forEach((cell) => used.add(key(cell.row, cell.col)));
      placements.push({
        shipClass: ship.class,
        orientation: horiz ? "HORIZONTAL" : "VERTICAL",
        startRow: r,
        startCol: c,
      });
      placed = true;
    }
    if (!placed) throw new Error(`could not place ${ship.class} after 2000 tries`);
  }
  return placements;
}

// Pre-flight validation (guide §10). Throws → we crash before sending an
// illegal layout (which would be a terminal DQ, not a retry).
export function validatePlacements(placements: any[], state: any): void {
  const { R, C } = boardDims(state);
  const lengths = Object.fromEntries(
    shipClasses(state).map((s) => [s.class, s.length]),
  );
  const expected = new Set(Object.keys(lengths));
  const seen = new Set<string>();
  const used = new Set<string>();

  for (const p of placements) {
    const len = lengths[p.shipClass];
    if (len === undefined) throw new Error(`unknown class ${p.shipClass}`);
    if (seen.has(p.shipClass)) throw new Error(`duplicate ${p.shipClass}`);
    seen.add(p.shipClass);
    const horiz = p.orientation === "HORIZONTAL";
    if (horiz && p.startCol + len > C) throw new Error(`${p.shipClass} off-board H`);
    if (!horiz && p.startRow + len > R) throw new Error(`${p.shipClass} off-board V`);
    for (let i = 0; i < len; i++) {
      const cell = horiz
        ? key(p.startRow, p.startCol + i)
        : key(p.startRow + i, p.startCol);
      if (used.has(cell)) throw new Error(`${p.shipClass} overlap`);
      used.add(cell);
    }
  }
  if (seen.size !== expected.size) {
    throw new Error(`missing classes: expected ${[...expected]} got ${[...seen]}`);
  }
}

// ---------------------------------------------------------------- SHOOTING

type Shot = { row: number; col: number; outcome: string; sunkShipClass?: string };

function readShots(state: any): Shot[] {
  return Array.isArray(state?.yourShots) ? state.yourShots : [];
}

// Analyze the board from shot history (shared by L2/L3 targeting and L4 density):
//  - openHits: HIT cells of ships NOT yet sunk (drive targeting)
//  - sunkSet:  cells attributed to sunk ships (no unsunk ship can sit there)
// When a SINK reveals a class+length, retire the straight run through the sink
// cell. Adjacency-allowed boards can chain ships; this is a heuristic.
function analyzeBoard(state: any): { openHits: Cell[]; sunkSet: Set<string> } {
  const shots = readShots(state);
  const outcome = new Map<string, Shot>();
  for (const s of shots) outcome.set(key(s.row, s.col), s);
  const isShip = (r: number, c: number) => {
    const o = outcome.get(key(r, c));
    return o && (o.outcome === "HIT" || o.outcome === "SINK");
  };

  const lengths = Object.fromEntries(
    shipClasses(state).map((s) => [s.class, s.length]),
  );
  const sunkSet = new Set<string>();

  for (const s of shots) {
    if (s.outcome !== "SINK") continue;
    const len = lengths[s.sunkShipClass ?? ""] ?? 0;
    if (!len) {
      sunkSet.add(key(s.row, s.col));
      continue;
    }
    for (const [dr, dc] of [
      [0, 1],
      [1, 0],
    ] as const) {
      let lo = 0;
      while (isShip(s.row - dr * (lo + 1), s.col - dc * (lo + 1))) lo++;
      let hi = 0;
      while (isShip(s.row + dr * (hi + 1), s.col + dc * (hi + 1))) hi++;
      if (lo + hi + 1 >= len) {
        const start = -Math.min(lo, len - 1);
        for (let i = 0; i < len; i++) {
          sunkSet.add(key(s.row + dr * (start + i), s.col + dc * (start + i)));
        }
        break;
      }
    }
  }

  const openHits: Cell[] = [];
  for (const s of shots) {
    if (s.outcome === "HIT" && !sunkSet.has(key(s.row, s.col))) {
      openHits.push({ row: s.row, col: s.col });
    }
  }
  return { openHits, sunkSet };
}

function computeOpenHits(state: any): Cell[] {
  return analyzeBoard(state).openHits;
}

function onBoard(r: number, c: number, R: number, C: number) {
  return r >= 0 && r < R && c >= 0 && c < C;
}

// Level 3 targeting: prefer extending a locked line of ≥2 collinear open hits;
// else fire an untried neighbor of any open hit.
function targetShot(
  open: Cell[],
  tried: Set<string>,
  R: number,
  C: number,
): Cell | null {
  const openSet = new Set(open.map((h) => key(h.row, h.col)));

  // Locked lines first (Level 3). Look for an open hit with a collinear open
  // neighbor; extend that axis from either end.
  if (SHOT_LEVEL >= 3) {
    for (const h of open) {
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ] as const) {
        if (!openSet.has(key(h.row + dr, h.col + dc))) continue;
        // Found a line along (dr,dc). Walk to both ends, try extending.
        let lo = h;
        while (openSet.has(key(lo.row - dr, lo.col - dc)))
          lo = { row: lo.row - dr, col: lo.col - dc };
        let hi = h;
        while (openSet.has(key(hi.row + dr, hi.col + dc)))
          hi = { row: hi.row + dr, col: hi.col + dc };
        const ends = [
          { row: lo.row - dr, col: lo.col - dc },
          { row: hi.row + dr, col: hi.col + dc },
        ];
        for (const e of ends) {
          if (onBoard(e.row, e.col, R, C) && !tried.has(key(e.row, e.col))) return e;
        }
      }
    }
  }

  // Single-hit (or unresolved) fallback: any untried orthogonal neighbor.
  for (const h of open) {
    for (const [dr, dc] of NEIGHBORS) {
      const nr = h.row + dr,
        nc = h.col + dc;
      if (onBoard(nr, nc, R, C) && !tried.has(key(nr, nc))) return { row: nr, col: nc };
    }
  }
  return null;
}

// Level 2 hunt: parity-masked random over untried cells.
function huntShot(tried: Set<string>, R: number, C: number): Cell {
  const parity: Cell[] = [];
  const any: Cell[] = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (tried.has(key(r, c))) continue;
      any.push({ row: r, col: c });
      if ((r + c) % 2 === 0) parity.push({ row: r, col: c });
    }
  }
  const pool = parity.length ? parity : any;
  if (!pool.length) throw new Error("no untried cells left to shoot");
  return pool[Math.floor(Math.random() * pool.length)];
}

export function chooseShot(state: any): Cell {
  const { R, C } = boardDims(state);
  const tried = new Set(readShots(state).map((s) => key(s.row, s.col)));

  // Fingerprint exploit: if this opponent reuses a known fixed layout, fire its
  // known ship cells first (all hits → fast win). Self-disables after 2 misses
  // on known cells (layout changed) → falls through to density. Env-gated.
  if (FINGERPRINT) {
    const opp = state?.opponent?.displayName;
    const known = opp ? FIXED_LAYOUTS[opp] : undefined;
    if (known) {
      const knownSet = new Set(known.map(([r, c]) => key(r, c)));
      const missOnKnown = readShots(state).filter(
        (s) => s.outcome === "MISS" && knownSet.has(key(s.row, s.col)),
      ).length;
      if (missOnKnown < 2) {
        for (const [r, c] of known) {
          if (!tried.has(key(r, c))) return assertShot({ row: r, col: c }, tried, R, C);
        }
      }
    }
  }

  // Level 4 hook — implement only when greenlit; until then fall through.
  if (SHOT_LEVEL >= 4) {
    const dense = densityShot(state, tried, R, C);
    if (dense) return assertShot(dense, tried, R, C);
  }

  const open = computeOpenHits(state);
  if (open.length) {
    const t = targetShot(open, tried, R, C);
    if (t) return assertShot(t, tried, R, C);
  }
  return assertShot(huntShot(tried, R, C), tried, R, C);
}

// Level 4: probability density (parity-boosted, focus-fire targeting).
//  - TARGET (open hits exist): count ONLY placements that cover ≥1 open hit,
//    weighted 8^(hitsCovered) so a placement extending a 2-hit line dominates.
//    This focus-fires the known ship instead of smearing weight board-wide.
//  - HUNT (no open hits): pure per-cell placement density + a 20% checkerboard
//    boost (every ship ≥2 cells ⇒ covers a parity cell), per the standard
//    probability solver. Lower average shots than flat density or parity alone.
function densityShot(state: any, tried: Set<string>, R: number, C: number): Cell | null {
  const shots = readShots(state);
  const water = new Set<string>(
    shots.filter((s: any) => s.outcome === "MISS").map((s: any) => key(s.row, s.col)),
  );
  const { openHits, sunkSet } = analyzeBoard(state);
  const openKeys = new Set(openHits.map((h) => key(h.row, h.col)));

  // NO-TOUCH inference (data: opponents place every ship non-adjacent, 0/992
  // touching). A ship is a straight line, so a ship cell's DIAGONAL neighbours
  // are never the same ship, and no-touch ⇒ never another ship ⇒ always water.
  // A SUNK ship's full 8-neighbour halo is water (ship complete). Pruning these
  // sharpens the density map and stops wasted shots around hits/sinks.
  if (ENEMY_NOTOUCH) {
    const shipCells = shots.filter((s: any) => s.outcome === "HIT" || s.outcome === "SINK");
    for (const s of shipCells) {
      for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
        if (onBoard(s.row + dr, s.col + dc, R, C)) water.add(key(s.row + dr, s.col + dc));
      }
    }
    for (const k of sunkSet) {
      const [r, c] = k.split(",").map(Number);
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          if ((dr || dc) && onBoard(r + dr, c + dc, R, C)) water.add(key(r + dr, c + dc));
    }
    for (const k of openKeys) water.delete(k); // never mark a known ship cell as water
  }

  const blocked = (k: string) => water.has(k) || sunkSet.has(k);
  const targeting = openHits.length > 0;

  const sunkClasses = new Set(state?.sunkOpponentShipClasses ?? []);
  const unsunk = shipClasses(state).filter((s) => !sunkClasses.has(s.class));

  const heat = new Map<string, number>();
  const add = (k: string, w: number) => heat.set(k, (heat.get(k) ?? 0) + w);

  for (const ship of unsunk) {
    const L = ship.length;
    for (const horiz of [true, false]) {
      const rMax = horiz ? R : R - L;
      const cMax = horiz ? C - L : C;
      for (let r = 0; r < rMax; r++) {
        for (let c = 0; c < cMax; c++) {
          const cells: string[] = [];
          for (let i = 0; i < L; i++) cells.push(horiz ? key(r, c + i) : key(r + i, c));
          if (cells.some(blocked)) continue; // can't sit on a miss or sunk cell
          const hb = cells.filter((k) => openKeys.has(k)).length;
          if (targeting && hb === 0) continue; // focus-fire: ignore non-hit placements
          const w = targeting ? Math.pow(8, hb) : 1;
          for (const k of cells) if (!tried.has(k)) add(k, w);
        }
      }
    }
  }

  let best: Cell | null = null;
  let bestW = -1;
  for (const [k, w0] of heat) {
    const [r, c] = k.split(",").map(Number);
    const w = !targeting && (r + c) % 2 === 0 ? w0 * 1.2 : w0; // checkerboard boost in hunt
    if (w > bestW) {
      bestW = w;
      best = { row: r, col: c };
    }
  }
  return best;
}

function assertShot(cell: Cell, tried: Set<string>, R: number, C: number): Cell {
  if (!onBoard(cell.row, cell.col, R, C))
    throw new Error(`off-board shot ${cell.row},${cell.col}`);
  if (tried.has(key(cell.row, cell.col)))
    throw new Error(`duplicate shot ${cell.row},${cell.col}`);
  return cell;
}

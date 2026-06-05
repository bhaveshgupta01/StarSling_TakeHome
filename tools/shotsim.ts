// Offline shot-count harness: run the REAL chooseShot against random no-touch
// enemy layouts (mimicking the 11 uniform randomizers) and measure how many
// shots we need to sink all ships. Faithful for OUR shooting because only the
// enemy's PLACEMENT matters to our shot count, not their shooting.
//   node --experimental-strip-types tools/shotsim.ts [N]
import { chooseShot } from "../src/strategy.ts";

const R = 10, C = 10;
const SHIPS = [
  { class: "CARRIER", length: 5 },
  { class: "BATTLESHIP", length: 4 },
  { class: "CRUISER", length: 3 },
  { class: "SUBMARINE", length: 3 },
  { class: "DESTROYER", length: 2 },
];
const key = (r: number, c: number) => `${r},${c}`;

function randomNoTouchLayout(): Map<string, string> {
  // returns cell -> shipClass
  for (let attempt = 0; attempt < 200; attempt++) {
    const occupied = new Map<string, string>();
    const used = new Set<string>();
    let ok = true;
    for (const ship of [...SHIPS].sort((a, b) => b.length - a.length)) {
      let placed = false;
      for (let t = 0; t < 500 && !placed; t++) {
        const horiz = Math.random() < 0.5;
        const len = ship.length;
        const r = horiz ? Math.floor(Math.random() * R) : Math.floor(Math.random() * (R - len + 1));
        const c = horiz ? Math.floor(Math.random() * (C - len + 1)) : Math.floor(Math.random() * C);
        const cells = Array.from({ length: len }, (_, i) =>
          horiz ? { row: r, col: c + i } : { row: r + i, col: c },
        );
        const touch = cells.some((cell) =>
          [-1, 0, 1].some((dr) => [-1, 0, 1].some((dc) => used.has(key(cell.row + dr, cell.col + dc)))),
        );
        if (touch) continue;
        cells.forEach((cell) => {
          used.add(key(cell.row, cell.col));
          occupied.set(key(cell.row, cell.col), ship.class);
        });
        placed = true;
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return occupied;
  }
  throw new Error("could not build layout");
}

function playGame(occupied: Map<string, string>): number {
  // ship class -> remaining cells, to know when a ship sinks
  const remaining = new Map<string, number>();
  for (const s of SHIPS) remaining.set(s.class, s.length);
  const yourShots: any[] = [];
  const sunkOpponentShipClasses: string[] = [];
  const board = { gridRows: R, gridCols: C, shipClasses: SHIPS };
  let totalHits = 0;
  const totalShipCells = SHIPS.reduce((a, s) => a + s.length, 0);

  for (let shot = 0; shot < 100; shot++) {
    if (totalHits >= totalShipCells) return shot; // all sunk
    const state = { board, yourShots, sunkOpponentShipClasses, opponent: { displayName: "__sim__" } };
    const cell = chooseShot(state);
    const k = key(cell.row, cell.col);
    const cls = occupied.get(k);
    if (cls) {
      totalHits++;
      const left = remaining.get(cls)! - 1;
      remaining.set(cls, left);
      if (left === 0) {
        sunkOpponentShipClasses.push(cls);
        yourShots.push({ row: cell.row, col: cell.col, outcome: "SINK", sunkShipClass: cls });
      } else {
        yourShots.push({ row: cell.row, col: cell.col, outcome: "HIT" });
      }
    } else {
      yourShots.push({ row: cell.row, col: cell.col, outcome: "MISS" });
    }
  }
  return 100; // safety
}

const N = Number(process.argv[2] ?? "500");
const results: number[] = [];
for (let i = 0; i < N; i++) results.push(playGame(randomNoTouchLayout()));
results.sort((a, b) => a - b);
const pct = (p: number) => results[Math.min(results.length - 1, Math.floor(p * (results.length - 1)))];
const mean = results.reduce((a, b) => a + b, 0) / results.length;
const over50 = results.filter((x) => x > 50).length;
console.log(`N=${N}  mean=${mean.toFixed(1)}  p10=${pct(0.1)} p50=${pct(0.5)} p90=${pct(0.9)} max=${pct(1)}  >50: ${(100 * over50 / N).toFixed(1)}%`);

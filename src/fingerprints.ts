// Fixed-layout opponents (fire these known ship cells first → ~16-shot win, ~0
// loss). Re-validated 2026-06-04 against the full archive (52–56 samples each):
//   Hydra Probe       — 56 games, all 16 cells 100%  (Jaccard 1.00). Stable.
//   Eridanus Drone    — 55 games, all 16 cells 100%  (Jaccard 1.00). Stable.
//   Andromeda Cruiser — 54 games, 15 cells 100% but its DESTROYER flips: (6,0)
//     is always there, the 2nd cell is (7,0) ~70% / (5,0) ~30%. So we keep only
//     the 15 always-present cells and let the density solver finish the destroyer
//     from the (6,0) open hit (1–2 extra shots). Including (7,0) caused a wasted
//     miss 30% of games. (Jaccard ~0.93 — still effectively fixed.)
// Antares/Betelgeuse/Centauri were small-sample false positives — they RANDOMIZE
// (Centauri confirmed random at 19 samples, Jaccard 0.00–0.22). Excluded.
export const FIXED_LAYOUTS: Record<string, [number, number][]> = {
  "Hydra Probe": [[0, 0], [0, 2], [0, 4], [0, 6], [1, 0], [1, 2], [1, 4], [1, 6], [1, 8], [2, 0], [2, 2], [2, 4], [2, 6], [3, 0], [3, 2], [4, 0]],
  "Eridanus Drone": [[0, 0], [0, 1], [0, 2], [0, 9], [1, 9], [2, 9], [3, 6], [3, 7], [3, 9], [4, 9], [5, 4], [7, 4], [9, 0], [9, 1], [9, 2], [9, 3]],
  "Andromeda Cruiser": [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [3, 8], [4, 3], [4, 4], [4, 8], [5, 8], [6, 0], [6, 8], [8, 2], [8, 3], [8, 4]],
};

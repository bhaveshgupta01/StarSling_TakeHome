// Auto-extracted from analysis/games_archive.jsonl (93 games, 7 samples/opponent).
// Only opponents with a PERFECTLY stable layout (Jaccard=1.0 across all attempts).
// Firing these known ship cells first wins the race in ~17 shots → ~0 ships lost.
// Antares/Betelgeuse were small-sample false positives (later random) — excluded.
export const FIXED_LAYOUTS: Record<string, [number, number][]> = {
  "Hydra Probe": [[0, 0], [0, 2], [0, 4], [0, 6], [1, 0], [1, 2], [1, 4], [1, 6], [1, 8], [2, 0], [2, 2], [2, 4], [2, 6], [3, 0], [3, 2], [4, 0]],
  "Eridanus Drone": [[0, 0], [0, 1], [0, 2], [0, 9], [1, 9], [2, 9], [3, 6], [3, 7], [3, 9], [4, 9], [5, 4], [7, 4], [9, 0], [9, 1], [9, 2], [9, 3]],
  "Andromeda Cruiser": [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [3, 8], [4, 3], [4, 4], [4, 8], [5, 8], [6, 0], [6, 8], [7, 0], [8, 2], [8, 3], [8, 4]],
};

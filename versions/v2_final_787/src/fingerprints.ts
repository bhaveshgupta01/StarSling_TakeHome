// Auto-extracted from analysis/games_archive.jsonl (93 games, 7 samples/opponent).
// Only opponents with a PERFECTLY stable layout (Jaccard=1.0 across all attempts).
// Firing these known ship cells first wins the race in ~17 shots → ~0 ships lost.
// Antares/Betelgeuse were small-sample false positives (later random) — excluded.
export const FIXED_LAYOUTS: Record<string, [number, number][]> = {
  "Hydra Probe": [[0, 0], [0, 2], [0, 4], [0, 6], [1, 0], [1, 2], [1, 4], [1, 6], [1, 8], [2, 0], [2, 2], [2, 4], [2, 6], [3, 0], [3, 2], [4, 0]],
  "Eridanus Drone": [[0, 0], [0, 1], [0, 2], [0, 9], [1, 9], [2, 9], [3, 6], [3, 7], [3, 9], [4, 9], [5, 4], [7, 4], [9, 0], [9, 1], [9, 2], [9, 3]],
  // NB: Centauri Battlecruiser looked fixed at 2 samples (Jaccard 0.938) but the
  // 3rd sample was a totally different layout (Jaccard 0.000) — a small-sample
  // false positive, same trap as Antares/Betelgeuse. It RANDOMIZES. Not added.
  // (The 2-miss self-disable guard meant the bad fingerprint cost nothing live.)
};

#!/usr/bin/env python3
"""Deep analysis of opponent behavior from analysis/games_archive.jsonl (cumulative
across attempts). Answers: where do opponents SHOOT (avoid placing there) and where
do they PLACE ships (shoot there first), and is either DETERMINISTIC per opponent?
No deps. Run: python3 tools/analyze.py"""
import json, os
from collections import defaultdict

ARCH = os.path.join(os.path.dirname(__file__), "..", "analysis", "games_archive.jsonl")
DETAIL = os.path.join(os.path.dirname(__file__), "..", "games_detail.jsonl")
SHADE = " .:-=+*#%@"

def grid(counts, R=10, C=10):
    mx = max((counts[r][c] for r in range(R) for c in range(C)), default=0) or 1
    out = ["      " + " ".join(f"{c}" for c in range(C))]
    for r in range(R):
        cells = [SHADE[min(9, round(counts[r][c] / mx * 9))] for c in range(C)]
        out.append(f"   {r}  " + " ".join(cells))
    return "\n".join(out), mx

def blank():
    return [[0] * 10 for _ in range(10)]

def load():
    path = ARCH if os.path.exists(ARCH) and os.path.getsize(ARCH) else DETAIL
    if not os.path.exists(path):
        return [], path
    return [json.loads(l) for l in open(path) if l.strip()], path

def enemy_ship_cells(g):
    return {(r, c) for r, c, o, _ in g.get("yourShots", []) if o in ("HIT", "SINK")}

def main():
    games, path = load()
    if not games:
        print("no data yet"); return
    attempts = len({g.get("runLabel") for g in games})
    print(f"{len(games)} games from {os.path.basename(path)} ({attempts} run-labels)\n")

    incoming, placement = blank(), blank()
    for g in games:
        for r, c, _ in g.get("incomingShots", []):
            incoming[r][c] += 1
        for (r, c) in enemy_ship_cells(g):
            placement[r][c] += 1

    s, mx = grid(incoming)
    print(f"=== ENEMY SHOOTING (where they fire — AVOID placing here). max={mx} ===\n{s}\n")
    s, mx = grid(placement)
    print(f"=== ENEMY PLACEMENT (our hits — SHOOT here first). max={mx} ===\n{s}\n")

    # Coldest columns/rows for our placement (fewest enemy shots).
    rowsum = [sum(incoming[r]) for r in range(10)]
    colsum = [sum(incoming[r][c] for r in range(10)) for c in range(10)]
    print("enemy shots by ROW :", [f"{i}:{v}" for i, v in enumerate(rowsum)])
    print("enemy shots by COL :", [f"{i}:{v}" for i, v in enumerate(colsum)])
    print("coldest rows (place here):", sorted(range(10), key=lambda r: rowsum[r])[:4])
    print("coldest cols (place here):", sorted(range(10), key=lambda c: colsum[c])[:4], "\n")

    # Determinism per opponent across attempts.
    print("=== DETERMINISM per opponent (across attempts) ===")
    by_opp = defaultdict(list)
    for g in games:
        by_opp[g.get("opponent") or f"ord{g['gameOrdinal']}"].append(g)
    for opp, gs in by_opp.items():
        if len(gs) < 2:
            print(f"  {opp:<22} only {len(gs)} attempt — need ≥2 to compare"); continue
        # placement determinism: Jaccard of enemy ship cells between attempts
        cellsets = [enemy_ship_cells(g) for g in gs]
        base = cellsets[0]
        jac = []
        for cs in cellsets[1:]:
            u = len(base | cs); jac.append(len(base & cs) / u if u else 0)
        # shooting determinism: do first 8 incoming shots match attempt-to-attempt?
        opens = [tuple((r, c) for r, c, _ in g.get("incomingShots", [])[:8]) for g in gs]
        same_open = all(o == opens[0] for o in opens)
        print(f"  {opp:<22} n={len(gs)} placement-Jaccard~{sum(jac)/len(jac):.2f} "
              f"openingShotsIdentical={same_open}")

if __name__ == "__main__":
    main()

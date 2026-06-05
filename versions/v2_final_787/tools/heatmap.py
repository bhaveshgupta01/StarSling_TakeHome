#!/usr/bin/env python3
"""ASCII heatmaps from games_detail.jsonl. No deps. Run: python3 tools/heatmap.py"""
import json, sys, os
from collections import defaultdict

PATH = os.path.join(os.path.dirname(__file__), "..", "games_detail.jsonl")
SHADE = " .:-=+*#%@"  # low -> high intensity

def grid_str(counts, R=10, C=10):
    mx = max((counts[r][c] for r in range(R) for c in range(C)), default=0) or 1
    out = ["     " + " ".join(f"{c}" for c in range(C))]
    for r in range(R):
        row = []
        for c in range(C):
            v = counts[r][c]
            row.append(SHADE[min(len(SHADE) - 1, round(v / mx * (len(SHADE) - 1)))])
        out.append(f"  {r}  " + " ".join(row))
    return "\n".join(out), mx

def blank():
    return [[0] * 10 for _ in range(10)]

def main():
    if not os.path.exists(PATH):
        print("no games_detail.jsonl yet"); return
    games = [json.loads(l) for l in open(PATH) if l.strip()]
    print(f"{len(games)} games\n")

    incoming = blank()          # opponent shots at us, all games
    incoming_by_cls = defaultdict(blank)
    our_shots = blank()
    for g in games:
        for r, c, _ in g.get("incomingShots", []):
            incoming[r][c] += 1
            incoming_by_cls[g.get("opponentClass") or "?"][r][c] += 1
        for r, c, _ in g.get("yourShots", []):
            our_shots[r][c] += 1

    s, mx = grid_str(incoming)
    print(f"=== OPPONENT INCOMING SHOTS (all {len(games)} games, max/cell={mx}) ===\n{s}\n")
    for cls, cnt in incoming_by_cls.items():
        s, mx = grid_str(cnt)
        print(f"=== INCOMING by {cls} (max/cell={mx}) ===\n{s}\n")
    s, mx = grid_str(our_shots)
    print(f"=== OUR SHOTS (all games, max/cell={mx}) ===\n{s}\n")

    # Determinism probe: are the first 12 incoming shots identical across games?
    print("=== OPENING incoming sequence (first 12) per game — identical => deterministic bot ===")
    for g in games:
        seq = [(r, c) for r, c, _ in g.get("incomingShots", [])[:12]]
        print(f"  G{g['gameOrdinal']:>2} {g.get('opponentClass','?'):<8} {seq}")

if __name__ == "__main__":
    main()

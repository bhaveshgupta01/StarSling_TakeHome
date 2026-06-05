#!/usr/bin/env python3
"""Determinism check for an opponent: are its ship cells the same every game?
Ship cells = where OUR shots HIT/SINK (yourShots). Pairwise Jaccard ~1.0 across
games => fixed layout => fingerprintable (fire known cells first, 16-shot win).
Usage: python3 tools/check_fixed.py "Centauri Battlecruiser" """
import json, sys
from itertools import combinations
opp = sys.argv[1] if len(sys.argv) > 1 else "Centauri Battlecruiser"
layouts = []
for l in open("analysis/games_archive.jsonl"):
    l=l.strip()
    if not l: continue
    d=json.loads(l)
    if d["opponent"] != opp: continue
    cells = frozenset((s[0],s[1]) for s in d["yourShots"] if s[2] in ("HIT","SINK"))
    layouts.append((d.get("runLabel"), cells))
print(f"{opp}: {len(layouts)} game(s)")
for rl,cells in layouts:
    print(f"  {rl}: {len(cells)} hit cells  {sorted(cells)}")
if len(layouts) >= 2:
    js=[len(a&b)/len(a|b) for (_,a),(_,b) in combinations([l for l in layouts],2)]
    print(f"pairwise Jaccard: min={min(js):.3f} mean={sum(js)/len(js):.3f} max={max(js):.3f}")
    inter=set.intersection(*[set(c) for _,c in layouts])
    union=set.union(*[set(c) for _,c in layouts])
    print(f"cells in ALL games ({len(inter)}): {sorted(inter)}")
    print(f"FIXED" if min(js)>0.85 else "NOT fixed (randomizes)")

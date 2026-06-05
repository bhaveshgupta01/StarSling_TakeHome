#!/usr/bin/env python3
"""Per-opponent shooting adaptivity: do they hunt+target (fire next-to-a-hit)
or shoot blind? If an opponent does NOT target after a hit, we can place ships
TOUCHING / clustered in its cold zone with no chain-sink penalty -> less total
exposure. This finds those opponents.

adaptivity = P(next shot ortho-adjacent | prev was HIT) - P(... | prev was MISS).
High positive (>~0.2) = adaptive targeter (must spread, NO_TOUCH). ~0 = blind
shooter (touching is free; cluster in cold rows)."""
import json, sys
from collections import defaultdict

ARCHIVE = sys.argv[1] if len(sys.argv) > 1 else "analysis/games_archive.jsonl"
games = defaultdict(list)
with open(ARCHIVE) as f:
    for line in f:
        line=line.strip()
        if line: d=json.loads(line); games[d["opponent"]].append(d)

def ortho(a,b):
    return abs(a[0]-b[0])+abs(a[1]-b[1])==1

print(f"{'opponent':22} {'n':>3} {'adjHit':>7} {'adjMiss':>8} {'index':>7}  verdict")
for opp,glist in sorted(games.items()):
    hit_next_adj=hit_n=miss_next_adj=miss_n=0
    for g in glist:
        inc=g["incomingShots"]
        for i in range(len(inc)-1):
            prev=inc[i]; cur=inc[i+1]
            adj=ortho(prev,cur)
            if prev[2] in ("HIT","SINK"):
                hit_n+=1; hit_next_adj+=adj
            elif prev[2]=="MISS":
                miss_n+=1; miss_next_adj+=adj
    ph=hit_next_adj/hit_n if hit_n else 0.0
    pm=miss_next_adj/miss_n if miss_n else 0.0
    idx=ph-pm
    verdict = "ADAPTIVE (spread)" if idx>0.20 else ("weak" if idx>0.08 else "BLIND -> touch OK")
    print(f"{opp:22} {len(glist):>3} {ph:>7.2f} {pm:>8.2f} {idx:>7.2f}  {verdict}")

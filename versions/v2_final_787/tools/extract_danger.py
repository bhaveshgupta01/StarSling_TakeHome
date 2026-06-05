#!/usr/bin/env python3
"""Extract per-opponent danger maps from the game archive.

danger[r][c] = fraction of that opponent's games where it fired at (r,c)
within an exposure window K. Two modes:
  - fixed K=40 (the current v1 behaviour)
  - "matched": K = that opponent's median win length (len of OUR shots),
    so the window reflects the real exposure of a typical game vs that
    opponent. Long-game opponents (Polaris ~54) get a longer window, giving
    real ranking signal in the bottom rows where we actually place ships.

Also prints, per opponent: n games, median/p90 win length, and an OFFLINE
placement comparison: expected contacted ship-cells of a greedy low-danger
layout, scored under the HONEST full-exposure map (every incoming shot of
the game), for both the v1 (K=40) guide map and the matched-K guide map.
The honest metric is the fair judge of which guide map places better.
"""
import json, sys, statistics, random
from collections import defaultdict

ARCHIVE = sys.argv[1] if len(sys.argv) > 1 else "analysis/games_archive.jsonl"
R = C = 10
SHIPS = [("CARRIER",5),("BATTLESHIP",4),("CRUISER",3),("SUBMARINE",3),("DESTROYER",2)]

games = defaultdict(list)
with open(ARCHIVE) as f:
    for line in f:
        line=line.strip()
        if not line: continue
        d=json.loads(line)
        games[d["opponent"]].append(d)

def win_len(g):
    return len(g["yourShots"])

def danger_map(glist, K):
    """fraction of games where (r,c) in the first K incoming shots."""
    n=len(glist)
    cnt=[[0]*C for _ in range(R)]
    for g in glist:
        seen=set()
        for s in g["incomingShots"][:K]:
            seen.add((s[0],s[1]))
        for (r,c) in seen:
            if 0<=r<R and 0<=c<C: cnt[r][c]+=1
    return [[round(cnt[r][c]/n,3) if n else 0.0 for c in range(C)] for r in range(R)]

def full_exposure_map(glist):
    """honest: fraction of games where (r,c) fired at ALL during the game."""
    n=len(glist)
    cnt=[[0]*C for _ in range(R)]
    for g in glist:
        seen=set((s[0],s[1]) for s in g["incomingShots"])
        for (r,c) in seen:
            if 0<=r<R and 0<=c<C: cnt[r][c]+=1
    return [[cnt[r][c]/n if n else 0.0 for c in range(C)] for r in range(R)]

def ship_positions(L):
    out=[]
    for horiz in (True,False):
        rMax = R-1 if horiz else R-L
        cMax = C-L if horiz else C-1
        for r in range(rMax+1):
            for c in range(cMax+1):
                cells=[(r,c+i) if horiz else (r+i,c) for i in range(L)]
                out.append(cells)
    return out

def touches(cells, used):
    for (r,c) in cells:
        for dr in (-1,0,1):
            for dc in (-1,0,1):
                if (r+dr,c+dc) in used: return True
    return False

def greedy_layout(guide, seed=0):
    """mirror smartLayout: largest first, lowest summed-guide-danger, top-8 random."""
    rnd=random.Random(seed)
    used=set(); layout=[]
    for cls,L in sorted(SHIPS,key=lambda x:-x[1]):
        pool=[cs for cs in ship_positions(L)
              if not any(p in used for p in cs) and not touches(cs,used)]
        if not pool:
            pool=[cs for cs in ship_positions(L) if not any(p in used for p in cs)]
        scored=sorted(pool,key=lambda cs:sum(guide[r][c] for (r,c) in cs))
        k=min(8,len(scored))
        pick=scored[rnd.randrange(k)]
        for p in pick: used.add(p)
        layout.append(pick)
    return layout

def expected_contacts(layout, honest):
    """expected number of our ship-cells the opponent fires at (under honest map)."""
    return sum(honest[r][c] for cells in layout for (r,c) in cells)

print(f"archive: {ARCHIVE}")
print(f"{'opponent':22} {'n':>3} {'med':>4} {'p90':>4}  {'v1@40':>6} {'matchK':>6}  {'EC_v1':>6} {'EC_mat':>6}")
v1_maps={}; matched_maps={}
tot_v1=tot_mat=0.0
for opp,glist in sorted(games.items()):
    n=len(glist)
    wl=sorted(win_len(g) for g in glist)
    med=int(statistics.median(wl))
    p90=wl[int(0.9*(n-1))]
    K=max(med,16)  # matched window
    v1=danger_map(glist,40)
    mat=danger_map(glist,K)
    honest=full_exposure_map(glist)
    v1_maps[opp]=v1; matched_maps[opp]=mat
    # offline placement comparison, averaged over seeds
    ec_v1=statistics.mean(expected_contacts(greedy_layout(v1,s),honest) for s in range(40))
    ec_mat=statistics.mean(expected_contacts(greedy_layout(mat,s),honest) for s in range(40))
    tot_v1+=ec_v1; tot_mat+=ec_mat
    print(f"{opp:22} {n:>3} {med:>4} {p90:>4}  {40:>6} {K:>6}  {ec_v1:>6.2f} {ec_mat:>6.2f}")
print(f"{'TOTAL expected contacts':22} {'':>3} {'':>4} {'':>4}  {'':>6} {'':>6}  {tot_v1:>6.2f} {tot_mat:>6.2f}")

# write matched maps if requested
if "--write" in sys.argv:
    out={opp:matched_maps[opp] for opp in sorted(matched_maps)}
    body=json.dumps(out)
    with open("src/danger_maps_v2.ts","w") as f:
        f.write("// Win-length-matched danger maps (K = per-opponent median win length).\n")
        f.write("// danger[r][c] = fraction of games this opponent fired at (r,c) within K shots.\n")
        f.write("// Auto-generated by tools/extract_danger.py from the archive.\n")
        f.write("export const DANGER_MAPS: Record<string, number[][]> = "+body+";\n")
    print("wrote src/danger_maps_v2.ts")

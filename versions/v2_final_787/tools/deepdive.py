#!/usr/bin/env python3
"""Deep data-science pass over the whole archive to find new strategy levers.
Angles:
  A. Opening-sequence determinism: do opponents fire a FIXED opening? If the
     first K incoming shots are identical across games, those cells are
     guaranteed-known => place to dodge them perfectly.
  B. Cold-region capacity: under the honest full-exposure map, how many cells
     are 'cold' (<thr) and can the 17-cell no-touch fleet hide there?
  C. Ship-loss attribution: which of OUR ship classes die most, and WHERE on
     the board do our losses happen (are some placement regions death traps)?
  D. Game-length vs ships-lost: quantify the driver.
  E. Per-opponent honest expected loss with the CURRENT vs an IDEAL placement
     (greedy on the honest map) — headroom left in placement.
"""
import json, statistics
from collections import defaultdict, Counter
from itertools import combinations

R=C=10
SHIPS=[("CARRIER",5),("BATTLESHIP",4),("CRUISER",3),("SUBMARINE",3),("DESTROYER",2)]
PEN={"CARRIER":14,"BATTLESHIP":12,"CRUISER":11,"SUBMARINE":10,"DESTROYER":8}

games=defaultdict(list)
for l in open("analysis/games_archive.jsonl"):
    l=l.strip()
    if l: d=json.loads(l); games[d["opponent"]].append(d)

FIXED={"Hydra Probe","Eridanus Drone","Andromeda Cruiser"}

def full_map(gl):
    n=len(gl);cnt=[[0]*C for _ in range(R)]
    for g in gl:
        for(r,c)in set((s[0],s[1])for s in g["incomingShots"]):
            if 0<=r<R and 0<=c<C:cnt[r][c]+=1
    return [[cnt[r][c]/n for c in range(C)] for r in range(R)]

print("="*70)
print("A. OPENING-SEQUENCE DETERMINISM (first 8 incoming shots)")
print("="*70)
print(f"{'opponent':22}{'n':>4}{'identical1st':>12}{'meanPrefix':>11}  interpretation")
for opp in sorted(games):
    gl=games[opp]; n=len(gl)
    # how deep is the common prefix of incoming shot (r,c) across games?
    seqs=[[(s[0],s[1]) for s in g["incomingShots"]] for g in gl]
    # fraction sharing the exact same first shot, and mean common-prefix length
    first=Counter(s[0] for s in seqs if s)
    frac_first=max(first.values())/n
    # mean pairwise common prefix length (sample to keep cheap)
    import random; rnd=random.Random(0)
    pairs=list(combinations(range(n),2)); rnd.shuffle(pairs); pairs=pairs[:200]
    def cpl(a,b):
        i=0
        while i<len(a) and i<len(b) and a[i]==b[i]: i+=1
        return i
    mp=statistics.mean(cpl(seqs[i],seqs[j]) for i,j in pairs) if pairs else 0
    interp="DETERMINISTIC opening" if mp>=6 else ("partial" if mp>=2 else "random order")
    print(f"{opp:22}{n:>4}{frac_first:>12.2f}{mp:>11.1f}  {interp}")

print()
print("="*70)
print("B. COLD-REGION CAPACITY (honest map; can the 17-cell fleet hide cold?)")
print("="*70)
print(f"{'opponent':22}{'cold<.20':>9}{'cold<.35':>9}{'minloss17':>10}  note")
def positions(L):
    o=[]
    for h in(True,False):
        for r in range((R-1 if h else R-L)+1):
            for c in range((C-L if h else C-1)+1):
                o.append([(r,c+i)if h else(r+i,c)for i in range(L)])
    return o
def touch(cs,u):return any((r+dr,c+dc)in u for(r,c)in cs for dr in(-1,0,1)for dc in(-1,0,1))
def greedy_min(honest):
    # place fleet greedily to minimize summed honest exposure (the ideal floor)
    u=set();tot=0
    for cls,L in sorted(SHIPS,key=lambda x:-x[1]):
        pool=[cs for cs in positions(L) if not any(p in u for p in cs) and not touch(cs,u)] or \
             [cs for cs in positions(L) if not any(p in u for p in cs)]
        best=min(pool,key=lambda cs:sum(honest[r][c] for(r,c)in cs))
        for p in best:u.add(p)
        tot+=sum(honest[r][c] for(r,c)in best)
    return tot
for opp in sorted(games):
    if opp in FIXED: continue
    h=full_map(games[opp])
    flat=[h[r][c] for r in range(R) for c in range(C)]
    c20=sum(1 for x in flat if x<0.20); c35=sum(1 for x in flat if x<0.35)
    floor=greedy_min(h)
    note="fleet fits cold" if c20>=25 else "cold region TIGHT"
    print(f"{opp:22}{c20:>9}{c35:>9}{floor:>10.2f}  {note}")

print()
print("="*70)
print("C. OUR SHIP-LOSS ATTRIBUTION (which class dies, where)")
print("="*70)
# a ship is lost if all its placement cells appear as incoming HIT/SINK
lost_by_class=Counter(); placed_by_class=Counter(); loss_rows=Counter()
for opp,gl in games.items():
    for g in gl:
        inc=set((s[0],s[1]) for s in g["incomingShots"] if s[2] in ("HIT","SINK"))
        for p in g["placements"]:
            cls=p["shipClass"]; L=dict(SHIPS)[cls]
            h=p["orientation"]=="HORIZONTAL"
            cells=[(p["startRow"],p["startCol"]+i) if h else (p["startRow"]+i,p["startCol"]) for i in range(L)]
            placed_by_class[cls]+=1
            if all(c in inc for c in cells):
                lost_by_class[cls]+=1
                for (r,c) in cells: loss_rows[r]+=1
print(f"{'class':12}{'placed':>8}{'lost':>6}{'lossRate':>10}")
for cls,_ in SHIPS:
    pl=placed_by_class[cls]; lo=lost_by_class[cls]
    print(f"{cls:12}{pl:>8}{lo:>6}{(lo/pl if pl else 0):>10.2%}")
print("loss cells by row (0=top):", dict(sorted(loss_rows.items())))

print()
print("="*70)
print("D. GAME-LENGTH vs SHIPS-LOST (driver check)")
print("="*70)
pts=[]
for opp,gl in games.items():
    for g in gl:
        wl=len(g["yourShots"])
        inc=set((s[0],s[1]) for s in g["incomingShots"] if s[2] in ("HIT","SINK"))
        lost=0
        for p in g["placements"]:
            cls=p["shipClass"]; L=dict(SHIPS)[cls]; h=p["orientation"]=="HORIZONTAL"
            cells=[(p["startRow"],p["startCol"]+i) if h else (p["startRow"]+i,p["startCol"]) for i in range(L)]
            if all(c in inc for c in cells): lost+=1
        pts.append((wl,lost))
# bucket by win-length
buckets=defaultdict(list)
for wl,lost in pts: buckets[min(60,(wl//10)*10)].append(lost)
print(f"{'winLen bucket':14}{'n':>5}{'mean ships lost':>17}")
for b in sorted(buckets):
    print(f"{b:>3}-{b+9:<10}{len(buckets[b]):>5}{statistics.mean(buckets[b]):>17.2f}")

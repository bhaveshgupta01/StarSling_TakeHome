#!/usr/bin/env python3
"""Offline compare flat-k vs penalty-k smart placement on the penalty-weighted
loss objective: sum over ships of LOSS_PENALTY[ship] * P(ship contacted),
where P(contacted) ~ 1-prod(1-honest[cell]) under the honest full-exposure map.
Guide map = matched-K (the live default). Judge = honest full exposure."""
import json, sys, statistics, random
from collections import defaultdict

ARCHIVE="analysis/games_archive.jsonl"
R=C=10
SHIPS=[("CARRIER",5),("BATTLESHIP",4),("CRUISER",3),("SUBMARINE",3),("DESTROYER",2)]
PEN={"CARRIER":14,"BATTLESHIP":12,"CRUISER":11,"SUBMARINE":10,"DESTROYER":8}
PK={"CARRIER":1,"BATTLESHIP":2,"CRUISER":3,"SUBMARINE":4,"DESTROYER":8}

games=defaultdict(list)
for l in open(ARCHIVE):
    l=l.strip()
    if l: d=json.loads(l); games[d["opponent"]].append(d)

def danger_map(gl,K):
    n=len(gl); cnt=[[0]*C for _ in range(R)]
    for g in gl:
        seen=set((s[0],s[1]) for s in g["incomingShots"][:K])
        for (r,c) in seen:
            if 0<=r<R and 0<=c<C: cnt[r][c]+=1
    return [[cnt[r][c]/n if n else 0 for c in range(C)] for r in range(R)]

def full_map(gl):
    n=len(gl); cnt=[[0]*C for _ in range(R)]
    for g in gl:
        seen=set((s[0],s[1]) for s in g["incomingShots"])
        for (r,c) in seen:
            if 0<=r<R and 0<=c<C: cnt[r][c]+=1
    return [[cnt[r][c]/n if n else 0 for c in range(C)] for r in range(R)]

def positions(L):
    out=[]
    for h in (True,False):
        for r in range((R-1 if h else R-L)+1):
            for c in range((C-L if h else C-1)+1):
                out.append([(r,c+i) if h else (r+i,c) for i in range(L)])
    return out

def touches(cells,used):
    return any((r+dr,c+dc) in used for (r,c) in cells for dr in(-1,0,1) for dc in(-1,0,1))

def layout(guide, penalty_k, seed):
    rnd=random.Random(seed); used=set(); out=[]
    order=sorted(SHIPS,key=lambda x:(-PEN[x[0]],-x[1])) if penalty_k else sorted(SHIPS,key=lambda x:-x[1])
    for cls,L in order:
        pool=[cs for cs in positions(L) if not any(p in used for p in cs) and not touches(cs,used)]
        if not pool: pool=[cs for cs in positions(L) if not any(p in used for p in cs)]
        scored=sorted(pool,key=lambda cs:sum(guide[r][c] for (r,c) in cs))
        cap=PK[cls] if penalty_k else 8
        pick=scored[rnd.randrange(min(cap,len(scored)))]
        for p in pick: used.add(p)
        out.append((cls,pick))
    return out

def weighted_loss(lay,honest):
    tot=0.0
    for cls,cells in lay:
        pcontact=1.0
        for (r,c) in cells: pcontact*=(1-honest[r][c])
        tot+=PEN[cls]*(1-pcontact)
    return tot

flat=pen=0.0
print(f"{'opponent':22} {'flat-k':>8} {'pen-k':>8}")
for opp,gl in sorted(games.items()):
    med=int(statistics.median(len(g['yourShots']) for g in gl)); K=max(med,16)
    guide=danger_map(gl,K); honest=full_map(gl)
    f=statistics.mean(weighted_loss(layout(guide,False,s),honest) for s in range(60))
    p=statistics.mean(weighted_loss(layout(guide,True,s),honest) for s in range(60))
    flat+=f; pen+=p
    print(f"{opp:22} {f:>8.2f} {p:>8.2f}")
print(f"{'TOTAL weighted loss':22} {flat:>8.2f} {pen:>8.2f}   delta={pen-flat:+.2f}")

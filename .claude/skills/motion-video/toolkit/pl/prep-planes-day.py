# One day of planes for three/planes.html: tracks [t, lon, lat, ft, onGround] thinned to 15 s within 120 km of Logan,
# plus every ground<->air transition at the field as a landing/takeoff event. usage: python3 pl/prep-planes-day.py MMDD out.json
import glob, json, math, collections, sys
from datetime import datetime
DAY, OUT = sys.argv[1], sys.argv[2]
LOGAN = (-71.0096, 42.3656); km = lambda p: math.hypot((p[1] - LOGAN[0]) * 82.0, (p[2] - LOGAN[1]) * 111.0)
fix = collections.defaultdict(dict)
for f in sorted(glob.glob(f'day24/{DAY}-*/extra/planes.jsonl')):
    for line in open(f):
        try: s = json.loads(line)
        except Exception: continue
        for a in s['d']:
            if a.get('altitudeFeet') is None and not a.get('onGround'): continue
            t = int(datetime.fromisoformat(a['updatedAt'].replace('Z', '+00:00')).timestamp() * 1000)
            fix[a['id']][t] = [t, round(a['lng'], 5), round(a['lat'], 5), 0 if a.get('onGround') else max(0, a['altitudeFeet'] or 0), 1 if a.get('onGround') else 0, round(a['bearing'], 1) if a.get('bearing') is not None else -1]
gnd = lambda p: km(p) < 4 and (p[4] or p[3] <= 50); air = lambda p: not p[4] and p[3] >= 400
pt, ev = {}, []
for k, dd in fix.items():
    tr = [dd[t] for t in sorted(dd)]; la = lg = None
    for p in tr:
        if air(p) and km(p) < 15:
            if lg and p[0] - lg[0] < 6 * 60000: ev.append(['dep', lg[0], [lg[1], lg[2]], k]); lg = None
            la = p
        elif gnd(p):
            if la and p[0] - la[0] < 6 * 60000: ev.append(['arr', p[0], [p[1], p[2]], k]); la = None
            lg = p
    o, last = [], -1e15
    for p in tr:
        if km(p) > 120: continue
        if p[0] - last >= 15000 or (o and o[-1][4] != p[4]): o.append(p); last = p[0]
    if len(o) > 1: pt[k] = o
ev.sort(key=lambda e: e[1]); evo = []
for e in ev:
    if any(o[3] == e[3] and o[0] == e[0] and abs(o[1] - e[1]) < 600000 for o in evo[-30:]): continue
    evo.append(e)
json.dump({'tracks': pt, 'events': evo}, open(OUT, 'w'), separators=(',', ':'))
c = collections.Counter(e[0] for e in evo); print(len(pt), 'tracks', dict(c), 'movements', len(evo))

# Boston-only copy for the Monday rush video (MBTA drawn in full, planes airborne only).
# Recorded hours -> compact inputs for three/ne.html: every vehicle in New England (MBTA kept but marked), thinned to 30-60 s,
# plus planes. usage: python3 prep-ne.py outPrefix day24/1025-12 day24/1025-13 ...
import glob, json, sys, math, collections
from datetime import datetime
out, dirs = sys.argv[1], sys.argv[2:]
BOX = (-71.45, -70.75, 42.12, 42.62)
inb = lambda lon, lat: BOX[0] < lon < BOX[1] and BOX[2] < lat < BOX[3]
tracks, props = collections.defaultdict(dict), {}
for d in dirs:
    for f in sorted(glob.glob(f'{d}*/transit-clean.json')):
        j = json.load(open(f))
        for k, tr in j['tracks'].items():
            p = j['props'].get(k) or {}
            if p.get('group') == 'plane': continue
            props[k] = {'g': p.get('group'), 'f': 'mbta-hook' if p.get('legendKey') == 'mbta' else p.get('legendKey'), 'l': p.get('legendLabel'), 'c': p.get('color') or p.get('modeColor') or '#cfd8e3'}
            for q in tr:
                if inb(q[1], q[2]): tracks[k][q[0]] = [q[0], round(q[1], 5), round(q[2], 5)]
T = {}
for k, d in tracks.items():
    step = 45000 if props[k]['g'] == 'bus' else 20000; tr, last = [], -1e15; ts = sorted(d)
    for i, t in enumerate(ts):
        if t - last >= step or i == len(ts) - 1 or ts[i + 1] - t > 300000 or (i and t - ts[i - 1] > 300000): tr.append(d[t]); last = t
    if len(tr) > 1: T[k] = tr
json.dump({'props': {k: props[k] for k in T}, 'tracks': T}, open(f'{out}-transit.json', 'w'), separators=(',', ':'))
print('vehicles', len(T), collections.Counter(props[k]['f'] for k in T).most_common(25))
# planes: one fix per real update, thinned to 20 s
fix = collections.defaultdict(dict)
for d in dirs:
    for f in sorted(glob.glob(f'{d}*/extra/planes.jsonl')):
        for line in open(f):
            for a in json.loads(line)['d']:
                if a.get('altitudeFeet') is None and not a.get('onGround'): continue
                if not inb(a['lng'], a['lat']): continue
                t = int(datetime.fromisoformat(a['updatedAt'].replace('Z', '+00:00')).timestamp() * 1000)
                fix[a['id']][t] = [t, round(a['lng'], 5), round(a['lat'], 5), 0 if a.get('onGround') else max(0, a['altitudeFeet'] or 0), 1 if a.get('onGround') else 0]
P = {}
for k, d in fix.items():
    tr, last = [], -1e15
    for t in sorted(d):
        if (t - last >= 20000) and not d[t][4]: tr.append(d[t]); last = t
    if len(tr) > 1: P[k] = tr
json.dump({'tracks': P}, open(f'{out}-planes.json', 'w'), separators=(',', ':'))
print('planes', len(P))

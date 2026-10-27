# Live MBTA counts every 2 minutes from the cleaned tracks, using the page's own rule for "present"
# (between two fixes less than GAP apart, or within 2 min after the last fix). usage: counts.py transit.json out.json
import json, sys, bisect, collections
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); GAP = int(sys.argv[3]) if len(sys.argv) > 3 else 600000
d = json.load(open(sys.argv[1])); P, T = d['props'], d['tracks']
lo = min(tr[0][0] for tr in T.values()); hi = max(tr[-1][0] for tr in T.values())
KIND = lambda p: 'bus' if p['g'] in ('bus', 'silver') else 'commuter' if p['g'] == 'commuter' else 'ferry' if p['g'] == 'ferry' else 'subway'
idx = [(KIND(P[k]), [q[0] for q in tr]) for k, tr in T.items() if P[k]['f'] == 'mbta-hook']
out = []
t = lo - lo % 120000 + 120000
while t <= hi:
    c = collections.Counter()
    for kd, ts in idx:
        j = bisect.bisect_right(ts, t) - 1
        if j < 0: continue
        if (j < len(ts) - 1 and ts[j + 1] - ts[j] <= GAP) or (t - ts[j] < 120000 and (j == len(ts) - 1 or ts[j + 1] - ts[j] > GAP) and j == len(ts) - 1): c[kd] += 1
    out.append([t, sum(c.values()), c['bus'], c['subway'], c['commuter'], c['ferry']]); t += 120000
json.dump(out, open(sys.argv[2], 'w'))
fm = lambda t: datetime.fromtimestamp(t / 1000, ET).strftime('%H:%M')
for i, name in enumerate(['total', 'bus', 'subway', 'commuter', 'ferry']):
    m = max(out, key=lambda r: r[i + 1]); print(f'{name:9} peak {m[i+1]:4} at {fm(m[0])}')

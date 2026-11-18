# Verified numbers for the DC video, from prep-dc.py outputs. Prints every count with its rule; writes OUT/facts.json and OUT/running.json.
# usage: python3 dc/facts-dc.py PREFIX OUTDIR Y-M-D
# Counting rules (quote them in the caption if asked):
#   moving   = a vehicle with a position fix in the 2 minutes up to t AND at least 100 m between its fixes in the 4 minutes around t.
#   Metro    = WMATA rail vehicles in the Metrorail realtime feed (route RED/ORANGE/SILVER/BLUE/YELLOW/GREEN).
#   bus      = WMATA Metrobus vehicles (other operators are counted separately).
#   flights  = ground<->air changes within 4 km of the airport (prep-dc.py events). A change seen twice within 5 min counts once.
import json, sys, math, bisect, collections, os
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York')
pre, outd, day = sys.argv[1:4]; os.makedirs(outd, exist_ok=True)
y, m, d = map(int, day.split('-')); D0 = int(datetime(y, m, d, tzinfo=ET).timestamp() * 1000)
hm = lambda t: datetime.fromtimestamp(t / 1000, ET).strftime('%-I:%M %p').lower()
TR = json.load(open(f'{pre}-transit.json')); PL = json.load(open(f'{pre}-planes.json'))
km = lambda a, b: math.hypot((a[1] - b[1]) * 86.6, (a[2] - b[2]) * 111.2)
STEP = 60000; t0 = min(tr[0][0] for tr in TR['tracks'].values()) // STEP * STEP; t1 = max(tr[-1][0] for tr in TR['tracks'].values())
NB = (t1 - t0) // STEP + 1
series = collections.defaultdict(lambda: [0] * NB)
for k, tr in TR['tracks'].items():
    f = TR['props'][k]['f']; ts = [q[0] for q in tr]
    for i in range(NB):
        t = t0 + i * STEP; j = bisect.bisect_right(ts, t) - 1
        if j < 0 or t - ts[j] > 120000: continue
        a = bisect.bisect_left(ts, t - 120000); b = bisect.bisect_right(ts, t + 120000) - 1
        if b > a and max(km(tr[a], tr[x]) for x in range(a + 1, b + 1)) >= 0.1: series[f][i] += 1
at = lambda i: t0 + i * STEP
day_ix = lambda h0, h1: [i for i in range(NB) if D0 + h0 * 3600000 <= at(i) < D0 + h1 * 3600000]
def peak(f, h0, h1):
    ix = day_ix(h0, h1); i = max(ix, key=lambda i: series[f][i]) if ix else None
    return None if i is None else {'value': series[f][i], 't': at(i), 'clock': hm(at(i))}
F = {}
F['rail_peak_am'] = peak('wmata-rail', 6, 10); F['rail_peak_pm'] = peak('wmata-rail', 15, 19)
F['bus_peak_am'] = peak('wmata-bus', 6, 10); F['bus_peak_pm'] = peak('wmata-bus', 15, 19)
both = [series['wmata-rail'][i] + series['wmata-bus'][i] for i in range(NB)]
for nm, h0, h1 in (('all_peak_am', 6, 10), ('all_peak_pm', 15, 19)):
    ix = day_ix(h0, h1)
    if ix: i = max(ix, key=lambda i: both[i]); F[nm] = {'value': both[i], 't': at(i), 'clock': hm(at(i))}
# Metro overnight: last minute with a moving train before 3 am, first after 3 am (night of the recording start)
r = series['wmata-rail']; c3 = D0 + 3 * 3600000
last = max((i for i in range(NB) if at(i) < c3 and r[i] > 0), default=None); first = min((i for i in range(NB) if at(i) >= c3 and r[i] > 0), default=None)
if last is not None: F['metro_last_train'] = {'value': hm(at(last)), 't': at(last)}
if first is not None: F['metro_first_train'] = {'value': hm(at(first)), 't': at(first)}
if last is not None and first is not None: F['metro_dark_minutes'] = {'value': (at(first) - at(last)) // 60000}
F['bus_3am'] = {'value': series['wmata-bus'][(c3 - t0) // STEP] if 0 <= (c3 - t0) // STEP < NB else None, 't': c3}
# flights
ev, seen = [], {}
for e in PL['events']:
    key = (e[3], e[0], e[4])
    if key in seen and e[1] - seen[key] < 300000: continue
    seen[key] = e[1]; ev.append(e)
for ap in ('DCA', 'IAD', 'BWI'):
    E = [e for e in ev if e[4] == ap and D0 <= e[1] < D0 + 86400000]
    F[f'{ap}_flights'] = {'value': len(E), 'arr': sum(e[0] == 'arr' for e in E), 'dep': sum(e[0] == 'dep' for e in E)}
    hrs = collections.Counter(datetime.fromtimestamp(e[1] / 1000, ET).hour for e in E)
    if hrs: h, n = hrs.most_common(1)[0]; F[f'{ap}_busiest_hour'] = {'value': n, 'hour': h}
cov = {f: sum(1 for v in s if v) for f, s in series.items()}
F['_coverage_minutes'] = {'value': cov, 'from': hm(t0), 'to': hm(t1)}
json.dump({'facts': F, 'rules': 'see header of facts-dc.py'}, open(f'{outd}/facts.json', 'w'), indent=1)
json.dump({'t0': t0, 'step': STEP, 'rail': series['wmata-rail'], 'bus': series['wmata-bus'], 'all': both}, open(f'{outd}/running.json', 'w'), separators=(',', ':'))
for k, v in F.items(): print(f'{k:22s} {v}')

# One day of MBTA rail (subway, Mattapan, commuter rail) as a background layer, cleaned and thinned to 30 s.
# usage: python3 pl/prep-rail-day.py MMDD out.json   (needs a-ne/clean.py)
import glob, json, collections, subprocess, sys
DAY, OUT = sys.argv[1], sys.argv[2]; RAIL = {'red', 'orange', 'blue', 'green', 'mattapan', 'commuter'}
tracks, props = collections.defaultdict(dict), {}
for f in sorted(glob.glob(f'day24/{DAY}-*/transit-clean.json')):
    d = json.load(open(f))
    for k, tr in d['tracks'].items():
        p = d['props'].get(k) or {}
        if p.get('legendKey') != 'mbta' or p.get('group') not in RAIL: continue
        props[k] = {'g': p['group'], 'r': p.get('route'), 'f': 'mbta'}
        for q in tr: tracks[k][q[0]] = [q[0], round(q[1], 5), round(q[2], 5)]
raw = {k: [d[t] for t in sorted(d)] for k, d in tracks.items() if len(d) > 1}
json.dump({'props': {k: props[k] for k in raw}, 'tracks': raw}, open(OUT + '.raw', 'w'), separators=(',', ':'))
subprocess.run(['python3', 'a-ne/clean.py', OUT + '.raw', OUT + '.cl'], check=True)
d = json.load(open(OUT + '.cl')); out = {}
for k, tr in d['tracks'].items():
    o, last = [], -1e15
    for i, q in enumerate(tr):
        if q[0] - last >= 30000 or i == len(tr) - 1 or tr[i + 1][0] - q[0] > 300000: o.append(q); last = q[0]
    if len(o) > 1: out[k] = o
json.dump({'props': {k: d['props'][k] for k in out}, 'tracks': out}, open(OUT, 'w'), separators=(',', ':'))
print('rail', len(out), collections.Counter(d['props'][k]['g'] for k in out))

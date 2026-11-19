# Thin non-rail transit tracks so a full day fits in the browser page's ~4 GB heap.
# usage: python3 thin-transit.py PREFIX [MIN_SECONDS]
# Keeps a bus/regional row only if it is at least MIN_SECONDS (default 60) after the last kept row, plus each
# track's last row and any row that follows a gap of more than 10 minutes (so fades in/out stay correct).
# Metro rail (snap-rail.py output) is left alone. Run after prep-dc.py and snap-rail.py; facts-dc.py should read
# the unthinned data (run it first).
import json, sys
pre = sys.argv[1]; MIN = int(float(sys.argv[2]) * 1000) if len(sys.argv) > 2 else 60000
T = json.load(open(f'{pre}-transit.json')); before = after = 0
for k, tr in T['tracks'].items():
    if T['props'][k]['f'] == 'wmata-rail': continue
    out = []
    for i, r in enumerate(tr):
        if not out or r[0] - out[-1][0] >= MIN or i == len(tr) - 1 or (i + 1 < len(tr) and tr[i + 1][0] - r[0] > 600000) or r[0] - tr[i - 1][0] > 600000:
            out.append(r)
    before += len(tr); after += len(out); T['tracks'][k] = out
json.dump(T, open(f'{pre}-transit.json', 'w'), separators=(',', ':'))
print(f'non-rail rows {before} -> {after}')

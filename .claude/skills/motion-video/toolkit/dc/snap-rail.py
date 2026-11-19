# Put Metro trains on their tracks.
# usage: python3 snap-rail.py REC_DIR PREFIX [RAIL_LINES]
# Rewrites the wmata-rail tracks in PREFIX-transit.json:
#  - one track per run on a single route (a train that switches Blue -> Silver becomes two tracks, each the right colour)
#  - every fix snapped onto its line's geometry (fixes more than 250 m from it, e.g. yards, are dropped)
#  - points added along the line between fixes, so motion follows curves instead of cutting chords
#  - rows are [t_ms, lon, lat, nx, ny]; (nx, ny) is the line's unit normal (east, north) there, the same normal
#    the page uses to offset each line's ribbon, so the page can shift the train onto its own ribbon.
import glob, json, math, os, sys
from collections import defaultdict
import numpy as np

rec, pre = sys.argv[1], sys.argv[2]
lines_path = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), 'rail-lines.json')
COL = {'RED': '#BF0D3E', 'BLUE': '#009CDE', 'ORANGE': '#ED8B00', 'SILVER': '#A2A4A1', 'GREEN': '#00B140', 'YELLOW': '#FFD100'}
LAT0 = 38.9; KX, KY = 111320 * math.cos(math.radians(LAT0)), 110540
STEP_M, SNAP_M, GAP_MS = 120, 250, 600000

L = {}
for l in json.load(open(lines_path))['lines']:
    if l['r'] not in COL: continue
    P = np.array(l['pts'], float); E = (P[:, 0] + 77) * KX; N = (P[:, 1] - LAT0) * KY
    dE, dN = np.diff(E), np.diff(N); seg = np.hypot(dE, dN); seg[seg == 0] = 1e-6
    cum = np.concatenate([[0], np.cumsum(seg)])
    # per-vertex normal from neighbours, the same miter normal the page builds its ribbon from
    a = np.r_[0, np.arange(len(P) - 1)]; b = np.r_[np.arange(1, len(P)), len(P) - 1]
    vE, vN = E[b] - E[a], N[b] - N[a]; vl = np.hypot(vE, vN); vl[vl == 0] = 1
    L[l['r']] = dict(P=P, E=E, N=N, dE=dE, dN=dN, seg=seg, cum=cum, nE=-vN / vl, nN=vE / vl)

def snap(r, lon, lat):
    g = L[r]; x, y = (lon + 77) * KX, (lat - LAT0) * KY
    t = np.clip(((x - g['E'][:-1]) * g['dE'] + (y - g['N'][:-1]) * g['dN']) / g['seg'] ** 2, 0, 1)
    d = np.hypot(g['E'][:-1] + t * g['dE'] - x, g['N'][:-1] + t * g['dN'] - y); i = int(d.argmin())
    return float(d[i]), float(g['cum'][i] + t[i] * g['seg'][i])

def at(r, s):
    g = L[r]; s = min(max(s, 0), g['cum'][-1]); i = int(min(np.searchsorted(g['cum'], s, 'right') - 1, len(g['seg']) - 1)); u = (s - g['cum'][i]) / g['seg'][i]
    lon = g['P'][i, 0] + (g['P'][i + 1, 0] - g['P'][i, 0]) * u; lat = g['P'][i, 1] + (g['P'][i + 1, 1] - g['P'][i, 1]) * u
    nE = g['nE'][i] + (g['nE'][i + 1] - g['nE'][i]) * u; nN = g['nN'][i] + (g['nN'][i + 1] - g['nN'][i]) * u; nl = math.hypot(nE, nN) or 1
    return [round(lon, 6), round(lat, 6), round(nE / nl, 3), round(nN / nl, 3)]

fix = defaultdict(dict)
for f in sorted(glob.glob(f'{rec}/*/rail.jsonl')):
    for line in open(f):
        try: j = json.loads(line)
        except ValueError: continue
        for vid, lon, lat, route, trip, brg, ts in j['d']:
            if route in L: fix[vid][ts * 1000] = (route, lon, lat)

T = json.load(open(f'{pre}-transit.json'))
for k in [k for k, p in T['props'].items() if p['f'] == 'wmata-rail']: del T['props'][k]; T['tracks'].pop(k, None)
nfix = nkept = npts = nruns = 0
for vid, F in fix.items():
    run, rid, prev = [], 0, None
    def flush():
        global nruns, npts
        if len(run) < 2: return
        r = run[0][1]; rows = []
        for (t0, _, s0), (t1, _, s1) in zip(run, run[1:]):
            n = max(1, int(abs(s1 - s0) // STEP_M)) if t1 - t0 <= GAP_MS else 1
            for q in range(n): rows.append([int(t0 + (t1 - t0) * q / n)] + at(r, s0 + (s1 - s0) * q / n))
        rows.append([run[-1][0]] + at(r, run[-1][2]))
        k = f'rail-{vid}#{rid}'; T['props'][k] = {'g': 'subway', 'f': 'wmata-rail', 'l': r.title(), 'c': COL[r]}; T['tracks'][k] = rows
        nruns += 1; npts += len(rows)
    for ts in sorted(F):
        r, lon, lat = F[ts]; nfix += 1
        d, s = snap(r, lon, lat)
        if d > SNAP_M: continue
        nkept += 1
        if run and r != run[-1][1]: flush(); run, rid = [], rid + 1
        run.append((ts, r, s))
    flush()
json.dump(T, open(f'{pre}-transit.json', 'w'), separators=(',', ':'))
print(f'rail fixes {nfix}, on track {nkept} ({100 * nkept / max(1, nfix):.1f}%), runs {nruns}, points {npts}')

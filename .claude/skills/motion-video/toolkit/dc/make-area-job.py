# Area video from a recorded day: config + facts -> map-only render job (three/area.html) + Remotion timeline.
# usage: python3 make-area-job.py bk/config.json [test frames e.g. 0,600]   -> bk/job.json (or bk/job-test.json), bk/timeline.json
# Config: area/day/len/fps, warp = [[video s, "HH:MM[:SS]"], ...] (a repeated video second = hard cut), cam = [[s, lon, lat, az, tilt, dist, lead], ...]
# (repeat a second to cut), focus = [[s, {layer: w}]], cards = [{"at": "HH:MM" clock it may appear, "hold": s, "kick", "fact": key or null,
# "value_path": [...], "big": suffix, "text"}], pins = [[s0, s1, label, lon, lat]], counter = "bus".
import json, sys, bisect, math, os
from datetime import datetime
from zoneinfo import ZoneInfo
cfgp = sys.argv[1]; C = json.load(open(cfgp)); OUTD = os.path.dirname(cfgp); facts = json.load(open(os.path.join(OUTD, 'facts.json')))['facts']
ET = ZoneInfo('America/New_York'); y, m, d = map(int, C['day'].split('-')); D0 = int(datetime(y, m, d, tzinfo=ET).timestamp() * 1000)
def clk(s):
    p = list(map(int, s.split(':'))) + [0, 0]; return D0 + (p[0] * 3600 + p[1] * 60 + p[2]) * 1000
FPS, DUR = C['fps'], C['len']; N = int(DUR * FPS); F = lambda s: int(round(s * FPS))
# ---- time warp: piecewise monotone cubic per segment; a repeated video second starts a new segment (hard cut)
A = [(s, clk(c)) for s, c in C['warp']]
segs, cur = [], [A[0]]
for a in A[1:]:
    if a[0] == cur[-1][0]: segs.append(cur); cur = [a]
    else: cur.append(a)
segs.append(cur)
def mono(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    if len(xs) == 1: return lambda v: ys[0]
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(len(xs) - 1)]
    mm = [d[0]] + [0 if d[i - 1] * d[i] <= 0 else 2 / (1 / d[i - 1] + 1 / d[i]) for i in range(1, len(d))] + [d[-1]]
    def f(v):
        i = max(0, min(len(xs) - 2, next((j for j in range(len(xs) - 1) if v < xs[j + 1]), len(xs) - 2)))
        h = xs[i + 1] - xs[i]; t = max(0, min(1, (v - xs[i]) / h)); t2, t3 = t * t, t * t * t
        return int((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * mm[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * mm[i + 1])
    return f
fs_ = [(sg[0][0], mono(sg)) for sg in segs]
def clock(v): return [f for s0, f in fs_ if s0 <= v][-1](v)
tmap = [clock(f / FPS) for f in range(N)]
for sg_start, _ in fs_[1:]:
    pass
cuts = [F(s0) for s0, _ in fs_[1:]]
for i in range(1, N):
    if i not in cuts: assert tmap[i] >= tmap[i - 1], ('time ran backwards', i)
# ---- camera: keyframes; a repeated second = cut (two keys one frame apart)
keys, prev = [], None
for s, lon, lat, az, ti, di, le in C['cam']:
    f = F(s) + (1 if prev is not None and F(s) <= prev else 0); prev = f
    keys.append({'f': f, 'at': [lon, lat], 'az': az, 'tilt': ti, 'dist': di, 'lead': le})
focus = [{'f': F(s), 'w': w} for s, w in C['focus']]
# ---- cards: appear only once the clock has reached their time, after any cut, never overlapping
def first_frame(c, after=0):
    for i in range(after, N):
        if tmap[i] >= c and (i == 0 or tmap[i - 1] < c or i == after): return i
    raise SystemExit(f'card time {c} never reached')
cards, last = [], 0
for c in C['cards']:
    v = None
    if c.get('fact'):
        v = facts[c['fact']]
        for k in c.get('value_path', ['value']): v = v[k]
    if c.get('abs') and isinstance(v, (int, float)): v = abs(v)
    f0 = max(first_frame(clk(c['at']), max(last, cuts[0] if cuts and c.get('after_cut', True) else 0)), last + F(0.3)); f1 = f0 + F(c['hold'])
    assert f1 < N, c
    cards.append({'f0': f0, 'f1': f1, 'kick': c['kick'], 'big': c.get('big', ''), 'bigValue': v if isinstance(v, (int, float)) and c.get('count_up', True) else None, 'decimals': c.get('decimals', 0),
                  'text': c['text'].replace('{v}', f'{v:,}' if isinstance(v, (int, float)) else str(v))}); last = f1
chapters = [{'f': first_frame(clk(t), cuts[0] if cuts else 0), 'text': x} for t, x in C.get('chapters', [])]
pins = [{'f0': F(a), 'f1': F(b), 'label': l, 'at': [lo, la]} for a, b, l, lo, la in C.get('pins', [])]
# ---- counter series per frame (area numbers only)
run = json.load(open(os.path.join(OUTD, 'running-area.json')))
def series(T): i = (T - run['t0']) // run['step']; return run['bus'][int(max(0, min(len(run['bus']) - 1, i)))]
counter = [{'label': f"mta buses on the move in {C['name'].lower()}", 'values': [series(T) for T in tmap]}]
base = json.load(open('job-v5.json'))   # reuse the proven NYC v5 look/assets
look = dict(base['look']); look.update({'total': N, 'tmap': tmap, 'keys': keys, 'focus': focus, 'notes': [], 'pins': pins, 'noText': True, 'textFrames': 10 ** 6,
             'ovIn': 10 ** 6, 'hudOut': 10 ** 6, 'expoKeys': None, 'dayStart': D0})
NS = C.get('slices', 12)
job = dict(base); job.update({'total': N, 'page': 'area.html', 'fps': FPS, 'overlay': True, 'look': look, 'slices': [{'f0': i * N // NS, 'f1': (i + 1) * N // NS} for i in range(NS)]})
if len(sys.argv) > 2:
    fr = [int(x) for x in sys.argv[2].split(',')]; job['slices'] = [{'f0': f, 'f1': f + 1} for f in fr]; job['warm'] = 90
    json.dump(job, open(os.path.join(OUTD, 'job-test.json'), 'w'))
else: json.dump(job, open(os.path.join(OUTD, 'job.json'), 'w'))
tl = {'total': N, 'fps': FPS, 'clock': tmap, 'date': C['date'], 'title': C['title'], 'kicker': C.get('kicker', 'MOTION'), 'sub': C['sub'], 'counter': counter,
      'cards': cards, 'chapters': chapters, 'cuts': cuts, 'dayStart': D0, 'pins': {}, 'credit': C['credit'], 'outroFrom': F(C.get('outro_from', DUR - 3)), 'frameDir': 'frames'}
json.dump(tl, open(os.path.join(OUTD, 'timeline.json'), 'w'))
for c in cards: print(f"{c['f0']/FPS:6.1f}-{c['f1']/FPS:6.1f}s  clock {datetime.fromtimestamp(tmap[c['f0']]/1000, ET):%H:%M}  {c['kick']}: {c['text']}")
print('frames', N, 'cuts at', [c / FPS for c in cuts])


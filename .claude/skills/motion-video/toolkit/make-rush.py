# Job for "Monday's two rushes" in Boston: one continuous camera, the clock racing between moments.
# usage: python3 make-rush.py transit.json planes.json curve.json Y-M-D "date label"
import json, sys, math
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); FPS = 24
tpath, ppath, cpath, day, label = sys.argv[1:6]
y, m, d = map(int, day.split('-'))
ms = lambda hm: int(datetime(y, m, d, *map(int, hm.split(':')), tzinfo=ET).timestamp() * 1000)
F = lambda s: int(round(s * FPS))
MB = ['mbta-hook']
LINES = [('Bus', '#efabff'), ('Red', '#DA291C'), ('Orange', '#ED8B00'), ('Green', '#00843D'), ('Blue', '#003DA5'), ('Silver', '#7C878E'), ('Commuter Rail', '#80276c'), ('Ferry', '#00b3a3')]
SUB = ['red', 'orange', 'green', 'blue', 'mattapan']
# (clock, name, groups or None, unit, radius km, centre, fact, dist, legend)
S = json.load(open('mon/stops.json'))
PER = 6.2; GAPS = 2.6; HALF = 4 * 60000; START = 3.4
WIDE = [-71.07, 42.35]
keys = [(0, WIDE, -10, 50, 520), (START - 1.0, WIDE, -14, 58, 300)]
segs = [(0, START, ms(S[0]['clock']) - HALF - 25 * 60000, ms(S[0]['clock']) - HALF)]
stops, t = [], START
for i, row in enumerate(S):
    at, dist = row['at'], row['dist']
    if i:
        prev = S[i - 1]; sep = math.hypot((at[0] - prev['at'][0]) * 82, (at[1] - prev['at'][1]) * 111)
        keys.append((t - GAPS / 2, [(at[0] + prev['at'][0]) / 2, (at[1] + prev['at'][1]) / 2], 0, 56, max(dist, prev['dist'], sep * 9) * 1.25))
        c0, c1 = ms(prev['clock']) + HALF, ms(row['clock']) - HALF
        if c1 - c0 > 3 * 3600000:   # no midday recording: race to 10 AM, then cut the clock straight to 3 PM halfway through the flight
            segs.append((t - GAPS, t - GAPS / 2, c0, ms('10:00'))); segs.append((t - GAPS / 2, t, ms('15:00'), c1))
        else: segs.append((t - GAPS, t, c0, c1))
    c = ms(row['clock']); segs.append((t, t + PER, c - HALF, c + HALF))
    keys.append((t, at, -24 + 8 * (i % 2), 66, dist)); keys.append((t + PER, at, 10 + 8 * (i % 2), 69, dist * 0.84))
    leg = LINES if row.get('groups') is None else [x for x in LINES if x[0].lower() in [g for g in (row.get('legend') or [])]]
    stops.append({'f0': F(t + 0.2), 'f1': F(t + PER), 'clock': c, 'name': row['name'], 'fleets': MB, 'groups': row.get('groups'), 'unit': row['unit'], 'at': at, 'km': row['km'], 'fact': row['fact'], 'only': False, 'leg': row.get('legKeys') and [x for x in LINES if x[0] in row['legKeys']] or LINES})
    t += PER + GAPS
end = t - GAPS; DUR = math.ceil(end + 3.0); N = DUR * FPS
segs.append((end, DUR, ms(S[-1]['clock']) + HALF, ms(S[-1]['clock']) + HALF + 15 * 60000))
keys.append((DUR, WIDE, 0, 52, 560))
tmap = []
for k in range(N):
    s = k / FPS; s0, s1, c0, c1 = next(g for g in segs if g[0] <= s < g[1] or g is segs[-1])
    tmap.append(int(c0 + (c1 - c0) * min(1, (s - s0) / (s1 - s0))))
keys = [{'f': F(s), 'at': at, 'az': az, 'tilt': ti, 'dist': di} for s, at, az, ti, di in keys]
KS = ['boswt', 'bost']
his = [{'url': f'/hi-{k}.png', 'proj': json.load(open(f'ne/bg-{k}-proj.json'))} for k in KS]
curve = json.load(open(cpath))
W = [[ms('6:00'), ms('10:00')], [ms('15:00'), ms('19:00')]]
ticks = [[ms(h), l] for h, l in [('6:00', '6a'), ('8:00', '8a'), ('10:00', '10a'), ('15:00', '3p'), ('17:00', '5p'), ('19:00', '7p')]]
job = {'total': N, 'warm': 40, 'page': 'rush.html', 'assets': {f'/hi-{k}.png': f'ne/bg-{k}.png' for k in KS},
       'extraJson': {'transit': tpath, 'planes': ppath}, 'slices': [{'f0': i * N // 9, 'f1': (i + 1) * N // 9} for i in range(9)],
       'look': {'total': N, 'tmap': tmap, 'keys': keys, 'stops': stops, 'his': his, 'title': "Monday's two rushes", 'sub': 'Every MBTA bus, train and ferry in Boston, Oct 26', 'date': label,
                'ovF': [0, F(START - 0.3)], 'curve': [[r[0], r[1]] for r in curve], 'windows': W, 'ticks': ticks, 'dayStart': ms('0:00'), 'sunset': ms('17:47'), 'sunrise': ms('7:13')}}
json.dump(job, open('job-rush.json', 'w')); print('frames', N, 'dur', DUR)

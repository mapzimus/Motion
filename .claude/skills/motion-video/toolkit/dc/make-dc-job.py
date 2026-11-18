# Job for the DC video (three/dc.html). Shot list lives in SHOTS: (video seconds, clock "H:MM" or None to keep racing, camera, focus, line).
# usage: python3 dc/make-dc-job.py PREFIX Y-M-D [test frames, e.g. 30,700,1300]
import json, sys, math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); FPS = 24
pre, day = sys.argv[1:3]; test = [int(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else None
y, m, d = map(int, day.split('-'))
def ms(hm, plus=0):
    h, mi = map(int, hm.split(':')); return int((datetime(y, m, d, tzinfo=ET) + timedelta(days=plus, hours=h, minutes=mi)).timestamp() * 1000)
F = lambda s: int(round(s * FPS))
CORE, WIDE, DCA = [-77.03, 38.895], [-77.06, 38.92], [-77.0377, 38.8512]
# camera: (sec, at, azimuth, tilt, distance)
keys = [(0, WIDE, -12, 52, 2600), (8, CORE, -20, 60, 1500), (20, CORE, 10, 64, 900), (34, DCA, 30, 66, 700), (46, CORE, -8, 58, 1400), (60, WIDE, 0, 50, 2800)]
# clock: (sec from, sec to, clock from, clock to)
segs = [(0, 8, ms('0:05'), ms('5:00')), (8, 20, ms('6:30'), ms('9:30')), (20, 34, ms('9:30'), ms('16:00')), (34, 46, ms('16:00'), ms('19:30')), (46, 60, ms('19:30'), ms('0:00', 1))]
focus = [(0, dict(transit=1, planes=1, bikes=0, lime=0.6)), (60, dict(transit=1, planes=1, bikes=0, lime=0.6))]
lines = []
DUR = segs[-1][1]; N = DUR * FPS
tmap = []
for k in range(N):
    s = k / FPS; s0, s1, c0, c1 = next(g for g in segs if g[0] <= s < g[1] or g is segs[-1])
    tmap.append(int(c0 + (c1 - c0) * min(1, (s - s0) / (s1 - s0))))
look = {'total': N, 'tmap': tmap, 'geo': [-77.03, 38.9], 'title': '', 'sub': '', 'textFrames': 0,
        'keys': [{'f': F(s), 'at': at, 'az': az, 'tilt': ti, 'dist': di} for s, at, az, ti, di in keys],
        'focus': [{'f': F(s), 'w': w} for s, w in focus], 'lines': [{'f0': F(a), 'f1': F(b), 'text': t} for a, b, t in lines],
        'hi': {'url': '/hi-core.png', 'proj': json.load(open('dcv/bg-core-proj.json'))}, 'fogNear': 5000, 'fogFar': 12000,
        'dayStart': ms('0:00'), 'sunrise': ms('6:57'), 'sunset': ms('16:49'), 'noon': ms('11:53')}
slices = [{'f0': f, 'f1': f + 1} for f in test] if test else [{'f0': i * N // 12, 'f1': (i + 1) * N // 12} for i in range(12)]
job = {'total': N, 'warm': 24 if test else 48, 'page': 'dc.html', 'assets': {'/hi-core.png': 'dcv/bg-core.png', '/fonts/': 'fonts'},
       'extraJson': {'transit': f'{pre}-transit.json', 'planes': f'{pre}-planes.json', 'bikes': f'{pre}-bikes.json', 'lime': f'{pre}-lime.json'}, 'slices': slices, 'look': look}
json.dump(job, open('job-dc.json' if not test else 'job-dc-test.json', 'w')); print('frames', N, 'dur', DUR, 'slices', len(slices))

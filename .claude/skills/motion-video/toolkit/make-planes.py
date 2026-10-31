# "Just planes": Logan, Monday Oct 26. Planes only, one camera, clock + one line. usage: python3 make-planes.py [testframes]
import json, sys
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); FPS = 24; DUR = 62; N = DUR * FPS
ms = lambda hm: int(datetime(2026, 10, 26, *map(int, hm.split(':')), tzinfo=ET).timestamp() * 1000)
F = lambda s: int(round(s * FPS))
segs = [(0, 5, ms('6:01'), ms('6:04')), (5, 15, ms('6:04'), ms('7:00')), (15, 25, ms('7:00'), ms('8:00')), (25, 34, ms('8:52'), ms('9:12')),
        (34, 37, ms('9:12'), ms('15:00')), (37, 49, ms('15:00'), ms('17:00')), (49, 59, ms('17:30'), ms('18:30')), (59, 62.01, ms('18:30'), ms('18:31'))]
def clock(s):
    for s0, s1, c0, c1 in segs:
        if s0 <= s < s1: return int(c0 + (c1 - c0) * (s - s0) / (s1 - s0))
    return segs[-1][3]
tmap = [clock(k / FPS) for k in range(N)]
LG = [-71.0096, 42.3656]; SW = [-71.0105, 42.3535]; NE = [-71.0005, 42.3745]
MID = [-71.0055, 42.364]
keys = [(0, MID, -35, 66, 280, 0), (5, MID, -25, 66, 300, 10), (9, LG, -10, 64, 520, 20), (15, LG, 5, 60, 800, 40), (25, [-71.02, 42.35], 20, 54, 1900, 120),
        (26.5, LG, 40, 64, 420, 10), (34, LG, 75, 66, 360, 10), (37, [-71.03, 42.36], 90, 50, 2600, 160), (49, [-71.01, 42.37], 120, 52, 2400, 150),
        (50.5, NE, 150, 68, 300, 10), (59, NE, 200, 70, 260, 10), (62, [-71.06, 42.36], 215, 50, 3000, 180)]
keys = [{'f': F(s), 'at': at, 'az': az, 'tilt': ti, 'dist': di, 'lead': le} for s, at, az, ti, di, le in keys]
focus = [{'f': 0, 'w': {'planes': 1, 'transit': 0.55}}, {'f': N, 'w': {'planes': 1, 'transit': 0.55}}]
lines = [(0.6, 4.6, 'Logan, a Monday in October.'), (5.5, 14.5, 'Before seven, 31 planes left and 11 came in.'), (15.5, 24.5, 'Sunrise at 7:13.'),
         (25.5, 33.5, 'Just after nine, the busiest ten minutes we saw. 18 planes in and out.'), (34.2, 36.8, 'Nothing recorded between nine and three.'),
         (37.5, 48.5, 'By afternoon more planes are landing than leaving.'), (49.5, 58.5, 'Sunset at 5:47.'), (59.2, 62.5, '570 takeoffs and landings in the eight hours we watched.')]
lines = [{'f0': F(a), 'f1': F(b), 'text': t} for a, b, t in lines]
job = {'total': N, 'warm': 60, 'page': 'planes.html', 'assets': {'/hi.png': 'ne/bg-day-hi.png', '/hi-logan.png': 'ne/bg-logan-hi.png', '/fonts/': 'fonts/'},
       'extraJson': {'transit': 'pl/rail.json', 'crowd': 'pl/empty-crowd.json', 'planes': 'pl/planes.json', 'bikes': 'pl/empty-bikes.json', 'airport': 'data/airport.json', 'bld': 'data/airport-bld.json', 'bld2': 'data/boston-massing.json'},
       'slices': [{'f0': i * N // 9, 'f1': (i + 1) * N // 9} for i in range(9)],
       'look': {'total': N, 'tmap': tmap, 'keys': keys, 'focus': focus, 'notes': [], 'pins': [], 'lines': lines, 'title': 'Just planes', 'sub': 'Logan Airport · Monday, Oct 26',
                'fogNear': 2600, 'fogFar': 6600, 'bldEx': 1.8, 'textFrames': -60, 'dayStart': ms('0:00'), 'bikeRef': ms('6:00'),
                'sunrise': ms('7:13'), 'sunset': ms('17:47'), 'noon': ms('12:28'),
                'hi': {'url': '/hi.png', 'proj': json.load(open('ne/bg-day-hi-proj.json'))}, 'his': [{'url': '/hi-logan.png', 'proj': json.load(open('ne/bg-logan-hi-proj.json'))}]}}
if len(sys.argv) > 1: job['slices'] = [{'f0': f, 'f1': f + 1} for f in map(int, sys.argv[1].split(','))]; job['warm'] = 30
json.dump(job, open('job-planes-test.json' if len(sys.argv) > 1 else 'job-planes.json', 'w')); print('frames', N)

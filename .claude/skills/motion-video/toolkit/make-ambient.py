# Ambient clip: near-real-time clock, one slow camera move, no text but the clock. usage: python3 make-ambient.py name MMDD H:MM speed dur at0 at1 az0 az1 tilt0 tilt1 d0 d1
import json, sys
from datetime import datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); FPS = 24
name, day, hm, speed, dur = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5])
at0, at1 = json.loads(sys.argv[6]), json.loads(sys.argv[7]); az0, az1, t0, t1, d0, d1 = map(float, sys.argv[8:14]); TR, PL, wT, wP = sys.argv[14], sys.argv[15], float(sys.argv[16]), float(sys.argv[17])
ms = lambda hm: int(datetime(2026, 10, int(day[2:]), *map(int, hm.split(':')), tzinfo=ET).timestamp() * 1000)
N = int(dur * FPS); c0 = ms(hm); tmap = [int(c0 + k / FPS * speed * 1000) for k in range(N)]
keys = [{'f': 0, 'at': at0, 'az': az0, 'tilt': t0, 'dist': d0, 'lead': 0}, {'f': N, 'at': at1, 'az': az1, 'tilt': t1, 'dist': d1, 'lead': 0}]
job = {'total': N, 'warm': 60, 'page': 'planes.html', 'assets': {'/hi.png': 'bg-day-hi.png', '/hi-logan.png': 'bg-logan-hi.png', '/fonts/': 'fonts/'},
       'extraJson': {'transit': TR, 'crowd': 'pl/empty-crowd.json', 'planes': PL, 'bikes': 'pl/empty-bikes.json', 'airport': 'airport.json', 'bld': 'airport-bld.json', 'bld2': 'three/boston-massing.json'},
       'slices': [{'f0': i * N // 9, 'f1': (i + 1) * N // 9} for i in range(9)],
       'look': {'total': N, 'tmap': tmap, 'keys': keys, 'focus': [{'f': 0, 'w': {'planes': wP, 'transit': wT}}, {'f': N, 'w': {'planes': wP, 'transit': wT}}], 'notes': [], 'pins': [], 'lines': [],
                'title': '', 'sub': '', 'fogNear': 2600, 'fogFar': 6600, 'bldEx': 1.8, 'textFrames': -60, 'dayStart': ms('0:00'), 'bikeRef': ms('6:00'),
                'sunrise': ms('7:13'), 'sunset': ms('17:47'), 'noon': ms('12:28'),
                'hi': {'url': '/hi.png', 'proj': json.load(open('bg-day-hi-proj.json'))}, 'his': [{'url': '/hi-logan.png', 'proj': json.load(open('bg-logan-hi-proj.json'))}]}}
json.dump(job, open(f'job-{name}.json', 'w')); print(name, 'frames', N)

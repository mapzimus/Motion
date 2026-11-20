# v9 timeline: slow beats incl. three aborted landings at DCA with a chase camera; fast-forward between.
import json, math, bisect
C = json.load(open('dcv/config.json')); P = json.load(open('day-planes.json'))
def mins(c): p = c.split(':'); return int(p[0]) * 60 + int(p[1]) + (int(p[2]) / 60 if len(p) > 2 else 0)
def hm(t): t = round(t * 60); h, r = divmod(t, 3600); m, s = divmod(r, 60); return f"{h}:{m:02d}:{s:02d}"
def seg(s0, s1, c0, c1, n): a, b = mins(c0), mins(c1); return [[round(s0 + (s1 - s0) * i / n, 3), hm(a + (b - a) * i / n)] for i in range(n + 1)]
BEATS = [  # s0, s1, clock0, clock1, kind
    (5, 12, '1:12', '1:30', 'wide'), (14, 21, '4:37', '4:55', 'wide'),
    (23, 35, '7:05', '7:20', ('ga', 'ac1951')),
    (37, 49, '8:00', '8:25', 'city'), (51, 65, '9:48', '10:08', 'air'),
    (67, 86, '12:38', '12:55', ('ga', 'ab7b02')),
    (88, 100, '16:28', '16:47', ('ga', 'a36200')),
    (102, 114, '17:20', '17:45', 'city'),
]
W = [[0, '8:13'], [3, '8:16'], [3, '0:00']]
for s0, s1, c0, c1, k in BEATS: W += seg(s0, s1, c0, c1, 12 if isinstance(k, tuple) else 4)
W += [[117, '23:59'], [120, '23:59:59']]
C['warp'] = W; C['len'] = 120; C['outro_from'] = 117; C['slices'] = 20
D0 = 1794978000000 - 5 * 3600000 + 5 * 3600000  # placeholder, replaced below
from datetime import datetime, timezone, timedelta
ET = timezone(timedelta(hours=-5)); D0 = int(datetime(2026, 11, 18, tzinfo=ET).timestamp() * 1000)
DCA = (-77.0377, 38.8521); K = 111320 * math.cos(math.radians(38.85)); MPU = 19.6  # metres per world unit
def ppos(icao, T):
    tr = P['tracks'][icao]; ts = [r[0] for r in tr]; i = bisect.bisect_right(ts, T) - 1
    if i < 0: return tr[0][1:4]
    if i >= len(tr) - 1: return tr[-1][1:4]
    a, b = tr[i], tr[i + 1]; u = (T - a[0]) / max(1, b[0] - a[0]); return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, (a[3] or 0) + ((b[3] or 0) - (a[3] or 0)) * u]
CAM = {'wide': (-77.045, 38.91, -15, 40, 1900), 'city': (-77.03, 38.898, -4, 48, 1000), 'air': (-77.039, 38.853, 2, 55, 560)}
cam = [[0, -77.03, 38.898, -15, 48, 800, 0], [3, -77.03, 38.898, -10, 50, 850, 0], [3, -77.05, 38.915, -12, 38, 2200, 0]]
HLs = {}
for s0, s1, c0, c1, k in BEATS:
    if isinstance(k, tuple):
        ic = k[1]; HLs[ic] = [D0 + int(mins(c0) * 60000) - 60000, D0 + int(mins(c1) * 60000) + 60000]
        n = int(s1 - s0)
        for q in range(n + 1):
            s = s0 + q; T = D0 + int((mins(c0) + (mins(c1) - mins(c0)) * q / n) * 60000); lon, lat, ft = ppos(ic, T)
            sep = math.hypot((lon - DCA[0]) * K, (lat - DCA[1]) * 111320)
            tx, ty = DCA[0] + (lon - DCA[0]) * 0.85, DCA[1] + (lat - DCA[1]) * 0.85
            dist = max(380, min(1600, sep / MPU * 1.6))
            cam.append([s, round(tx, 5), round(ty, 5), round(-8 + 18 * q / n, 1), 54, round(dist), 0, round(ft * 0.9)])
    else:
        x, y, az, ti, di = CAM[k]; cam += [[s0, x, y, az - 4, ti, di, 0], [s1, x, y, az + 6, ti, di * 0.95, 0]]
cam += [[117, -77.05, 38.915, 0, 38, 2300, 0], [120, -77.05, 38.915, 0, 38, 2300, 0]]
C['cam'] = cam
T_, P_ = dict(transit=1, planes=0.6, lime=0), dict(transit=0.55, planes=1, lime=0)
foc = [[0, T_]]
for s0, s1, c0, c1, k in BEATS:
    w = P_ if (isinstance(k, tuple) or k == 'air') else T_
    foc += [[max(0, s0 - 1.5), w], [s1, w]]
C['focus'] = foc + [[120, T_]]
C['look'].update({'camSpline': True, 'planeHL': HLs, 'altScale': 0.5})
C['cards'] = [
    {"at": "1:17", "hold": 5, "kick": "1:17 am", "fact": None, "text": "The last Metro train of the night stops."},
    {"at": "4:40", "hold": 5, "kick": "1:17 to 4:40 am", "fact": "metro_dark_minutes", "big": " min", "text": "with no Metro trains moving. The buses kept going."},
    {"at": "7:08", "hold": 5, "kick": "7:08 am", "fact": None, "text": "A jet pulls up over the runway instead of landing, and circles back."},
    {"at": "8:15", "hold": 5, "kick": "8:15 am", "fact": "all_peak_am", "text": "trains and buses moving at once."},
    {"at": "10:00", "hold": 5, "kick": "9 to 10 am", "fact": "DCA_by_hour", "value_path": ["value", "9"], "text": "flights in and out of Reagan National."},
    {"at": "12:42", "hold": 5, "kick": "12:41 pm", "fact": None, "text": "Another one. American 1177 aborts its landing."},
    {"at": "12:52", "hold": 3, "kick": "12:52 pm", "fact": None, "text": "It lands on the second try."},
    {"at": "16:31", "hold": 5, "kick": "4:31 pm", "fact": None, "text": "A third aborted landing, Delta 1454. It lands 15 minutes later."},
    {"at": "17:32", "hold": 5, "kick": "5:32 pm", "fact": "all_peak_pm", "text": "trains and buses moving at once, the busiest moment of the day."},
]
json.dump(C, open('dcv/config.json', 'w'), indent=1)
print(len(cam), 'cam keys', HLs)

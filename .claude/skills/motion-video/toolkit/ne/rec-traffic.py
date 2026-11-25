# Record New England road congestion from the public 511 traffic-flow tiles (the same source the Motion app relays).
# usage: python3 rec-traffic.py OUTDIR SECONDS [INTERVAL_S]
# Every INTERVAL_S (default 300, aligned to the clock) it saves every tile in LAYERS to
#   OUTDIR/MMDD-HH/HHMM/z{z}_{x}_{y}.png   (ET folder names), plus a line per snapshot in OUTDIR/log.jsonl.
# Run it as a tracked background job, at most ~2 h per block (see SKILL.md recording rules).
import json, math, os, sys, time, urllib.request, concurrent.futures as cf
from datetime import datetime, timezone, timedelta
ET = timezone(timedelta(hours=-5))  # EST (Nov-Mar)
URL = 'https://tiles.ibi511.com/Geoservice/GetTrafficTile?x={x}&y={y}&z={z}'

def tile(lon, lat, z):
    n = 2 ** z; r = math.radians(lat)
    return int((lon + 180) / 360 * n), int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)

def box(z, w, s, e, n):
    (x0, y0), (x1, y1) = tile(w, n, z), tile(e, s, z)
    return [(z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]

LAYERS = box(10, -73.7, 41.0, -69.9, 43.7) + box(12, -71.35, 42.2, -70.85, 42.5)  # southern New England + Boston core

def get(zxy, folder):
    z, x, y = zxy; p = f'{folder}/z{z}_{x}_{y}.png'
    for a in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(URL.format(x=x, y=y, z=z), headers={'User-Agent': 'motion-recorder'}), timeout=20) as r:
                b = r.read()
            if r.status == 204: return 0  # no roads in this tile (open water)
            if r.status == 200 and b[:4] == b'\x89PNG': open(p, 'wb').write(b); return len(b)
        except Exception: time.sleep(1 + a)
    return -1

out, secs = sys.argv[1], float(sys.argv[2]); iv = int(sys.argv[3]) if len(sys.argv) > 3 else 300
end = time.time() + secs; os.makedirs(out, exist_ok=True)
print(f'{len(LAYERS)} tiles per snapshot, every {iv}s, until {datetime.fromtimestamp(end, ET):%H:%M} ET', flush=True)
with cf.ThreadPoolExecutor(6) as ex:
    while time.time() < end:
        t = time.time(); slot = t - t % iv
        if t - slot > 60: time.sleep(slot + iv - t); continue  # wait for the next clock-aligned slot
        d = datetime.fromtimestamp(slot, ET); folder = f'{out}/{d:%m%d-%H}/{d:%H%M}'; os.makedirs(folder, exist_ok=True)
        sizes = list(ex.map(lambda q: get(q, folder), LAYERS)); ok = sum(s > 0 for s in sizes)
        rec = {'t': int(slot * 1000), 'et': f'{d:%H:%M}', 'ok': ok, 'empty': sizes.count(0), 'fail': sizes.count(-1), 'bytes': sum(s for s in sizes if s > 0), 'took': round(time.time() - t, 1)}
        open(f'{out}/log.jsonl', 'a').write(json.dumps(rec) + '\n'); print(json.dumps(rec), flush=True)
        nxt = slot + iv
        if nxt >= end: break
        time.sleep(max(0, nxt - time.time()))
print('DONE', flush=True)

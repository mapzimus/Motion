# DC day recorder: polls the feeds directly and appends JSON lines per hour folder.
# usage: python3 record-dc.py OUTDIR SECONDS   (run as a tracked background job, one call per block)
# Feeds: WMATA rail + bus GTFS-rt (key injected by the network proxy as the api_key header),
# Motion gateway region=washington (MARC, VRE, DASH, Fairfax Connector), ADSB.lol planes, Capital Bikeshare GBFS.
import json, os, sys, time, urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo
from google.transit import gtfs_realtime_pb2 as g
OUT, DUR = sys.argv[1], float(sys.argv[2]); ET = ZoneInfo('America/New_York')
def get(u, hdr=None, t=25):
    r = urllib.request.Request(u, headers={'User-Agent': 'motion-recorder', **(hdr or {})})
    with urllib.request.urlopen(r, timeout=t) as f: return f.read()
def gtfsrt(kind):
    m = g.FeedMessage(); m.ParseFromString(get(f'https://api.wmata.com/gtfs/{kind}-gtfsrt-vehiclepositions.pb', {'api_key': 'proxy-injected'}))
    return [[e.vehicle.vehicle.id or e.id, round(e.vehicle.position.longitude, 6), round(e.vehicle.position.latitude, 6), e.vehicle.trip.route_id, e.vehicle.trip.trip_id,
             round(e.vehicle.position.bearing), e.vehicle.timestamp] for e in m.entity if e.HasField('vehicle')]
def regional():
    d = json.loads(get('https://motion-gateway.mapzimus.workers.dev/api/transit?region=washington'))
    return [[v['id'], v['lng'], v['lat'], v.get('route'), v.get('feed'), v.get('bearing'), v.get('updatedAt')] for v in d['vehicles'] if not v['feed'].startswith('wmata')]
def planes():
    d = json.loads(get('https://api.adsb.lol/v2/point/38.89/-77.03/60'))
    return [[a.get('hex'), a.get('lon'), a.get('lat'), a.get('alt_baro'), a.get('track'), a.get('gs'), (a.get('flight') or '').strip(), a.get('t'), a.get('seen_pos')] for a in d.get('ac', []) if a.get('lat')]
def bikes():
    d = json.loads(get('https://gbfs.lyft.com/gbfs/1.1/dca-cabi/en/station_status.json'))
    return [[s['station_id'], s.get('num_bikes_available'), s.get('num_ebikes_available', 0), s.get('is_renting')] for s in d['data']['stations']]
JOBS = [('rail', lambda: gtfsrt('rail'), 15), ('bus', lambda: gtfsrt('bus'), 20), ('regional', regional, 30), ('planes', planes, 10), ('bikes', bikes, 120)]
last = {k: 0 for k, _, _ in JOBS}; t_end = time.time() + DUR; errs = {}
while time.time() < t_end:
    now = time.time()
    for k, fn, every in JOBS:
        if now - last[k] < every: continue
        last[k] = now
        try: rows = fn()
        except Exception as e: errs[k] = errs.get(k, 0) + 1; print('ERR', k, str(e)[:120], flush=True); continue
        hdir = os.path.join(OUT, datetime.fromtimestamp(now, ET).strftime('%m%d-%H')); os.makedirs(hdir, exist_ok=True)
        with open(os.path.join(hdir, k + '.jsonl'), 'a') as f: f.write(json.dumps({'t': int(now * 1000), 'd': rows}, separators=(',', ':')) + '\n')
    time.sleep(1)
print('DONE', json.dumps(errs))

# DC recording (record-dc.py hour folders) -> compact inputs for the three.js pages.
# usage: python3 prep-dc.py REC_DIR OUT_PREFIX [HOURS ...]   (HOURS like 1118-07; default: every hour folder)
# writes OUT-transit.json {props, tracks}   rows [t_ms, lon, lat]          (Metro rail, Metro bus, MARC, VRE, DASH, Fairfax, Amtrak)
#        OUT-planes.json  {props, tracks}   rows [t_ms, lon, lat, alt_ft, onGround]
#        OUT-bikes.json   {stations: {id: [lon, lat]}, snaps: [[t_ms, {id: bikes}]]}, OUT-lime.json [[t_ms, [[lon, lat], ...]]]
import glob, json, sys, os, collections, urllib.request
from datetime import datetime
rec, out = sys.argv[1], sys.argv[2]
hours = sys.argv[3:] or sorted(os.path.basename(p) for p in glob.glob(f'{rec}/[01]*-[0-2]*') if os.path.isdir(p))
BOX = (-77.62, -76.45, 38.55, 39.25)
inb = lambda lon, lat: lon is not None and lat is not None and BOX[0] < lon < BOX[1] and BOX[2] < lat < BOX[3]
iso = lambda s: int(datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
RAIL = {'RED': '#BF0D3E', 'ORANGE': '#ED8B00', 'SILVER': '#A2A4A1', 'BLUE': '#009CDE', 'YELLOW': '#FFD100', 'GREEN': '#00B140'}
REG = {'marc': ('commuter', '#f0a03c'), 'vre': ('commuter', '#e0435d'), 'dash': ('bus', '#58a6e8'), 'fairfax': ('bus', '#7cc46a')}
tracks, props = collections.defaultdict(dict), {}
def rows(h, feed):
    p = f'{rec}/{h}/{feed}.jsonl'
    if not os.path.exists(p): return
    for line in open(p):
        try: j = json.loads(line)
        except ValueError: continue  # a half-written last line after a restart
        yield j['t'], j['d']
for h in hours:
    for t, d in rows(h, 'rail'):
        for vid, lon, lat, route, trip, brg, ts in d:
            if route not in RAIL or not inb(lon, lat): continue
            k = f'rail-{vid}'; props[k] = {'g': 'subway', 'f': 'wmata-rail', 'l': route.title(), 'c': RAIL[route]}
            tracks[k][ts * 1000] = [ts * 1000, round(lon, 5), round(lat, 5)]
    for t, d in rows(h, 'bus'):
        for vid, lon, lat, route, trip, brg, ts in d:
            if not inb(lon, lat): continue
            k = f'bus-{vid}'; props[k] = {'g': 'bus', 'f': 'wmata-bus', 'l': route, 'c': '#d9c2ff'}
            tracks[k][ts * 1000] = [ts * 1000, round(lon, 5), round(lat, 5)]
    for t, d in rows(h, 'regional'):
        for vid, lon, lat, route, feed, brg, ts in d:
            f = next((x for x in REG if feed.startswith(x)), None)
            if not f or not inb(lon, lat): continue
            k = f'{f}-{vid}'; props[k] = {'g': REG[f][0], 'f': f, 'l': route, 'c': REG[f][1]}
            tt = iso(ts) if isinstance(ts, str) else int(ts) * 1000
            tracks[k][tt] = [tt, round(lon, 5), round(lat, 5)]
    for t, d in rows(h, 'amtrak'):
        for tid, lon, lat, name, hdg, vel, ts in d:
            if not inb(lon, lat) or not ts: continue
            k = f'amtrak-{tid}'; props[k] = {'g': 'amtrak', 'f': 'amtrak', 'l': name, 'c': '#7fb2ff'}
            tt = iso(ts); tracks[k][tt] = [tt, round(lon, 5), round(lat, 5)]
T = {}
for k, d in tracks.items():
    g = props[k]['g']; step = 45000 if g == 'bus' else 20000; tr, last = [], -1e15; ts = sorted(d)
    for i, t in enumerate(ts):  # thin, but keep the fixes either side of a long silence so tracks end cleanly
        if t - last >= step or i == len(ts) - 1 or ts[i + 1] - t > 300000 or (i and t - ts[i - 1] > 300000): tr.append(d[t]); last = t
    if len(tr) > 1: T[k] = tr
json.dump({'props': {k: props[k] for k in T}, 'tracks': T}, open(f'{out}-transit.json', 'w'), separators=(',', ':'))
print('vehicles', len(T), collections.Counter(props[k]['f'] for k in T).most_common())
# planes: one fix per position update (snapshot time minus seen_pos), thinned to 20 s
fix, pprops = collections.defaultdict(dict), {}
for h in hours:
    for t, d in rows(h, 'planes'):
        for hx, lon, lat, alt, trk, gs, flt, typ, seen in d:
            if not inb(lon, lat) or alt is None: continue
            gnd = alt == 'ground'; tt = int(t - (seen or 0) * 1000)
            fix[hx][tt] = [tt, round(lon, 5), round(lat, 5), 0 if gnd else max(0, int(alt)), 1 if gnd else 0]
            pprops[hx] = {'fl': flt or pprops.get(hx, {}).get('fl', ''), 'ty': typ or pprops.get(hx, {}).get('ty')}
P = {}
for k, d in fix.items():
    tr, last, ts = [], -1e15, sorted(d)
    for i, t in enumerate(ts):
        if t - last >= 20000 or i == len(ts) - 1 or ts[i + 1] - t > 300000: tr.append(d[t]); last = t
    if len(tr) > 1: P[k] = tr
json.dump({'props': {k: pprops[k] for k in P}, 'tracks': P}, open(f'{out}-planes.json', 'w'), separators=(',', ':'))
print('aircraft', len(P))
# Capital Bikeshare docks: station positions + bikes docked, every snapshot (2 min)
si = json.loads(urllib.request.urlopen('https://gbfs.lyft.com/gbfs/1.1/dca-cabi/en/station_information.json', timeout=30).read())
ST = {s['station_id']: [round(s['lon'], 5), round(s['lat'], 5)] for s in si['data']['stations']}
snaps = [[t, {sid: nb for sid, nb, ne, ok in d if sid in ST}] for h in hours for t, d in rows(h, 'bikes')]
json.dump({'stations': ST, 'snaps': snaps}, open(f'{out}-bikes.json', 'w'), separators=(',', ':'))
lime = [[t, [[r[1], r[0]] for r in d if not r[3]]] for h in hours for t, d in rows(h, 'lime')]
json.dump(lime, open(f'{out}-lime.json', 'w'), separators=(',', ':'))
print('bike snaps', len(snaps), 'stations', len(ST), 'lime snaps', len(lime))

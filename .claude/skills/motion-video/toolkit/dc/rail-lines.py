# WMATA rail GTFS (static) -> dc/rail-lines.json: one polyline per line per direction-shape, in the line colour, plus stations.
# usage: python3 dc/rail-lines.py gtfs/rail dc/rail-lines.json   (zip from api.wmata.com/gtfs/rail-gtfs-static.zip)
import csv, json, sys, collections
src, out = sys.argv[1:3]
R = {r['route_id']: '#' + r['route_color'] for r in csv.DictReader(open(f'{src}/routes.txt'))}
use = collections.Counter((t['route_id'], t['shape_id']) for t in csv.DictReader(open(f'{src}/trips.txt')))
pts = collections.defaultdict(list)
for p in csv.DictReader(open(f'{src}/shapes.txt')): pts[p['shape_id']].append((int(p['shape_pt_sequence']), round(float(p['shape_pt_lon']), 5), round(float(p['shape_pt_lat']), 5)))
best = {}  # longest shape per line, both directions collapse to one drawn line
for (r, sh), n in use.items():
    if r in R and (r not in best or len(pts[sh]) > len(pts[best[r]])): best[r] = sh
lines = [{'r': r, 'c': R[r], 'pts': [[x, y] for _, x, y in sorted(pts[sh])]} for r, sh in best.items()]
st = [{'n': s['stop_name'].title(), 'at': [round(float(s['stop_lon']), 5), round(float(s['stop_lat']), 5)]} for s in csv.DictReader(open(f'{src}/stops.txt')) if s.get('location_type') == '1']
json.dump({'lines': lines, 'stations': st}, open(out, 'w'), separators=(',', ':'))
print({l['r']: len(l['pts']) for l in lines}, 'stations', len(st))

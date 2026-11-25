# Rank where and when congestion was worst, from prep-traffic.py output (for camera targets and cards).
# usage: python3 hotspots-traffic.py OUT_DIR PROJ_JSON [BLOCK_PX] [TOP]
# Groups jam cells (class >= 3: jammed or stop-and-go) into BLOCK_PX x BLOCK_PX basemap-pixel blocks (default 80 = about
# 6 km at the NE view), then for each block reports jam-cell-snapshots (size x duration), the peak snapshot time, and the
# longest unbroken run of snapshots with any jam. Also prints the region-wide peak (share of road pixels slow or worse).
import json, math, sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
out, projp = sys.argv[1], sys.argv[2]; B = int(sys.argv[3]) if len(sys.argv) > 3 else 80; TOP = int(sys.argv[4]) if len(sys.argv) > 4 else 15
ET = timezone(timedelta(hours=-5)); P = json.load(open(projp)); C = json.load(open(f'{out}/traffic-cells.json')); T = json.load(open(f'{out}/traffic.json'))
Z = 512 * 2 ** P['zoom'] * P['dpr']; TW, TH = P['w'] * P['dpr'], P['h'] * P['dpr']
mx = (P['center'][0] + 180) / 360; r = math.radians(P['center'][1]); my = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2
def lonlat(px, py):
    x, y = mx + (px - TW / 2) / Z, my + (py - TH / 2) / Z
    return round(x * 360 - 180, 3), round(math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y)))), 3)
hm = lambda t: datetime.fromtimestamp(t / 1000, ET).strftime('%a %H:%M')
tot, per = defaultdict(int), defaultdict(lambda: defaultdict(int))
for si, s in enumerate(C['snaps']):
    for i in range(0, len(s), 2):
        if s[i + 1] < 3: continue
        cell = s[i]; py, px = (cell // C['w']) * C['cell'], (cell % C['w']) * C['cell']
        k = (px // B, py // B); tot[k] += 1; per[k][si] += 1
idx = T['index']
print(f"{len(idx)} snapshots {hm(idx[0])} .. {hm(idx[-1])}")
pk = max(T['stats'], key=lambda s: sum(s[1:])); print(f"region peak {hm(pk[0])}: {100 * sum(pk[1:]):.2f}% of road slow or worse (jam+stop {100 * (pk[2] + pk[3]):.2f}%)")
for k, n in sorted(tot.items(), key=lambda kv: -kv[1])[:TOP]:
    snaps = per[k]; peak = max(snaps, key=snaps.get); run = best = 0; prev = None
    for si in sorted(snaps):
        run = run + 1 if prev is not None and si == prev + 1 else 1; best = max(best, run); prev = si
    print(f"{lonlat((k[0] + .5) * B, (k[1] + .5) * B)}  score {n:6d}  peak {hm(idx[peak])} ({snaps[peak]} cells)  longest run {best * 5} min")

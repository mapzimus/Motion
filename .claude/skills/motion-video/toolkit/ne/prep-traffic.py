# Turn rec-traffic.py snapshots into overlay textures on a bg.cjs basemap grid, plus congestion stats.
# usage: python3 prep-traffic.py REC_DIR PROJ_JSON OUT_DIR [ZOOM]
# For every snapshot folder REC_DIR/MMDD-HH/HHMM it stitches the z{ZOOM} (default 10) tiles, crops/scales them onto the
# basemap's pixel grid (both are web mercator, so it is one affine resample) and writes OUT_DIR/tex/{t_ms}.png with a
# clean palette: free flow green at low alpha, slow yellow, jammed red, stop-and-go dark red at full alpha (dc.html's
# traffic shader treats alpha >= 0.7 as "warm"). OUT_DIR/traffic.json = {base, index: [t_ms...], stats: [[t, slow, jam, stop]...]}
# and OUT_DIR/traffic-cells.json (jam cells for 3D columns); stats are shares of road pixels inside the basemap frame. Snapshots with failed tiles are skipped. Reruns only
# build missing textures.
import glob, json, math, os, sys
import numpy as np
from PIL import Image
from datetime import datetime, timezone, timedelta

rec, projp, out = sys.argv[1], sys.argv[2], sys.argv[3]; ZT = int(sys.argv[4]) if len(sys.argv) > 4 else 10
P = json.load(open(projp)); TW, TH = P['w'] * P['dpr'], P['h'] * P['dpr']
ET = timezone(timedelta(hours=-5))
mx = lambda lon: (lon + 180) / 360
my = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2
Zb = 512 * 2 ** P['zoom'] * P['dpr']; cx, cy = mx(P['center'][0]), my(P['center'][1])
# basemap frame in tile-pixel space of zoom ZT
Zt = 256 * 2 ** ZT
fx0, fy0 = (cx - TW / 2 / Zb) * Zt, (cy - TH / 2 / Zb) * Zt; fx1, fy1 = (cx + TW / 2 / Zb) * Zt, (cy + TH / 2 / Zb) * Zt
tx0, ty0, tx1, ty1 = int(fx0 // 256), int(fy0 // 256), int(fx1 // 256), int(fy1 // 256)
# 511 palette -> class: 1 free, 2 slow, 3 jammed, 4 stop-and-go
PAL = np.array([[36, 157, 116], [240, 240, 32], [192, 0, 0], [64, 0, 0]], float)
OUTC = np.array([[0, 0, 0, 0], [46, 190, 120, 110], [255, 214, 40, 255], [255, 40, 30, 255], [170, 0, 40, 255]], np.uint8)

def classify(a):
    rgb, al = a[..., :3].astype(float), a[..., 3]
    d = ((rgb[..., None, :] - PAL) ** 2).sum(-1); k = d.argmin(-1) + 1
    k[(al < 128) | (d.min(-1) > 60 ** 2)] = 0
    return k.astype(np.uint8)

os.makedirs(f'{out}/tex', exist_ok=True)
idx, stats, cells = [], [], []
CELL = int(os.environ.get('CELL', 4))  # jam-column grid, basemap px (env CELL)
for folder in sorted(glob.glob(f'{rec}/*/[0-9][0-9][0-9][0-9]')):
    day, hm = folder.split('/')[-2].split('-')[0], folder.split('/')[-1]
    t = int(datetime(2026, int(day[:2]), int(day[2:]), int(hm[:2]), int(hm[2:]), tzinfo=ET).timestamp() * 1000)
    need = [(x, y) for x in range(tx0, tx1 + 1) for y in range(ty0, ty1 + 1)]
    have = {os.path.basename(f) for f in glob.glob(f'{folder}/z{ZT}_*.png')}
    mos = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), np.uint8)
    for x, y in need:
        f = f'z{ZT}_{x}_{y}.png'
        if f in have: mos[(y - ty0) * 256:(y - ty0 + 1) * 256, (x - tx0) * 256:(x - tx0 + 1) * 256] = classify(np.asarray(Image.open(f'{folder}/{f}').convert('RGBA')))
    # 204 (no roads) tiles are simply absent; a snapshot with real failures has fewer files than its neighbours -> checked via the log
    box = (fx0 - tx0 * 256, fy0 - ty0 * 256, fx1 - tx0 * 256, fy1 - ty0 * 256)
    cls = np.asarray(Image.fromarray(mos).resize((TW, TH), Image.NEAREST, box=box))
    roads = (cls > 0).sum() or 1
    g = cls.reshape(TH // CELL, CELL, TW // CELL, CELL).max((1, 3)).ravel(); nz = np.nonzero(g >= 2)[0]
    cells.append(np.stack([nz, g[nz]], 1).ravel().tolist())
    stats.append([t] + [round(float((cls == c).sum() / roads), 5) for c in (2, 3, 4)]); idx.append(t)
    p = f'{out}/tex/{t}.png'
    if not os.path.exists(p): Image.fromarray(OUTC[cls]).save(p, optimize=False, compress_level=3)
# drop snapshots the recorder logged with failures
bad = set()
for line in open(f'{rec}/log.jsonl'):
    r = json.loads(line)
    if r['fail'] > 0: bad.add(r['t'])
keep = [i for i, t in enumerate(idx) if t not in bad]
json.dump({'base': '/traffic/', 'index': [idx[i] for i in keep], 'stats': [stats[i] for i in keep]}, open(f'{out}/traffic.json', 'w'))
# jam cells per snapshot: flat [cell, class, cell, class, ...], cell = row * (TW/CELL) + col, class 2 slow / 3 jammed / 4 stop-and-go
json.dump({'cell': CELL, 'w': TW // CELL, 'h': TH // CELL, 'snaps': [cells[i] for i in keep]}, open(f'{out}/traffic-cells.json', 'w'), separators=(',', ':'))
print(f'{len(keep)} snapshots ({len(idx) - len(keep)} skipped), frame tiles x{tx0}-{tx1} y{ty0}-{ty1}')

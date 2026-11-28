# Trace road centerlines from prep-traffic.py textures, for flowing-traffic particles in three/traffic.html.
# usage: python3 roads-from-traffic.py OUT_DIR [MIN_LEN_PX]
# Takes the union of the road pixels (alpha > 0) in a few OUT_DIR/tex/*.png snapshots (basemap pixel grid), thins it to a
# one-pixel skeleton, walks the skeleton into polylines between junctions/ends, simplifies them (Douglas-Peucker, 1 px)
# and drops pieces shorter than MIN_LEN_PX (default 12). Writes OUT_DIR/roads.json = {lines: [[x0, y0, x1, y1, ...], ...]}
# in basemap pixels (the page's world units).
import glob, json, sys
import numpy as np
from PIL import Image
from skimage.morphology import skeletonize, binary_closing, disk

out = sys.argv[1]; MIN = float(sys.argv[2]) if len(sys.argv) > 2 else 12
files = sorted(glob.glob(f'{out}/tex/*.png')); pick = files[:: max(1, len(files) // 6)][:6]
mask = None
for f in pick:
    a = np.asarray(Image.open(f))[..., 3] > 0
    mask = a if mask is None else (mask | a)
mask = binary_closing(mask, disk(1))
sk = skeletonize(mask)
H, W = sk.shape
ys, xs = np.nonzero(sk); on = set(zip(ys.tolist(), xs.tolist()))
N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
nb = lambda p: [(p[0] + dy, p[1] + dx) for dy, dx in N8 if (p[0] + dy, p[1] + dx) in on]
deg = {p: len(nb(p)) for p in on}
nodes = {p for p, d in deg.items() if d != 2}
seen = set(); lines = []
def walk(a, b):
    path = [a, b]; prev, cur = a, b
    while cur not in nodes:
        nxt = [q for q in nb(cur) if q != prev and frozenset((cur, q)) not in seen]
        if not nxt: break
        seen.add(frozenset((cur, nxt[0]))); prev, cur = cur, nxt[0]; path.append(cur)
    return path
for a in nodes:
    for b in nb(a):
        e = frozenset((a, b))
        if e in seen: continue
        seen.add(e); lines.append(walk(a, b))
# loops with no node
for p in list(on):
    for q in nb(p):
        e = frozenset((p, q))
        if e not in seen: seen.add(e); lines.append(walk(p, q))
def rdp(pts, eps=1.0):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float); d = b - a; n = np.hypot(*d) or 1
    P = np.array(pts, float); dist = np.abs(d[0] * (P[:, 1] - a[1]) - d[1] * (P[:, 0] - a[0])) / n
    i = int(dist.argmax())
    return rdp(pts[: i + 1], eps)[:-1] + rdp(pts[i:], eps) if dist[i] > eps else [pts[0], pts[-1]]
res = []; total = 0
for L in lines:
    P = np.array(L, float); ln = np.hypot(*np.diff(P, axis=0).T).sum()
    if ln < MIN: continue
    s = rdp([(x, y) for y, x in L]); total += ln
    res.append([round(v, 1) for xy in s for v in xy])
json.dump({'w': W, 'h': H, 'lines': res}, open(f'{out}/roads.json', 'w'), separators=(',', ':'))
print(f'{len(res)} polylines, {total:.0f} px of road, from {len(pick)} snapshots')

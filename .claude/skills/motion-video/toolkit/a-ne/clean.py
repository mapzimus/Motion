# Smooth feed glitches: frozen positions that then leap ahead, back-and-forth zigzags, lone spikes.
# Only splits a track (vehicle fades out/in) if a leap is still impossible after that.
import json, math, sys
src, out = sys.argv[1:3]
d = json.load(open(src)); P, T = d['props'], d['tracks']
km = lambda a, b: math.hypot((a[1] - b[1]) * 82.5, (a[2] - b[2]) * 111.2)
mph = lambda a, b: km(a, b) / max(1e-9, (b[0] - a[0]) / 3.6e6) * 0.6214
LIM = lambda g: 110 if g in ('amtrak', 'commuter') else 70 if g in ('bus', 'silver', 'red', 'orange', 'blue', 'green', 'mattapan', 'subway') else 45
st = dict(hold=0, zig=0, split=0); NT = {}; NP = {}
for k, tr in T.items():
    lim = LIM(P[k]['g'])
    # 1. frozen runs: keep the first fix; drop the rest if the train then has to leap to catch up
    o = [tr[0]]
    for i in range(1, len(tr)):
        q = tr[i]; nxt = tr[i + 1] if i + 1 < len(tr) else None
        if km(o[-1], q) < 0.05 and nxt and nxt[0] - q[0] < 600000 and mph(q, nxt) > lim and mph(o[-1], nxt) <= lim * 1.05: st['hold'] += 1; continue
        o.append(q)
    # 2. zigzags and spikes: a fix that sends the vehicle out and straight back
    ch = True
    while ch and len(o) > 2:
        ch = False
        for i in range(1, len(o) - 1):
            a, b, c = o[i - 1], o[i], o[i + 1]
            if c[0] - a[0] < 600000 and km(a, b) > 0.25 and km(b, c) > 0.25 and km(a, c) < 0.8 * max(km(a, b), km(b, c)) and (mph(a, b) > lim * 0.6 or mph(b, c) > lim * 0.6):
                o = o[:i] + o[i + 1:]; st['zig'] += 1; ch = True; break
    # 2b. trains and boats: ease the speed changes with a light 3-point average (ends stay put)
    if P[k]['g'] not in ('bus',) and len(o) > 2:
        o = [o[0]] + [[o[i][0], (o[i - 1][1] + 2 * o[i][1] + o[i + 1][1]) / 4, (o[i - 1][2] + 2 * o[i][2] + o[i + 1][2]) / 4] if o[i + 1][0] - o[i - 1][0] < 600000 else o[i] for i in range(1, len(o) - 1)] + [o[-1]]
    # 3. anything still impossible: end the track there and start a new one
    parts, cur = [], [o[0]]
    for a, b in zip(o, o[1:]):
        if b[0] - a[0] < 600000 and mph(a, b) > lim * 1.2 and km(a, b) > 0.5: parts.append(cur); cur = [b]; st['split'] += 1
        else: cur.append(b)
    parts.append(cur)
    for i, p in enumerate(parts):
        if len(p) > 1: kk = k if i == 0 else f'{k}#{i}'; NT[kk] = p; NP[kk] = dict(P[k], e=1) if i < len(parts) - 1 else P[k]
json.dump({'props': NP, 'tracks': NT}, open(out, 'w'), separators=(',', ':'))
print(st)
bad = {}
for k, tr in NT.items():
    lim = LIM(NP[k]['g'])
    for a, b in zip(tr, tr[1:]):
        if b[0] - a[0] < 600000 and mph(a, b) > lim and km(a, b) > 0.3: bad[NP[k]['f']] = bad.get(NP[k]['f'], 0) + 1
print('remaining fast hops', sorted(bad.items(), key=lambda x: -x[1])[:8])

# Find frames where the renderer dropped the ground (lower half goes flat vs. its neighbours) and re-render just those.
# usage: python3 fix-frames.py job.json data.json bg.png proj.json outDir
import glob, json, os, shutil, subprocess, sys
from PIL import Image
job, data, bg, proj, out = sys.argv[1:6]
fs = sorted(glob.glob(f'{out}/s*/f*.jpg'), key=lambda f: f.split('/')[-1])
def black(f):  # a tile the software rasterizer failed to paint comes out pure black (never present in a normal frame)
    h = Image.open(f).convert('L').resize((270, 480)).histogram(); return sum(h[:3]) / sum(h) > 0.04
def dark(f):  # share of dark land pixels in the lower half: ~0.4-0.85 normally, ~0 when the ground dropped out
    h = Image.open(f).convert('L').resize((270, 480)).crop((0, 280, 270, 440)).histogram(); return sum(h[:40]) / sum(h)
bad = [i for i, f in enumerate(fs) if dark(f) < 0.1 or black(f)]
print(f'{len(bad)} bad frames', bad[:40], flush=True)
for rnd in range(4):  # repaired frames can glitch too: re-check and retry
    if not bad: break
    j = json.load(open(job)); j['slices'] = [{'f0': i, 'f1': i + 1} for i in bad]
    json.dump(j, open(f'{out}-fix.json', 'w')); shutil.rmtree(f'{out}-fix', ignore_errors=True)
    subprocess.run(['timeout', '6000', 'node', 'three-render.cjs', f'{out}-fix.json', data, bg, proj, f'{out}-fix', '3'], stdout=open(f'{out}-fix.log', 'w'), stderr=subprocess.STDOUT)
    still = []
    for s, i in enumerate(bad):
        src = f'{out}-fix/s{s}/f{i:04d}.jpg'
        if os.path.exists(src) and dark(src) >= 0.1 and not black(src): shutil.copy(src, fs[i])
        else: still.append(i)
    print(f'round {rnd + 1}: fixed {len(bad) - len(still)}, still bad {len(still)}', flush=True); bad = still
print('FIX-DONE', len(bad), 'left', flush=True)

#!/bin/bash
# Remotion pass for the DC video: map frames (three-render) + timeline -> final MP4.
# usage (from the toolkit copy): bash dc/compose-dc.sh dcv FRAMES_DIR NAME [still FRAME]
# needs dcv/timeline.json (make-dc-job.py), optional dcv/labels.json + dcv/labels-proj.json (PROJ pass), remo/ with node_modules.
set -e; cd "$(dirname "$0")/.."; A=$1; FR=$2; N=$3; PORT=8765
mkdir -p $A/flat out; rm -f $A/flat/*.jpg
for f in $FR/s*/f*.jpg; do ln -sf "$(realpath $f)" $A/flat/; done
python3 - "$A" <<'PY'
import json, os, sys
A = sys.argv[1]; tl = json.load(open(f'{A}/timeline.json'))
if os.path.exists(f'{A}/labels.json') and os.path.exists(f'{A}/labels-proj.json'): tl['labels'] = {'defs': json.load(open(f'{A}/labels.json')), 'proj': json.load(open(f'{A}/labels-proj.json'))}
tl['pins'] = {}; tl['frameDir'] = 'http://127.0.0.1:8765'
json.dump(tl, open('remo/public/timeline.json', 'w')); print('timeline', tl['total'], 'frames')
PY
python3 -m http.server $PORT -d $A/flat >/dev/null 2>&1 & SRV=$!; trap "kill $SRV" EXIT; sleep 1
CH=$(ls /opt/pw-browsers/chromium_headless_shell-*/chrome-*/{headless_shell,chrome-headless-shell} 2>/dev/null | head -1)
cd remo
if [ "$4" = "still" ]; then npx remotion still src/index.ts Motion ../$A/still-$5.png --frame=$5 --browser-executable=$CH --log=error; exit 0; fi
npx remotion render src/index.ts Motion ../out/$N.mp4 --browser-executable=$CH --codec=h264 --crf=18 --concurrency=3 --log=error
ls -la ../out/$N*.mp4 | awk '{print $5,$9}'; echo COMPOSE-DONE

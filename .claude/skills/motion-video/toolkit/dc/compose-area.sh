#!/bin/bash
# Remotion pass: map frames (from three-render) + timeline -> final MP4s.
# usage: compose-area.sh AREA_DIR FRAMES_DIR NAME [still FRAME]
set -e; cd $(dirname $0); A=$1; FR=$2; N=$3; R=../remo; PORT=8765
mkdir -p $A/flat; rm -f $A/flat/*.jpg
for f in $FR/s*/f*.jpg; do ln -sf "$(realpath $f)" $A/flat/; done
python3 - "$A" "$FR" <<'PY'
import json, glob, sys
A, FR = sys.argv[1:3]; tl = json.load(open(f'{A}/timeline.json')); pins = {}
for fn in glob.glob(f'{FR}/s*/ov.jsonl'):
    for l in open(fn):
        o = json.loads(l)
        if o.get('pins'): pins[str(o['f'])] = o['pins']
import os
if os.path.exists(f'{A}/labels.json') and os.path.exists(f'{A}/labels-proj.json'): tl['labels'] = {'defs': json.load(open(f'{A}/labels.json')), 'proj': json.load(open(f'{A}/labels-proj.json'))}
tl['pins'] = pins; tl['frameDir'] = 'http://127.0.0.1:8765'
json.dump(tl, open('../remo/public/timeline.json', 'w')); print('timeline', tl['total'], 'frames,', len(pins), 'frames with pins')
PY
python3 -m http.server $PORT -d $A/flat >/dev/null 2>&1 & SRV=$!; trap "kill $SRV" EXIT; sleep 1
CH=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
cd $R
if [ "$4" = "still" ]; then npx remotion still src/index.ts Motion ../rec/$A/still-$5.png --frame=$5 --browser-executable=$CH --log=error; exit 0; fi
npx remotion render src/index.ts Motion ../tiktok/$N.mp4 --browser-executable=$CH --codec=h264 --crf=17 --concurrency=3 --log=error
cd ../tiktok && D=$(python3 -c "import json;t=json.load(open('../remo/public/timeline.json'));print(t['total']/t['fps']-4)")
ffmpeg -y -loglevel error -i $N.mp4 -i "../music/Floating%20Cities.mp3" -filter_complex "[1:a]afade=t=in:st=0:d=1.5,afade=t=out:st=$D:d=4,volume=0.8[m];[0:a][m]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11[a]" -map 0:v -map "[a]" -c:v copy -ar 48000 -c:a aac -b:a 192k -movflags +faststart $N-youtube-music.mp4
ls -la $N*.mp4 | awk '{print $5,$9}'; echo COMPOSE-DONE
Shell cwd was reset to /home/user/Motion
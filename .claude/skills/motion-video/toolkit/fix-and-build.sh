#!/bin/bash
# usage: fix-and-build.sh job data bg proj dir outName  -> repairs dropped frames, then builds ../tiktok/outName.mp4 (scene + 3 s end card)
cd $(dirname $0); J=$1; DATA=$2; BG=$3; PR=$4; D=$5; N=$6
python3 fix-frames.py $J $DATA $BG $PR $D
L=$D/list.txt; : > $L; for f in $(ls $D/s*/f*.jpg | sort -t/ -k3); do echo "file '$(realpath $f)'" >> $L; done; echo "frames $(wc -l < $L)"
last=$(tail -1 $L | sed "s/file '//; s/'$//")
node endcard.cjs "$last" $D/endcard.png "MOTION" "Link in bio"
ffmpeg -y -loglevel error -r 24 -f concat -safe 0 -i $L -vf format=yuv420p -c:v libx264 -preset medium -crf 17 -r 24 $D/scene.mp4
ffmpeg -y -loglevel error -loop 1 -framerate 24 -i $D/endcard.png -t 3 -vf "scale=1080:1920,format=yuv420p,fade=in:0:8" -c:v libx264 -preset veryfast -crf 17 -r 24 $D/end.mp4
ffmpeg -y -loglevel error -i $D/scene.mp4 -i $D/end.mp4 -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v]" -map "[v]" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart ../tiktok/$N.mp4
echo "$N $(ffprobe -v error -show_entries format=duration -of csv=p=0 ../tiktok/$N.mp4)s"; echo BUILD-DONE

#!/usr/bin/env bash
# Generates the test media in tests/fixtures (not committed: ~6 MB).
#   tone.wav      20 s, 440 Hz stereo tone
#   counter.webm  20 s, 640x360 VP9 + Opus, frame number burned into the picture
#   bad.mp3       not audio at all, to test error handling
#   dl-audio.m4a  6 s AAC in a fragmented ("DASH") MP4, like YouTube's audio
#   dl-video.webm 6 s VP9 picture without sound, like YouTube's video
#                 (the last two are served by fake-yt-dlp.cjs)
# Needs ffmpeg (with libvpx and libopus).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fixtures
cd fixtures

ffmpeg -v error -y -f lavfi -i "sine=frequency=440:duration=20" -ac 2 tone.wav
ffmpeg -v error -y \
  -f lavfi -i "testsrc2=size=640x360:rate=30:duration=20" \
  -f lavfi -i "sine=frequency=330:duration=20" \
  -vf "drawtext=text='%{frame_num}':fontsize=80:fontcolor=white:x=20:y=20:box=1:boxcolor=black" \
  -c:v libvpx-vp9 -deadline realtime -c:a libopus -shortest counter.webm
printf 'not audio' > bad.mp3
ffmpeg -v error -y -f lavfi -i "sine=frequency=523:duration=6" -ac 2 -c:a aac -b:a 128k \
  -movflags +frag_keyframe+empty_moov+default_base_moof dl-audio.m4a
ffmpeg -v error -y -f lavfi -i "testsrc2=size=640x360:rate=30:duration=6" \
  -c:v libvpx-vp9 -deadline realtime -an dl-video.webm

echo "Test fixtures written to $(pwd)"

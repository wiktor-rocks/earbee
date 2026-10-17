#!/usr/bin/env bash
# Generates the test media in tests/fixtures (not committed: ~17 MB).
#   tone.wav      20 s, 440 Hz stereo tone
#   counter.webm  20 s, 640x360 VP9 + Opus, frame number burned into the picture
#   long-counter.webm
#                 4 min, the same with a keyframe only every 20 s: dragging far
#                 in, before the proxy is built there (e2e/08-video.cjs)
#   bad.mp3       not audio at all, to test error handling
#   dl-audio.m4a  6 s AAC in a fragmented ("DASH") MP4, like YouTube's audio
#   dl-video.webm 6 s VP9 picture without sound, like YouTube's video
#                 (the last two are served by fake-yt-dlp.cjs)
#   long-chirp.mp3/.m4a/.webm
#                 90 s mono chirp (a tone gliding up, never repeating) as
#                 MP3, AAC and Opus: long enough to be decoded in parallel
#                 parts, to test the joins (e2e/11-parallel.cjs)
#   quiet-spike.wav  10 s quiet tone with one full-scale click (5 s in)
#   loud-beats.wav   10 s "mastered" beats: every slice peaks near full
#                    scale, only the loudness tells beats from gaps
#   stereo-left.wav  6 s tone on the left channel, silence on the right
#   verse-chorus.wav 12 s tone, 2 s at 0.4 then 2 s at 0.65, in turn: the
#                    minimap's exaggerated contrast
#                 (the last four: the waveform's scaling, e2e/17-waveform.cjs)
#   clicks.wav    20 s click track at 120 BPM, a click every 0.5 s from
#                 0.25 s, over a quiet hum: finding the beats (e2e/20-beats.cjs)
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
ffmpeg -v error -y \
  -f lavfi -i "testsrc2=size=640x360:rate=30:duration=240" \
  -f lavfi -i "sine=frequency=330:duration=240" \
  -vf "drawtext=text='%{frame_num}':fontsize=80:fontcolor=white:x=20:y=20:box=1:boxcolor=black" \
  -c:v libvpx-vp9 -deadline realtime -b:v 150k -g 600 -c:a libopus -b:a 24k -shortest long-counter.webm
printf 'not audio' > bad.mp3
ffmpeg -v error -y -f lavfi -i "sine=frequency=523:duration=6" -ac 2 -c:a aac -b:a 128k \
  -movflags +frag_keyframe+empty_moov+default_base_moof dl-audio.m4a
ffmpeg -v error -y -f lavfi -i "testsrc2=size=640x360:rate=30:duration=6" \
  -c:v libvpx-vp9 -deadline realtime -an dl-video.webm

chirp="aevalsrc=0.4*sin(2*PI*(200*t+8*t*t)):s=48000:d=90"
ffmpeg -v error -y -f lavfi -i "$chirp" -ar 44100 -c:a libmp3lame -b:a 32k long-chirp.mp3
ffmpeg -v error -y -f lavfi -i "$chirp" -ar 44100 -c:a aac -b:a 32k long-chirp.m4a
ffmpeg -v error -y -f lavfi -i "$chirp" -c:a libopus -b:a 24k long-chirp.webm

ffmpeg -v error -y -f lavfi -i "aevalsrc=0.03*sin(2*PI*330*t)+if(between(t\,5\,5.001)\,0.95\,0):s=44100:d=10" \
  -c:a pcm_s16le quiet-spike.wav
ffmpeg -v error -y -f lavfi \
  -i "aevalsrc=if(lt(mod(t\,0.5)\,0.25)\,0.95*sgn(sin(2*PI*110*t))\,if(lt(mod(t*1000\,20)\,0.05)\,0.95\,0.05*sin(2*PI*220*t))):s=44100:d=10" \
  -c:a pcm_s16le loud-beats.wav
ffmpeg -v error -y -f lavfi -i "aevalsrc=0.5*sin(2*PI*440*t)|0:s=44100:d=6" -c:a pcm_s16le stereo-left.wav
ffmpeg -v error -y -f lavfi -i "aevalsrc=if(lt(mod(t\,4)\,2)\,0.4\,0.65)*sin(2*PI*330*t):s=44100:d=12" \
  -c:a pcm_s16le verse-chorus.wav

ffmpeg -v error -y -f lavfi \
  -i "aevalsrc=if(lt(mod(t+0.25\,0.5)\,0.01)\,0.8*sin(2*PI*1000*t)*exp(-300*mod(t+0.25\,0.5))\,0)+0.01*sin(2*PI*90*t):s=44100:d=20" \
  -c:a pcm_s16le clicks.wav

echo "Test fixtures written to $(pwd)"

#!/usr/bin/env bash
# Generates long media for the loading diagnostics (profile-load.cjs) in
# tests/output/long-media (not committed: about 1.5 GB). Skips files that
# already exist. Needs ffmpeg (with libmp3lame, libopus and libx264).
#   mp3-{10,30,60,90,120}min.mp3  192 kb/s stereo, 44.1 kHz (a typical song rip)
#   aac-{30,45,60}min.m4a      128 kb/s stereo AAC, 44.1 kHz (YouTube-like audio)
#   opus-60min.webm            128 kb/s stereo Opus, 48 kHz
#   wav-60min.wav              16-bit stereo PCM, 44.1 kHz (~600 MB)
#   video-60min.mp4            1280x720 30 fps H.264 + AAC (~750 MB)
# The sound is pink noise plus a tone per channel: dense like music, so the
# encoders work about as hard as on real songs.
set -euo pipefail
out="$(dirname "$0")/../output/long-media"
mkdir -p "$out"
cd "$out"

sound() { # $1 = seconds, $2 = sample rate
  echo -f lavfi -i "anoisesrc=color=pink:amplitude=0.25:duration=$1:sample_rate=$2" \
    -f lavfi -i "sine=frequency=220:duration=$1:sample_rate=$2" \
    -f lavfi -i "sine=frequency=331:duration=$1:sample_rate=$2"
}
# Noise + one tone per channel. $1 = index of the noise input (the video
# file has its picture as input 0).
mix() {
  local n=$1
  echo "[$n][$((n + 1))]amix=inputs=2:normalize=0[l];[$n][$((n + 2))]amix=inputs=2:normalize=0[r];[l][r]join=inputs=2:channel_layout=stereo[a]"
}

make() { # $1 = file, rest = ffmpeg output options
  local file=$1
  shift
  if [[ -s $file ]]; then echo "exists: $file"; return; fi
  echo "making: $file"
  ffmpeg -v error -y "$@" "$file.part.${file##*.}"
  mv "$file.part.${file##*.}" "$file"
}

for minutes in 10 30 60 90 120; do
  make "mp3-${minutes}min.mp3" $(sound $((minutes * 60)) 44100) -filter_complex "$(mix 0)" -map "[a]" -c:a libmp3lame -b:a 192k
done
for minutes in 30 45 60; do
  make "aac-${minutes}min.m4a" $(sound $((minutes * 60)) 44100) -filter_complex "$(mix 0)" -map "[a]" -c:a aac -b:a 128k
done
make opus-60min.webm $(sound 3600 48000) -filter_complex "$(mix 0)" -map "[a]" -c:a libopus -b:a 128k
make wav-60min.wav $(sound 3600 44100) -filter_complex "$(mix 0)" -map "[a]" -c:a pcm_s16le
make video-60min.mp4 -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=3600" $(sound 3600 44100) \
  -filter_complex "$(mix 1)" -map 0:v -map "[a]" -c:v libx264 -preset ultrafast -b:v 1500k -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart

ls -l

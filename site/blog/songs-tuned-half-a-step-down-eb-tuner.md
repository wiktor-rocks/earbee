---
title: "Songs tuned half a step down (with an E♭ tuner)"
description: "Songs tuned half a step down: how to tell a recording is tuned down, an E♭ tuner for your guitar, and how to play along without retuning."
keyword: "songs tuned half a step down"
date: 2026-10-31
draft: true
---

A lot of songs are tuned half a step down: every string a semitone lower than standard, E♭ A♭ D♭ G♭ B♭ E♭. You hear it most in blues, hard rock, grunge and metal. To play along, you can either tune your guitar down a half step, or leave it in standard and shift the recording up a semitone. While I'm learning a song, I'd do the second: [EarBee](/) is a free, open-source player that does it in a click (I make it, so weigh my opinion accordingly).

To tune down, use the E♭ tuner right below: it listens to your guitar through the microphone, and plays each string's note if you'd rather tune by ear.

<h2 id="eb-tuner">E♭ tuner</h2>

<style>
.eb-tuner { margin: 0 0 28px; padding: 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.eb-tuner[hidden] { display: none; }
.eb-tuner p { margin: 0; }
.eb-tuner .button { font-family: inherit; cursor: pointer; touch-action: manipulation; }
.tu-top { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px; }
.tu-top > div { flex: 1; min-width: 12em; }
.tu-note { font-family: var(--display); font-size: 56px; line-height: 1; }
.eb-tuner .tu-status { margin-top: 6px; font-weight: 700; }
.eb-tuner .tu-status.in-tune { color: var(--start); }
.eb-tuner .tu-heard { margin-top: 2px; color: var(--muted); font-size: 15px; font-variant-numeric: tabular-nums; }
.tu-meter { position: relative; height: 28px; margin: 18px 0 4px; border-radius: 8px; background: var(--surface-2); overflow: hidden; }
.tu-meter::before { content: ""; position: absolute; top: 0; bottom: 0; left: 45%; width: 10%; background: color-mix(in srgb, var(--start) 25%, transparent); }
.tu-needle { position: absolute; top: 3px; bottom: 3px; left: 50%; width: 4px; margin-left: -2px; border-radius: 2px; background: var(--accent); transition: left 0.08s linear, opacity 0.2s; }
.tu-needle.in-tune { background: var(--start); }
.tu-needle.idle { opacity: 0.25; }
.tu-scale { display: flex; justify-content: space-between; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.tu-strings { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
.eb-tuner .tu-string { flex: 1; min-width: 3.4em; justify-content: center; padding: 10px 8px; font-size: 18px; }
.eb-tuner .tu-string[aria-pressed="true"] { border-color: var(--accent); color: var(--accent-text); }
.eb-tuner .tu-string.heard { box-shadow: inset 0 -3px 0 var(--accent); }
.eb-tuner .tu-help { margin-top: 12px; color: var(--muted); font-size: 15px; }
@media (max-width: 520px) {
  .eb-tuner .tu-start { flex: 1 1 100%; justify-content: center; }
  .tu-strings { display: grid; grid-template-columns: repeat(6, 1fr); }
  .eb-tuner .tu-string { min-width: 0; padding: 8px 0; flex-direction: column; align-items: center; justify-content: center; gap: 0; align-self: stretch; }
  .eb-tuner .tu-string[data-string="auto"] { grid-column: 1 / -1; flex-direction: row; }
  .eb-tuner .tu-string small { font-size: 11px; }
}
</style>

<div class="eb-tuner" id="eb-tuner-box" hidden>
<div class="tu-top">
<div>
<p class="tu-note" id="tu-note">–</p>
<p class="tu-status" id="tu-status" aria-live="polite">Click Start, then play one string.</p>
<p class="tu-heard" id="tu-heard">&nbsp;</p>
</div>
<button type="button" class="button primary tu-start" id="tu-start">Start the tuner</button>
</div>
<div class="tu-meter" aria-hidden="true"><div class="tu-needle idle" id="tu-needle"></div></div>
<p class="tu-scale" aria-hidden="true"><span>−50</span><span>0</span><span>+50 cents</span></p>
<div class="tu-strings" id="tu-strings">
<button type="button" class="button quiet tu-string" aria-pressed="true" data-string="auto">Auto</button>
<button type="button" class="button quiet tu-string" aria-pressed="false" data-string="0" aria-label="Low E flat, the 6th string">E♭ <small>low</small></button>
<button type="button" class="button quiet tu-string" aria-pressed="false" data-string="1" aria-label="A flat, the 5th string">A♭</button>
<button type="button" class="button quiet tu-string" aria-pressed="false" data-string="2" aria-label="D flat, the 4th string">D♭</button>
<button type="button" class="button quiet tu-string" aria-pressed="false" data-string="3" aria-label="G flat, the 3rd string">G♭</button>
<button type="button" class="button quiet tu-string" aria-pressed="false" data-string="4" aria-label="B flat, the 2nd string">B♭</button>
<button type="button" class="button quiet tu-string" aria-pressed="false" data-string="5" aria-label="High E flat, the 1st string">E♭ <small>high</small></button>
</div>
<p class="tu-help">Auto finds the string you play. Click a string to hear its note, and to tune that string only. The sound stays in your browser: nothing is recorded or sent.</p>
</div>

<script>
// The E♭ tuner: listens through the microphone and shows how far the string
// played is from E♭ standard; the string buttons play each note. Hidden
// without JavaScript, as nothing would work.
(() => {
  const $ = (id) => document.getElementById(id);
  $("eb-tuner-box").hidden = false;
  const intro = $("tu-status").textContent;

  // E♭ standard from the low string, as MIDI notes (E♭2 is 39), with A4 at 440 Hz.
  const STRINGS = [39, 44, 49, 54, 58, 63];
  const NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
  const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
  const name = (midi) => NAMES[((midi % 12) + 12) % 12];
  const signed = (cents) => (cents > 0 ? "+" : cents < 0 ? "−" : "") + Math.abs(cents);

  // The string to tune: null is Auto, the nearest string to what's heard.
  let picked = null;
  let ctx = null;
  let stream = null;
  let analyser = null;
  let buffer = null;
  let frame = 0;
  let raf = 0;
  let readings = [];
  let lastHeard = 0;
  let quietUntil = 0;
  let tone = null;

  function context() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // The pitch of a guitar note, by the McLeod pitch method: the normalized
  // square difference at each lag, then the first peak close to the highest,
  // which keeps it from jumping an octave down. 0 when it's quiet or unclear.
  function detect(data, rate) {
    let level = 0;
    for (let i = 0; i < data.length; i++) level += data[i] * data[i];
    if (Math.sqrt(level / data.length) < 0.01) return 0;
    const minLag = Math.floor(rate / 420);
    const maxLag = Math.min(Math.ceil(rate / 60), data.length >> 1);
    const size = data.length - maxLag;
    const nsdf = new Float32Array(maxLag + 2);
    for (let lag = 0; lag < nsdf.length; lag++) {
      let acf = 0;
      let m = 0;
      for (let i = 0; i < size; i++) {
        const a = data[i];
        const b = data[i + lag];
        acf += a * b;
        m += a * a + b * b;
      }
      nsdf[lag] = m ? (2 * acf) / m : 0;
    }
    // The highest point of each stretch above zero, after the first dip below it.
    const peaks = [];
    let lag = 1;
    while (lag < nsdf.length && nsdf[lag] > 0) lag++;
    while (lag < nsdf.length - 1) {
      while (lag < nsdf.length - 1 && nsdf[lag] <= 0) lag++;
      let best = lag;
      while (lag < nsdf.length - 1 && nsdf[lag] > 0) {
        if (nsdf[lag] > nsdf[best]) best = lag;
        lag++;
      }
      if (best >= minLag && best <= maxLag && nsdf[best] > 0) peaks.push(best);
    }
    if (!peaks.length) return 0;
    const highest = Math.max(...peaks.map((p) => nsdf[p]));
    if (highest < 0.6) return 0;
    const peak = peaks.find((p) => nsdf[p] >= 0.9 * highest);
    // Between samples: the top of a parabola through the peak and its neighbours.
    const [a, b, c] = [nsdf[peak - 1], nsdf[peak], nsdf[peak + 1]];
    const shift = a - 2 * b + c ? (a - c) / (2 * (a - 2 * b + c)) : 0;
    return rate / (peak + shift);
  }

  // What's heard, against the string picked or the nearest one.
  function show(freq) {
    const needle = $("tu-needle");
    if (!freq) {
      $("tu-note").textContent = picked === null ? "–" : name(STRINGS[picked]);
      setStatus(stream ? "Play one string." : intro, false);
      $("tu-heard").innerHTML = "&nbsp;";
      needle.style.left = "50%";
      needle.className = "tu-needle idle";
      highlight(null);
      return;
    }
    const midi = 69 + 12 * Math.log2(freq / 440);
    let string = picked;
    if (string === null) {
      string = 0;
      for (let i = 1; i < STRINGS.length; i++) {
        if (Math.abs(midi - STRINGS[i]) < Math.abs(midi - STRINGS[string])) string = i;
      }
    }
    let cents = Math.round((midi - STRINGS[string]) * 100);
    // A picked string is read in its own octave: a guitar's low strings
    // sometimes sound loudest an octave up.
    if (picked !== null) cents = ((((cents + 600) % 1200) + 1200) % 1200) - 600;
    const inTune = Math.abs(cents) <= 5;
    $("tu-note").textContent = name(STRINGS[string]);
    setStatus(inTune ? "In tune" : cents < 0 ? "Tune up" : "Tune down", inTune);
    const near = Math.round(midi);
    $("tu-heard").textContent = `${signed(cents)} cents · heard ${name(near)}, ${signed(Math.round((midi - near) * 100))}`;
    needle.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
    needle.className = inTune ? "tu-needle in-tune" : "tu-needle";
    highlight(string);
  }
  // Only when it changes, so a screen reader isn't told the same thing many times a second.
  function setStatus(text, inTune) {
    const status = $("tu-status");
    if (status.textContent !== text) status.textContent = text;
    status.classList.toggle("in-tune", inTune);
  }
  function highlight(string) {
    for (const button of $("tu-strings").children) {
      button.classList.toggle("heard", button.dataset.string === String(string));
    }
  }

  // About 30 readings a second; the median of the last five keeps the needle
  // steady, and the last one stays for a second after the note fades.
  function listen() {
    raf = requestAnimationFrame(listen);
    if (frame++ % 2 || performance.now() < quietUntil) return;
    analyser.getFloatTimeDomainData(buffer);
    const freq = detect(buffer, ctx.sampleRate);
    if (freq) {
      readings.push(freq);
      if (readings.length > 5) readings.shift();
      lastHeard = performance.now();
      show([...readings].sort((x, y) => x - y)[readings.length >> 1]);
    } else if (readings.length && performance.now() - lastHeard > 1000) {
      readings = [];
      show(0);
    }
  }

  async function start() {
    const button = $("tu-start");
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("This browser can't use the microphone here, but the strings below still play their notes.", false);
      return;
    }
    button.disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (error) {
      button.disabled = false;
      const missing = error && error.name === "NotFoundError";
      setStatus(missing ? "No microphone found. The strings below still play their notes." : "The microphone wasn't allowed. The strings below still play their notes.", false);
      return;
    }
    const audio = context();
    analyser = audio.createAnalyser();
    analyser.fftSize = 4096;
    buffer = new Float32Array(analyser.fftSize);
    audio.createMediaStreamSource(stream).connect(analyser);
    button.disabled = false;
    button.textContent = "Stop";
    show(0);
    listen();
  }
  function stop() {
    cancelAnimationFrame(raf);
    for (const track of stream.getTracks()) track.stop();
    stream = null;
    readings = [];
    ctx.close();
    ctx = null;
    tone = null;
    $("tu-start").textContent = "Start the tuner";
    show(0);
  }
  $("tu-start").addEventListener("click", () => (stream ? stop() : start()));

  // A string's note: a sawtooth that dulls and dies away like a plucked string.
  // The tuner doesn't listen meanwhile, or it would tune to its own note.
  function play(string) {
    const audio = context();
    const now = audio.currentTime;
    const freq = hz(STRINGS[string]);
    if (tone) tone.stop();
    const osc = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(freq * 8, now);
    filter.frequency.exponentialRampToValueAtTime(freq * 2, now + 2.5);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);
    osc.connect(filter).connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 2.6);
    tone = osc;
    quietUntil = performance.now() + 2700;
    readings = [];
  }
  for (const button of $("tu-strings").children) {
    button.addEventListener("click", () => {
      const value = button.dataset.string;
      picked = value === "auto" ? null : Number(value);
      for (const other of $("tu-strings").children) other.setAttribute("aria-pressed", String(other === button));
      if (picked !== null) play(picked);
      else quietUntil = 0;
      show(0);
    });
  }
})();
</script>

Below: why bands tune down, how to tell that a recording is tuned down, the two ways to play along, and a few songs to test your ear on. I won't tell you which of them are tuned down. That's for you to find out.

## Why do bands tune down a half step?

The reasons you usually hear are practical. A lower tuning sounds darker and heavier. And it can suit the singer: half a step lower, the high notes of a chorus come within reach.

Whatever the reason, the result for you is the same: you play the song's shapes and riffs as usual, and nothing quite fits.

## How can you tell a song is tuned down?

Start with the key. E♭ is an uncomfortable key for a guitar in standard tuning: its chords are barre chords, most of the open strings are outside the key, and the open low E and A, which so many riffs are built on, don't fit. Tuned half a step down, though, E♭ is played with E shapes, the most natural key on the guitar. So if a guitar-driven song is in E♭ major or E♭ minor, that's your first clue that the band tuned down. It's only a clue; the next one tells you for sure.

The most reliable sign is the bottom of the guitar. In standard tuning, the lowest note a guitar can play is the open low E. If a riff goes down to a note a semitone below that, and it's clearly a guitar, not a bass or a keyboard, then the guitar isn't in standard tuning. Nothing you can do with your fingers in standard tuning reaches that note.

## Two ways to play along

### 1. Tune your guitar down

Tune every string down a half step: E♭ A♭ D♭ G♭ B♭ E♭ from the lowest. Most tuners let you tune to those notes directly, and [the one above](#eb-tuner) does only that. Your shapes and the record's are then the same, and the open strings ring exactly as they do on the recording, which matters for some riffs.

The downside is the retuning: back to standard for the next song, down again for this one, and the strings take a while to settle each time. If you have a spare guitar, keeping it in E♭ solves that.

Note that a capo can't help here. A capo raises the pitch: on the first fret, you're a half step higher than standard, not lower.

### 2. Shift the recording up a semitone

Leave your guitar in standard tuning and shift the recording up one semitone, with a player that changes the pitch and keeps the speed. The E♭ the band plays now sounds as E, so you play the same shapes they do, in your own tuning. For a recording that's just a few cents off, shift it by those cents instead.

A semitone barely changes the sound of a recording, so it doesn't get in the way of hearing it. I'd say this is the better way while you're learning a song: you switch between songs without touching your tuning pegs, and you can slow the passage down at the same time. Once you know the song, tune down and play it with the record as it is. ([How to slow down a song without changing the pitch](/blog/slow-down-a-song-without-changing-pitch/) explains how changing the pitch and the speed separately works.)

## Songs to test your ear on

Some of these are tuned half a step down; some are in standard tuning. Use the method above: check the key, then listen for the lowest guitar note. Don't look it up first. Working it out is the point.

- Jimi Hendrix, "Little Wing"
- Stevie Ray Vaughan, "Pride and Joy"
- Deep Purple, "Smoke on the Water"
- Guns N' Roses, "Sweet Child O' Mine"
- Nirvana, "Smells Like Teen Spirit"
- Van Halen, "Ain't Talkin' 'bout Love"

Once you've decided for each one, play along: retuned, or with the recording shifted. If it fits on every note, you got it right. For more songs to learn by ear, with what each one trains, see [eight easy songs to transcribe](/blog/easy-songs-to-transcribe/).

## Try EarBee

[EarBee](/) is a free, open-source player for learning songs by ear. It shifts a song's pitch in semitones and cents without changing its speed, so you can play along with a tuned-down band in standard tuning, or match an old recording that's slightly off. It also slows a passage down without changing the pitch, and loops the bar you're working on. Everything is in the download: there's [no trial, no paid version and no account](/#free). It runs on Windows, macOS and Linux: [download it here](/#download).

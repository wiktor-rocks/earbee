---
title: "How to find the BPM of a song (with a tap tempo calculator)"
description: "Find the BPM of a song with the tap tempo calculator, or count it by ear in 15 seconds. Then check it with a click and avoid the half-time trap."
keyword: "how to find the bpm of a song"
date: 2026-10-30
---

To find the BPM of a song, play it and tap along with the beat on the tap tempo calculator below: after a few taps, it shows the tempo.

<h2 id="tap-tempo-calculator">Tap tempo calculator</h2>

<style>
.tempo-calc { margin: 0 0 28px; padding: 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.tempo-calc[hidden] { display: none; }
.tempo-calc p { margin: 0; }
.tc-tap { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px; }
.tc-tap > div { flex: 1; min-width: 12em; }
.tempo-calc .tc-tap-button { justify-content: center; align-items: center; min-width: 150px; min-height: 96px; font-size: 24px; cursor: pointer; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.tempo-calc .tc-tap-button:active { transform: scale(0.97); }
.tc-readout { font-family: var(--display); font-size: 48px; line-height: 1.1; font-variant-numeric: tabular-nums; }
.tc-readout small { font-family: var(--sans); font-size: 18px; color: var(--muted); }
.tempo-calc .tc-meta { margin-top: 4px; color: var(--muted); font-size: 15px; }
.tempo-calc .tc-reset { padding: 8px 14px; font-size: 15px; cursor: pointer; }
.tempo-calc .tc-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
.tempo-calc input, .tempo-calc select { width: 5em; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font: inherit; }
.tempo-calc output { font-weight: 700; color: var(--accent-text); }
.tc-result { white-space: nowrap; }
@media (max-width: 520px) { .tempo-calc .tc-tap-button { flex: 1 1 100%; } }
</style>

<div class="tempo-calc" id="tempo-calc" hidden>
<div class="tc-tap">
<button type="button" class="button primary tc-tap-button" id="tc-tap">Tap</button>
<div>
<p class="tc-readout"><span id="tc-bpm">–</span> <small>BPM</small></p>
<p class="tc-meta" id="tc-meta" aria-live="polite">Tap along with the beat.</p>
</div>
<button type="button" class="button quiet tc-reset" id="tc-reset">Start again</button>
</div>
<p class="tc-row"><label>Counted <input id="tc-beats" type="number" min="1" inputmode="numeric"> beats</label> <label>in <select id="tc-secs"><option>10</option><option selected>15</option><option>30</option><option>60</option></select> seconds</label> <span class="tc-result">= <output id="tc-count">–</output> BPM</span></p>
<p class="tc-row"><label>A song at <input id="tc-song" type="number" min="1" inputmode="numeric"> BPM</label> <label>played at <input id="tc-speed" type="number" min="1" value="75" inputmode="numeric"> % speed</label> <span class="tc-result">sounds like <output id="tc-heard">–</output> BPM</span></p>
</div>

<script>
// The tempo calculator: the tempo from taps or from a count, and the tempo
// heard at another speed. Hidden without JavaScript, as nothing would work.
(() => {
  const $ = (id) => document.getElementById(id);
  const intro = $("tc-meta").textContent;
  $("tempo-calc").hidden = false;
  // The taps since the last pause of over two seconds, which starts afresh.
  // The tempo is their average over the whole run: steadier than the last few.
  let taps = [];
  function tap(time) {
    if (taps.length && time - taps[taps.length - 1] > 2000) taps = [];
    taps.push(time);
    if (taps.length < 2) {
      $("tc-bpm").textContent = "–";
      $("tc-meta").textContent = "Keep tapping…";
      return;
    }
    const bpm = (60000 * (taps.length - 1)) / (time - taps[0]);
    const shown = Math.round(bpm);
    $("tc-bpm").textContent = String(shown);
    $("tc-meta").textContent = `${taps.length} taps · half time ${Math.round(bpm / 2)}, double time ${shown * 2}`;
    song(bpm);
  }
  const button = $("tc-tap");
  button.addEventListener("pointerdown", (e) => e.button === 0 && tap(e.timeStamp));
  button.addEventListener("contextmenu", (e) => e.preventDefault());
  button.addEventListener("keydown", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (!e.repeat) tap(e.timeStamp);
  });
  $("tc-reset").addEventListener("click", () => {
    taps = [];
    $("tc-bpm").textContent = "–";
    $("tc-meta").textContent = intro;
  });
  // A tempo found above becomes the song's tempo in the last line.
  function song(bpm) {
    $("tc-song").value = String(Math.round(bpm));
    heard();
  }
  function counted() {
    const beats = Number($("tc-beats").value);
    const bpm = beats > 0 ? (beats * 60) / Number($("tc-secs").value) : 0;
    $("tc-count").value = bpm ? String(Math.round(bpm)) : "–";
    if (bpm) song(bpm);
  }
  function heard() {
    const bpm = Number($("tc-song").value);
    const speed = Number($("tc-speed").value);
    $("tc-heard").value = bpm > 0 && speed > 0 ? String(Math.round((bpm * speed) / 100)) : "–";
  }
  $("tc-beats").addEventListener("input", counted);
  $("tc-secs").addEventListener("change", counted);
  $("tc-song").addEventListener("input", heard);
  $("tc-speed").addEventListener("input", heard);
})();
</script>

Once you've clicked Tap, Space works too. If you counted the beats instead, type in how many, and the calculator does the sum. Without a calculator, tap your foot, count the taps for 15 seconds and multiply by four: thirty taps in 15 seconds is 120 BPM. The last line gives the tempo you hear when you slow a song down.

Whichever way you got it, check the number: set a metronome to it and play it along with the song. If the click drifts away, nudge it until it stays put. Software can find the tempo for you, and it's usually close, but it makes one mistake very often: it gives you half or double the right number. So check its answer by ear too.

Below: which beat you're actually counting, how to count it by ear, what software gets wrong, and why, for learning a song, the number matters less than knowing where each bar starts.

## What is BPM, and which beat do you count?

BPM is beats per minute: how many times you'd tap your foot in a minute if you tapped along with the song. That's the whole definition, and it hides the only tricky part. Which beat?

Most songs give you more than one pulse to tap to. Tap along with a rock song and you might tap on every kick and snare, or only on the snare, or twice as fast on the hi-hat. Each of those is a steady pulse, and each gives you a different number. A slow ballad can feel like 70 or 140 depending on whether you follow the singer or the hi-hat.

There's a convention, more or less: count the pulse most people would tap their foot or nod their head to. In most rock and pop, that puts the snare on the second and fourth beat you count. If your number seems strangely slow or strangely fast for how the song feels, you're probably counting half or double time. Neither is wrong, exactly, but if you're telling a drummer the tempo, use the convention.

## How to find the BPM by ear

You need a clock and your foot. Or a hand, if you're on a train.

1. **Find the pulse.** Listen for a few bars before you start counting. Pick a part of the song where the drums or the bass keep a steady beat, usually a verse. Intros are often free in time, and choruses can be busy.
2. **Tap and count for 15 seconds.** Start the clock on a tap and count that tap as zero, not one. Starting at one is the classic way to end up a few BPM too fast.
3. **Multiply by four.** 30 taps is 120 BPM, 25 is 100. Count for 30 seconds and multiply by two if you want to be more accurate: a miscounted tap then costs 2 BPM instead of 4.
4. **Check it with a click.** Set a metronome to your number and start it on a beat of the song. Listen for a minute. If the click slowly drifts ahead, your number is too high; if it falls behind, too low. Change it by one or two and listen again.

The last step is the one people skip, and it's the one that matters. Counting gets you close. Listening to a click against the song tells you whether you're right.

A tap tempo button, like the [calculator's above](#tap-tempo-calculator) or the one in a metronome app or a DAW, does steps 2 and 3 for you: tap along, and it shows the tempo of your taps. It's quicker, but the same rule applies: the first few taps are usually off, so keep tapping until the number settles, then check it with a click.

## What software gets wrong

Plenty of tools find the tempo for you: online BPM finders, DAWs, DJ software, and players made for learning songs. They listen for regular hits in the sound, mostly drums and the attacks of notes, and work out how far apart they are. On a song with a clear beat they're usually right, or close.

When they're wrong, it tends to be in one of these ways:

- **Half or double time.** By far the most common. The software found a steady pulse, just not the one you'd tap your foot to. Usually the beats it found are fine; there are just twice as many as you wanted, or half as many.
- **Songs that speed up or slow down.** Plenty of recordings weren't made to a click. A band playing live pushes the chorus and settles back in the verse. A single number is then only an average, and a beat grid made from it slowly slides away from the music.
- **No steady beat at all.** A rubato ballad, a classical piece, a solo guitar intro: there's no single tempo to find, and any number you get is a guess.
- **Swing and shuffle.** These don't change the tempo, but the uneven eighth notes can confuse a tool into finding the wrong level of beat.

So treat the software's number as a first guess, just like your own count. Play a click along with it and listen.

## Why the bars matter more than the number

If you DJ, the number is most of what you need. If you're learning a song, it's the least of it. In my view, what you really want to know is where each bar starts and how many beats it has.

That's what lets you say "the riff comes in on bar 9" or "the solo is 16 bars long". It's how you hear that a phrase starts just before the bar rather than on it, or that the chord changes on beat 3 instead of beat 1. And it's what makes a loop of exactly one bar loop cleanly, instead of hiccuping where you cut it.

To find the first beat of the bar, count along with the song, "one, two, three, four", and listen for where "one" feels like it lands. Some clues:

- **The chords** usually change on beat 1.
- **The kick drum** often hits on beat 1, with the snare on 2 and 4.
- **A crash cymbal** after a drum fill nearly always lands on a "one".
- **The melody** often starts a phrase just before or on a "one".

If counting to four keeps feeling wrong, try three: you may be in a waltz time, or in a 6/8 that swings in twos. And if a bar seems to come up a beat short now and then, it might be. Odd bars are more common than you'd think, and spotting them is half the fun of transcribing.

The beat you count also changes how you hear the music. A note that lands [a little behind the beat](/blog/why-transcribe-music-by-ear/) only feels laid back if you know where the beat was.

## When you slow the song down

When you [slow a song down to learn it](/blog/slow-down-a-song-without-changing-pitch/), you're hearing a different tempo, of course: 120 BPM at 75 % speed is 90. That matters when you practise with a metronome. Set it to the tempo you're hearing, not the song's, and raise both together as you speed the song back up. The last line of the [calculator](#tap-tempo-calculator) works it out.

## How EarBee does it

[EarBee](/) is a free, open-source player made for transcribing music by ear, and finding the beats is one of the things it does. Ask it, and it finds the beats and the bars, draws them as lines over the waveform and shows the tempo. Then:

- **Check it by ear:** turn on a click on each beat and play the song. If the click and the drums agree, you're done.
- **Fix the usual mistake:** if it found half or double the beats you'd tap, switch to half time or double time. It can also start the bars a beat earlier or later, if it put the "one" in the wrong place.
- **Use the bars:** step through a phrase beat by beat or bar by bar from the keyboard, and loop exactly one bar, then double it or move it on to the next phrase.
- **Slow it down:** it shows the tempo you're hearing at the slower speed too.

Like any beat finder, it can be fooled by the songs in the list above. When it is, the click tells you straight away.

## Try EarBee

[EarBee](/) finds the beats and the bars of a song, slows it down without changing the pitch and loops the bar you're working on. Everything is in the download: there's [no trial, no paid version and no account](/#free). It runs on Windows, macOS and Linux: [download it here](/#download).

"""Exports the Beat This! small beat tracker to ONNX for EarBee, and the
reference data the JS port is tested against. A one-time, dev-only step;
nothing Python ships with the app.

Writes:
  models/beat-this-small.onnx              the network (spectrogram in, beat
                                           and downbeat logits out)
  tests/unit/fixtures/beat-this-golden.json  reference values from the
                                           Python original, for
                                           tests/unit/beat-this.test.mjs

Needs (in a venv):
  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
  pip install numpy einops rotary-embedding-torch soxr onnx onnxruntime onnxscript
  pip install --no-deps git+https://github.com/CPJKU/beat_this.git
Run from the project root:  python scripts/export-beat-model.py

Beat This! (Foscarin, Schlüter, Widmer, ISMIR 2024): code and weights under
the MIT licence, https://github.com/CPJKU/beat_this.
"""

import base64
import json
import math
from pathlib import Path

import numpy as np
import onnxruntime
import soxr
import torch
import torchaudio
from beat_this.inference import load_model, split_predict_aggregate
from beat_this.model.postprocessor import Postprocessor
from beat_this.preprocessing import LogMelSpect

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "models" / "beat-this-small.onnx"
GOLDEN = ROOT / "tests" / "unit" / "fixtures" / "beat-this-golden.json"
CHECKPOINT = "small0"
CHUNK = 1500  # frames per model window (inference.py); every window of a piece
#               longer than ~30 s is exactly this long, so a fixed-size model
#               gives the reference's results


class Logits(torch.nn.Module):
    """The model with its dict output as a (beat, downbeat) pair."""

    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, spect):
        out = self.model(spect)
        return out["beat"], out["downbeat"]


def clip(rate, seconds=32.0):
    """The test clip, mono, as float32: 120 BPM from 0.5 s, a click on each
    beat (louder, higher and with a kick on every 4th), over a quiet chord
    that changes every bar. Computed the same way in the JS test (float64,
    then rounded to float32), so both sides start from the same samples."""
    t = np.arange(round(seconds * rate), dtype=np.float64) / rate
    out = np.zeros_like(t)
    chords = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (261.63, 329.63, 392.0), (196.0, 246.94, 293.66)]
    beat = 0.5
    k = 0
    while beat < seconds:
        since = t - beat
        on = since >= 0
        accent = k % 4 == 0
        freq = 2000.0 if accent else 1000.0
        level = 0.6 if accent else 0.35
        out[on] += level * np.sin(2 * math.pi * freq * since[on]) * np.exp(-since[on] * 60.0)
        if accent:
            out[on] += 0.5 * np.sin(2 * math.pi * 60.0 * since[on]) * np.exp(-since[on] * 12.0)
        beat += 0.5
        k += 1
    bar = np.floor(np.maximum(t - 0.5, 0) / 2.0).astype(int) % 4
    for i in range(3):
        freqs = np.array([chord[i] for chord in chords])[bar]
        out += 0.04 * np.sin(2 * math.pi * freqs * t)
    return out.astype(np.float32)


def b64(array):
    return base64.b64encode(np.ascontiguousarray(array, dtype="<f4").tobytes()).decode("ascii")


def main():
    torch.manual_seed(0)
    model = load_model(CHECKPOINT).eval()
    wrapped = Logits(model).eval()

    # Export with a fixed window: the rotary position embedding doesn't
    # trace to a dynamic length.
    MODEL.parent.mkdir(parents=True, exist_ok=True)
    example = torch.randn(1, CHUNK, 128)
    torch.onnx.export(
        wrapped,
        (example,),
        str(MODEL),
        input_names=["spect"],
        output_names=["beat", "downbeat"],
        dynamic_axes={"spect": {0: "batch"}, "beat": {0: "batch"}, "downbeat": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    print(f"wrote {MODEL} ({MODEL.stat().st_size / 1e6:.1f} MB)")

    session = onnxruntime.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    with torch.inference_mode():
        beat, downbeat = wrapped(example)
    ort_beat, ort_downbeat = session.run(None, {"spect": example.numpy()})
    worst = max(np.abs(ort_beat - beat.numpy()).max(), np.abs(ort_downbeat - downbeat.numpy()).max())
    print(f"ONNX vs PyTorch on random input: max abs difference {worst:.2e}")
    assert worst < 1e-3, worst

    # The reference values.
    spect_of = LogMelSpect()
    post = Postprocessor(type="minimal")
    golden = {"about": __doc__.split("\n")[0], "checkpoint": CHECKPOINT, "chunk": CHUNK}

    fbank = torchaudio.functional.melscale_fbanks(
        n_freqs=513, f_min=30, f_max=11000, n_mels=128, sample_rate=22050, norm=None, mel_scale="slaney"
    )
    golden["melFilterbank"] = b64(fbank.numpy())  # [513][128]

    def run(signal):
        with torch.inference_mode():
            spect = spect_of(torch.tensor(signal))
            pred = split_predict_aggregate(spect, CHUNK, 6, "keep_first", model)
        beats, downbeats = post(pred["beat"], pred["downbeat"])
        return spect.numpy(), pred["beat"].numpy(), pred["downbeat"].numpy(), beats, downbeats

    # At 22050 Hz: no resampling, so the spectrogram and the logits are exact references.
    spect, beat_logits, downbeat_logits, beats, downbeats = run(clip(22050))
    golden["at22050"] = {
        "frames": int(spect.shape[0]),
        "spectHead": b64(spect[:256]),  # the first 256 frames
        "spectTail": b64(spect[-64:]),  # the last 64
        "beatLogits": b64(beat_logits),
        "downbeatLogits": b64(downbeat_logits),
        "beats": [float(x) for x in beats],
        "downbeats": [float(x) for x in downbeats],
    }
    # At 44100 Hz, resampled by soxr as the reference does: the JS resampler is close, not identical.
    signal = soxr.resample(clip(44100), in_rate=44100, out_rate=22050).astype(np.float32)
    spect, _, _, beats, downbeats = run(signal)
    golden["at44100"] = {
        "frames": int(spect.shape[0]),
        "spectHead": b64(spect[:256]),
        "beats": [float(x) for x in beats],
        "downbeats": [float(x) for x in downbeats],
    }
    GOLDEN.parent.mkdir(parents=True, exist_ok=True)
    GOLDEN.write_text(json.dumps(golden) + "\n")
    print(f"wrote {GOLDEN} ({GOLDEN.stat().st_size / 1e3:.0f} kB)")
    print(f"beats at 22050 Hz: {len(golden['at22050']['beats'])}, downbeats: {golden['at22050']['downbeats'][:6]}")


if __name__ == "__main__":
    main()

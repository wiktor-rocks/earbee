"""Exports the Demucs v4 six-stem model (htdemucs_6s) to ONNX for EarBee,
and the reference data the JS inverse STFT is tested against. A one-time,
dev-only step; nothing Python ships with the app.

The model goes up to its last step, turning the spectral branch back into
sound: that needs complex numbers, which the ONNX exporter can't handle,
so it is done in JS (electron/stems/). Its STFT stays inside.

Writes:
  models/htdemucs-6s.onnx                one 7.8 s segment of stereo at
                                         44.1 kHz in ("mix", [1, 2, 343980]),
                                         for each of the six stems the
                                         spectral branch ("spec", [1, 6, 4,
                                         2048, 336]: left and right, real and
                                         imaginary) and the time branch
                                         ("wave", [1, 6, 2, 343980]) out
  tests/unit/fixtures/stems-golden.json  a small spectrogram and Demucs's
                                         inverse of it, for the JS port
With --reference DIR, also a segment of noise and music-like test signal,
and the full PyTorch model's output for it, as raw float32 (DIR/mix.f32,
DIR/stems.f32), for checking the JS side end to end.

Needs (in a venv):
  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
  pip install numpy soundfile einops julius pyyaml tqdm onnx onnxruntime onnxscript
  pip install --no-deps git+https://github.com/adefossez/demucs.git
Run from the project root:  python scripts/export-stem-model.py

Demucs v4 (Rouard, Massa, Défossez, ICASSP 2023): code and weights under
the MIT licence, https://github.com/adefossez/demucs. The weights are
downloaded from Facebook's server by Demucs itself, which checks their hash.
"""

import argparse
import base64
import json
import math
from pathlib import Path

import numpy as np
import onnx
import onnxruntime
import torch
import torch.nn.functional as F
import demucs.htdemucs as htdemucs
from demucs.pretrained import get_model

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "models" / "htdemucs-6s.onnx"
GOLDEN = ROOT / "tests" / "unit" / "fixtures" / "stems-golden.json"
NAME = "htdemucs_6s"
RATE = 44100
SEGMENT = 343980  # int(39/5 * 44100): the length the model was trained on


# Demucs's padding checks its own result against the input, which the
# exporter can't trace (it depends on the data). The same padding, unchecked.
def pad1d(x, paddings, mode="constant", value=0.0):
    return F.pad(x, paddings, mode, value)


htdemucs.pad1d = pad1d


class Separator(torch.nn.Module):
    """HTDemucs.forward (demucs 4.1.0, htdemucs.py) for one full segment in
    eval mode, stopping before _mask and _ispec: returns the spectral
    branch, scaled back, and the time branch."""

    def __init__(self, model):
        super().__init__()
        self.m = model

    def forward(self, mix):
        m = self.m
        z = m._spec(mix)
        x = m._magnitude(z)
        B, C, Fq, T = x.shape
        mean = x.mean(dim=(1, 2, 3), keepdim=True)
        std = x.std(dim=(1, 2, 3), keepdim=True)
        x = (x - mean) / (1e-5 + std)
        xt = mix
        meant = xt.mean(dim=(1, 2), keepdim=True)
        stdt = xt.std(dim=(1, 2), keepdim=True)
        xt = (xt - meant) / (1e-5 + stdt)

        saved, saved_t, lengths, lengths_t = [], [], [], []
        for idx, encode in enumerate(m.encoder):
            lengths.append(x.shape[-1])
            inject = None
            if idx < len(m.tencoder):
                lengths_t.append(xt.shape[-1])
                tenc = m.tencoder[idx]
                xt = tenc(xt)
                if not tenc.empty:
                    saved_t.append(xt)
                else:
                    inject = xt
            x = encode(x, inject)
            if idx == 0 and m.freq_emb is not None:
                frs = torch.arange(x.shape[-2], device=x.device)
                emb = m.freq_emb(frs).t()[None, :, :, None].expand_as(x)
                x = x + m.freq_emb_scale * emb
            saved.append(x)

        if m.crosstransformer:
            if m.bottom_channels:
                b, c, f, t = x.shape
                x = x.reshape(b, c, f * t)
                x = m.channel_upsampler(x)
                x = x.reshape(b, -1, f, t)
                xt = m.channel_upsampler_t(xt)
            x, xt = m.crosstransformer(x, xt)
            if m.bottom_channels:
                b, c, f, t = x.shape
                x = x.reshape(b, c, f * t)
                x = m.channel_downsampler(x)
                x = x.reshape(b, -1, f, t)
                xt = m.channel_downsampler_t(xt)

        for idx, decode in enumerate(m.decoder):
            x, pre = decode(x, saved.pop(-1), lengths.pop(-1))
            offset = m.depth - len(m.tdecoder)
            if idx >= offset:
                tdec = m.tdecoder[idx - offset]
                length_t = lengths_t.pop(-1)
                if tdec.empty:
                    xt, _ = tdec(pre[:, :, 0], None, length_t)
                else:
                    xt, _ = tdec(xt, saved_t.pop(-1), length_t)

        S = len(m.sources)
        x = x.view(B, S, -1, Fq, T) * std[:, None] + mean[:, None]
        xt = xt.view(B, S, -1, SEGMENT) * stdt[:, None] + meant[:, None]
        return x, xt


def finish(model, spec, wave):
    """What Demucs does after the exported part (_mask, _ispec, the sum),
    in PyTorch: the stems as sound, [1, 6, 2, SEGMENT]."""
    spec = torch.from_numpy(spec) if isinstance(spec, np.ndarray) else spec
    wave = torch.from_numpy(wave) if isinstance(wave, np.ndarray) else wave
    zout = model._mask(None, spec)
    return model._ispec(zout, SEGMENT) + wave


def test_mix(seconds_offset=0.0):
    """A segment with something for every stem to find: a kick and a
    snare-like noise burst, a bass note, chords and a sung-like vowel."""
    t = torch.arange(SEGMENT, dtype=torch.float64) / RATE + seconds_offset
    beat = t % 0.5
    kick = torch.sin(2 * math.pi * 55 * beat) * torch.exp(-beat * 30)
    gen = torch.Generator().manual_seed(1)
    snare = torch.randn(SEGMENT, generator=gen, dtype=torch.float64) * torch.exp(-((t + 0.25) % 0.5) * 40) * 0.3
    bass = 0.3 * torch.sin(2 * math.pi * 82.4 * t)
    chord = sum(0.1 * torch.sign(torch.sin(2 * math.pi * f * t)) for f in (329.6, 392.0, 493.9))
    voice = 0.2 * torch.sin(2 * math.pi * 220 * t + 3 * torch.sin(2 * math.pi * 5 * t)) * (1 + torch.sin(2 * math.pi * 0.5 * t)) / 2
    left = kick + snare + bass + chord * 0.8 + voice
    right = kick + snare + bass + chord * 1.2 + voice
    return (torch.stack([left, right])[None] * 0.5).float()


def sdr(reference, estimate):
    """Signal-to-distortion ratio in dB: how close `estimate` is to `reference`."""
    noise = np.sum((reference - estimate) ** 2)
    return 10 * math.log10(np.sum(reference**2) / max(noise, 1e-20))


def golden(model):
    """A small case of the inverse STFT the JS port does: Demucs's own
    _ispec, with a hop of 64 (n_fft 256) instead of 1024, so the fixture
    stays small. Same code path, same padding."""
    hop, frames, length = 64, 40, 2500
    gen = torch.Generator().manual_seed(2)
    re = torch.randn(1, 1, 1, hop * 2, frames, generator=gen)
    im = torch.randn(1, 1, 1, hop * 2, frames, generator=gen)
    small = type("Small", (), {"hop_length": hop})()
    out = htdemucs.HTDemucs._ispec(small, torch.complex(re, im), length)

    def b64(tensor):
        return base64.b64encode(tensor.contiguous().numpy().astype("<f4").tobytes()).decode("ascii")

    return {
        "hop": hop,
        "bins": hop * 2,
        "frames": frames,
        "length": length,
        "re": b64(re.flatten()),
        "im": b64(im.flatten()),
        "out": b64(out.flatten()),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", type=Path, help="also write a test segment and PyTorch's stems for it here")
    args = parser.parse_args()

    model = get_model(NAME).models[0].eval()
    assert model.samplerate == RATE and int(model.segment * RATE) == SEGMENT
    print("stems:", model.sources)
    separator = Separator(model).eval()

    mix = test_mix()
    with torch.no_grad():
        full = model(mix).numpy()
        spec, wave = separator(mix)
        mine = finish(model, spec, wave).numpy()
    print(f"the cut model in PyTorch against the whole one: {sdr(full, mine):.1f} dB")

    MODEL.parent.mkdir(exist_ok=True)
    torch.onnx.export(
        separator, (mix,), str(MODEL), dynamo=True, opset_version=18,
        input_names=["mix"], output_names=["spec", "wave"],
    )
    # The exporter puts the weights in a file of their own beside it; one
    # file is simpler to download and check.
    data = MODEL.with_name(MODEL.name + ".data")
    onnx.save(onnx.load(str(MODEL)), str(MODEL), save_as_external_data=False)
    data.unlink(missing_ok=True)
    print(f"wrote {MODEL.relative_to(ROOT)} ({MODEL.stat().st_size / 1e6:.1f} MB)")

    # The ONNX model, on another segment than the one it was traced with.
    other = test_mix(seconds_offset=3.1)
    session = onnxruntime.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    onnx_spec, onnx_wave = session.run(["spec", "wave"], {"mix": other.numpy()})
    with torch.no_grad():
        reference = model(other).numpy()
        from_onnx = finish(model, onnx_spec, onnx_wave).numpy()
    print(f"ONNX against PyTorch: {sdr(reference, from_onnx):.1f} dB")
    for i, name in enumerate(model.sources):
        print(f"  {name}: {sdr(reference[0, i], from_onnx[0, i]):.1f} dB")

    GOLDEN.parent.mkdir(parents=True, exist_ok=True)
    GOLDEN.write_text(json.dumps(golden(model), indent=2) + "\n")  # as Prettier formats it
    print(f"wrote {GOLDEN.relative_to(ROOT)}")

    if args.reference:
        args.reference.mkdir(parents=True, exist_ok=True)
        other.numpy().astype("<f4").tofile(args.reference / "mix.f32")
        reference.astype("<f4").tofile(args.reference / "stems.f32")
        print(f"wrote the reference segment to {args.reference}")


if __name__ == "__main__":
    main()

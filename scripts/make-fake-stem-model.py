"""Writes a stand-in for the stem model (models/htdemucs-6s.onnx, from
export-stem-model.py) for the tests: the same input and outputs, but no
network. Each of the six stems' time branch is the segment divided by 6,
and every spectral branch is silent, so the stems add up to the song. It
runs in an instant, and is a few hundred bytes, so it can be in git: the
end-to-end test separates with it (tests/e2e/21-stems.cjs), CI included.

Writes:
  tests/unit/fixtures/stem-model-fake.onnx

Needs (in a venv):  pip install onnx
Run from the project root:  python scripts/make-fake-stem-model.py
"""

from pathlib import Path

import onnx
from onnx import TensorProto, helper

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "unit" / "fixtures" / "stem-model-fake.onnx"
SEGMENT = 343980
STEMS, BINS, FRAMES = 6, 2048, 336


def main():
    mix = helper.make_tensor_value_info("mix", TensorProto.FLOAT, [1, 2, SEGMENT])
    spec = helper.make_tensor_value_info("spec", TensorProto.FLOAT, [1, STEMS, 4, BINS, FRAMES])
    wave = helper.make_tensor_value_info("wave", TensorProto.FLOAT, [1, STEMS, 2, SEGMENT])
    constants = [
        helper.make_tensor("sixth", TensorProto.FLOAT, [], [1 / STEMS]),
        helper.make_tensor("axis", TensorProto.INT64, [1], [1]),
        helper.make_tensor("wave_shape", TensorProto.INT64, [4], [1, STEMS, 2, SEGMENT]),
        helper.make_tensor("spec_shape", TensorProto.INT64, [5], [1, STEMS, 4, BINS, FRAMES]),
    ]
    nodes = [
        helper.make_node("Mul", ["mix", "sixth"], ["share"]),
        helper.make_node("Unsqueeze", ["share", "axis"], ["one_stem"]),  # [1, 1, 2, SEGMENT]
        helper.make_node("Expand", ["one_stem", "wave_shape"], ["wave"]),
        helper.make_node(
            "ConstantOfShape",
            ["spec_shape"],
            ["spec"],
            value=helper.make_tensor("zero", TensorProto.FLOAT, [1], [0.0]),
        ),
    ]
    graph = helper.make_graph(nodes, "fake-stems", [mix], [spec, wave], initializer=constants)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)])
    model.ir_version = 9
    onnx.checker.check_model(model)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, str(OUT))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

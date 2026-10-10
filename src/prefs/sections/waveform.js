// Settings › Waveform: how the waveform is drawn (its shape, what it
// measures, the scale, stereo, the height). The values are an Appearance
// (core/waveshape.js); app.js hands them to the waveform's setAppearance().
import { defineSection } from "../fields.js";

export default defineSection({
  id: "waveform",
  title: "Waveform",
  icon: "wave",
  fields: [
    {
      key: "style",
      type: "choice",
      label: "Shape",
      default: "bars",
      options: [
        { value: "bars", label: "Bars" },
        { value: "continuous", label: "Continuous", detail: "one filled shape" },
        { value: "twoTone", label: "Peak + loudness", detail: "pale peaks around solid loudness" },
      ],
    },
    {
      key: "measure",
      type: "choice",
      label: "Show",
      help: "Loudness tells beats and notes apart even in a loud, mastered song; peaks show every transient.",
      default: "loudness",
      options: [
        { value: "loudness", label: "Loudness", detail: "RMS" },
        { value: "peaks", label: "Peaks" },
      ],
      visibleWhen: (values) => values.style !== "twoTone",
    },
    {
      key: "scale",
      type: "choice",
      label: "Scale",
      help: "Logarithmic brings out quiet parts: intros, fades, soft notes.",
      default: "linear",
      options: [
        { value: "linear", label: "Linear" },
        { value: "log", label: "Logarithmic", detail: "dB" },
      ],
    },
    {
      key: "stereo",
      type: "choice",
      label: "Stereo",
      default: "combined",
      options: [
        { value: "combined", label: "Combined", detail: "the louder channel, mirrored" },
        { value: "split", label: "Left above, right below" },
      ],
    },
    {
      key: "height",
      type: "number",
      label: "Height",
      help: "Above 100 %, the loudest parts are clipped to the full height.",
      default: 100,
      min: 50,
      max: 300,
      step: 10,
      unit: "%",
    },
  ],
});

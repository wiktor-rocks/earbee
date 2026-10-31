// Stems (src/features/stems/): the mixer in the Stems section, a row per
// stem (CONFIG.stems.list): its name, a volume knob (ui/knob.js, over a
// range input as the dock's are) with its value, and S (solo) and M
// (mute) toggles. It only shows and reports: index.js keeps the mix and
// applies it.
//
//   buildMixer(container, { list, range, onChange })
//     onChange(id, { volume } | { solo } | { mute }) on every change
//     → { render(mix) }  shows a mix (mix.js's StemSetting by id)
import { buildKnob } from "../../ui/knob.js";
import { element, guarded } from "../../ui/dom.js";

const percent = (volume) => `${Math.round(volume * 100)}%`;

/**
 * @param {HTMLElement} container
 * @param {{
 *   list: { id: string, label: string }[],
 *   range: { min: number, max: number, step: number, initial: number },
 *   onChange: (id: string, change: Partial<import("./mix.js").StemSetting>) => void,
 * }} options
 */
export function buildMixer(container, { list, range, onChange }) {
  const rows = list.map(({ id, label }) => {
    const input = element("input", { type: "range", ariaLabel: `${label} volume` });
    Object.assign(input, { min: String(range.min), max: String(range.max), step: String(range.step) });
    const value = element("output", { className: "knob-value" });
    const toggle = (text, title) =>
      element("button", { type: "button", className: "small toggle", textContent: text, title, ariaLabel: title });
    const solo = toggle("S", `Solo ${label}: only the soloed stems play`);
    const mute = toggle("M", `Mute ${label}`);
    const row = element(
      "div",
      { className: "stems-row" },
      element("span", { className: "stems-name", textContent: label }),
      element("div", { className: "knob-cell" }, input, value),
      solo,
      mute,
    );
    row.dataset.stem = id;
    container.append(row);

    const setVolume = guarded((volume) => onChange(id, { volume: Number(volume) }));
    const knob = buildKnob(input, { range, onInput: setVolume });
    input.addEventListener("input", () => setVolume(input.value));
    solo.addEventListener(
      "click",
      guarded(() => onChange(id, { solo: solo.ariaPressed !== "true" })),
    );
    mute.addEventListener(
      "click",
      guarded(() => onChange(id, { mute: mute.ariaPressed !== "true" })),
    );
    return { id, row, input, value, knob, solo, mute };
  });

  return {
    /** @param {Record<string, import("./mix.js").StemSetting>} mix */
    render(mix) {
      const anySolo = rows.some(({ id }) => mix[id].solo);
      for (const { id, row, input, value, knob, solo, mute } of rows) {
        const setting = mix[id];
        input.value = String(setting.volume);
        knob.render(setting.volume);
        value.textContent = percent(setting.volume);
        solo.ariaPressed = String(setting.solo);
        mute.ariaPressed = String(setting.mute);
        // Not heard: muted, or another stem soloed.
        row.classList.toggle("silent", setting.mute || (anySolo && !setting.solo));
      }
    },
  };
}

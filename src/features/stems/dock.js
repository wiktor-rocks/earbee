// Stems (src/features/stems/): the stems' rows in the Mixer, one per stem
// (CONFIG.stems.list): its name, a volume knob (ui/knob.js, over a range
// input as the dock's are) with its value, a smaller pan knob, and S (solo)
// and M (mute) toggles. The value shows the pan instead while the pointer
// is on the pan knob, or it's focused or being turned. It only shows and
// reports: index.js keeps the mix and applies it.
//
//   buildMixer(container, { list, range, panRange, onChange })
//     onChange(id, { volume } | { pan } | { solo } | { mute }) on every change
//     → { render(mix) }  shows a mix (mix.js's StemSetting by id)
import { buildKnob } from "../../ui/knob.js";
import { element, guarded } from "../../ui/dom.js";
import { formatPan } from "./mix.js";

const percent = (volume) => `${Math.round(volume * 100)}%`;

/** @param {{ min: number, max: number, step: number, initial: number }} range @param {string} ariaLabel */
function rangeInput(range, ariaLabel) {
  const input = element("input", { type: "range", ariaLabel });
  Object.assign(input, { min: String(range.min), max: String(range.max), step: String(range.step) });
  input.value = String(range.initial); // not the middle a range starts at
  return input;
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   list: { id: string, label: string }[],
 *   range: { min: number, max: number, step: number, initial: number },
 *   panRange: { min: number, max: number, step: number, initial: number },
 *   onChange: (id: string, change: Partial<import("./mix.js").StemSetting>) => void,
 * }} options
 */
export function buildMixer(container, { list, range, panRange, onChange }) {
  const rows = list.map(({ id, label }) => {
    const input = rangeInput(range, `${label} volume`);
    const panInput = rangeInput(panRange, `${label} pan`);
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
      element("div", { className: "stems-pan" }, panInput),
      solo,
      mute,
    );
    row.dataset.stem = id;
    container.append(row);

    const setVolume = guarded((volume) => onChange(id, { volume: Number(volume) }));
    const knob = buildKnob(input, { range, onInput: setVolume });
    input.addEventListener("input", () => setVolume(input.value));
    const setPan = guarded((pan) => onChange(id, { pan: Number(pan) }));
    const panKnob = buildKnob(panInput, { range: panRange, centred: true, onInput: setPan });
    panInput.addEventListener("input", () => setPan(panInput.value));
    solo.addEventListener(
      "click",
      guarded(() => onChange(id, { solo: solo.ariaPressed !== "true" })),
    );
    mute.addEventListener(
      "click",
      guarded(() => onChange(id, { mute: mute.ariaPressed !== "true" })),
    );

    // The value shows the pan while it's being looked at or set.
    const showing = { hover: false, focus: false, turning: false };
    const entry = { id, row, input, value, knob, panInput, panKnob, solo, mute, setting: null, showing };
    const show = (key, on) => {
      showing[key] = on;
      if (entry.setting) renderValue(entry);
    };
    const panElement = /** @type {HTMLElement} */ (panInput.parentElement); // the knob, from buildKnob
    panElement.addEventListener("pointerenter", () => show("hover", true));
    panElement.addEventListener("pointerleave", () => show("hover", false));
    panInput.addEventListener("focus", () => show("focus", true));
    panInput.addEventListener("blur", () => show("focus", false));
    panElement.addEventListener("pointerdown", () => {
      show("turning", true);
      window.addEventListener("pointerup", () => show("turning", false), { once: true });
    });
    return entry;
  });

  function renderValue({ value, setting, showing }) {
    const panning = showing.hover || showing.focus || showing.turning;
    value.textContent = panning ? formatPan(setting.pan) : percent(setting.volume);
    value.classList.toggle("stems-pan-value", panning);
  }

  return {
    /** @param {Record<string, import("./mix.js").StemSetting>} mix */
    render(mix) {
      const anySolo = rows.some(({ id }) => mix[id].solo);
      for (const entry of rows) {
        const { id, row, input, knob, panInput, panKnob, solo, mute } = entry;
        const setting = mix[id];
        entry.setting = setting;
        input.value = String(setting.volume);
        knob.render(setting.volume);
        panInput.value = String(setting.pan);
        panKnob.render(setting.pan);
        panInput.parentElement.title = `${list.find((stem) => stem.id === id).label} pan: ${formatPan(setting.pan)}`;
        renderValue(entry);
        solo.ariaPressed = String(setting.solo);
        mute.ariaPressed = String(setting.mute);
        // Not heard: muted, or another stem soloed.
        row.classList.toggle("silent", setting.mute || (anySolo && !setting.solo));
      }
    },
  };
}

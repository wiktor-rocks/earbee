// Stems (src/features/stems/): the stems' rows in the Mixer, one per stem
// (CONFIG.stems.list): its name, a volume knob (ui/knob.js, over a range
// input as the dock's are) with its value, a smaller pan knob, S (solo)
// and M (mute) toggles, and × to fold it into Other (shown while the row is
// pointed at or focused; not on Other's row). The value shows the pan
// instead while the pointer is on the pan knob, or it's focused or being
// turned. A folded stem's row is hidden, Other's name says what it holds,
// and a line under the rows says it, with Show to bring them back. It only
// shows and reports: index.js keeps the mix and applies it.
//
//   buildMixer(container, { list, range, panRange, onChange, onUnfoldAll })
//     onChange(id, { volume } | { pan } | { solo } | { mute } | { folded }) on every change
//     onUnfoldAll() for Show
//     → { render(mix) }  shows a mix (mix.js's StemSetting by id)
import { buildKnob } from "../../ui/knob.js";
import { element, guarded } from "../../ui/dom.js";
import { formatPan } from "./mix.js";

const OTHER = "other";
const percent = (volume) => `${Math.round(volume * 100)}%`;
// "Piano", "Piano and Guitar", "Vocals, Piano and Guitar".
const listed = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

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
 *   onUnfoldAll: () => void,
 * }} options
 */
export function buildMixer(container, { list, range, panRange, onChange, onUnfoldAll }) {
  const rows = list.map(({ id, label }) => {
    const input = rangeInput(range, `${label} volume`);
    const panInput = rangeInput(panRange, `${label} pan`);
    const value = element("output", { className: "knob-value" });
    const toggle = (text, title) =>
      element("button", { type: "button", className: "small toggle", textContent: text, title, ariaLabel: title });
    const solo = toggle("S", `Solo ${label}: only the soloed stems play`);
    const mute = toggle("M", `Mute ${label}`);
    const name = element("span", { className: "stems-name", textContent: label });
    // Other can't be folded into itself: a space keeps the columns.
    const fold =
      id === OTHER
        ? element("span", { className: "stems-fold" })
        : element("button", {
            type: "button",
            className: "stems-fold",
            textContent: "×",
            title: `Fold ${label} into Other: its row goes, its sound stays (Show brings it back)`,
            ariaLabel: `Fold ${label} into Other`,
          });
    const row = element(
      "div",
      { className: "stems-row" },
      name,
      element("div", { className: "knob-cell" }, input, value),
      element("div", { className: "stems-pan" }, panInput),
      solo,
      mute,
      fold,
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
    if (id !== OTHER)
      fold.addEventListener(
        "click",
        guarded(() => onChange(id, { folded: true })),
      );

    // The value shows the pan while it's being looked at or set.
    const showing = { hover: false, focus: false, turning: false };
    const entry = { id, label, row, name, input, value, knob, panInput, panKnob, solo, mute, setting: null, showing };
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

  // What's folded into Other, and Show.
  const foldedText = element("span");
  const showAll = element("button", { type: "button", className: "stems-show", textContent: "Show" });
  showAll.addEventListener("click", guarded(onUnfoldAll));
  const foldedLine = element("p", { className: "stems-folded", hidden: true }, foldedText, " · ", showAll);
  container.append(foldedLine);

  function renderValue({ value, setting, showing }) {
    const panning = showing.hover || showing.focus || showing.turning;
    value.textContent = panning ? formatPan(setting.pan) : percent(setting.volume);
    value.classList.toggle("stems-pan-value", panning);
  }

  return {
    /** @param {Record<string, import("./mix.js").StemSetting>} mix */
    render(mix) {
      const isFolded = (id) => id !== OTHER && mix[id].folded;
      const foldedNames = rows.filter(({ id }) => isFolded(id)).map(({ label }) => label);
      // Only rows still shown count (as in mix.js).
      const anySolo = rows.some(({ id }) => mix[id].solo && !isFolded(id));
      for (const entry of rows) {
        const { id, label, row, name, input, knob, panInput, panKnob, solo, mute } = entry;
        const setting = mix[id];
        row.hidden = isFolded(id);
        if (id === OTHER) name.textContent = foldedNames.length ? `${label} + ${foldedNames.join(", ")}` : label;
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
      foldedLine.hidden = !foldedNames.length;
      foldedText.textContent = `${listed(foldedNames)} ${foldedNames.length === 1 ? "is" : "are"} in Other`;
    },
  };
}

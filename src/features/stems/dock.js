// Stems (src/features/stems/): the stems' rows in the Mixer, one per stem
// (CONFIG.stems.list), kept calm: its name, a small volume knob (ui/knob.js,
// over a range input as the dock's are), and S (solo) and M (mute). A
// click on the name opens the stem's panel beside the side panel: its
// volume and pan, each with its value, and "Fold into Other" (not for
// Other). A folded stem's row is hidden, and a line under the rows says
// what's in Other, with Show to bring it back. It only shows and reports:
// index.js keeps the mix and applies it.
//
//   buildMixer(container, { list, range, panRange, onChange, onUnfoldAll })
//     onChange(id, { volume } | { pan } | { solo } | { mute } | { folded }) on every change
//     onUnfoldAll() for Show
//     → { render(mix) }  shows a mix (mix.js's StemSetting by id)
import { buildKnob } from "../../ui/knob.js";
import { element, guarded } from "../../ui/dom.js";
import { formatPan } from "./mix.js";

const OTHER = "other";
const ANCHOR = "--stem-menu"; // the panel is placed against the name that opened it
const percent = (volume) => `${Math.round(volume * 100)}%`;
// "Piano", "Piano and Guitar", "Vocals, Piano and Guitar".
const listed = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** @param {{ min: number, max: number, step: number, initial: number }} range @param {object} [props] */
function rangeInput(range, props = {}) {
  const input = element("input", { type: "range", ...props });
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
  /** @type {Record<string, import("./mix.js").StemSetting> | null} */
  let shown = null; // the mix last rendered
  let current = null; // the stem the panel is for

  /* ---------- The rows ---------- */

  const rows = list.map(({ id, label }) => {
    const name = element("button", {
      type: "button",
      className: "stems-name",
      textContent: label,
      title: `${label}: volume, pan${id === OTHER ? "" : ", fold into Other"}`,
      ariaHasPopup: "dialog",
      ariaExpanded: "false",
    });
    const input = rangeInput(range, { ariaLabel: `${label} volume` });
    const toggle = (text, title) =>
      element("button", { type: "button", className: "small toggle", textContent: text, title, ariaLabel: title });
    const solo = toggle("S", `Solo ${label}: only the soloed stems play`);
    const mute = toggle("M", `Mute ${label}`);
    const row = element(
      "div",
      { className: "stems-row" },
      name,
      element("div", { className: "knob-cell" }, input),
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
    return { id, label, row, name, input, knob, solo, mute };
  });

  // What's folded into Other, and Show.
  const foldedText = element("span");
  const showAll = element("button", { type: "button", className: "stems-show", textContent: "Show" });
  showAll.addEventListener("click", guarded(onUnfoldAll));
  const foldedLine = element("p", { className: "stems-folded", hidden: true }, foldedText, " · ", showAll);
  container.append(foldedLine);

  /* ---------- A stem's panel ---------- */

  // A knob with its label and value, as in the EQ's popover.
  const panelKnob = (knobRange, label, centred, send) => {
    const input = rangeInput(knobRange, { ariaLabel: label });
    const value = element("output", { className: "knob-value" });
    const cell = element(
      "div",
      { className: "knob-cell" },
      input,
      element("div", { className: "knob-text" }, element("span", { textContent: label }), value),
    );
    const onInput = guarded((v) => current && send(current, Number(v)));
    const knob = buildKnob(input, { range: knobRange, centred, onInput });
    input.addEventListener("input", () => onInput(input.value));
    return { cell, input, value, knob };
  };
  const heading = element("h3");
  const volume = panelKnob(range, "Volume", false, (id, v) => onChange(id, { volume: v }));
  const pan = panelKnob(panRange, "Pan", true, (id, v) => onChange(id, { pan: v }));
  const fold = element("button", { type: "button", className: "menu-item", textContent: "Fold into Other" });
  const panel = element(
    "div",
    { className: "menu stems-menu", role: "dialog" },
    heading,
    element("div", { className: "stems-menu-knobs" }, volume.cell, pan.cell),
    fold,
  );
  panel.setAttribute("popover", "");
  container.append(panel);
  fold.addEventListener(
    "click",
    guarded(() => {
      const id = current;
      panel.hidePopover();
      if (id) onChange(id, { folded: true });
    }),
  );

  function renderPanel() {
    const entry = rows.find(({ id }) => id === current);
    if (!entry || !shown) return;
    const { volume: v, pan: p } = shown[entry.id];
    heading.textContent = entry.label;
    panel.ariaLabel = entry.label;
    volume.input.value = String(v);
    volume.knob.render(v);
    volume.value.textContent = percent(v);
    pan.input.value = String(p);
    pan.knob.render(p);
    pan.value.textContent = formatPan(p);
    fold.hidden = entry.id === OTHER;
  }

  // Opens the panel against the name clicked, or closes it if it was that
  // stem's. (Not ui/menu.js: there ↑ / ↓ move between items, here they turn
  // the focused knob.) A press outside closes it (light dismiss) before the
  // click arrives, so a press on its own name must not open it again.
  let opener = null;
  for (const entry of rows) {
    let closedByPress = false;
    entry.name.addEventListener("pointerdown", () => {
      closedByPress = panel.matches(":popover-open") && current === entry.id;
    });
    entry.name.addEventListener("click", (/** @type {MouseEvent} */ event) => {
      const wasOpen = panel.matches(":popover-open");
      if ((event.detail > 0 && closedByPress) || (wasOpen && current === entry.id)) {
        closedByPress = false;
        if (wasOpen) panel.hidePopover();
        return;
      }
      if (wasOpen) panel.hidePopover();
      for (const { name } of rows) name.style.removeProperty("anchor-name");
      entry.name.style.setProperty("anchor-name", ANCHOR);
      current = entry.id;
      opener = entry.name;
      renderPanel();
      panel.showPopover();
      entry.name.ariaExpanded = "true";
      volume.input.focus();
    });
  }
  panel.addEventListener("toggle", (/** @type {any} */ event) => {
    if (event.newState !== "closed" || !opener) return;
    opener.ariaExpanded = "false";
    if (panel.contains(document.activeElement) || document.activeElement === document.body) opener.focus();
    opener = null;
  });

  return {
    /** @param {Record<string, import("./mix.js").StemSetting>} mix */
    render(mix) {
      shown = mix;
      const isFolded = (id) => id !== OTHER && mix[id].folded;
      const foldedNames = rows.filter(({ id }) => isFolded(id)).map(({ label }) => label);
      // Only rows still shown count (as in mix.js).
      const anySolo = rows.some(({ id }) => mix[id].solo && !isFolded(id));
      for (const { id, label, row, input, knob, solo, mute } of rows) {
        const setting = mix[id];
        row.hidden = isFolded(id);
        input.value = String(setting.volume);
        knob.render(setting.volume);
        input.parentElement.title = `${label} volume: ${percent(setting.volume)}`;
        solo.ariaPressed = String(setting.solo);
        mute.ariaPressed = String(setting.mute);
        // Not heard: muted, or another stem soloed.
        row.classList.toggle("silent", setting.mute || (anySolo && !setting.solo));
      }
      foldedLine.hidden = !foldedNames.length;
      foldedText.textContent = `${listed(foldedNames)} ${foldedNames.length === 1 ? "is" : "are"} in Other`;
      if (panel.matches(":popover-open")) {
        if (current && isFolded(current)) panel.hidePopover();
        else renderPanel();
      }
    },
  };
}

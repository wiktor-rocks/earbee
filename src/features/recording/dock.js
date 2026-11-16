// Recording (src/features/recording/): its part of the Mixer. The input to
// record, with a meter that moves while it's listened to; the Record
// button; once there's a take, its row, as a stem's (its name, which opens
// the list of takes; a small volume knob; S for solo, the take without the
// track; M for mute), the nudge under it,
// and a quiet line when the take can't play at the speed set. It only
// shows and reports: index.js keeps the takes and plays them.
//
//   buildRecorder(section, { volume, nudge, onRecord, onMix, onNudge, onSelect, onDelete, onInput, onCalibrate })
//     onRecord()                        the Record button (start, or stop)
//     onMix({ volume } | { solo } | { mute })
//                                       the take's volume, solo and mute
//     onNudge(ms)                       the nudge
//     onSelect(id), onDelete(id)        from the list of takes
//     onInput(id)                       the input chosen ("" for the system's default)
//     onCalibrate()                     the Calibrate button
//     → { render(view), level(fraction | null) }
//                                       shows a View (below); the meter (null: not listening)
import { formatSigned } from "../../core/format.js";
import { element, guarded, onClick } from "../../ui/dom.js";
import { buildKnob } from "../../ui/knob.js";
import { bindMenu } from "../../ui/menu.js";

/**
 * What the part shows.
 * @typedef {object} View
 * @property {boolean} canRecord A track is open.
 * @property {"idle" | "opening" | "recording" | "finishing" | "calibrating"} stage
 * @property {string} elapsed How long it's been recording ("0:07").
 * @property {{ id: number, label: string, detail: string }[]} takes Oldest first.
 * @property {number | null} selected The take that plays.
 * @property {{ volume: number, solo: boolean, mute: boolean }} mix
 * @property {number} nudge In ms.
 * @property {string} note Why the take isn't heard ("" when it is).
 * @property {{ id: string, label: string }[]} inputs The sound inputs, the system's default aside.
 * @property {string} input The one chosen ("" for the system's default).
 */

const ANCHOR = "--take-menu";
const percent = (volume) => `${Math.round(volume * 100)}%`;

/** @param {{ min: number, max: number, step: number, initial: number }} range @param {object} [props] */
function rangeInput(range, props = {}) {
  const input = element("input", { type: "range", ...props });
  Object.assign(input, { min: String(range.min), max: String(range.max), step: String(range.step) });
  input.value = String(range.initial); // not the middle a range starts at
  return input;
}

/**
 * @param {HTMLElement} section
 * @param {{
 *   volume: { min: number, max: number, step: number, initial: number },
 *   nudge: { min: number, max: number, step: number, initial: number },
 *   onRecord: () => void,
 *   onMix: (change: { volume: number } | { solo: boolean } | { mute: boolean }) => void,
 *   onNudge: (ms: number) => void,
 *   onSelect: (id: number) => void,
 *   onDelete: (id: number) => void,
 *   onInput: (id: string) => void,
 *   onCalibrate: () => void,
 * }} options
 */
export function buildRecorder(
  section,
  { volume, nudge, onRecord, onMix, onNudge, onSelect, onDelete, onInput, onCalibrate },
) {
  let listed = ""; // the takes the list was last built for

  const record = element("button", { type: "button", className: "recording-action" });
  record.setAttribute("aria-pressed", "false");
  onClick(record, onRecord);

  /* ---------- The input, and its meter ---------- */

  const input = element("select", {
    className: "recording-input",
    ariaLabel: "Sound input",
    title: "The sound input to record: your interface's input, or a microphone",
  });
  input.addEventListener(
    "change",
    guarded(() => onInput(input.value)),
  );
  let offered = ""; // the inputs the select was last built for
  const meterFill = element("div", { className: "recording-meter-fill" });
  const meter = element("div", { className: "recording-meter", title: "The input's level", hidden: true }, meterFill);

  /* ---------- The take's row ---------- */

  const name = element("button", {
    type: "button",
    className: "stems-name recording-name",
    title: "The takes: choose the one that plays, or delete it",
    ariaHasPopup: "menu",
    ariaExpanded: "false",
  });
  const volumeInput = rangeInput(volume, { ariaLabel: "Take volume" });
  const solo = element("button", {
    type: "button",
    className: "small toggle",
    textContent: "S",
    title: "Solo the take: only the take plays, without the track",
    ariaLabel: "Solo the take",
  });
  const mute = element("button", {
    type: "button",
    className: "small toggle",
    textContent: "M",
    title: "Mute the take",
    ariaLabel: "Mute the take",
  });
  const row = element(
    "div",
    { className: "stems-row recording-row" },
    name,
    element("div", { className: "knob-cell" }, volumeInput),
    solo,
    mute,
  );
  const setVolume = guarded((value) => onMix({ volume: Number(value) }));
  const volumeKnob = buildKnob(volumeInput, { range: volume, onInput: setVolume });
  volumeInput.addEventListener("input", () => setVolume(volumeInput.value));
  onClick(solo, () => onMix({ solo: solo.ariaPressed !== "true" }));
  onClick(mute, () => onMix({ mute: mute.ariaPressed !== "true" }));

  /* ---------- The nudge ---------- */

  const nudgeInput = rangeInput(nudge, { id: "recordingNudge" });
  const nudgeValue = element("output", { className: "knob-value" });
  const nudgeCell = element(
    "div",
    {
      className: "knob-cell recording-nudge",
      title: "Moves the take against the track, for the delay the system doesn't report: up if you hear it late",
    },
    nudgeInput,
    element(
      "div",
      { className: "knob-text" },
      element("label", { htmlFor: "recordingNudge", textContent: "Nudge" }),
      nudgeValue,
    ),
  );
  const setNudge = guarded((value) => onNudge(Number(value)));
  const nudgeKnob = buildKnob(nudgeInput, { range: nudge, centred: true, onInput: setNudge });
  nudgeInput.addEventListener("input", () => setNudge(nudgeInput.value));

  // Measures the nudge: for when the input can hear the output.
  const calibrate = element("button", {
    type: "button",
    className: "small recording-calibrate",
    textContent: "Calibrate",
    title:
      "Measures the nudge with a few clicks. The input has to hear the output: connect an output to this input with a cable, or hold a microphone to the speaker",
  });
  onClick(calibrate, onCalibrate);
  const timing = element("div", { className: "recording-timing" }, nudgeCell, calibrate);

  const note = element("p", { className: "stems-note recording-note" });
  const mixer = element("div", { className: "stems-mixer recording-mixer" }, row);

  /* ---------- The list of takes ---------- */

  const menu = element("div", { className: "menu recording-menu", role: "menu", ariaLabel: "Takes" });
  menu.setAttribute("popover", "");
  bindMenu({
    menu,
    buttons: () => [name],
    anchor: ANCHOR,
    itemSelector: ".menu-item",
    initialFocus: () => menu.querySelector('[aria-checked="true"]'),
    closeOnPick: true,
  });
  menu.addEventListener(
    "click",
    guarded((/** @type {MouseEvent} */ event) => {
      const item = /** @type {HTMLElement} */ (event.target).closest(".menu-item");
      if (!(item instanceof HTMLElement)) return;
      const id = Number(item.dataset.take);
      if (item.dataset.action === "delete") onDelete(id);
      else onSelect(id);
    }),
  );

  /** @param {View} view */
  function renderMenu({ takes, selected }) {
    // Only when they changed: rebuilding would take the focus from an open list.
    const key = JSON.stringify([takes, selected]);
    if (key === listed) return;
    listed = key;
    const items = takes.toReversed().map(({ id, label, detail }) => {
      const item = element(
        "button",
        { type: "button", className: "menu-item", role: "menuitemradio", ariaChecked: String(id === selected) },
        element("span", { className: "menu-label", textContent: label }),
        element("small", { textContent: detail }),
      );
      item.dataset.take = String(id);
      return item;
    });
    const current = takes.find(({ id }) => id === selected);
    const remove = element("button", {
      type: "button",
      className: "menu-item",
      role: "menuitem",
      textContent: current ? `Delete ${current.label}` : "",
      hidden: !current,
    });
    remove.dataset.take = String(selected);
    remove.dataset.action = "delete";
    menu.replaceChildren(...items, element("hr"), remove);
  }

  section.append(
    element("div", { className: "stems-head" }, element("h3", { textContent: "Recording" })),
    input,
    meter,
    mixer,
    timing,
    note,
    record,
    menu,
  );

  return {
    /** @param {View} view */
    render(view) {
      const { stage, takes, selected, mix } = view;
      const current = takes.find(({ id }) => id === selected);

      const recording = stage === "recording";
      record.disabled = !view.canRecord || !["idle", "recording"].includes(stage);
      calibrate.disabled = !view.canRecord || stage !== "idle";
      calibrate.textContent = stage === "calibrating" ? "Listening…" : "Calibrate";
      record.classList.toggle("on", recording);
      record.setAttribute("aria-pressed", String(recording));
      record.textContent = {
        idle: "● Record",
        opening: "Opening the input…",
        recording: `■ Stop recording · ${view.elapsed}`,
        finishing: "Keeping the take…",
        calibrating: "● Record",
      }[stage];
      record.title = recording
        ? "Stop recording (pausing stops it too)"
        : "Record the sound input while the track plays. With the loop on, each time around is a take";

      mixer.hidden = !current;
      name.textContent = current?.label ?? "";
      volumeInput.value = String(mix.volume);
      volumeKnob.render(mix.volume);
      volumeInput.parentElement.title = `Take volume: ${percent(mix.volume)}`;
      solo.ariaPressed = String(mix.solo);
      mute.ariaPressed = String(mix.mute);
      row.classList.toggle("silent", mix.mute || view.note !== "");

      nudgeInput.value = String(view.nudge);
      nudgeKnob.render(view.nudge);
      nudgeValue.textContent = formatSigned(view.nudge, " ms");

      note.hidden = !current || view.note === "";
      note.textContent = view.note;

      // The inputs, only when they changed (an open select would close).
      const key = JSON.stringify(view.inputs);
      if (key !== offered) {
        offered = key;
        input.replaceChildren(
          element("option", { value: "", textContent: "System default input" }),
          ...view.inputs.map(({ id, label }) => element("option", { value: id, textContent: label })),
        );
      }
      input.value = view.input;
      input.disabled = stage !== "idle";

      if (!current && menu.matches(":popover-open")) menu.hidePopover();
      renderMenu(view);
    },
    /** The meter: how full (0…1), or null to put it away. @param {number | null} fraction */
    level(fraction) {
      meter.hidden = fraction === null;
      meterFill.style.width = `${Math.round((fraction ?? 0) * 100)}%`;
    },
  };
}

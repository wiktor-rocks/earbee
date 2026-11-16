// Recording (src/features/recording/): its part of the Mixer. The Record
// button; once there's a take, its row, as a stem's (its name, which opens
// the list of takes; a small volume knob; M for mute), the nudge under it,
// and a quiet line when the take can't play at the speed set. It only
// shows and reports: index.js keeps the takes and plays them.
//
//   buildRecorder(section, { volume, nudge, onRecord, onMix, onNudge, onSelect, onDelete })
//     onRecord()                        the Record button (start, or stop)
//     onMix({ volume } | { mute })      the take's volume and mute
//     onNudge(ms)                       the nudge
//     onSelect(id), onDelete(id)        from the list of takes
//     → { render(view) }                shows a View (below)
import { formatSigned } from "../../core/format.js";
import { element, guarded, onClick } from "../../ui/dom.js";
import { buildKnob } from "../../ui/knob.js";
import { bindMenu } from "../../ui/menu.js";

/**
 * What the part shows.
 * @typedef {object} View
 * @property {boolean} canRecord A track is open.
 * @property {"idle" | "opening" | "recording" | "finishing"} stage
 * @property {string} elapsed How long it's been recording ("0:07").
 * @property {{ id: number, label: string, detail: string }[]} takes Oldest first.
 * @property {number | null} selected The take that plays.
 * @property {{ volume: number, mute: boolean }} mix
 * @property {number} nudge In ms.
 * @property {string} note Why the take isn't heard ("" when it is).
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
 *   onMix: (change: { volume: number } | { mute: boolean }) => void,
 *   onNudge: (ms: number) => void,
 *   onSelect: (id: number) => void,
 *   onDelete: (id: number) => void,
 * }} options
 */
export function buildRecorder(section, { volume, nudge, onRecord, onMix, onNudge, onSelect, onDelete }) {
  let listed = ""; // the takes the list was last built for

  const record = element("button", { type: "button", className: "recording-action" });
  record.setAttribute("aria-pressed", "false");
  onClick(record, onRecord);

  /* ---------- The take's row ---------- */

  const name = element("button", {
    type: "button",
    className: "stems-name recording-name",
    title: "The takes: choose the one that plays, or delete it",
    ariaHasPopup: "menu",
    ariaExpanded: "false",
  });
  const volumeInput = rangeInput(volume, { ariaLabel: "Take volume" });
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
    mute,
  );
  const setVolume = guarded((value) => onMix({ volume: Number(value) }));
  const volumeKnob = buildKnob(volumeInput, { range: volume, onInput: setVolume });
  volumeInput.addEventListener("input", () => setVolume(volumeInput.value));
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
    mixer,
    nudgeCell,
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
      record.disabled = !view.canRecord || stage === "opening" || stage === "finishing";
      record.classList.toggle("on", recording);
      record.setAttribute("aria-pressed", String(recording));
      record.textContent = {
        idle: "● Record",
        opening: "Opening the input…",
        recording: `■ Stop recording · ${view.elapsed}`,
        finishing: "Keeping the take…",
      }[stage];
      record.title = recording
        ? "Stop recording (pausing stops it too)"
        : "Record the sound input while the track plays. With the loop on, each time around is a take";

      mixer.hidden = !current;
      nudgeCell.hidden = !current;
      name.textContent = current?.label ?? "";
      volumeInput.value = String(mix.volume);
      volumeKnob.render(mix.volume);
      volumeInput.parentElement.title = `Take volume: ${percent(mix.volume)}`;
      mute.ariaPressed = String(mix.mute);
      row.classList.toggle("silent", mix.mute || view.note !== "");

      nudgeInput.value = String(view.nudge);
      nudgeKnob.render(view.nudge);
      nudgeValue.textContent = formatSigned(view.nudge, " ms");

      note.hidden = !current || view.note === "";
      note.textContent = view.note;

      if (!current && menu.matches(":popover-open")) menu.hidePopover();
      renderMenu(view);
    },
  };
}

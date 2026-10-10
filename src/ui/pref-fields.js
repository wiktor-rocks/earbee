// The Settings dialog's controls: one renderer per field type (see
// src/prefs/fields.js). A renderer builds its control once and returns
// { element, update(values) }; update() shows a section's current values,
// so a change made anywhere (the palette menu, another window) shows here
// without rebuilding anything, and focus stays put.
//
// A new field type: an entry in TYPES (src/prefs/fields.js) and one here.
import { isVisible } from "../prefs/index.js";
import { element, guarded } from "./dom.js";

/**
 * @typedef {import("../prefs/fields.js").Field} Field
 * @typedef {import("../prefs/fields.js").Option} Option
 * @typedef {object} FieldActions What a control can do to its setting.
 * @property {(value: unknown) => Promise<void>} set
 * @property {() => Promise<void>} reset
 * @property {() => Promise<void>} chooseFolder
 * @property {string} [defaultPath] What a folder's null means.
 * @typedef {{ element: HTMLElement, update: (values: Record<string, any>) => void }} Rendered
 */

/** Colour squares previewing a theme (also used by the palette menu). @param {string[]} colors */
export const swatch = (colors) =>
  element(
    "span",
    { className: "theme-swatch", ariaHidden: "true" },
    ...colors.map((color) => element("span", { style: `background: ${color}` })),
  );

let fieldCount = 0;

/** @type {Record<string, (field: Field, actions: FieldActions, id: string) => Rendered>} */
const RENDERERS = {
  // Radios: a list with swatches (themes), or a row of tiles (audio /
  // video, 720p / 1080p, Bars / Continuous…), each with its detail if any.
  choice(field, actions, id) {
    const rich = field.options.some((option) => option.swatch);
    const group = element("div", {
      className: `pref-options ${rich ? "pref-options-list" : "pref-options-row"}`,
      role: "radiogroup",
    });
    group.setAttribute("aria-labelledby", `${id}-label`);
    const inputs = field.options.map((option) => {
      const input = element("input", { type: "radio", name: id, value: String(option.value) });
      input.addEventListener(
        "change",
        guarded(() => input.checked && actions.set(option.value)),
      );
      const text = element(
        "span",
        { className: "pref-option-text" },
        option.label,
        option.detail ? element("small", {}, option.detail) : "",
      );
      group.append(
        element("label", { className: "pref-option" }, input, ...(option.swatch ? [swatch(option.swatch)] : []), text),
      );
      return { input, value: option.value };
    });
    return {
      element: group,
      update(values) {
        for (const { input, value } of inputs) input.checked = value === values[field.key];
      },
    };
  },

  boolean(field, actions, id) {
    const input = element("input", { type: "checkbox", id: `${id}-input`, className: "pref-switch" });
    input.setAttribute("aria-labelledby", `${id}-label`);
    input.addEventListener(
      "change",
      guarded(() => actions.set(input.checked)),
    );
    return { element: input, update: (values) => (input.checked = values[field.key]) };
  },

  number(field, actions, id) {
    const input = element("input", { type: "range", min: field.min, max: field.max, step: field.step ?? "any" });
    input.setAttribute("aria-labelledby", `${id}-label`);
    const output = element("output", { className: "pref-number" });
    const show = (value) => (output.textContent = field.unit ? `${value} ${field.unit}` : String(value));
    input.addEventListener("input", () => show(input.value));
    input.addEventListener(
      "change",
      guarded(() => actions.set(Number(input.value))),
    );
    return {
      element: element("div", { className: "pref-range" }, input, output),
      update(values) {
        input.value = String(values[field.key]);
        show(values[field.key]);
      },
    };
  },

  // The path (or the default one, marked as such) and a button for the
  // system's folder picker; the page never types a path in.
  folder(field, actions) {
    const path = element("code", { className: "pref-path" });
    const note = element("small", {}, "(the default)");
    const choose = element("button", { type: "button", className: "small" }, "Choose…");
    choose.addEventListener(
      "click",
      guarded(() => actions.chooseFolder()),
    );
    return {
      element: element("div", { className: "pref-folder" }, path, note, choose),
      update(values) {
        const value = values[field.key];
        path.textContent = value ?? actions.defaultPath ?? "";
        note.hidden = value !== null;
      },
    };
  },
};

/**
 * One setting: its label, help, control and Reset button. Hidden while its
 * visibleWhen() says so; Reset shows only when it isn't at its default.
 * @param {Field} field
 * @param {FieldActions} actions
 * @returns {Rendered}
 */
export function renderField(field, actions) {
  const id = `pref-${++fieldCount}`;
  const control = RENDERERS[field.type](field, actions, id);
  const reset = element("button", { type: "button", className: "small pref-reset" }, "Reset");
  reset.title = "Back to the default";
  reset.addEventListener(
    "click",
    guarded(() => actions.reset()),
  );
  // An on/off switch sits on the right of its label; other controls go
  // under the label and help.
  const inHead = field.type === "boolean";
  const row = element(
    "div",
    { className: "pref-field" },
    element(
      "div",
      { className: "pref-head" },
      element("span", { id: `${id}-label`, className: "pref-label" }, field.label),
      reset,
      ...(inHead ? [control.element] : []),
    ),
    ...(field.help ? [element("p", { className: "pref-help" }, field.help)] : []),
    ...(inHead ? [] : [control.element]),
  );
  row.dataset.key = field.key;
  return {
    element: row,
    update(values) {
      row.hidden = !isVisible(field, values);
      reset.hidden = values[field.key] === field.default;
      control.update(values);
    },
  };
}

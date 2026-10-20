// The colour themes (src/themes): every theme is complete and readable, and
// the logic that picks and applies one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  DEFAULT_PREFS,
  MARK_COLORS,
  REQUIRED_ROLES,
  ROLES,
  THEMES,
  contrast,
  cssVariables,
  getTheme,
  parseHex,
  resolveTheme,
} from "../../src/themes/index.js";

const distance = (a, b) => Math.hypot(...parseHex(a).map((c, i) => c - parseHex(b)[i]));

describe("every theme", () => {
  test("has a unique id, a name and a scheme", () => {
    assert.equal(new Set(THEMES.map((theme) => theme.id)).size, THEMES.length);
    for (const theme of THEMES) {
      assert.ok(theme.name, theme.id);
      assert.ok(["dark", "light"].includes(theme.scheme), theme.id);
    }
  });

  test("defines every required role as #rrggbb, and nothing unknown", () => {
    for (const theme of THEMES) {
      for (const role of REQUIRED_ROLES)
        assert.match(theme.colors[role] ?? "", /^#[0-9a-f]{6}$/i, `${theme.id}.${role}`);
      for (const role of Object.keys(theme.colors)) assert.ok(role in ROLES, `${theme.id}: unknown role ${role}`);
    }
  });

  // WCAG 2 contrast. Text needs 4.5:1 (AA); graphics such as the played
  // waveform, the loop and focus rings need 3:1. The unplayed waveform is
  // deliberately soft, but must stay visible.
  for (const theme of THEMES) {
    test(`${theme.name}: readable`, () => {
      const v = cssVariables(theme);
      const atLeast = (minimum, fg, ...backgrounds) => {
        for (const bg of backgrounds) {
          const ratio = contrast(v[fg], v[bg]);
          assert.ok(ratio >= minimum, `${fg} on ${bg}: ${ratio.toFixed(2)} < ${minimum}`);
        }
      };
      atLeast(4.5, "--text", "--bg", "--surface", "--surface-2", "--surface-hover");
      atLeast(4.5, "--muted", "--bg", "--surface");
      atLeast(4.5, "--danger", "--bg", "--surface");
      atLeast(4.5, "--accent-ink", "--accent", "--accent-hover");
      atLeast(4.5, "--cursor", "--surface");
      // EarBee Light's amber is a fill, soft on purpose (one brand colour); as text it's darkened in style.css.
      if (theme.id !== "earbee-light") atLeast(3, "--accent", "--surface");
      atLeast(3, "--loop", "--surface");
      atLeast(3, "--start", "--surface");
      atLeast(3, "--stop", "--surface");
      atLeast(1.5, "--wave", "--surface");
      for (const color of MARK_COLORS) atLeast(3, `--mark-${color.id}`, "--bg", "--surface");
      const apart = distance(v["--loop"], v["--accent"]);
      assert.ok(apart >= 90, `loop and accent too alike (${apart.toFixed(0)})`);
      // The start and stop points: apart from each other and from the loop
      // and accent they're drawn over. (Gruvbox's accent is itself a red-orange.)
      const apartFrom = (variable, others, minimum) => {
        for (const other of others) {
          const away = distance(v[variable], v[other]);
          assert.ok(away >= minimum, `${variable} and ${other} too alike (${away.toFixed(0)})`);
        }
      };
      apartFrom("--start", ["--loop", "--accent", "--stop"], 70);
      apartFrom("--stop", ["--loop"], 70);
      apartFrom("--stop", ["--accent"], 60);
    });
  }
});

describe("cssVariables", () => {
  test("sets every variable, deriving the optional ones", () => {
    const nord = getTheme("nord");
    assert.equal(nord.colors.surfaceHover, undefined);
    const v = cssVariables(nord);
    const marks = MARK_COLORS.map((color) => `--mark-${color.id}`);
    assert.deepEqual(Object.keys(v).sort(), [...Object.values(ROLES), ...marks].sort());
    for (const value of Object.values(v)) assert.match(value, /^#[0-9a-f]{6}$/i);
    assert.equal(v["--bg"], "#2e3440");
  });

  test("the marks' colours follow the theme's scheme", () => {
    const [rose] = MARK_COLORS;
    assert.equal(cssVariables(getTheme("nord"))["--mark-rose"], rose.dark);
    assert.equal(cssVariables(getTheme("github-light"))["--mark-rose"], rose.light);
  });

  test("a theme's own value wins over the derived one", () => {
    assert.equal(cssVariables(getTheme("earbee"))["--surface-hover"], "#262a33");
  });
});

describe("picking a theme", () => {
  test("an explicit choice, whatever the system", () => {
    assert.equal(resolveTheme({ choice: "dracula" }, false).id, "dracula");
  });

  test("automatic follows the system with the chosen pair", () => {
    const prefs = { choice: "auto", dark: "nord", light: "solarized-light" };
    assert.equal(resolveTheme(prefs, true).id, "nord");
    assert.equal(resolveTheme(prefs, false).id, "solarized-light");
  });

  test("unknown or mismatched ids fall back to the defaults", () => {
    assert.equal(resolveTheme({ choice: "gone" }, true).id, DEFAULT_PREFS.choice);
    assert.equal(resolveTheme({ choice: "auto", dark: "solarized-light" }, true).id, DEFAULT_PREFS.dark);
    assert.equal(resolveTheme(null, true).id, DEFAULT_PREFS.choice);
  });
});

test("style.css defaults are the EarBee theme", () => {
  // The page's fallback (before or without JavaScript) must look like the
  // default theme.
  const css = readFileSync(new URL("../../style.css", import.meta.url), "utf8");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  for (const [variable, value] of Object.entries(cssVariables(getTheme("earbee")))) {
    const match = new RegExp(`${variable}:\\s*([^;]+);`).exec(root);
    assert.ok(match, `${variable} missing from :root`);
    assert.equal(match[1].trim().toLowerCase(), value, variable);
  }
});

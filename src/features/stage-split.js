/* =====================================================================
 * STAGE SPLIT
 * A handle between the picture and the timeline, while a video is on the
 * stage: dragging it up makes the timeline taller and the picture
 * smaller, down the other way, without going to big video.
 *
 *   How        The timeline's part of the stage's height is
 *              --timeline-share on #stage (style.css, "Stage"); a drag
 *              sets it, with --timeline-min lowered to
 *              CONFIG.stage.minTimeline, so the waveform can become a
 *              thin strip. The picture and the waveform follow their new
 *              sizes by themselves (their ResizeObservers). Big video and
 *              the video window lay the stage out their own way and hide
 *              the handle.
 *   Saved      In project files (the "stage" section,
 *              features/project/sections.js); a new file starts from the
 *              default, as before the handle was dragged.
 *
 * Removing it means deleting this file, its part in style.css ("Stage
 * split handle") and the lines marked "Stage split (".
 * ===================================================================== */

import { CONFIG } from "../config.js";
import { clamp } from "../core/format.js";
import { $, element } from "../ui/dom.js";

const stage = $("stage");

/** The timeline's part of the stage's height, 0–1. */
export function getTimelineShare() {
  const share = Number.parseFloat(stage.style.getPropertyValue("--timeline-share"));
  return Number.isFinite(share) ? share : CONFIG.stage.timelineShare;
}

/** @param {number} share Kept within CONFIG.stage.minShare–maxShare. */
export function setTimelineShare(share) {
  const { minShare, maxShare, minTimeline } = CONFIG.stage;
  stage.style.setProperty("--timeline-share", String(clamp(share, minShare, maxShare)));
  stage.style.setProperty("--timeline-min", `${minTimeline}px`);
}

// Back to the layout before any drag: 40 % and at least 170 px (style.css).
export function resetTimelineShare() {
  stage.style.removeProperty("--timeline-share");
  stage.style.removeProperty("--timeline-min");
}

export function bindStageSplit() {
  const handle = element("div", {
    className: "stage-split",
    role: "separator",
    ariaOrientation: "horizontal",
    ariaLabel: "Resize the video and the waveform",
    title: "Drag to make the video bigger or smaller",
  });
  stage.append(handle);

  const timeline = /** @type {HTMLElement} */ (stage.querySelector(".timeline"));
  const minimap = $("waveform-minimap");

  // The timeline's height for the pointer at `y`: the handle's middle
  // follows the pointer. Kept so the timeline and the picture both keep
  // their least heights.
  function timelineHeightAt(y) {
    const gap = Number.parseFloat(getComputedStyle(stage).rowGap) || 0;
    const room = stage.clientHeight - minimap.offsetHeight - 2 * gap;
    const wanted = timeline.getBoundingClientRect().bottom - y - handle.offsetHeight / 2;
    return clamp(wanted, CONFIG.stage.minTimeline, Math.max(CONFIG.stage.minTimeline, room - CONFIG.stage.minVideo));
  }

  // One change a frame, the newest pointer position.
  let pendingY = null;
  function apply() {
    const y = pendingY;
    pendingY = null;
    if (y !== null && stage.clientHeight > 0) setTimelineShare(timelineHeightAt(y) / stage.clientHeight);
  }

  function onMove(event) {
    if (pendingY === null) requestAnimationFrame(apply);
    pendingY = event.clientY;
  }

  // Moves and the release are followed on the window, so a drag goes on
  // wherever the pointer goes (the capture, where it takes, keeps other
  // elements from reacting meanwhile).
  function endDrag() {
    handle.classList.remove("dragging");
    document.body.classList.remove("stage-split-dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  }

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add("stage-split-dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  });
}

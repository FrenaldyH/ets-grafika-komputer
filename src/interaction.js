// interaction.js — mouse and keyboard input.
//
// Hover and click both use THREE.Raycaster: a ray is shot from the camera
// through the mouse position, and the first artifact it hits is the one under
// the pointer. Clicks are told apart from camera drags, because releasing the
// mouse after orbiting the camera also fires a "click" event.

import * as THREE from "three";

/** A press that moves more than this many pixels is a drag, not a click. */
const DRAG_THRESHOLD_PX = 5;

/**
 * Connects pointer and keyboard input to the museum.
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {THREE.Camera} options.camera
 * @param {object[]} options.exhibits From buildExhibits().
 * @param {object} options.museum From createMuseum().
 * @returns {{ dispose: () => void }} Call dispose() to remove every listener.
 */
export function createInteraction({ canvas, camera, exhibits, museum }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(); // mouse position in NDC (-1..1)
  // Rays are tested against each exhibit's invisible hit box, not the artifact
  // meshes — see createHitArea() in exhibits.js for why.
  const targets = exhibits.map((exhibit) => exhibit.hitArea);

  /** Where the current press started, or null when no button is down. */
  let press = null;

  /**
   * Whether the press that just ended was a drag. Kept separately because the
   * browser fires "pointerup" (which clears `press`) BEFORE "click".
   */
  let lastPressWasDrag = false;

  /**
   * Converts a mouse event's pixel position into NDC (Normalized Device
   * Coordinates): x and y from -1 to 1 with +y pointing UP — the space the
   * raycaster expects. Measured against the canvas, not the whole window.
   *
   * @param {PointerEvent | MouseEvent} event
   */
  function updatePointer(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /**
   * Finds the exhibit under the pointer.
   *
   * setFromCamera() builds a ray that starts at the camera and passes through
   * the pointer's NDC position. intersectObjects() returns every hit, nearest
   * first, so the first result is the exhibit in front. Each hit box stores
   * its exhibit's index in userData, which maps the hit back to the exhibit.
   *
   * @returns {object|null} The exhibit, or null if the ray hits no artifact.
   */
  function pickExhibit() {
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObjects(targets, false);
    return hit ? exhibits[hit.object.userData.exhibitIndex] : null;
  }

  /**
   * Hover: re-checks what is under the pointer as it moves.
   * Skipped while a button is held, so hover does not flicker during a drag.
   *
   * @param {PointerEvent} event
   */
  function onPointerMove(event) {
    if (press) {
      // Once the pointer has travelled far enough, this press is a drag.
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_THRESHOLD_PX) press.dragged = true;
      return;
    }

    // Over a UI panel rather than the canvas: nothing in the scene is hovered.
    if (event.target !== canvas) {
      museum.setHovered(null);
      return;
    }

    updatePointer(event);
    const exhibit = museum.canSelect() ? pickExhibit() : null;
    museum.setHovered(exhibit);
    canvas.style.cursor = exhibit ? "pointer" : "";
  }

  /**
   * Remembers where a press started, to measure later whether it became a drag.
   *
   * @param {PointerEvent} event
   */
  function onPointerDown(event) {
    press = { x: event.clientX, y: event.clientY, dragged: false };
  }

  /**
   * Click: selects the artifact under the pointer — unless the press was a
   * camera drag, or it was not the left mouse button.
   *
   * @param {MouseEvent} event
   */
  function onClick(event) {
    if (lastPressWasDrag || event.button !== 0 || !museum.canSelect()) return;

    updatePointer(event);
    const exhibit = pickExhibit();
    if (exhibit) {
      canvas.style.cursor = "";
      museum.inspect(exhibit);
    }
  }

  /**
   * Ends the press wherever the button is released — even outside the canvas,
   * which would otherwise leave `press` set and freeze hover detection.
   */
  function onPointerUp() {
    lastPressWasDrag = press?.dragged ?? false;
    press = null;
  }

  /** Clears the hover highlight when the pointer leaves the canvas. */
  function onPointerLeave() {
    if (!press) museum.setHovered(null);
    canvas.style.cursor = "";
  }

  /**
   * Keyboard shortcuts: Esc returns from inspect mode, R resets the visit.
   * `event.repeat` is ignored so holding a key fires the action only once.
   *
   * @param {KeyboardEvent} event
   */
  function onKeyDown(event) {
    if (event.repeat) return;
    if (event.code === "Escape") museum.back();
    if (event.code === "KeyR") museum.reset();
  }

  // pointermove is watched on window (capture phase) so a drag is still
  // measured even when OrbitControls captures the pointer during it.
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("keydown", onKeyDown);

  /** Removes every listener added above. */
  function dispose() {
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("click", onClick);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    window.removeEventListener("keydown", onKeyDown);
  }

  return { dispose };
}

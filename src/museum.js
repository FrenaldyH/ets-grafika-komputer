// museum.js — the experience's state and camera choreography.
//
// The visit is a small state machine:
//
//   intro ──enter()──► explore ──inspect()──► inspect
//                         ▲                      │
//                         └──────── back() ──────┘
//   explore ──(all artifacts inspected, after back())──► complete
//   any state ──reset()──► intro
//
// This module owns that state, moves the camera between views, and tells the
// rest of the app (UI, effects) when something changed through `hooks`.

import * as THREE from "three";
import { restorePrimaryRoughness, setHighlight, setPrimaryRoughness, readPrimaryMaterial } from "./exhibits.js";

/** Camera views: where the camera sits (position) and what it looks at (target). */
const VIEWS = {
  intro: { position: new THREE.Vector3(0, 9, 16), target: new THREE.Vector3(0, 1, -3) },
  overview: { position: new THREE.Vector3(0, 6, 10), target: new THREE.Vector3(0, 1, -2.5) },
};

/** How long a camera flight takes, in seconds. */
const FLIGHT_SECONDS = 1.2;

/** In inspect mode the camera stays this far from the artifact. */
const INSPECT_DISTANCE = 2.6;

/** OrbitControls limits per mode: wide while exploring, close while inspecting. */
const ORBIT_LIMITS = {
  explore: { minDistance: 4, maxDistance: 16, minPolarAngle: 0.35, maxPolarAngle: 1.35 },
  inspect: { minDistance: 1.4, maxDistance: 4, minPolarAngle: 0.2, maxPolarAngle: 1.6 },
};

/**
 * Smooth start and smooth stop for camera flights (ease-in-out cubic).
 * Moving at a constant speed would start and stop with a visible jerk.
 *
 * @param {number} t Progress 0–1.
 * @returns {number} Eased progress 0–1.
 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Creates the museum state machine.
 *
 * @param {object} options
 * @param {THREE.PerspectiveCamera} options.camera
 * @param {import("three/addons/controls/OrbitControls.js").OrbitControls} options.controls
 * @param {object[]} options.exhibits From buildExhibits().
 * @param {object} options.hooks Callbacks so other modules can react:
 * @param {(snapshot: object) => void} options.hooks.onChange       Any visible state changed.
 * @param {(exhibit: object) => void}   options.hooks.onFirstVisit   An artifact was inspected for the first time.
 * @param {() => void}                  options.hooks.onComplete     Every artifact has been inspected.
 * @param {() => void}                  options.hooks.onReset        The visit was reset.
 * @returns {object} The public API (see the `return` at the bottom).
 */
export function createMuseum({ camera, controls, exhibits, hooks }) {
  const state = {
    mode: "intro", // "intro" | "explore" | "inspect" | "complete"
    hovered: null, // exhibit under the pointer (explore mode only)
    current: null, // exhibit being inspected
    visited: new Set(), // indexes of exhibits already inspected
  };

  /** The camera flight in progress, or null when the camera is free. */
  let flight = null;

  // ------------------------------------------------------------------
  // CAMERA
  // ------------------------------------------------------------------

  /**
   * Places the camera instantly (no animation) — used at start-up and reset.
   * controls.update() is deliberately NOT called: it would clamp the camera to
   * maxDistance, and the intro view sits farther away than that limit.
   *
   * @param {{ position: THREE.Vector3, target: THREE.Vector3 }} view
   */
  function jumpTo(view) {
    camera.position.copy(view.position);
    controls.target.copy(view.target);
    camera.lookAt(view.target);
  }

  /**
   * Starts an animated camera flight. The flight itself advances in update().
   * OrbitControls is switched off during the flight so a stray drag cannot
   * fight the animation; it is switched back on when the camera arrives.
   *
   * @param {THREE.Vector3} position Where the camera should end up.
   * @param {THREE.Vector3} target   What it should be looking at when it arrives.
   */
  function flyTo(position, target) {
    flight = {
      fromPosition: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPosition: position.clone(),
      toTarget: target.clone(),
      elapsed: 0,
    };
    controls.enabled = false;
  }

  /**
   * Applies one of the ORBIT_LIMITS presets to OrbitControls.
   *
   * @param {"explore" | "inspect"} preset
   */
  function applyOrbitLimits(preset) {
    Object.assign(controls, ORBIT_LIMITS[preset]);
  }

  /**
   * Works out the inspect view for an exhibit: the camera is placed in front
   * of the artifact (on the side the plaque faces), slightly above it.
   *
   * @param {object} exhibit
   * @returns {{ position: THREE.Vector3, target: THREE.Vector3 }}
   */
  function inspectViewFor(exhibit) {
    // The centre of the artifact's bounding box, in world coordinates.
    const target = new THREE.Box3().setFromObject(exhibit.artifact).getCenter(new THREE.Vector3());

    // The exhibit group's +Z axis points at the visitor (see buildExhibits).
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(exhibit.group.quaternion);
    const position = target.clone().addScaledVector(forward, INSPECT_DISTANCE).add(new THREE.Vector3(0, 0.6, 0));

    return { position, target };
  }

  // ------------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------------

  /**
   * A plain-data picture of the current state, for the UI.
   *
   * @returns {{ mode: string, hovered: object|null, current: object|null,
   *             visited: Set<number>, total: number,
   *             material: { roughness: number, metalness: number } | null }}
   */
  function getSnapshot() {
    return {
      mode: state.mode,
      hovered: state.hovered,
      current: state.current,
      visited: state.visited,
      total: exhibits.length,
      material: state.current ? readPrimaryMaterial(state.current) : null,
    };
  }

  /** Tells listeners (the UI) that something visible changed. */
  function emit() {
    hooks.onChange(getSnapshot());
  }

  /**
   * True when the visitor may hover and click artifacts: only while exploring
   * and never mid-flight.
   *
   * @returns {boolean}
   */
  function canSelect() {
    return state.mode === "explore" && flight === null;
  }

  // ------------------------------------------------------------------
  // ACTIONS
  // ------------------------------------------------------------------

  /** Leaves the intro screen and flies down into the hall. */
  function enter() {
    if (state.mode !== "intro") return;
    state.mode = "explore";
    applyOrbitLimits("explore");
    flyTo(VIEWS.overview.position, VIEWS.overview.target);
    emit();
  }

  /**
   * Changes which exhibit is under the pointer and updates its highlight.
   *
   * @param {object|null} exhibit
   */
  function setHovered(exhibit) {
    if (exhibit === state.hovered) return;
    if (state.hovered) setHighlight(state.hovered, false);
    state.hovered = exhibit;
    if (exhibit) setHighlight(exhibit, true);
    emit();
  }

  /**
   * Opens an exhibit: flies the camera to it, starts the turntable rotation,
   * and marks it as visited. The first visit also fires onFirstVisit (sparkle).
   *
   * @param {object} exhibit
   */
  function inspect(exhibit) {
    if (!canSelect()) return;

    setHovered(null);
    state.mode = "inspect";
    state.current = exhibit;

    if (!state.visited.has(exhibit.index)) {
      state.visited.add(exhibit.index);
      hooks.onFirstVisit(exhibit);
    }

    const view = inspectViewFor(exhibit);
    applyOrbitLimits("inspect");
    flyTo(view.position, view.target);
    // A slow automatic orbit around the artifact — a "turntable" animation.
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.5;
    emit();
  }

  /**
   * Closes the current exhibit and returns to the overview. If that was the
   * last unvisited artifact, the visit is complete.
   *
   * Allowed even while the camera is still flying in: flyTo() always starts
   * from wherever the camera is right now, so the flight simply turns around.
   * Ignoring Esc during the 1.2 s fly-in would feel like a broken key.
   */
  function back() {
    if (state.mode !== "inspect") return;

    restorePrimaryRoughness(state.current);
    state.current = null;
    controls.autoRotate = false;
    applyOrbitLimits("explore");
    flyTo(VIEWS.overview.position, VIEWS.overview.target);

    if (state.visited.size === exhibits.length) {
      state.mode = "complete";
      hooks.onComplete();
    } else {
      state.mode = "explore";
    }
    emit();
  }

  /**
   * Changes the inspected artifact's roughness (from the info-panel slider).
   *
   * @param {number} value 0–1.
   */
  function setRoughness(value) {
    if (state.mode !== "inspect") return;
    setPrimaryRoughness(state.current, value);
    emit();
  }

  /** Returns everything to the very first screen, as if the page had reloaded. */
  function reset() {
    if (state.hovered) setHighlight(state.hovered, false);
    for (const exhibit of exhibits) restorePrimaryRoughness(exhibit);

    state.mode = "intro";
    state.hovered = null;
    state.current = null;
    state.visited.clear();

    flight = null;
    controls.enabled = false; // the intro screen is not interactive
    controls.autoRotate = false;
    applyOrbitLimits("explore");
    jumpTo(VIEWS.intro);

    hooks.onReset();
    emit();
  }

  // ------------------------------------------------------------------
  // PER-FRAME
  // ------------------------------------------------------------------

  /**
   * Advances the camera flight (if any) and OrbitControls. Called once per frame.
   *
   * @param {number} dt Seconds since the previous frame.
   */
  function update(dt) {
    if (flight) {
      flight.elapsed += dt;
      const t = easeInOutCubic(Math.min(flight.elapsed / FLIGHT_SECONDS, 1));

      camera.position.lerpVectors(flight.fromPosition, flight.toPosition, t);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, t);
      camera.lookAt(controls.target);

      if (t >= 1) {
        flight = null;
        controls.enabled = state.mode !== "intro";
      }
    }

    // Needed every frame for damping and autoRotate to work. Skipped on the
    // intro screen, where it would pull the distant intro camera inside maxDistance.
    if (!flight && state.mode !== "intro") controls.update(dt);
  }

  // Start on the intro view with the controls locked.
  controls.enabled = false;
  applyOrbitLimits("explore");
  jumpTo(VIEWS.intro);

  return { enter, setHovered, inspect, back, setRoughness, reset, update, canSelect, getSnapshot };
}

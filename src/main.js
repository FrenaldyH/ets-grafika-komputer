// main.js — entry point. Builds every module, connects them, and runs the
// animation loop. Each module does one job:
//
//   scene.js        the room: renderer, camera, lights, environment, shadows
//   exhibits.js     the collection: loads the GLB, builds pedestals + artifacts
//   museum.js       the state machine and camera flights
//   interaction.js  mouse (raycasting) and keyboard input
//   effects.js      particles, halos and bursts (VFX)
//   ui.js           the HTML HUD, panels and overlays
//
// three is pinned to r182 in package.json: from r183, THREE.Clock prints a
// deprecation warning in the console.

import "./style.css";
import * as THREE from "three";
import { createStage } from "./scene.js";
import { ARTIFACTS, buildExhibits, loadArtifactModels } from "./exhibits.js";
import { createMuseum } from "./museum.js";
import { createInteraction } from "./interaction.js";
import { createEffects } from "./effects.js";
import { createUI } from "./ui.js";

/** BASE_URL keeps the path correct both in `npm run dev` and in a built site. */
const MODEL_URL = `${import.meta.env.BASE_URL}models/artifacts.glb`;

/**
 * Longest frame step allowed, in seconds. After the tab has been in the
 * background, the first delta can be several seconds; clamping it stops
 * particles and camera flights from jumping.
 */
const MAX_DELTA_SECONDS = 0.05;

/**
 * Starts the application.
 *
 * Order matters:
 *   1. the stage and UI first, so the loading screen can show progress;
 *   2. load the GLB (async);
 *   3. build exhibits, effects, museum and input, which all need the models;
 *   4. start the animation loop.
 */
async function start() {
  const canvas = document.querySelector("#scene");
  const stage = createStage(canvas);

  /**
   * Keeps renderer size, camera aspect and projection matrix in step with
   * the browser window.
   */
  function onResize() {
    stage.resize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", onResize);
  onResize();

  // `museum` does not exist until the models load; the buttons are hidden
  // until then anyway, and `?.` makes an early click harmless.
  let museum = null;
  const ui = createUI({
    titles: ARTIFACTS.map((artifact) => artifact.title),
    onEnter: () => museum?.enter(),
    onBack: () => museum?.back(),
    onReset: () => museum?.reset(),
    onRoughness: (value) => museum?.setRoughness(value),
  });

  let models;
  try {
    models = await loadArtifactModels(MODEL_URL, ui.setLoading);
  } catch (error) {
    console.error("[Hall of Relics] gagal memuat artifacts.glb", error);
    ui.showError("Gagal memuat koleksi. Jalankan `npm run build:models`, lalu muat ulang halaman.");
    return;
  }

  const { exhibits, mixers } = buildExhibits(stage.scene, models);
  const effects = createEffects(stage.scene, exhibits);

  museum = createMuseum({
    camera: stage.camera,
    controls: stage.controls,
    exhibits,
    hooks: {
      onChange: ui.render,
      onFirstVisit: effects.sparkle,
      onComplete: effects.celebrate,
      onReset: effects.clearBursts,
    },
  });

  createInteraction({ canvas, camera: stage.camera, exhibits, museum });

  ui.hideLoading();
  ui.render(museum.getSnapshot());

  const clock = new THREE.Clock();
  let elapsed = 0;

  /**
   * One frame: measure time, update every moving part, then draw.
   * Every speed in the project is multiplied by `dt` (seconds), so motion has
   * the same pace on a 60 Hz and a 144 Hz screen.
   */
  function frame() {
    const dt = Math.min(clock.getDelta(), MAX_DELTA_SECONDS);
    elapsed += dt;

    for (const mixer of mixers) mixer.update(dt); // GLB animation clip
    museum.update(dt); // camera flight + OrbitControls
    effects.update(dt, elapsed, museum.getSnapshot());

    stage.renderer.render(stage.scene, stage.camera);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

start();

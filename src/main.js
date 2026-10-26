// main.js — entry point. Membuat semua modul, menyambungkannya, dan menjalankan
// animation loop. Setiap modul punya satu tugas:
//
//   scene.js        ruangan: renderer, kamera, cahaya, environment, shadow
//   exhibits.js     koleksi: memuat GLB, membangun pedestal + artefak
//   museum.js       state machine dan penerbangan kamera
//   interaction.js  input mouse (raycasting) dan keyboard
//   effects.js      partikel, halo, dan ledakan (VFX)
//   ui.js           HUD, panel, dan overlay HTML
//
// three dipin ke r182 di package.json: mulai r183, THREE.Clock mencetak
// peringatan deprecation di console.

import "./style.css";
import * as THREE from "three";
import { createStage } from "./scene.js";
import { ARTIFACTS, buildExhibits, loadArtifactModels } from "./exhibits.js";
import { createMuseum } from "./museum.js";
import { createInteraction } from "./interaction.js";
import { createEffects } from "./effects.js";
import { createUI } from "./ui.js";

/** BASE_URL menjaga path tetap benar, baik di `npm run dev` maupun di situs hasil build. */
const MODEL_URL = `${import.meta.env.BASE_URL}models/artifacts.glb`;

/**
 * Langkah frame terpanjang yang diizinkan, dalam detik. Setelah tab berada di
 * background, delta pertama bisa berupa beberapa detik; pembatasan ini
 * mencegah partikel dan penerbangan kamera melompat.
 */
const MAX_DELTA_SECONDS = 0.05;

/**
 * Menjalankan aplikasi.
 *
 * Urutan penting:
 *   1. stage dan UI lebih dulu, supaya layar loading bisa menampilkan progres;
 *   2. muat GLB (async);
 *   3. bangun exhibit, effects, museum, dan input, yang semuanya butuh model;
 *   4. mulai animation loop.
 */
async function start() {
  const canvas = document.querySelector("#scene");
  const stage = createStage(canvas);

  /**
   * Menyamakan ukuran renderer, aspect kamera, dan projection matrix dengan
   * ukuran jendela browser.
   */
  function onResize() {
    stage.resize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", onResize);
  onResize();

  // `museum` belum ada sampai model selesai dimuat; tombol-tombolnya
  // disembunyikan selama itu, dan `?.` membuat klik yang terlalu dini tidak berbahaya.
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
   * Satu frame: ukur waktu, perbarui setiap bagian yang bergerak, lalu gambar.
   * Setiap kecepatan di proyek ini dikali `dt` (detik), sehingga geraknya
   * sama cepat di layar 60 Hz maupun 144 Hz.
   */
  function frame() {
    const dt = Math.min(clock.getDelta(), MAX_DELTA_SECONDS);
    elapsed += dt;

    for (const mixer of mixers) mixer.update(dt); // clip animasi GLB
    museum.update(dt); // penerbangan kamera + OrbitControls
    effects.update(dt, elapsed, museum.getSnapshot());

    stage.renderer.render(stage.scene, stage.camera);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

start();

// museum.js — state pengalaman dan koreografi kamera.
//
// Kunjungan adalah state machine kecil:
//
//   intro ──enter()──► explore ──inspect()──► inspect
//                         ▲                      │
//                         └──────── back() ──────┘
//   explore ──(semua artefak diperiksa, setelah back())──► complete
//   state apa pun ──reset()──► intro
//
// Modul ini memegang state tersebut, memindahkan kamera antar tampilan, dan
// memberi tahu bagian lain aplikasi (UI, effects) saat ada perubahan lewat `hooks`.

import * as THREE from "three";
import { restorePrimaryRoughness, setHighlight, setPrimaryRoughness, readPrimaryMaterial } from "./exhibits.js";

/** Tampilan kamera: posisi kamera (position) dan apa yang dilihatnya (target). */
const VIEWS = {
  intro: { position: new THREE.Vector3(0, 9, 16), target: new THREE.Vector3(0, 1, -3) },
  overview: { position: new THREE.Vector3(0, 6, 10), target: new THREE.Vector3(0, 1, -2.5) },
};

/** Lama satu penerbangan kamera, dalam detik. */
const FLIGHT_SECONDS = 1.2;

/** Di mode inspect, kamera tetap sejauh ini dari artefak. */
const INSPECT_DISTANCE = 2.6;

/** Batas OrbitControls per mode: lebar saat menjelajah, dekat saat memeriksa. */
const ORBIT_LIMITS = {
  explore: { minDistance: 4, maxDistance: 16, minPolarAngle: 0.35, maxPolarAngle: 1.35 },
  inspect: { minDistance: 1.4, maxDistance: 4, minPolarAngle: 0.2, maxPolarAngle: 1.6 },
};

/**
 * Awal yang mulus dan akhir yang mulus untuk penerbangan kamera (ease-in-out cubic).
 * Bergerak dengan kecepatan konstan akan memulai dan berhenti dengan sentakan yang terlihat.
 *
 * @param {number} t Progres 0–1.
 * @returns {number} Progres yang sudah di-ease, 0–1.
 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Membuat state machine museum.
 *
 * @param {object} options
 * @param {THREE.PerspectiveCamera} options.camera
 * @param {import("three/addons/controls/OrbitControls.js").OrbitControls} options.controls
 * @param {object[]} options.exhibits Dari buildExhibits().
 * @param {object} options.hooks Callback supaya modul lain bisa bereaksi:
 * @param {(snapshot: object) => void} options.hooks.onChange       Ada state yang terlihat berubah.
 * @param {(exhibit: object) => void}   options.hooks.onFirstVisit   Sebuah artefak diperiksa untuk pertama kali.
 * @param {() => void}                  options.hooks.onComplete     Semua artefak sudah diperiksa.
 * @param {() => void}                  options.hooks.onReset        Kunjungan diatur ulang.
 * @returns {object} API publiknya (lihat `return` di bagian bawah).
 */
export function createMuseum({ camera, controls, exhibits, hooks }) {
  const state = {
    mode: "intro", // "intro" | "explore" | "inspect" | "complete"
    hovered: null, // exhibit di bawah pointer (hanya di mode explore)
    current: null, // exhibit yang sedang diperiksa
    visited: new Set(), // indeks exhibit yang sudah diperiksa
  };

  /** Penerbangan kamera yang sedang berlangsung, atau null bila kamera bebas. */
  let flight = null;

  // ------------------------------------------------------------------
  // KAMERA
  // ------------------------------------------------------------------

  /**
   * Menempatkan kamera seketika (tanpa animasi) — dipakai saat start dan reset.
   * controls.update() sengaja TIDAK dipanggil: ia akan menjepit kamera ke
   * maxDistance, padahal tampilan intro berada lebih jauh dari batas itu.
   *
   * @param {{ position: THREE.Vector3, target: THREE.Vector3 }} view
   */
  function jumpTo(view) {
    camera.position.copy(view.position);
    controls.target.copy(view.target);
    camera.lookAt(view.target);
  }

  /**
   * Memulai penerbangan kamera beranimasi. Penerbangannya sendiri berjalan di update().
   * OrbitControls dimatikan selama penerbangan supaya drag yang tidak sengaja
   * tidak berebut dengan animasi; dinyalakan lagi saat kamera tiba.
   *
   * @param {THREE.Vector3} position Tempat kamera berakhir.
   * @param {THREE.Vector3} target   Yang harus dilihat kamera saat tiba.
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
   * Menerapkan salah satu preset ORBIT_LIMITS ke OrbitControls.
   *
   * @param {"explore" | "inspect"} preset
   */
  function applyOrbitLimits(preset) {
    Object.assign(controls, ORBIT_LIMITS[preset]);
  }

  /**
   * Menghitung tampilan inspect untuk sebuah exhibit: kamera ditaruh di depan
   * artefak (di sisi yang dihadapi plakat), sedikit di atasnya.
   *
   * @param {object} exhibit
   * @returns {{ position: THREE.Vector3, target: THREE.Vector3 }}
   */
  function inspectViewFor(exhibit) {
    // Titik tengah bounding box artefak, dalam koordinat dunia.
    const target = new THREE.Box3().setFromObject(exhibit.artifact).getCenter(new THREE.Vector3());

    // Sumbu +Z group exhibit menghadap pengunjung (lihat buildExhibits).
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(exhibit.group.quaternion);
    const position = target.clone().addScaledVector(forward, INSPECT_DISTANCE).add(new THREE.Vector3(0, 0.6, 0));

    return { position, target };
  }

  // ------------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------------

  /**
   * Potret data biasa dari state saat ini, untuk UI.
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

  /** Memberi tahu listener (UI) bahwa ada yang berubah dan terlihat. */
  function emit() {
    hooks.onChange(getSnapshot());
  }

  /**
   * True bila pengunjung boleh meng-hover dan mengklik artefak: hanya saat
   * menjelajah dan tidak pernah di tengah penerbangan.
   *
   * @returns {boolean}
   */
  function canSelect() {
    return state.mode === "explore" && flight === null;
  }

  // ------------------------------------------------------------------
  // AKSI
  // ------------------------------------------------------------------

  /** Meninggalkan layar intro dan terbang turun ke dalam aula. */
  function enter() {
    if (state.mode !== "intro") return;
    state.mode = "explore";
    applyOrbitLimits("explore");
    flyTo(VIEWS.overview.position, VIEWS.overview.target);
    emit();
  }

  /**
   * Mengganti exhibit yang berada di bawah pointer dan memperbarui sorotannya.
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
   * Membuka sebuah exhibit: menerbangkan kamera ke sana, memulai rotasi
   * turntable, dan menandainya sudah dikunjungi. Kunjungan pertama juga
   * memicu onFirstVisit (sparkle).
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
    // Orbit otomatis yang lambat mengelilingi artefak — animasi "turntable".
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.5;
    emit();
  }

  /**
   * Menutup exhibit saat ini dan kembali ke overview. Bila itu artefak terakhir
   * yang belum dikunjungi, kunjungan selesai.
   *
   * Diizinkan bahkan saat kamera masih terbang masuk: flyTo() selalu mulai dari
   * posisi kamera saat ini, jadi penerbangan hanya berbalik arah.
   * Mengabaikan Esc selama fly-in 1,2 detik akan terasa seperti tombol rusak.
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
   * Mengubah roughness artefak yang sedang diperiksa (dari slider di panel info).
   *
   * @param {number} value 0–1.
   */
  function setRoughness(value) {
    if (state.mode !== "inspect") return;
    setPrimaryRoughness(state.current, value);
    emit();
  }

  /** Mengembalikan semuanya ke layar paling awal, seolah halaman dimuat ulang. */
  function reset() {
    if (state.hovered) setHighlight(state.hovered, false);
    for (const exhibit of exhibits) restorePrimaryRoughness(exhibit);

    state.mode = "intro";
    state.hovered = null;
    state.current = null;
    state.visited.clear();

    flight = null;
    controls.enabled = false; // layar intro tidak interaktif
    controls.autoRotate = false;
    applyOrbitLimits("explore");
    jumpTo(VIEWS.intro);

    hooks.onReset();
    emit();
  }

  // ------------------------------------------------------------------
  // PER FRAME
  // ------------------------------------------------------------------

  /**
   * Memajukan penerbangan kamera (jika ada) dan OrbitControls. Dipanggil sekali per frame.
   *
   * @param {number} dt Detik sejak frame sebelumnya.
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

    // Dibutuhkan setiap frame agar damping dan autoRotate bekerja. Dilewati di
    // layar intro, karena di sana ia akan menarik kamera intro yang jauh masuk ke dalam maxDistance.
    if (!flight && state.mode !== "intro") controls.update(dt);
  }

  // Mulai di tampilan intro dengan controls terkunci.
  controls.enabled = false;
  applyOrbitLimits("explore");
  jumpTo(VIEWS.intro);

  return { enter, setHovered, inspect, back, setRoughness, reset, update, canSelect, getSnapshot };
}

// interaction.js — input mouse dan keyboard.
//
// Hover dan klik sama-sama memakai THREE.Raycaster: sebuah sinar ditembakkan
// dari kamera melewati posisi mouse, dan artefak pertama yang terkena sinar
// adalah yang berada di bawah kursor. Klik dibedakan dari drag kamera, karena
// melepas mouse setelah memutar kamera juga memicu event "click".

import * as THREE from "three";

/** Tekanan yang bergeser lebih dari sekian piksel dianggap drag, bukan klik. */
const DRAG_THRESHOLD_PX = 5;

/**
 * Menyambungkan input pointer dan keyboard ke museum.
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {THREE.Camera} options.camera
 * @param {object[]} options.exhibits Dari buildExhibits().
 * @param {object} options.museum Dari createMuseum().
 * @returns {{ dispose: () => void }} Panggil dispose() untuk melepas semua listener.
 */
export function createInteraction({ canvas, camera, exhibits, museum }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(); // posisi mouse dalam NDC (-1..1)
  // Sinar diuji ke kotak hit area tak terlihat milik tiap exhibit, bukan ke
  // mesh artefaknya — alasannya ada di createHitArea() di exhibits.js.
  const targets = exhibits.map((exhibit) => exhibit.hitArea);

  /** Tempat tekanan saat ini dimulai, atau null bila tidak ada tombol yang ditekan. */
  let press = null;

  /**
   * Apakah tekanan yang baru saja berakhir adalah drag. Disimpan terpisah
   * karena browser mengirim "pointerup" (yang mengosongkan `press`) SEBELUM "click".
   */
  let lastPressWasDrag = false;

  /**
   * Mengubah posisi piksel event mouse menjadi NDC (Normalized Device
   * Coordinates): x dan y dari -1 sampai 1 dengan +y mengarah KE ATAS — ruang
   * koordinat yang diharapkan raycaster. Diukur terhadap canvas, bukan seluruh jendela.
   *
   * @param {PointerEvent | MouseEvent} event
   */
  function updatePointer(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /**
   * Mencari exhibit yang berada di bawah pointer.
   *
   * setFromCamera() membuat sinar yang berawal dari kamera dan melewati posisi
   * NDC pointer. intersectObjects() mengembalikan semua yang terkena, dimulai
   * dari yang terdekat, jadi hasil pertama adalah exhibit paling depan. Setiap
   * hit box menyimpan indeks exhibit-nya di userData, yang memetakan hasil
   * tabrakan kembali ke exhibit-nya.
   *
   * @returns {object|null} Exhibit-nya, atau null bila sinar tidak mengenai artefak.
   */
  function pickExhibit() {
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObjects(targets, false);
    return hit ? exhibits[hit.object.userData.exhibitIndex] : null;
  }

  /**
   * Hover: memeriksa ulang apa yang ada di bawah pointer saat pointer bergerak.
   * Dilewati selama tombol ditahan, supaya hover tidak berkedip saat drag.
   *
   * @param {PointerEvent} event
   */
  function onPointerMove(event) {
    if (press) {
      // Begitu pointer bergeser cukup jauh, tekanan ini adalah drag.
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_THRESHOLD_PX) press.dragged = true;
      return;
    }

    // Di atas panel UI, bukan canvas: tidak ada objek scene yang di-hover.
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
   * Mengingat tempat tekanan dimulai, untuk mengukur nanti apakah ia menjadi drag.
   *
   * @param {PointerEvent} event
   */
  function onPointerDown(event) {
    press = { x: event.clientX, y: event.clientY, dragged: false };
  }

  /**
   * Klik: memilih artefak di bawah pointer — kecuali tekanannya adalah drag
   * kamera, atau bukan tombol kiri mouse.
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
   * Mengakhiri tekanan di mana pun tombol dilepas — bahkan di luar canvas,
   * yang bila tidak ditangani akan membiarkan `press` tetap terisi dan
   * membekukan deteksi hover.
   */
  function onPointerUp() {
    lastPressWasDrag = press?.dragged ?? false;
    press = null;
  }

  /** Menghapus sorotan hover saat pointer meninggalkan canvas. */
  function onPointerLeave() {
    if (!press) museum.setHovered(null);
    canvas.style.cursor = "";
  }

  /**
   * Pintasan keyboard: Esc kembali dari mode inspect, R mengatur ulang kunjungan.
   * `event.repeat` diabaikan supaya menahan tombol hanya memicu aksi sekali.
   *
   * @param {KeyboardEvent} event
   */
  function onKeyDown(event) {
    if (event.repeat) return;
    if (event.code === "Escape") museum.back();
    if (event.code === "KeyR") museum.reset();
  }

  // pointermove dipantau di window (fase capture) supaya drag tetap terukur
  // bahkan saat OrbitControls menangkap pointer selama drag.
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("keydown", onKeyDown);

  /** Melepas semua listener yang ditambahkan di atas. */
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

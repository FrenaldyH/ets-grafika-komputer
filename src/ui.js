// ui.js — antarmuka HTML yang digambar di atas canvas (HUD, panel, overlay).
//
// UI tidak pernah mengubah scene 3D itu sendiri. Tombol memanggil callback yang
// dikirim dari main.js, dan render() menggambar ulang antarmuka dari snapshot
// museum. Teks selalu ditulis dengan textContent (tidak pernah innerHTML),
// sehingga string apa pun tidak akan pernah ditafsirkan sebagai HTML.

/**
 * Mencari elemen berdasarkan id dan gagal dengan jelas bila index.html tidak
 * memilikinya, sehingga salah ketik langsung terlihat alih-alih muncul sebagai
 * "cannot read null" yang senyap.
 *
 * @param {string} id
 * @returns {HTMLElement}
 */
function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html is missing #${id}`);
  return element;
}

/**
 * Menampilkan atau menyembunyikan elemen lewat class CSS "hidden".
 *
 * @param {HTMLElement} element
 * @param {boolean} visible
 */
function setVisible(element, visible) {
  element.classList.toggle("hidden", !visible);
}

/** Baris petunjuk yang ditampilkan di HUD untuk tiap mode. */
const HINTS = {
  explore: "Arahkan kursor ke artefak, lalu klik untuk memeriksanya.",
  inspect: "Drag untuk memutar pandangan. Esc atau tombol Kembali untuk keluar.",
  complete: "Pameran selesai. Tekan R atau Jelajahi Lagi untuk mengulang.",
};

/**
 * Membangun antarmuka dan menyambungkan tombol-tombolnya.
 *
 * UI dibuat SEBELUM model 3D selesai dimuat (ia menampilkan persen loading),
 * jadi checklist dibangun dari judul biasa, bukan dari exhibit.
 *
 * @param {object} options
 * @param {string[]} options.titles      Judul artefak, sesuai urutan exhibit — untuk checklist.
 * @param {() => void} options.onEnter   "Masuk Museum" ditekan.
 * @param {() => void} options.onBack    "Kembali" ditekan.
 * @param {() => void} options.onReset   "Reset" / "Jelajahi Lagi" ditekan.
 * @param {(value: number) => void} options.onRoughness Slider digeser (0–1).
 * @returns {{ setLoading: (percent: number) => void, showError: (message: string) => void,
 *             hideLoading: () => void, render: (snapshot: object) => void }}
 */
export function createUI({ titles, onEnter, onBack, onReset, onRoughness }) {
  const elements = {
    loading: byId("loading"),
    loadingPercent: byId("loading-percent"),
    intro: byId("intro"),
    hud: byId("hud"),
    progress: byId("progress"),
    checklist: byId("checklist"),
    hint: byId("hint"),
    hoverLabel: byId("hover-label"),
    infoPanel: byId("info-panel"),
    infoTitle: byId("info-title"),
    infoPeriod: byId("info-period"),
    infoDescription: byId("info-description"),
    infoMaterial: byId("info-material"),
    infoRoughness: byId("info-roughness"),
    infoMetalness: byId("info-metalness"),
    slider: byId("roughness-slider"),
    complete: byId("complete"),
  };

  // Satu baris checklist per artefak; render() mencentangnya.
  const checklistItems = titles.map((title) => {
    const item = document.createElement("li");
    item.textContent = title;
    elements.checklist.append(item);
    return item;
  });

  byId("enter-button").addEventListener("click", onEnter);
  byId("back-button").addEventListener("click", onBack);
  byId("reset-button").addEventListener("click", onReset);
  byId("restart-button").addEventListener("click", onReset);
  // "input" terpicu terus-menerus saat slider digeser, jadi material berubah secara langsung.
  elements.slider.addEventListener("input", () => onRoughness(Number(elements.slider.value)));

  /**
   * Memperbarui persentase di layar loading.
   *
   * @param {number} percent 0–100.
   */
  function setLoading(percent) {
    elements.loadingPercent.textContent = `${percent}%`;
  }

  /**
   * Mengganti teks loading dengan pesan error (misalnya GLB tidak ada).
   *
   * @param {string} message
   */
  function showError(message) {
    elements.loading.querySelector("p").textContent = message;
  }

  /** Menyembunyikan layar loading setelah koleksi siap. */
  function hideLoading() {
    setVisible(elements.loading, false);
  }

  /**
   * Menggambar ulang seluruh antarmuka dari state museum saat ini.
   *
   * @param {object} snapshot Dari museum.getSnapshot().
   */
  function render(snapshot) {
    const { mode, hovered, current, visited, total, material } = snapshot;

    setVisible(elements.intro, mode === "intro");
    setVisible(elements.hud, mode !== "intro");
    setVisible(elements.complete, mode === "complete");
    setVisible(elements.infoPanel, mode === "inspect");

    elements.progress.textContent = `${visited.size} / ${total} artefak diperiksa`;
    elements.hint.textContent = HINTS[mode] ?? "";
    checklistItems.forEach((item, index) => item.classList.toggle("done", visited.has(index)));

    setVisible(elements.hoverLabel, mode === "explore" && hovered !== null);
    if (hovered) elements.hoverLabel.textContent = hovered.data.title;

    if (current && material) {
      elements.infoTitle.textContent = current.data.title;
      elements.infoPeriod.textContent = current.data.period;
      elements.infoDescription.textContent = current.data.description;
      elements.infoMaterial.textContent = current.data.materialLabel;
      elements.infoRoughness.textContent = material.roughness.toFixed(2);
      elements.infoMetalness.textContent = material.metalness.toFixed(2);
      elements.slider.value = String(material.roughness);
    }
  }

  return { setLoading, showError, hideLoading, render };
}

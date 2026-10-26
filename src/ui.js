// ui.js — the HTML interface drawn over the canvas (HUD, panels, overlays).
//
// The UI never changes the 3D scene itself. Buttons call the callbacks passed
// in from main.js, and render() redraws the interface from a museum snapshot.
// Text is always written with textContent (never innerHTML), so no string can
// ever be interpreted as HTML.

/**
 * Finds an element by id and fails loudly if index.html does not have it,
 * so a typo shows up immediately instead of as a silent "cannot read null".
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
 * Shows or hides an element through the "hidden" CSS class.
 *
 * @param {HTMLElement} element
 * @param {boolean} visible
 */
function setVisible(element, visible) {
  element.classList.toggle("hidden", !visible);
}

/** Instruction line shown in the HUD for each mode. */
const HINTS = {
  explore: "Arahkan kursor ke artefak, lalu klik untuk memeriksanya.",
  inspect: "Drag untuk memutar pandangan. Esc atau tombol Kembali untuk keluar.",
  complete: "Pameran selesai. Tekan R atau Jelajahi Lagi untuk mengulang.",
};

/**
 * Builds the interface and wires its buttons.
 *
 * The UI is created BEFORE the 3D models finish loading (it shows the loading
 * percentage), so the checklist is built from plain titles, not from exhibits.
 *
 * @param {object} options
 * @param {string[]} options.titles      Artifact titles, in exhibit order — for the checklist.
 * @param {() => void} options.onEnter   "Masuk Museum" pressed.
 * @param {() => void} options.onBack    "Kembali" pressed.
 * @param {() => void} options.onReset   "Reset" / "Jelajahi Lagi" pressed.
 * @param {(value: number) => void} options.onRoughness Slider moved (0–1).
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

  // One checklist row per artifact; render() ticks them off.
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
  // "input" fires continuously while dragging, so the material updates live.
  elements.slider.addEventListener("input", () => onRoughness(Number(elements.slider.value)));

  /**
   * Updates the loading screen's percentage.
   *
   * @param {number} percent 0–100.
   */
  function setLoading(percent) {
    elements.loadingPercent.textContent = `${percent}%`;
  }

  /**
   * Replaces the loading text with an error message (e.g. the GLB is missing).
   *
   * @param {string} message
   */
  function showError(message) {
    elements.loading.querySelector("p").textContent = message;
  }

  /** Hides the loading screen once the collection is ready. */
  function hideLoading() {
    setVisible(elements.loading, false);
  }

  /**
   * Redraws the whole interface from the museum's current state.
   *
   * @param {object} snapshot From museum.getSnapshot().
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

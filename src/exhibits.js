// exhibits.js — the museum's collection.
//
// Holds the text shown for each artifact, loads the GLB made by
// scripts/build-artifacts.mjs, and turns every artifact into an "exhibit":
// a THREE.Group containing a pedestal, the artifact, a spotlight and a brass
// plaque. Moving the group moves all four together — that is the scene graph
// (parent → children) at work.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * The collection. `node` must match a root node name inside artifacts.glb.
 * `primaryMaterial` names the material the roughness slider edits.
 * Periods and stories are fictional: the pieces are stylised replicas built
 * from code, not models of real historical objects.
 */
export const ARTIFACTS = [
  {
    node: "Amphora",
    title: "Amphora Terakota",
    period: "Era Pelabuhan Kuno (fiksi)",
    materialLabel: "Keramik terakota",
    primaryMaterial: "Ceramic",
    scale: 1.15,
    description:
      "Guci dua pegangan untuk menyimpan minyak dan anggur. Permukaan keramiknya kasar dan tidak memantulkan lingkungan, sehingga terlihat 'matte'.",
  },
  {
    node: "Crown",
    title: "Mahkota Emas Sang Ratu",
    period: "Dinasti Matahari (fiksi)",
    materialLabel: "Emas murni + batu rubi",
    primaryMaterial: "Gold",
    scale: 1.3,
    description:
      "Mahkota upacara dengan delapan tiara. Emas adalah logam penuh (metalness 1), jadi warnanya hampir seluruhnya berasal dari pantulan ruangan di sekitarnya.",
  },
  {
    node: "Astrolabe",
    title: "Astrolab Perunggu",
    period: "Abad Para Navigator (fiksi)",
    materialLabel: "Perunggu tua",
    primaryMaterial: "Bronze",
    scale: 1.1,
    description:
      "Alat pembaca posisi bintang. Cincin dalamnya adalah child dari cincin luar, sehingga gerakannya gabungan rotasi parent dan rotasinya sendiri.",
  },
  {
    node: "Stele",
    title: "Prasasti Batu",
    period: "Kerajaan Lembah Sungai (fiksi)",
    materialLabel: "Batu andesit",
    primaryMaterial: "Stone",
    scale: 1.05,
    description:
      "Lempeng batu berukir yang mencatat sebuah perjanjian. Batu adalah material paling kasar di koleksi ini (roughness 0,95).",
  },
  {
    node: "Statue",
    title: "Arca Marmer",
    period: "Zaman Para Pemahat (fiksi)",
    materialLabel: "Marmer putih",
    primaryMaterial: "Marble",
    scale: 1.1,
    description:
      "Arca bergaya sederhana dari marmer. Halus namun bukan logam, sehingga pantulannya lembut tanpa mengubah warna putihnya.",
  },
];

/** Where each pedestal stands: a gentle arc facing the visitor's start point. */
const SLOTS = [
  [-6, -1.5],
  [-3, -4],
  [0, -5],
  [3, -4],
  [6, -1.5],
];

/** Point every exhibit turns towards, so plaques face the overview camera. */
const FACING_POINT = new THREE.Vector3(0, 0, 10);

/** Height of a pedestal top — artifacts are placed exactly at this height. */
const PEDESTAL_HEIGHT = 1;

/** Extra emissive colour added to an artifact while the pointer hovers it. */
const HIGHLIGHT_EMISSIVE = new THREE.Color(0x3a2a14);

/**
 * Loads artifacts.glb and reports download progress.
 *
 * @param {string} url Address of the GLB (served from public/).
 * @param {(percent: number) => void} onProgress Called while downloading, 0–100.
 * @returns {Promise<{ nodes: Map<string, THREE.Object3D>, clips: THREE.AnimationClip[] }>}
 *   `nodes` maps each root node name ("Crown", …) to its object.
 */
export async function loadArtifactModels(url, onProgress) {
  const gltf = await new GLTFLoader().loadAsync(url, (event) => {
    // `total` is 0 when the server does not send a Content-Length header.
    if (event.total > 0) onProgress(Math.round((event.loaded / event.total) * 100));
  });

  const nodes = new Map();
  for (const child of [...gltf.scene.children]) nodes.set(child.name, child);
  return { nodes, clips: gltf.animations };
}

/**
 * Gives an artifact its own copy of every material.
 *
 * Highlighting and the roughness slider edit materials directly. Cloning makes
 * sure those edits stay on this artifact only. Meshes inside the same artifact
 * that shared one material keep sharing its single clone (the Map tracks that).
 * Each clone also remembers its original emissive colour and roughness, so
 * they can be restored later.
 *
 * @param {THREE.Object3D} artifact
 * @returns {THREE.MeshStandardMaterial[]} Every (cloned) material of the artifact.
 */
function cloneMaterials(artifact) {
  const clones = new Map();

  artifact.traverse((object) => {
    if (!object.isMesh) return;

    if (!clones.has(object.material)) {
      const copy = object.material.clone();
      copy.userData.baseEmissive = copy.emissive.clone();
      copy.userData.baseRoughness = copy.roughness;
      clones.set(object.material, copy);
    }
    object.material = clones.get(object.material);

    // glTF does not store shadow settings, so they are switched on here.
    object.castShadow = true;
    object.receiveShadow = true;
  });

  return [...clones.values()];
}

/**
 * Builds the round stone pedestal an artifact stands on.
 *
 * @returns {THREE.Mesh}
 */
function createPedestal() {
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.56, PEDESTAL_HEIGHT, 40),
    new THREE.MeshStandardMaterial({ color: 0x2c2724, roughness: 0.6, metalness: 0 }),
  );
  pedestal.position.y = PEDESTAL_HEIGHT / 2;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  return pedestal;
}

/**
 * Builds the small brass plaque on the front of the pedestal. Brass is a
 * smooth metal, so it picks up a bright reflection of the spotlight.
 *
 * @returns {THREE.Mesh}
 */
function createPlaque() {
  const plaque = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.16, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xb8913a, roughness: 0.3, metalness: 1 }),
  );
  plaque.position.set(0, 0.72, 0.53);
  plaque.rotation.x = -0.25; // tilted back slightly, like a lectern
  return plaque;
}

/**
 * Builds the warm spotlight that hangs above an exhibit.
 * It casts no shadow on purpose — the hall's skylight already does, and five
 * extra shadow maps would cost five extra render passes per frame.
 *
 * @param {THREE.Object3D} artifact The spotlight aims at this object.
 * @returns {THREE.SpotLight}
 */
function createSpotlight(artifact) {
  const spotlight = new THREE.SpotLight(0xffd9a0, 28, 0, 0.42, 0.55, 2);
  spotlight.position.set(0, 4.6, 1.4);
  spotlight.target = artifact;
  return spotlight;
}

/**
 * Builds an invisible box around an artifact for the raycaster to hit.
 *
 * Why not raycast the artifact itself? Some artifacts are thin or hollow — the
 * astrolabe is two spinning rings with a large gap — so a ray through the
 * middle passes straight through and the click is "missed". A box the size of
 * the artifact is always easy to hit, and testing 5 boxes (12 triangles each)
 * is far cheaper than testing every triangle of every artifact.
 *
 * `visible = false` hides it from rendering, but the raycaster still tests it.
 *
 * Must be called while the exhibit group is still at the origin, so the
 * artifact's world bounding box equals its box inside the group.
 *
 * @param {THREE.Object3D} artifact
 * @param {number} index Exhibit index, stored for interaction.js.
 * @returns {THREE.Mesh}
 */
function createHitArea(artifact, index) {
  artifact.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(artifact);
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(1.15); // a little padding

  // Width and depth are made equal: the box is measured at one instant, when
  // the astrolabe's ring happens to face forward and is paper-thin in Z. A
  // square footprint stays easy to click from any orbit angle.
  const footprint = Math.max(size.x, size.z);
  const hitArea = new THREE.Mesh(new THREE.BoxGeometry(footprint, size.y, footprint), new THREE.MeshBasicMaterial());
  hitArea.position.copy(box.getCenter(new THREE.Vector3()));
  hitArea.visible = false;
  hitArea.userData.exhibitIndex = index;
  return hitArea;
}

/**
 * Turns the loaded models into exhibits and places them in the hall.
 *
 * Scene graph of one exhibit:
 *   Group "Exhibit: Crown"
 *   ├── pedestal
 *   ├── plaque
 *   ├── spotlight
 *   ├── hit area (invisible box used for raycasting)
 *   └── artifact (from the GLB, with its own children)
 *
 * @param {THREE.Scene} scene
 * @param {{ nodes: Map<string, THREE.Object3D>, clips: THREE.AnimationClip[] }} models
 * @returns {{ exhibits: object[], mixers: THREE.AnimationMixer[] }}
 *   `exhibits` — one object per artifact (see the return value below).
 *   `mixers`   — animation players that main.js must update every frame.
 */
export function buildExhibits(scene, models) {
  const mixers = [];

  const exhibits = ARTIFACTS.map((data, index) => {
    const artifact = models.nodes.get(data.node);
    if (!artifact) throw new Error(`artifacts.glb has no node named "${data.node}"`);

    // The GLB lays artifacts side by side; reset that, then sit it on the pedestal.
    artifact.position.set(0, PEDESTAL_HEIGHT, 0);
    artifact.scale.setScalar(data.scale);

    const materials = cloneMaterials(artifact);
    const primaryMaterials = materials.filter((material) => material.name === data.primaryMaterial);
    // Fail here, with a clear message, rather than later with a vague crash
    // the first time someone clicks this artifact.
    if (primaryMaterials.length === 0) {
      throw new Error(`"${data.node}" has no material named "${data.primaryMaterial}"`);
    }
    const spotlight = createSpotlight(artifact);

    const group = new THREE.Group();
    group.name = `Exhibit: ${data.node}`;
    group.add(createPedestal(), createPlaque(), spotlight, artifact);

    // Measured now, while the group still sits at the origin (see createHitArea).
    const hitArea = createHitArea(artifact, index);
    group.add(hitArea);

    const [x, z] = SLOTS[index];
    group.position.set(x, 0, z);
    group.lookAt(FACING_POINT.x, 0, FACING_POINT.z);
    scene.add(group);

    // Play any animation clip that targets nodes inside this artifact.
    for (const clip of models.clips) {
      const animatesThisArtifact = clip.tracks.some((track) => artifact.getObjectByName(track.name.split(".")[0]));
      if (animatesThisArtifact) {
        const mixer = new THREE.AnimationMixer(artifact);
        mixer.clipAction(clip).play();
        mixers.push(mixer);
      }
    }

    return {
      index,
      data,
      group,
      artifact,
      hitArea,
      spotlight,
      baseSpotIntensity: spotlight.intensity,
      materials,
      primaryMaterials,
    };
  });

  return { exhibits, mixers };
}

/**
 * Turns the hover highlight on or off: the spotlight doubles in strength and
 * every material gets a faint warm glow added to its own emissive colour.
 *
 * @param {object} exhibit One item returned by buildExhibits().
 * @param {boolean} on
 */
export function setHighlight(exhibit, on) {
  exhibit.spotlight.intensity = exhibit.baseSpotIntensity * (on ? 2 : 1);

  for (const material of exhibit.materials) {
    material.emissive.copy(material.userData.baseEmissive);
    if (on) material.emissive.add(HIGHLIGHT_EMISSIVE);
  }
}

/**
 * Sets the roughness of the exhibit's main material (the slider in the info
 * panel). 0 = mirror-smooth, sharp reflections; 1 = rough, no clear reflection.
 *
 * @param {object} exhibit
 * @param {number} value 0–1.
 */
export function setPrimaryRoughness(exhibit, value) {
  for (const material of exhibit.primaryMaterials) material.roughness = value;
}

/**
 * Puts the main material back to the roughness it was authored with, so the
 * museum is never left "broken" after a visitor plays with the slider.
 *
 * @param {object} exhibit
 */
export function restorePrimaryRoughness(exhibit) {
  for (const material of exhibit.primaryMaterials) material.roughness = material.userData.baseRoughness;
}

/**
 * Reads the main material's current values for the info panel.
 *
 * @param {object} exhibit
 * @returns {{ roughness: number, metalness: number }}
 */
export function readPrimaryMaterial(exhibit) {
  const [material] = exhibit.primaryMaterials;
  return { roughness: material.roughness, metalness: material.metalness };
}

// Generates public/models/artifacts.glb — every 3D asset the museum shows.
//
// The project uses no downloaded models. Each artifact is built here from
// Three.js primitive geometries and exported with GLTFExporter, so the
// "source" of every asset is plain, readable code. Re-run it with:
//
//   npm run build:models
//
// Each artifact is a root node with a unique name (Amphora, Crown, Astrolabe,
// Stele, Statue). The app looks them up by that name after loading the GLB.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

// GLTFExporter turns its output Blob into an ArrayBuffer through FileReader,
// a browser API that Node does not have. Blob.arrayBuffer() does the same job.
globalThis.FileReader ??= class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
};

const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(here, "../public/models/artifacts.glb");

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/**
 * Creates a PBR material (exported as glTF "metallic-roughness").
 *
 * A NEW material is made for every call on purpose: GLTFExporter merges
 * materials that are the same object, and two artifacts sharing one material
 * would mean the roughness slider changes both at once.
 *
 * @param {string} name       Material name — the app finds the "primary" material by it.
 * @param {object} parameters Any MeshStandardMaterial options (color, roughness, metalness, …).
 * @returns {THREE.MeshStandardMaterial}
 */
function pbr(name, parameters) {
  return new THREE.MeshStandardMaterial({ name, ...parameters });
}

/**
 * Wraps a geometry and material in a named mesh and places it.
 *
 * @param {string} name                 Node name inside the GLB.
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Material} material
 * @param {[number, number, number]} [position=[0, 0, 0]]
 * @param {[number, number, number]} [rotation=[0, 0, 0]] Euler angles in radians.
 * @returns {THREE.Mesh}
 */
function mesh(name, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const result = new THREE.Mesh(geometry, material);
  result.name = name;
  result.position.set(...position);
  result.rotation.set(...rotation);
  return result;
}

/**
 * Turns a list of [radius, height] pairs into the Vector2 profile that
 * LatheGeometry spins around the Y axis — the way a potter's wheel turns a
 * side outline into a vase.
 *
 * @param {[number, number][]} points
 * @returns {THREE.Vector2[]}
 */
function profile(points) {
  return points.map(([radius, height]) => new THREE.Vector2(radius, height));
}

// ---------------------------------------------------------------------------
// ARTIFACTS — each one sits with its base at y = 0 so it can be placed
// directly on top of a pedestal.
// ---------------------------------------------------------------------------

/**
 * Ceramic amphora: a lathe-turned body, a dark painted band and two handles.
 * Ceramic is non-metal and fairly rough — a contrast to the gold crown.
 *
 * @returns {THREE.Group}
 */
function buildAmphora() {
  const ceramic = pbr("Ceramic", { color: 0xb5653a, roughness: 0.65, metalness: 0, side: THREE.DoubleSide });
  const paint = pbr("Paint", { color: 0x3a2416, roughness: 0.7, metalness: 0 });

  const body = profile([
    [0, 0], [0.16, 0], [0.2, 0.05], [0.29, 0.25], [0.32, 0.45],
    [0.27, 0.65], [0.13, 0.82], [0.1, 0.95], [0.14, 1.0],
  ]);

  const amphora = new THREE.Group();
  amphora.name = "Amphora";
  amphora.add(mesh("AmphoraBody", new THREE.LatheGeometry(body, 48), ceramic));
  amphora.add(mesh("AmphoraBand", new THREE.TorusGeometry(0.322, 0.012, 8, 64), paint, [0, 0.45, 0], [Math.PI / 2, 0, 0]));

  // Half-torus handles, standing upright on the left and right shoulders.
  for (const side of [-1, 1]) {
    amphora.add(
      mesh("AmphoraHandle", new THREE.TorusGeometry(0.11, 0.022, 8, 24, Math.PI), ceramic, [side * 0.2, 0.74, 0], [0, 0, side * -Math.PI / 2]),
    );
  }

  return amphora;
}

/**
 * Golden crown: an open band, eight spikes and an emissive ruby on each spike,
 * resting on a velvet cushion. Gold is fully metallic and smooth, so it shows
 * the environment reflection most clearly of all the artifacts.
 *
 * @returns {THREE.Group}
 */
function buildCrown() {
  const gold = pbr("Gold", { color: 0xffc94a, roughness: 0.25, metalness: 1, side: THREE.DoubleSide });
  const ruby = pbr("Ruby", { color: 0x9b111e, roughness: 0.1, metalness: 0, emissive: 0x5a0010, emissiveIntensity: 1 });
  const velvet = pbr("Velvet", { color: 0x5b1020, roughness: 1, metalness: 0 });

  const crown = new THREE.Group();
  crown.name = "Crown";
  crown.add(mesh("CrownCushion", new THREE.CylinderGeometry(0.42, 0.45, 0.1, 40), velvet, [0, 0.05, 0]));
  crown.add(mesh("CrownBand", new THREE.CylinderGeometry(0.32, 0.32, 0.22, 48, 1, true), gold, [0, 0.21, 0]));

  const spikeCount = 8;
  for (let i = 0; i < spikeCount; i++) {
    const angle = (i / spikeCount) * Math.PI * 2;
    const x = Math.cos(angle) * 0.32;
    const z = Math.sin(angle) * 0.32;
    crown.add(mesh("CrownSpike", new THREE.ConeGeometry(0.055, 0.22, 12), gold, [x, 0.43, z]));
    crown.add(mesh("CrownRuby", new THREE.OctahedronGeometry(0.04), ruby, [x * 1.04, 0.24, z * 1.04]));
  }

  return crown;
}

/**
 * Bronze astrolabe: a stand holding two nested rings.
 *
 * The rings are the scene-graph showcase. The outer gimbal spins around Y, and
 * the inner gimbal is its CHILD and spins around Z on top of that — so the
 * inner ring's final motion is the parent's rotation combined with its own.
 * Both spins are stored in the GLB as one animation clip (see buildSpinClip).
 *
 * @returns {THREE.Group}
 */
function buildAstrolabe() {
  const bronze = pbr("Bronze", { color: 0x8c6239, roughness: 0.45, metalness: 0.9 });
  const coreGold = pbr("CoreGold", { color: 0xffc94a, roughness: 0.3, metalness: 1, emissive: 0x442200, emissiveIntensity: 1 });

  const astrolabe = new THREE.Group();
  astrolabe.name = "Astrolabe";
  astrolabe.add(mesh("AstrolabeBase", new THREE.CylinderGeometry(0.28, 0.33, 0.07, 40), bronze, [0, 0.035, 0]));
  astrolabe.add(mesh("AstrolabePole", new THREE.CylinderGeometry(0.03, 0.03, 0.55, 16), bronze, [0, 0.34, 0]));

  // Gimbals are empty groups that only carry rotation; the rings hang inside them.
  const outerGimbal = new THREE.Group();
  outerGimbal.name = "AstrolabeOuterGimbal";
  outerGimbal.position.set(0, 0.95, 0);
  outerGimbal.add(mesh("AstrolabeOuterRing", new THREE.TorusGeometry(0.33, 0.022, 12, 64), bronze));

  const innerGimbal = new THREE.Group();
  innerGimbal.name = "AstrolabeInnerGimbal";
  // Rotated 90° so this ring stands across the outer one; spinning it about Z
  // then tilts it visibly instead of turning it within its own plane.
  innerGimbal.add(mesh("AstrolabeInnerRing", new THREE.TorusGeometry(0.25, 0.018, 12, 64), bronze, [0, 0, 0], [0, Math.PI / 2, 0]));
  innerGimbal.add(mesh("AstrolabeCore", new THREE.SphereGeometry(0.07, 24, 16), coreGold));

  outerGimbal.add(innerGimbal); // parent → child: the core of the scene-graph demo
  astrolabe.add(outerGimbal);
  return astrolabe;
}

/**
 * Stone stele (inscribed tablet): a slab with an arched top, a plinth and a
 * few carved lines. Stone is the roughest material in the collection.
 *
 * @returns {THREE.Group}
 */
function buildStele() {
  const stone = pbr("Stone", { color: 0x7d7468, roughness: 0.95, metalness: 0 });
  const carving = pbr("Carving", { color: 0x3f3a33, roughness: 1, metalness: 0 });

  const stele = new THREE.Group();
  stele.name = "Stele";
  stele.add(mesh("StelePlinth", new THREE.BoxGeometry(0.7, 0.08, 0.26), stone, [0, 0.04, 0]));
  stele.add(mesh("SteleSlab", new THREE.BoxGeometry(0.56, 0.8, 0.14), stone, [0, 0.48, 0]));

  // Half of a cylinder, turned to face forward, gives the arched top.
  // thetaStart π/2 with length π selects the half that ends up above the slab.
  stele.add(
    mesh("SteleArch", new THREE.CylinderGeometry(0.28, 0.28, 0.14, 32, 1, false, Math.PI / 2, Math.PI), stone, [0, 0.88, 0], [Math.PI / 2, 0, 0]),
  );

  // Carved text lines on the front face, slightly proud of the surface.
  for (let row = 0; row < 6; row++) {
    const width = row % 2 === 0 ? 0.4 : 0.32;
    stele.add(mesh("SteleLine", new THREE.BoxGeometry(width, 0.022, 0.01), carving, [0, 0.78 - row * 0.1, 0.072]));
  }

  return stele;
}

/**
 * Marble statue: a stylised robed figure — a lathe-turned body, a head and a
 * topknot on a round base. Marble is smooth but non-metallic.
 *
 * @returns {THREE.Group}
 */
function buildStatue() {
  const marble = pbr("Marble", { color: 0xeeeae2, roughness: 0.35, metalness: 0, side: THREE.DoubleSide });

  const robe = profile([
    [0, 0], [0.2, 0], [0.22, 0.1], [0.18, 0.5], [0.14, 0.7], [0.16, 0.8], [0.11, 0.86], [0, 0.87],
  ]);

  const statue = new THREE.Group();
  statue.name = "Statue";
  statue.add(mesh("StatueBase", new THREE.CylinderGeometry(0.25, 0.28, 0.1, 40), marble, [0, 0.05, 0]));
  statue.add(mesh("StatueRobe", new THREE.LatheGeometry(robe, 40), marble, [0, 0.1, 0]));
  statue.add(mesh("StatueHead", new THREE.SphereGeometry(0.11, 32, 24), marble, [0, 1.07, 0]));
  statue.add(mesh("StatueTopknot", new THREE.SphereGeometry(0.05, 20, 16), marble, [0, 1.19, 0]));
  return statue;
}

// ---------------------------------------------------------------------------
// ANIMATION
// ---------------------------------------------------------------------------

/**
 * Builds a quaternion track for one full turn around `axis` in `duration` seconds.
 *
 * A quaternion track interpolates the shortest way between neighbouring keys,
 * so a single 0° → 360° pair would not move at all. Five keys, 90° apart,
 * force the rotation to go all the way round.
 *
 * @param {string} nodeName Node to animate (must match a name inside the GLB).
 * @param {THREE.Vector3} axis Unit rotation axis.
 * @param {number} duration Seconds per full turn.
 * @returns {THREE.QuaternionKeyframeTrack}
 */
function fullTurnTrack(nodeName, axis, duration) {
  const times = [];
  const values = [];
  const quaternion = new THREE.Quaternion();

  for (let step = 0; step <= 4; step++) {
    times.push((step / 4) * duration);
    quaternion.setFromAxisAngle(axis, (step / 4) * Math.PI * 2);
    values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }

  return new THREE.QuaternionKeyframeTrack(`${nodeName}.quaternion`, times, values);
}

/**
 * The astrolabe's looping clip: outer ring around Y every 8 s, inner ring
 * around Z every 4 s. Both last 8 s in total so the clip loops seamlessly.
 *
 * @returns {THREE.AnimationClip}
 */
function buildSpinClip() {
  const outer = fullTurnTrack("AstrolabeOuterGimbal", new THREE.Vector3(0, 1, 0), 8);
  const innerFirst = fullTurnTrack("AstrolabeInnerGimbal", new THREE.Vector3(0, 0, 1), 4);

  // Two inner turns inside the same 8 s: repeat the 4 s keys, shifted by 4 s.
  const innerTimes = [...innerFirst.times, ...innerFirst.times.slice(1).map((t) => t + 4)];
  const innerValues = [...innerFirst.values, ...innerFirst.values.slice(4)];
  const inner = new THREE.QuaternionKeyframeTrack("AstrolabeInnerGimbal.quaternion", innerTimes, innerValues);

  return new THREE.AnimationClip("AstrolabeSpin", 8, [outer, inner]);
}

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------

/**
 * Builds every artifact, exports them as one binary GLB, and writes the file.
 * The artifacts are laid out side by side only so the GLB looks tidy if opened
 * in a viewer; the app re-positions each one onto its own pedestal.
 */
async function main() {
  const scene = new THREE.Scene();
  const artifacts = [buildAmphora(), buildCrown(), buildAstrolabe(), buildStele(), buildStatue()];
  artifacts.forEach((artifact, index) => {
    artifact.position.x = (index - 2) * 1.2;
    scene.add(artifact);
  });

  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: [buildSpinClip()] });

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, Buffer.from(glb));
  console.log(`Wrote ${OUTPUT} (${(glb.byteLength / 1024).toFixed(1)} KB, ${artifacts.length} artifacts)`);
}

await main();

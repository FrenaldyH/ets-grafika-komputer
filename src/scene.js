// scene.js — the "stage": renderer, camera, camera controls, the museum hall,
// global lighting, environment map and shadows.
//
// Nothing here knows about artifacts or game state. It only builds the room
// that everything else is placed into.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/** Caps devicePixelRatio: a 3x screen would triple the pixel work for no visible gain. */
const MAX_PIXEL_RATIO = 2;

/** Vertical field of view (degrees) on a landscape screen. */
const BASE_FOV = 50;

/** Background and fog share one colour so the far end of the hall fades into darkness. */
const HALL_COLOR = 0x14110f;

/**
 * Size of the hall (metres). The room spans x ∈ [-11, 11] and z ∈ [-8, 6].
 * The height must stay above the overview camera (y = 6 in museum.js): a camera
 * at exactly ceiling height sees the ceiling edge-on, i.e. not at all.
 */
const HALL = { width: 22, depth: 14, height: 7, centerZ: -1 };

/**
 * Creates the WebGL renderer bound to the page's canvas.
 *
 * - antialias smooths jagged triangle edges.
 * - Shadows are enabled here once; individual lights and meshes still have to
 *   opt in with castShadow / receiveShadow.
 * - PCFShadowMap (not PCFSoftShadowMap): the "soft" type is deprecated in
 *   three r182 and would log a console warning. PCF is softened via shadow.radius.
 * - ACES tone mapping compresses bright highlights (polished gold under a
 *   spotlight) instead of clipping them to flat white.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {THREE.WebGLRenderer}
 */
function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  return renderer;
}

/**
 * Adds an environment map: a blurred 360° image of a room that PBR materials
 * reflect. Without it, metals such as gold and bronze look black, because a
 * metal's colour comes almost entirely from what it reflects.
 *
 * RoomEnvironment is a small room generated in code (an official Three.js
 * helper), so no external HDR file is needed. PMREMGenerator pre-blurs it into
 * versions for every roughness level — that is what lets a rough surface show
 * a blurry reflection and a smooth one a sharp reflection.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 */
function addEnvironment(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  // The environment only lights and reflects; it is never drawn as the background.
  scene.environmentIntensity = 0.45;
  pmrem.dispose();
}

/**
 * Builds the hall: polished floor, three walls, a ceiling and a row of columns.
 *
 * The floor and walls only RECEIVE shadows. The columns both cast and receive,
 * which adds depth to the back of the room.
 *
 * @param {THREE.Scene} scene
 */
function buildHall(scene) {
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3230, roughness: 0.35, metalness: 0 });
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5b4d, roughness: 0.9, metalness: 0 });
  const columnMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d0c4, roughness: 0.5, metalness: 0 });

  // PlaneGeometry is created standing up (in the XY plane); -90° about X lays it flat.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALL.width, HALL.depth), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = HALL.centerZ;
  floor.receiveShadow = true;
  scene.add(floor);

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(HALL.width, HALL.height), wallMaterial);
  backWall.position.set(0, HALL.height / 2, HALL.centerZ - HALL.depth / 2);
  backWall.receiveShadow = true;
  scene.add(backWall);

  for (const side of [-1, 1]) {
    const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(HALL.depth, HALL.height), wallMaterial);
    sideWall.position.set(side * (HALL.width / 2), HALL.height / 2, HALL.centerZ);
    // Turned to face into the room: the left wall faces +X, the right wall faces −X.
    sideWall.rotation.y = -side * (Math.PI / 2);
    sideWall.receiveShadow = true;
    scene.add(sideWall);
  }

  // Ceiling: faces down (+90° about X). It does NOT cast a shadow, so the
  // skylight still shines through it — the "roof window" of this room.
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(HALL.width, HALL.depth), wallMaterial);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, HALL.height, HALL.centerZ);
  scene.add(ceiling);

  const columnGeometry = new THREE.CylinderGeometry(0.32, 0.36, HALL.height, 24);
  for (const x of [-8.5, -4.5, 4.5, 8.5]) {
    const column = new THREE.Mesh(columnGeometry, columnMaterial);
    column.position.set(x, HALL.height / 2, HALL.centerZ - HALL.depth / 2 + 0.8);
    column.castShadow = true;
    column.receiveShadow = true;
    scene.add(column);
  }
}

/**
 * Adds the two global lights. Each artifact also gets its own spotlight
 * (see exhibits.js) — those set the mood; these two make the room readable.
 *
 * - HemisphereLight (the "ambient" light): warm from above, dark brown from
 *   below, so nothing is ever pitch black.
 * - DirectionalLight (a cool skylight through an imagined roof window): the
 *   ONLY shadow-casting light. One shadow map for the whole hall is far
 *   cheaper than giving each of the five spotlights its own.
 *
 * @param {THREE.Scene} scene
 */
function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a1e14, 0.6));

  const skylight = new THREE.DirectionalLight(0xdfe8ff, 1.1);
  skylight.position.set(5, 12, 6);
  skylight.target.position.set(0, 0, HALL.centerZ);
  skylight.castShadow = true;

  // The shadow camera is an orthographic box; fitting it tightly around the
  // hall spends the 2048×2048 shadow-map pixels only where objects are.
  const shadowCamera = skylight.shadow.camera;
  shadowCamera.left = -12;
  shadowCamera.right = 12;
  shadowCamera.top = 12;
  shadowCamera.bottom = -12;
  shadowCamera.near = 1;
  shadowCamera.far = 40;
  skylight.shadow.mapSize.set(2048, 2048);
  skylight.shadow.radius = 3;
  // A small bias stops "shadow acne" — stripes where a surface shadows itself.
  skylight.shadow.bias = -0.0005;
  skylight.shadow.normalBias = 0.02;

  scene.add(skylight, skylight.target);
}

/**
 * Creates the perspective camera and OrbitControls.
 * OrbitControls turns mouse drag into orbiting around `controls.target` and
 * the scroll wheel into zoom. Pan is disabled to keep visitors inside the hall.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{ camera: THREE.PerspectiveCamera, controls: OrbitControls }}
 */
function createCameraRig(canvas) {
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; // smooth slowdown after a drag
  controls.enablePan = false;
  return { camera, controls };
}

/**
 * Builds the whole stage and returns everything the other modules need.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{
 *   renderer: THREE.WebGLRenderer,
 *   scene: THREE.Scene,
 *   camera: THREE.PerspectiveCamera,
 *   controls: OrbitControls,
 *   resize: (width: number, height: number) => void,
 * }}
 */
export function createStage(canvas) {
  const renderer = createRenderer(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(HALL_COLOR);
  scene.fog = new THREE.Fog(HALL_COLOR, 14, 34);

  addEnvironment(renderer, scene);
  buildHall(scene);
  addLights(scene);

  const { camera, controls } = createCameraRig(canvas);

  /**
   * Matches the drawing buffer and the camera to the window size.
   * camera.aspect alone is not enough: updateProjectionMatrix() must run
   * afterwards, or the new aspect never reaches the projection and the scene
   * looks stretched.
   *
   * On a portrait screen (aspect < 1) a fixed vertical FOV leaves a narrow
   * horizontal view that crops the outer exhibits. Widening the vertical FOV by
   * 1/aspect keeps the horizontal view the same as on a square screen.
   *
   * @param {number} width  CSS pixels.
   * @param {number} height CSS pixels.
   */
  function resize(width, height) {
    renderer.setSize(width, height);
    camera.aspect = width / height;

    const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) / Math.min(camera.aspect, 1));
    camera.fov = THREE.MathUtils.radToDeg(halfFov * 2);
    camera.updateProjectionMatrix();
  }

  return { renderer, scene, camera, controls, resize };
}

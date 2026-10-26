// effects.js — visual effects (VFX).
//
//   1. Dust     — floating specks of dust drifting through the hall (THREE.Points).
//   2. Halos    — a glowing ring on each pedestal top; it pulses, brightens on
//                 hover and turns gold once the artifact has been inspected.
//   3. Sparkle  — a short burst of particles the first time an artifact is inspected.
//   4. Celebration — a large multicolour burst when the exhibition is complete.
//
// All of them use additive blending: their colour is ADDED to what is behind
// them, so overlapping particles get brighter, the way real light does.

import * as THREE from "three";

const DUST_COUNT = 400;
const DUST_BOUNDS = { minX: -10, maxX: 10, minY: 0, maxY: 6, minZ: -7, maxZ: 5 };

const HALO_COLORS = { idle: new THREE.Color(0x5fa8ff), visited: new THREE.Color(0xffc94a) };

const GRAVITY = 3; // m/s² pulling burst particles down

/**
 * Builds a material for glowing particles.
 *
 * - AdditiveBlending: colours are added to the background, so they glow.
 * - depthWrite false: particles do not hide each other, so they blend smoothly
 *   instead of drawing ugly black squares where they overlap.
 *
 * @param {object} parameters Extra PointsMaterial options (size, color, …).
 * @returns {THREE.PointsMaterial}
 */
function glowMaterial(parameters) {
  return new THREE.PointsMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true, // farther particles appear smaller, like real objects
    ...parameters,
  });
}

/**
 * Returns a random number between min and max.
 *
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function random(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Creates the dust: one THREE.Points object holding DUST_COUNT particles.
 * Every particle is just a position in a Float32Array; the GPU draws each one
 * as a small square sprite. One draw call for all 400 particles.
 *
 * @returns {{ points: THREE.Points, speeds: Float32Array }}
 */
function createDust() {
  const positions = new Float32Array(DUST_COUNT * 3);
  const speeds = new Float32Array(DUST_COUNT);

  for (let i = 0; i < DUST_COUNT; i++) {
    positions[i * 3] = random(DUST_BOUNDS.minX, DUST_BOUNDS.maxX);
    positions[i * 3 + 1] = random(DUST_BOUNDS.minY, DUST_BOUNDS.maxY);
    positions[i * 3 + 2] = random(DUST_BOUNDS.minZ, DUST_BOUNDS.maxZ);
    speeds[i] = random(0.05, 0.2); // metres per second, upward
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const points = new THREE.Points(geometry, glowMaterial({ size: 0.035, color: 0xffe2b0, opacity: 0.55 }));
  return { points, speeds };
}

/**
 * Creates the glowing ring that lies on a pedestal top. It is a child of the
 * exhibit group, so it automatically sits on the right pedestal.
 *
 * @returns {THREE.Mesh}
 */
function createHalo() {
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.36, 0.48, 48),
    new THREE.MeshBasicMaterial({
      color: HALO_COLORS.idle,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  // RingGeometry is built standing up; -90° about X lays it flat on the pedestal.
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 1.005; // a hair above the pedestal top to avoid flickering (z-fighting)
  return halo;
}

/**
 * Creates the visual effects and returns functions to trigger and animate them.
 *
 * @param {THREE.Scene} scene
 * @param {object[]} exhibits From buildExhibits().
 * @returns {{
 *   sparkle: (exhibit: object) => void,
 *   celebrate: () => void,
 *   clearBursts: () => void,
 *   update: (dt: number, elapsed: number, snapshot: object) => void,
 * }}
 */
export function createEffects(scene, exhibits) {
  const dust = createDust();
  scene.add(dust.points);

  const halos = exhibits.map((exhibit) => {
    const halo = createHalo();
    exhibit.group.add(halo);
    return halo;
  });

  /** Particle bursts still alive; each removes itself when its life ends. */
  const bursts = [];

  /**
   * Spawns one burst of particles that fly outwards, fall under gravity and fade.
   *
   * @param {THREE.Vector3} origin World position the particles start from.
   * @param {object} options
   * @param {number} options.count   Number of particles.
   * @param {number} options.speed   Starting speed, m/s.
   * @param {number} options.life    Seconds until the burst fades out.
   * @param {number} options.size    Particle size.
   * @param {THREE.Color[]} options.palette Colours picked at random per particle.
   */
  function spawnBurst(origin, { count, speed, life, size, palette }) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions.set([origin.x, origin.y, origin.z], i * 3);

      // A random direction on a sphere, biased upward so the burst "pops".
      const direction = new THREE.Vector3(random(-1, 1), random(0.2, 1.2), random(-1, 1)).normalize();
      velocities.set([direction.x * speed, direction.y * speed, direction.z * speed], i * 3);

      const color = palette[Math.floor(Math.random() * palette.length)];
      colors.set([color.r, color.g, color.b], i * 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const points = new THREE.Points(geometry, glowMaterial({ size, vertexColors: true, opacity: 1 }));
    scene.add(points);
    bursts.push({ points, velocities, age: 0, life });
  }

  /**
   * Small golden sparkle above an artifact, the first time it is inspected.
   *
   * @param {object} exhibit
   */
  function sparkle(exhibit) {
    const origin = new THREE.Box3().setFromObject(exhibit.artifact).getCenter(new THREE.Vector3());
    spawnBurst(origin, {
      count: 90,
      speed: 1.6,
      life: 1.4,
      size: 0.06,
      palette: [new THREE.Color(0xffe08a), new THREE.Color(0xffffff), new THREE.Color(0xffb347)],
    });
  }

  /** Big multicolour burst in the middle of the hall for exhibition completion. */
  function celebrate() {
    spawnBurst(new THREE.Vector3(0, 2.5, -3), {
      count: 450,
      speed: 5,
      life: 2.8,
      size: 0.09,
      palette: [0xff5e5e, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xc77dff].map((hex) => new THREE.Color(hex)),
    });
  }

  /**
   * Removes one burst from the scene and frees its GPU memory.
   *
   * @param {{ points: THREE.Points }} burst
   */
  function removeBurst(burst) {
    scene.remove(burst.points);
    burst.points.geometry.dispose();
    burst.points.material.dispose();
  }

  /** Removes every burst immediately (used when the visit is reset). */
  function clearBursts() {
    for (const burst of bursts) removeBurst(burst);
    bursts.length = 0;
  }

  /**
   * Moves the dust upward and wraps it back to the floor when it reaches the top.
   *
   * @param {number} dt Seconds since the previous frame.
   * @param {number} elapsed Total seconds, used for a gentle sideways sway.
   */
  function updateDust(dt, elapsed) {
    const positions = dust.points.geometry.attributes.position;
    for (let i = 0; i < DUST_COUNT; i++) {
      let y = positions.getY(i) + dust.speeds[i] * dt;
      if (y > DUST_BOUNDS.maxY) y = DUST_BOUNDS.minY;
      positions.setY(i, y);
      positions.setX(i, positions.getX(i) + Math.sin(elapsed * 0.5 + i) * 0.02 * dt);
    }
    // Tells three.js the array changed, so it re-uploads it to the GPU buffer.
    positions.needsUpdate = true;
  }

  /**
   * Pulses each halo and sets its colour and brightness from the visit state:
   * gold once visited, blue otherwise, and brighter while hovered.
   *
   * @param {number} elapsed Total seconds.
   * @param {{ hovered: object|null, visited: Set<number> }} snapshot From museum.getSnapshot().
   */
  function updateHalos(elapsed, snapshot) {
    halos.forEach((halo, index) => {
      const visited = snapshot.visited.has(index);
      const hovered = snapshot.hovered?.index === index;

      halo.material.color.copy(visited ? HALO_COLORS.visited : HALO_COLORS.idle);
      // A sine wave between 0 and 1, offset per halo so they do not pulse in unison.
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.4 + index);
      halo.material.opacity = (hovered ? 0.75 : 0.3) + pulse * 0.25;
    });
  }

  /**
   * Moves every live burst particle (velocity + gravity) and fades it out.
   *
   * @param {number} dt Seconds since the previous frame.
   */
  function updateBursts(dt) {
    for (let b = bursts.length - 1; b >= 0; b--) {
      const burst = bursts[b];
      burst.age += dt;

      if (burst.age >= burst.life) {
        removeBurst(burst);
        bursts.splice(b, 1);
        continue;
      }

      const positions = burst.points.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        burst.velocities[i * 3 + 1] -= GRAVITY * dt;
        positions.setXYZ(
          i,
          positions.getX(i) + burst.velocities[i * 3] * dt,
          positions.getY(i) + burst.velocities[i * 3 + 1] * dt,
          positions.getZ(i) + burst.velocities[i * 3 + 2] * dt,
        );
      }
      positions.needsUpdate = true;
      burst.points.material.opacity = 1 - burst.age / burst.life;
    }
  }

  /**
   * Advances every effect by one frame.
   *
   * @param {number} dt Seconds since the previous frame.
   * @param {number} elapsed Total seconds since start.
   * @param {object} snapshot From museum.getSnapshot().
   */
  function update(dt, elapsed, snapshot) {
    updateDust(dt, elapsed);
    updateHalos(elapsed, snapshot);
    updateBursts(dt);
  }

  return { sparkle, celebrate, clearBursts, update };
}

// effects.js — efek visual (VFX).
//
//   1. Dust        — butiran debu yang melayang di aula (THREE.Points).
//   2. Halos       — cincin bercahaya di atas tiap pedestal; berdenyut, menyala lebih
//                    terang saat hover, dan menjadi emas setelah artefak diperiksa.
//   3. Sparkle     — ledakan partikel singkat saat artefak diperiksa untuk pertama kali.
//   4. Celebration — ledakan besar multiwarna saat pameran selesai.
//
// Semuanya memakai additive blending: warnanya DITAMBAHKAN ke apa yang ada di
// belakangnya, sehingga partikel yang bertumpuk makin terang, seperti cahaya sungguhan.

import * as THREE from "three";

const DUST_COUNT = 400;
const DUST_BOUNDS = { minX: -10, maxX: 10, minY: 0, maxY: 6, minZ: -7, maxZ: 5 };

const HALO_COLORS = { idle: new THREE.Color(0x5fa8ff), visited: new THREE.Color(0xffc94a) };

const GRAVITY = 3; // m/s² yang menarik partikel ledakan ke bawah

/**
 * Membuat material untuk partikel bercahaya.
 *
 * - AdditiveBlending: warna ditambahkan ke latar, sehingga tampak berpendar.
 * - depthWrite false: partikel tidak saling menutupi, jadi menyatu halus
 *   alih-alih menggambar kotak hitam jelek di tempat mereka bertumpuk.
 *
 * @param {object} parameters Opsi PointsMaterial tambahan (size, color, …).
 * @returns {THREE.PointsMaterial}
 */
function glowMaterial(parameters) {
  return new THREE.PointsMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true, // partikel yang lebih jauh tampak lebih kecil, seperti benda nyata
    ...parameters,
  });
}

/**
 * Mengembalikan bilangan acak antara min dan max.
 *
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function random(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Membuat debu: satu objek THREE.Points yang berisi DUST_COUNT partikel.
 * Setiap partikel hanyalah sebuah posisi di Float32Array; GPU menggambar
 * masing-masing sebagai sprite persegi kecil. Satu draw call untuk 400 partikel.
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
    speeds[i] = random(0.05, 0.2); // meter per detik, ke atas
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const points = new THREE.Points(geometry, glowMaterial({ size: 0.035, color: 0xffe2b0, opacity: 0.55 }));
  return { points, speeds };
}

/**
 * Membuat cincin bercahaya yang terbaring di atas pedestal. Ia adalah child dari
 * group exhibit, jadi otomatis berada di pedestal yang benar.
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
  // RingGeometry dibuat berdiri tegak; -90° pada sumbu X membaringkannya di atas pedestal.
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 1.005; // sedikit di atas permukaan pedestal agar tidak berkedip (z-fighting)
  return halo;
}

/**
 * Membuat efek visual dan mengembalikan fungsi untuk memicu dan menganimasikannya.
 *
 * @param {THREE.Scene} scene
 * @param {object[]} exhibits Dari buildExhibits().
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

  /** Ledakan partikel yang masih hidup; masing-masing menghapus dirinya saat umurnya habis. */
  const bursts = [];

  /**
   * Memunculkan satu ledakan partikel yang melesat keluar, jatuh karena gravitasi, dan memudar.
   *
   * @param {THREE.Vector3} origin Posisi dunia tempat partikel mulai.
   * @param {object} options
   * @param {number} options.count   Jumlah partikel.
   * @param {number} options.speed   Kecepatan awal, m/s.
   * @param {number} options.life    Detik sampai ledakan memudar habis.
   * @param {number} options.size    Ukuran partikel.
   * @param {THREE.Color[]} options.palette Warna yang dipilih acak per partikel.
   */
  function spawnBurst(origin, { count, speed, life, size, palette }) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions.set([origin.x, origin.y, origin.z], i * 3);

      // Arah acak pada sebuah bola, condong ke atas supaya ledakannya "melompat".
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
   * Kilauan emas kecil di atas artefak, saat ia diperiksa untuk pertama kali.
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

  /** Ledakan besar multiwarna di tengah aula saat pameran selesai. */
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
   * Menghapus satu ledakan dari scene dan membebaskan memori GPU-nya.
   *
   * @param {{ points: THREE.Points }} burst
   */
  function removeBurst(burst) {
    scene.remove(burst.points);
    burst.points.geometry.dispose();
    burst.points.material.dispose();
  }

  /** Menghapus semua ledakan seketika (dipakai saat kunjungan di-reset). */
  function clearBursts() {
    for (const burst of bursts) removeBurst(burst);
    bursts.length = 0;
  }

  /**
   * Menggerakkan debu ke atas dan memutarnya kembali ke lantai saat mencapai atap.
   *
   * @param {number} dt Detik sejak frame sebelumnya.
   * @param {number} elapsed Total detik, dipakai untuk ayunan halus ke samping.
   */
  function updateDust(dt, elapsed) {
    const positions = dust.points.geometry.attributes.position;
    for (let i = 0; i < DUST_COUNT; i++) {
      let y = positions.getY(i) + dust.speeds[i] * dt;
      if (y > DUST_BOUNDS.maxY) y = DUST_BOUNDS.minY;
      positions.setY(i, y);
      positions.setX(i, positions.getX(i) + Math.sin(elapsed * 0.5 + i) * 0.02 * dt);
    }
    // Memberi tahu three.js bahwa array berubah, sehingga ia mengunggahnya ulang ke buffer GPU.
    positions.needsUpdate = true;
  }

  /**
   * Mendenyutkan tiap halo dan mengatur warna serta kecerahannya dari state kunjungan:
   * emas setelah dikunjungi, biru bila belum, dan lebih terang saat di-hover.
   *
   * @param {number} elapsed Total detik.
   * @param {{ hovered: object|null, visited: Set<number> }} snapshot Dari museum.getSnapshot().
   */
  function updateHalos(elapsed, snapshot) {
    halos.forEach((halo, index) => {
      const visited = snapshot.visited.has(index);
      const hovered = snapshot.hovered?.index === index;

      halo.material.color.copy(visited ? HALO_COLORS.visited : HALO_COLORS.idle);
      // Gelombang sinus antara 0 dan 1, digeser per halo supaya tidak berdenyut serempak.
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.4 + index);
      halo.material.opacity = (hovered ? 0.75 : 0.3) + pulse * 0.25;
    });
  }

  /**
   * Menggerakkan setiap partikel ledakan yang hidup (kecepatan + gravitasi) dan memudarkannya.
   *
   * @param {number} dt Detik sejak frame sebelumnya.
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
   * Memajukan setiap efek sebanyak satu frame.
   *
   * @param {number} dt Detik sejak frame sebelumnya.
   * @param {number} elapsed Total detik sejak start.
   * @param {object} snapshot Dari museum.getSnapshot().
   */
  function update(dt, elapsed, snapshot) {
    updateDust(dt, elapsed);
    updateHalos(elapsed, snapshot);
    updateBursts(dt);
  }

  return { sparkle, celebrate, clearBursts, update };
}

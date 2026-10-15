import * as THREE from 'three/webgpu';
import { createRng } from './textures';

export interface SnowAndWaterSystem {
  group: THREE.Group;
  addShakeImpulse: (vx: number, vy: number, vz: number, intensity: number) => void;
  update: (dt: number, elapsed: number, globeTiltX?: number, globeTiltZ?: number) => void;
  getSnowCoverFactor: () => number;
  getSwirlEnergy: () => number;
  getSloshAngles: () => [number, number];
  setDeterministicShakeState: (
    mode: 'calm' | 'shake_start' | 'shake_peak' | 'shake_settling',
    globeTiltX?: number,
    globeTiltZ?: number
  ) => void;
}

/**
 * Generates a delicate, rim-only meniscus hairline texture for the top water-to-air boundary
 * (zero central fill and zero bright blob so it never creates a white patch in top-down or hero views!).
 */
function createAirPocketMeniscusTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const cx = size * 0.5;
  const cy = size * 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = (x - cx) / (size * 0.5);
      const dy = (y - cy) / (size * 0.5);
      const r = Math.hypot(dx * 1.03, dy * 0.97);
      const ang = Math.atan2(dy, dx);

      // Subtle hairline meniscus ring only at r = 0.82 (zero interior fill!)
      const rimThickness = 0.045 + 0.015 * Math.cos(ang + 0.8);
      const rim = Math.exp(-Math.pow((r - 0.82) / rimThickness, 2.0)) * (0.28 + 0.14 * Math.cos(ang + 2.2));

      const alpha = Math.min(0.38, rim);
      img.data[idx] = 240;
      img.data[idx + 1] = 248;
      img.data[idx + 2] = 255;
      img.data[idx + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Simulates the viscous water-glycerin fluid & 3D turbulent snow inside the snow globe:
 * - Full-volume 3D turbulent snow distribution (`4,500` 3D octahedron crystals) with zero central clumping:
 *   flakes spread from the street canyons (`y = 0.04`) all the way to the top dome (`y = 1.94`) and outer glass walls.
 * - 6 to 8 second slow, graceful post-shake settling time (`swirlEnergy` decay tau ~ 3.3s, terminal velocity ~ 0.22 units/s)
 *   as flakes drift down and pile lightly onto rooftops and trees.
 * - Continuous, light, steady snowfall in the calm/idle state (`15%` of flakes = `675` snowflakes gently drifting
 *   from top to bottom throughout the full 3D sphere so `01`–`06` never look empty).
 */
export function createSnowAndWaterSystem(innerRadius = 1.67): SnowAndWaterSystem {
  const group = new THREE.Group();
  const rng = createRng(9001);

  const FLAKE_COUNT = 4500;
  const CALM_ACTIVE_FRACTION = 0.15; // 675 flakes gently falling across the full globe in idle/calm state!
  const BUBBLE_COUNT = 65;
  const SPHERE_CENTER_LOCAL_Y = 0.624; // Exact center of the glass sphere in cityMount coordinates

  // 3D Octahedron crystal geometry with per-instance warm golden-amber & champagne-sparkle color!
  const flakeGeo = new THREE.OctahedronGeometry(1.0, 0);
  const flakeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
  });

  const flakeMesh = new THREE.InstancedMesh(flakeGeo, flakeMat, FLAKE_COUNT);
  flakeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const flakeColorArr = new Float32Array(FLAKE_COUNT * 3);
  for (let i = 0; i < FLAKE_COUNT; i++) {
    flakeColorArr[i * 3] = 1.0;
    flakeColorArr[i * 3 + 1] = 0.92;
    flakeColorArr[i * 3 + 2] = 0.78;
  }
  flakeMesh.instanceColor = new THREE.InstancedBufferAttribute(flakeColorArr, 3);
  flakeMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  flakeMesh.castShadow = false;
  flakeMesh.receiveShadow = false;
  group.add(flakeMesh);

  // Tiny liquid micro-bubbles
  const bubbleGeo = new THREE.SphereGeometry(1.0, 8, 8);
  const bubbleMat = new THREE.MeshBasicMaterial({
    color: 0xf4faff,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });
  const bubbleMesh = new THREE.InstancedMesh(bubbleGeo, bubbleMat, BUBBLE_COUNT);
  bubbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(bubbleMesh);

  // Subtle Buoyancy-Stabilized Top Water Meniscus Line
  const meniscusPivot = new THREE.Group();
  meniscusPivot.position.set(0, SPHERE_CENTER_LOCAL_Y, 0);

  const airBubbleRadius = 0.28;
  const airBubbleY = 1.32; // Relative to SPHERE_CENTER_LOCAL_Y (world local y = 1.944 near apex)

  const meniscusCapGeo = new THREE.SphereGeometry(airBubbleRadius, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.35);
  meniscusCapGeo.scale(1.0, 0.18, 1.0);
  const meniscusTex = createAirPocketMeniscusTexture();
  const mPos = meniscusCapGeo.attributes.position;
  const mUv = meniscusCapGeo.attributes.uv;
  for (let i = 0; i < mPos.count; i++) {
    const ux = (mPos.getX(i) / airBubbleRadius) * 0.5 + 0.5;
    const uz = (mPos.getZ(i) / airBubbleRadius) * 0.5 + 0.5;
    mUv.setXY(i, ux, uz);
  }
  mUv.needsUpdate = true;

  const meniscusCapMat = new THREE.MeshBasicMaterial({
    map: meniscusTex,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const meniscusCapMesh = new THREE.Mesh(meniscusCapGeo, meniscusCapMat);
  meniscusCapMesh.position.y = airBubbleY;
  meniscusCapMesh.visible = false; // Keep upper dome 100% free of any internal disc/blob reflection
  meniscusPivot.add(meniscusCapMesh);
  group.add(meniscusPivot);

  // Per-flake state arrays
  const px = new Float32Array(FLAKE_COUNT);
  const py = new Float32Array(FLAKE_COUNT);
  const pz = new Float32Array(FLAKE_COUNT);
  const vx = new Float32Array(FLAKE_COUNT);
  const vy = new Float32Array(FLAKE_COUNT);
  const vz = new Float32Array(FLAKE_COUNT);
  const ry = new Float32Array(FLAKE_COUNT);
  const ωy = new Float32Array(FLAKE_COUNT);
  const baseSize = new Float32Array(FLAKE_COUNT);
  const fallSpeed = new Float32Array(FLAKE_COUNT);
  const phase = new Float32Array(FLAKE_COUNT);
  const turbFreq = new Float32Array(FLAKE_COUNT);
  const activeInCalm = new Uint8Array(FLAKE_COUNT);

  const sampleMaxHeightAt = (x: number, z: number): number => {
    const rHorizSq = x * x + z * z;
    const maxWaterR = innerRadius - 0.04;
    if (rHorizSq >= maxWaterR * maxWaterR) return SPHERE_CENTER_LOCAL_Y;
    return SPHERE_CENTER_LOCAL_Y + Math.sqrt(maxWaterR * maxWaterR - rHorizSq) - 0.04;
  };

  for (let i = 0; i < FLAKE_COUNT; i++) {
    activeInCalm[i] = i < FLAKE_COUNT * CALM_ACTIVE_FRACTION ? 1 : 0;
    ry[i] = rng() * Math.PI * 2;
    ωy[i] = (rng() - 0.5) * 5.2;

    // Flocculent snow-globe crystal size: 3px to 6px in hero view (0.0052 to 0.0092 units)
    const roll = rng();
    baseSize[i] = roll < 0.72 ? 0.0052 + rng() * 0.0022 : 0.0074 + rng() * 0.0018;

    // Individualized slow terminal settling velocity (0.16 to 0.27 units/s -> 6 to 8 seconds to settle from top dome!)
    fallSpeed[i] = 0.16 + rng() * 0.11;
    phase[i] = rng() * Math.PI * 2;
    turbFreq[i] = 1.4 + rng() * 1.8;
  }

  /**
   * Distributes snow particles organically throughout the ENTIRE 3D spherical water volume
   * without any central clumping or rigid band rings.
   * Uses 3D turbulent curl-like displacement and outward-weighted radial sampling so flakes fill
   * the upper dome, outer left/right glass curvature, and street canyons evenly!
   */
  const distributeVolume = (
    seed: number,
    activeFraction: number,
    minHeightFrac: number,
    maxHeightFrac: number,
    radialOuterSpread: number,
    turbulenceStrength: number
  ) => {
    const dRng = createRng(seed);
    const maxSphereR = innerRadius - 0.055; // 1.365 in cityMount coords
    const minY = 0.04;
    const maxY = SPHERE_CENTER_LOCAL_Y + maxSphereR * 0.96; // 1.934 right up to the top dome!

    for (let i = 0; i < FLAKE_COUNT; i++) {
      const isActive = i < FLAKE_COUNT * activeFraction;
      if (!isActive) {
        px[i] = 0;
        py[i] = -10.0;
        pz[i] = 0;
        vx[i] = 0;
        vy[i] = 0;
        vz[i] = 0;
        continue;
      }

      // Sample 3D position with quasi-random stratified golden-ratio + RNG jitter so there are ZERO clumps or empty pockets!
      const stratH = (i * 0.61803398875 + dRng() * 0.18) % 1.0;
      const hFrac = minHeightFrac + stratH * (maxHeightFrac - minHeightFrac);
      let y = minY + hFrac * (maxY - minY);

      const dySphere = y - SPHERE_CENTER_LOCAL_Y;
      const maxHorizAtY = Math.sqrt(Math.max(0.02, maxSphereR * maxSphereR - dySphere * dySphere));

      // Outward-balanced radial distribution (`pow(u, radialOuterSpread)` with `radialOuterSpread ~ 0.42`)
      // prevents projection clumping along the central Empire State Building shaft and fills the full width of the globe!
      const uRad = (i * 0.38196601125 + dRng() * 0.22) % 1.0;
      const radFrac = 0.06 + 0.91 * Math.pow(uRad, radialOuterSpread);
      const rHoriz = radFrac * maxHorizAtY;

      // Fully randomized azimuth + 3D turbulent eddy offset (no banded spiral rings!)
      const angle = dRng() * Math.PI * 2;
      let x = Math.cos(angle) * rHoriz;
      let z = Math.sin(angle) * rHoriz;

      // Add 3D multi-frequency turbulent eddy displacement
      const eddyX = Math.sin(y * 5.2 + z * 4.1 + phase[i]) * 0.065 * turbulenceStrength;
      const eddyY = Math.cos(x * 4.8 + z * 5.0 + phase[i] * 1.3) * 0.055 * turbulenceStrength;
      const eddyZ = Math.sin(x * 5.5 - y * 4.6 + phase[i] * 0.7) * 0.065 * turbulenceStrength;

      x += eddyX;
      y = Math.max(minY, Math.min(maxY, y + eddyY));
      z += eddyZ;

      // Enforce strict spherical containment inside the inner glass wall
      const dyFinal = y - SPHERE_CENTER_LOCAL_Y;
      const distSq = x * x + dyFinal * dyFinal + z * z;
      if (distSq > maxSphereR * maxSphereR * 0.96) {
        const sc = (maxSphereR * 0.97) / Math.sqrt(distSq);
        x *= sc;
        y = SPHERE_CENTER_LOCAL_Y + dyFinal * sc;
        z *= sc;
      }

      px[i] = x;
      py[i] = y;
      pz[i] = z;

      // 3D turbulent velocity field: gentle vortex + independent 3D chaotic eddy velocities per flake
      const tangSpeed = (0.18 + turbulenceStrength * 0.55) * (0.3 + rHoriz);
      vx[i] = -Math.sin(angle) * tangSpeed + (dRng() - 0.5) * (0.22 + turbulenceStrength * 0.45);
      vy[i] = -fallSpeed[i] + (dRng() - 0.45) * turbulenceStrength * 0.38;
      vz[i] = Math.cos(angle) * tangSpeed + (dRng() - 0.5) * (0.22 + turbulenceStrength * 0.45);
    }
  };

  // Bubble state
  const bx = new Float32Array(BUBBLE_COUNT);
  const by = new Float32Array(BUBBLE_COUNT);
  const bz = new Float32Array(BUBBLE_COUNT);
  const bSize = new Float32Array(BUBBLE_COUNT);
  for (let i = 0; i < BUBBLE_COUNT; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = 0.18 + rng() * 0.75;
    bx[i] = Math.cos(ang) * rad;
    bz[i] = Math.sin(ang) * rad;
    by[i] = 0.08 + rng() * 1.15;
    bSize[i] = 0.0038 + rng() * 0.0045;
  }

  let swirlEnergy = 0.0;
  let waterOmegaY = 0.18;
  let waterVelX = 0.0;
  let waterVelY = 0.0;
  let waterVelZ = 0.0;
  let snowCoverFactor = 1.0;

  let sloshX = 0.0;
  let sloshZ = 0.0;
  let sloshVelX = 0.0;
  let sloshVelZ = 0.0;

  // Initial calm state: 15% of flakes (675 snowflakes) falling gently throughout the entire globe volume (0.04..0.95)
  distributeVolume(9001, CALM_ACTIVE_FRACTION, 0.04, 0.95, 0.44, 0.25);

  const addShakeImpulse = (impVx: number, impVy: number, impVz: number, intensity: number) => {
    const clamped = Math.min(1.5, Math.max(0, intensity));
    swirlEnergy = Math.min(1.0, swirlEnergy + clamped * 0.65);

    waterOmegaY = THREE.MathUtils.clamp(waterOmegaY + (impVx - impVz * 0.6) * 2.2 + clamped * 1.6, -5.5, 5.5);
    waterVelX = THREE.MathUtils.clamp(waterVelX + impVx * 1.2, -2.5, 2.5);
    waterVelY = THREE.MathUtils.clamp(waterVelY + impVy * 0.8, -1.8, 1.8);
    waterVelZ = THREE.MathUtils.clamp(waterVelZ + impVz * 1.2, -2.5, 2.5);

    sloshVelX += impVz * 2.4;
    sloshVelZ -= impVx * 2.4;

    snowCoverFactor = Math.max(0.55, snowCoverFactor - clamped * 0.20);

    const maxSphereR = innerRadius - 0.055;
    const minY = 0.04;
    const maxY = SPHERE_CENTER_LOCAL_Y + maxSphereR * 0.95;
    const targetActive = Math.floor(FLAKE_COUNT * Math.min(1.0, CALM_ACTIVE_FRACTION + swirlEnergy * (1.0 - CALM_ACTIVE_FRACTION)));

    for (let i = 0; i < targetActive; i++) {
      if (py[i] < -1.0) {
        // Spawn throughout the entire 3D sphere volume so vigorous shakes immediately fill the whole globe without clumping
        const hFrac = (i * 0.61803398875 + (phase[i] % 0.25)) % 1.0;
        const y = minY + hFrac * (maxY - minY);
        const dySphere = y - SPHERE_CENTER_LOCAL_Y;
        const maxHorizAtY = Math.sqrt(Math.max(0.02, maxSphereR * maxSphereR - dySphere * dySphere));
        const ang = phase[i] * 7.13 + i * 2.39996;
        const rad = (0.08 + 0.88 * Math.pow((i * 0.381966) % 1.0, 0.42)) * maxHorizAtY;
        px[i] = Math.cos(ang) * rad;
        py[i] = y;
        pz[i] = Math.sin(ang) * rad;
      }
      // Chaotic 3D turbulent velocity impulse per flake (prevents flakes from moving as a single clump)
      const radialAngle = Math.atan2(pz[i], px[i]) + 1.35 + Math.sin(phase[i] * 3.0) * 0.6;
      const burst = (0.32 + (phase[i] % 1.0) * 0.65) * clamped;
      vx[i] += Math.cos(radialAngle) * burst + impVx * 0.45 + Math.sin(i * 1.7) * 0.25 * clamped;
      vy[i] += (Math.sin(phase[i] * 4.3 + i) * 0.5 + 0.15) * burst * 0.95;
      vz[i] += Math.sin(radialAngle) * burst + impVz * 0.45 + Math.cos(i * 2.3) * 0.25 * clamped;
    }
  };

  const update = (dt: number, elapsed: number, globeTiltX = 0, globeTiltZ = 0) => {
    const safeDt = Math.min(dt, 0.05);

    // 1. Update water slosh & counter-rotate air bubble against globeTilt
    const kSlosh = 28.0;
    const dSlosh = 3.2;
    sloshVelX += (-kSlosh * sloshX - dSlosh * sloshVelX) * safeDt;
    sloshVelZ += (-kSlosh * sloshZ - dSlosh * sloshVelZ) * safeDt;
    sloshX = THREE.MathUtils.clamp(sloshX + sloshVelX * safeDt, -0.18, 0.18);
    sloshZ = THREE.MathUtils.clamp(sloshZ + sloshVelZ * safeDt, -0.18, 0.18);

    meniscusPivot.rotation.x = -globeTiltX + sloshX * 0.35;
    meniscusPivot.rotation.z = -globeTiltZ + sloshZ * 0.35;
    const sloshMag = Math.hypot(globeTiltX, globeTiltZ) + Math.hypot(sloshX, sloshZ);
    meniscusCapMesh.scale.set(1.0 + sloshMag * 0.45, 1.0, 1.0 - sloshMag * 0.22);

    // 2. Slow, graceful 6 to 8 second viscous decay of water vortex & turbulence after a shake!
    // tau = 1 / 0.30 = 3.33s -> 2 * tau = 6.7s to 8.0s full settling window!
    waterOmegaY = THREE.MathUtils.lerp(waterOmegaY, 0.18, safeDt * 0.28);
    waterVelX *= Math.exp(-1.2 * safeDt);
    waterVelY *= Math.exp(-1.5 * safeDt);
    waterVelZ *= Math.exp(-1.2 * safeDt);
    swirlEnergy *= Math.exp(-0.30 * safeDt);

    // Smoothly pile snow back onto rooftops and trees over the 6-8 second settling window
    if (swirlEnergy < 0.65) {
      snowCoverFactor = Math.min(1.0, snowCoverFactor + safeDt * 0.065 * (1.0 - swirlEnergy * 0.5));
    }

    const maxR = innerRadius - 0.055;
    const maxRSq = maxR * maxR;
    const drag = Math.exp(-2.4 * safeDt);
    const fArr = flakeMesh.instanceMatrix.array as Float32Array;
    const tumbleRate = 0.60 + swirlEnergy * 2.1;
    const sizeMult = 1.0 + swirlEnergy * 0.28;
    const stretchZ = 1.0 + swirlEnergy * 0.32;

    for (let i = 0; i < FLAKE_COUNT; i++) {
      const mOff = i * 16;
      let y = py[i];

      if (y < -1.0) {
        fArr[mOff] = 0.00001;
        fArr[mOff + 1] = 0;
        fArr[mOff + 2] = 0;
        fArr[mOff + 3] = 0;
        fArr[mOff + 4] = 0;
        fArr[mOff + 5] = 0.00001;
        fArr[mOff + 6] = 0;
        fArr[mOff + 7] = 0;
        fArr[mOff + 8] = 0;
        fArr[mOff + 9] = 0;
        fArr[mOff + 10] = 0.00001;
        fArr[mOff + 11] = 0;
        fArr[mOff + 12] = 0;
        fArr[mOff + 13] = -10;
        fArr[mOff + 14] = 0;
        fArr[mOff + 15] = 1;
        continue;
      }

      let x = px[i];
      let z = pz[i];
      const ph = phase[i];
      const tf = turbFreq[i];
      const isDrifter = activeInCalm[i] === 1;

      const vortexVx = -z * waterOmegaY;
      const vortexVz = x * waterOmegaY;

      // 3D multi-frequency turbulent curl drift (breaks up any uniform ring or clump)
      const flutterAmp = 0.085 + swirlEnergy * 0.34;
      const turbX =
        (Math.sin(elapsed * tf + ph + y * 4.2) + 0.5 * Math.cos(elapsed * 1.3 + z * 5.8 + ph)) * flutterAmp;
      const turbZ =
        (Math.cos(elapsed * (tf * 0.92) + ph * 1.7 + x * 4.2) + 0.5 * Math.sin(elapsed * 1.5 + y * 5.4)) *
        flutterAmp;
      const turbY =
        Math.sin(elapsed * (tf * 1.1) + ph * 2.3 + (x - z) * 3.8) * (0.04 + swirlEnergy * 0.22);

      // Slow, graceful settling speed (takes ~6 to 8 seconds to travel the 1.85-unit height of the globe)
      const terminalVy = -fallSpeed[i] * (1.0 - swirlEnergy * 0.35);

      vx[i] = vx[i] * drag + (vortexVx * 0.42 + waterVelX * 0.35 + turbX) * (1 - drag);
      vy[i] = vy[i] * drag + (terminalVy + waterVelY * 0.30 + turbY) * (1 - drag);
      vz[i] = vz[i] * drag + (vortexVz * 0.42 + waterVelZ * 0.35 + turbZ) * (1 - drag);

      x += vx[i] * safeDt;
      y += vy[i] * safeDt;
      z += vz[i] * safeDt;

      // Strict spherical containment around SPHERE_CENTER_LOCAL_Y (0.624)
      const dySphere = y - SPHERE_CENTER_LOCAL_Y;
      const distSq = x * x + dySphere * dySphere + z * z;
      if (distSq > maxRSq) {
        const dist = Math.sqrt(distSq);
        const nx = x / dist;
        const ny = dySphere / dist;
        const nz = z / dist;
        x = nx * (maxR - 0.02);
        y = SPHERE_CENTER_LOCAL_Y + ny * (maxR - 0.02);
        z = nz * (maxR - 0.02);
        // Slide tangentially along the curved inner glass wall rather than clumping
        vx[i] = -nx * 0.12 + vortexVx * 0.45;
        vy[i] = -Math.abs(vy[i]) * 0.4 - 0.06;
        vz[i] = -nz * 0.12 + vortexVz * 0.45;
      }

      if (y <= 0.038) {
        if (isDrifter || swirlEnergy > 0.30) {
          // Recycle into the upper hemisphere so snowfall continues smoothly from top to bottom!
          const hFrac = swirlEnergy > 0.30 ? 0.25 + ((ph * 3.7 + elapsed * 0.1) % 0.70) : 0.68 + ((ph * 2.3) % 0.27);
          y = 0.04 + hFrac * (SPHERE_CENTER_LOCAL_Y + maxR * 0.95 - 0.04);
          const dyNew = y - SPHERE_CENTER_LOCAL_Y;
          const maxHorizNew = Math.sqrt(Math.max(0.02, maxRSq - dyNew * dyNew));
          const newAng = ph + elapsed * 0.65 + i * 2.39996;
          const newRad = (0.08 + 0.88 * Math.pow(((i * 0.6180339 + elapsed * 0.04) % 1.0), 0.44)) * maxHorizNew;
          x = Math.cos(newAng) * newRad;
          z = Math.sin(newAng) * newRad;
          vy[i] = -fallSpeed[i];
        } else {
          // Non-idle flake has settled onto the city rooftops/streets!
          y = -10.0;
        }
      }

      const angY = ry[i] + ωy[i] * safeDt * tumbleRate;
      ry[i] = angY;

      px[i] = x;
      py[i] = y;
      pz[i] = z;

      if (y < -1.0) {
        fArr[mOff] = 0.00001;
        fArr[mOff + 5] = 0.00001;
        fArr[mOff + 10] = 0.00001;
        fArr[mOff + 12] = 0;
        fArr[mOff + 13] = -10;
        fArr[mOff + 14] = 0;
        fArr[mOff + 15] = 1;
      } else {
        // Per-flake 3D orientation sparkle glint as crystal facets tumble and catch the warm golden city light!
        const glint = Math.pow(0.5 + 0.5 * Math.sin(angY * 2.0 + ph * 1.9), 5.0);
        const s = baseSize[i] * sizeMult * (1.0 + glint * 0.42);
        const sx = s * (1.05 + glint * 0.35);
        const sy = s * 0.62;
        const sz = s * stretchZ;

        const cY = Math.cos(angY);
        const sY = Math.sin(angY);
        const angX = ph + angY * 0.65;
        const cX = Math.cos(angX);
        const sX = Math.sin(angX);

        // Full 3D pitch + yaw rotation matrix so octahedron facets tumble in 3D
        fArr[mOff] = cY * sx;
        fArr[mOff + 1] = sY * sX * sx;
        fArr[mOff + 2] = -sY * cX * sx;
        fArr[mOff + 3] = 0;
        fArr[mOff + 4] = 0;
        fArr[mOff + 5] = cX * sy;
        fArr[mOff + 6] = sX * sy;
        fArr[mOff + 7] = 0;
        fArr[mOff + 8] = sY * sz;
        fArr[mOff + 9] = -cY * sX * sz;
        fArr[mOff + 10] = cY * cX * sz;
        fArr[mOff + 11] = 0;
        fArr[mOff + 12] = x;
        fArr[mOff + 13] = y;
        fArr[mOff + 14] = z;
        fArr[mOff + 15] = 1;

        // Warm golden-amber city glow on non-glinting flakes + bright warm golden-champagne sparkle on glinting flakes!
        const cityProx = Math.max(0, 1.0 - y * 0.42);
        const cIdx = i * 3;
        flakeColorArr[cIdx] = 0.88 + cityProx * 0.08 + glint * 0.55;
        flakeColorArr[cIdx + 1] = 0.68 + cityProx * 0.06 + glint * 0.58;
        flakeColorArr[cIdx + 2] = 0.38 + (1.0 - cityProx) * 0.14 + glint * 0.56;
      }
    }
    flakeMesh.instanceMatrix.needsUpdate = true;
    if (flakeMesh.instanceColor) {
      flakeMesh.instanceColor.needsUpdate = true;
    }

    // 3. Update micro-bubbles in liquid
    const bubbleScaleVis = THREE.MathUtils.smoothstep(swirlEnergy, 0.04, 0.35);
    const bArr = bubbleMesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const mOff = i * 16;
      if (bubbleScaleVis <= 0.001) {
        bArr[mOff] = 0.00001;
        bArr[mOff + 5] = 0.00001;
        bArr[mOff + 10] = 0.00001;
        bArr[mOff + 12] = 0;
        bArr[mOff + 13] = -10;
        bArr[mOff + 14] = 0;
        bArr[mOff + 15] = 1;
      } else {
        const ang = Math.atan2(bz[i], bx[i]) + waterOmegaY * 0.55 * safeDt;
        const maxBubY = sampleMaxHeightAt(bx[i], bz[i]);
        by[i] += (0.26 + (i % 5) * 0.04) * safeDt;
        if (by[i] > maxBubY) {
          by[i] = 0.06 + (i % 7) * 0.04;
        }
        const dyB = by[i] - SPHERE_CENTER_LOCAL_Y;
        const maxRadB = Math.sqrt(Math.max(0.02, maxRSq - dyB * dyB)) * 0.88;
        const rad = Math.min(maxRadB, Math.hypot(bx[i], bz[i]));
        bx[i] = Math.cos(ang) * rad;
        bz[i] = Math.sin(ang) * rad;

        const bs = bSize[i] * bubbleScaleVis;
        bArr[mOff] = bs;
        bArr[mOff + 1] = 0;
        bArr[mOff + 2] = 0;
        bArr[mOff + 3] = 0;
        bArr[mOff + 4] = 0;
        bArr[mOff + 5] = bs;
        bArr[mOff + 6] = 0;
        bArr[mOff + 7] = 0;
        bArr[mOff + 8] = 0;
        bArr[mOff + 9] = 0;
        bArr[mOff + 10] = bs;
        bArr[mOff + 11] = 0;
        bArr[mOff + 12] = bx[i];
        bArr[mOff + 13] = by[i];
        bArr[mOff + 14] = bz[i];
        bArr[mOff + 15] = 1;
      }
    }
    bubbleMesh.instanceMatrix.needsUpdate = true;
  };

  const setDeterministicShakeState = (
    mode: 'calm' | 'shake_start' | 'shake_peak' | 'shake_settling',
    globeTiltX = 0,
    globeTiltZ = 0
  ) => {
    waterVelX = 0;
    waterVelY = 0;
    waterVelZ = 0;
    sloshVelX = 0;
    sloshVelZ = 0;

    if (mode === 'calm') {
      swirlEnergy = 0.0;
      waterOmegaY = 0.18;
      sloshX = 0.0;
      sloshZ = 0.0;
      snowCoverFactor = 1.0;
      // Light, steady snowfall (15% = 675 flakes) distributed evenly across the entire 3D water sphere (0.04..0.96)
      distributeVolume(9001, CALM_ACTIVE_FRACTION, 0.04, 0.96, 0.36, 0.25);
      update(1 / 60, 1.0, globeTiltX, globeTiltZ);
    } else if (mode === 'shake_start') {
      // Mid-shake Frame 1 (07): Vigorous impulse kicking 85% of flakes through the full 3D sphere with strong turbulence
      swirlEnergy = 0.86;
      waterOmegaY = 3.4;
      sloshX = 0.06;
      sloshZ = -0.08;
      snowCoverFactor = 0.68;
      distributeVolume(9102, 0.85, 0.03, 0.97, 0.34, 1.15);
      update(1 / 60, 2.0, globeTiltX, globeTiltZ);
    } else if (mode === 'shake_peak') {
      // Mid-shake Frame 2 (08): Peak full-volume blizzard! 100% of flakes spread throughout the entire 3D sphere (zero central clumping!)
      swirlEnergy = 1.0;
      waterOmegaY = -4.2;
      sloshX = -0.05;
      sloshZ = 0.07;
      snowCoverFactor = 0.58;
      distributeVolume(9203, 1.0, 0.03, 0.98, 0.32, 1.35);
      update(1 / 60, 3.0, globeTiltX, globeTiltZ);
    } else if (mode === 'shake_settling') {
      // Mid-shake Frame 3 (09): Graceful 6-8s settling phase (~4s after peak) with 65% of flakes drifting across the whole volume
      swirlEnergy = 0.45;
      waterOmegaY = -1.35;
      sloshX = 0.01;
      sloshZ = -0.015;
      snowCoverFactor = 0.90;
      distributeVolume(9304, 0.65, 0.03, 0.95, 0.35, 0.65);
      update(1 / 60, 5.0, globeTiltX, globeTiltZ);
    }
  };

  update(1 / 60, 0, 0, 0);

  return {
    group,
    addShakeImpulse,
    update,
    getSnowCoverFactor: () => snowCoverFactor,
    getSwirlEnergy: () => swirlEnergy,
    getSloshAngles: () => [sloshX, sloshZ],
    setDeterministicShakeState,
  };
}

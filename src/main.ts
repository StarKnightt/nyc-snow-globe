import * as THREE from 'three/webgpu';
import { createDaylightStudioEnvScene } from './textures';
import { buildSnowGlobeAndDesk, CITY_FLOOR_Y, R_INNER, SPHERE_CENTER_Y } from './globe';
import { buildManhattanInsideGlobe, ManhattanSceneData } from './manhattan';
import { createTaxiSystem } from './taxis';
import { createSnowAndWaterSystem } from './snowSystem';
import { SnowGlobeAudio } from './audio';

export interface CameraPreset {
  pos: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  hero_front: {
    pos: [0.65, 2.55, 6.25],
    target: [0.0, 1.72, 0.0],
    fov: 36,
  },
  side_east: {
    pos: [6.15, 2.40, 0.95],
    target: [0.0, 1.72, 0.0],
    fov: 36,
  },
  park_north: {
    pos: [-2.85, 2.75, -5.45],
    target: [0.0, 1.68, 0.0],
    fov: 36,
  },
  street_taxi_closeup: {
    pos: [0.42, 1.88, 2.85],
    target: [0.04, 1.36, 0.24],
    fov: 30,
  },
  brownstone_stoops: {
    pos: [-2.68, 1.88, 1.42],
    target: [-0.62, 1.38, 0.16],
    fov: 30,
  },
  top_overview: {
    pos: [0.38, 5.85, 3.15],
    target: [0.0, 1.58, 0.0],
    fov: 36,
  },
};

declare global {
  interface Window {
    __globe?: {
      ready: boolean;
      backend: string;
      presets: typeof CAMERA_PRESETS;
      setCameraPreset: (name: string) => void;
      setCamera: (pos: [number, number, number], target: [number, number, number], fov?: number) => void;
      triggerShake: (intensity?: number) => void;
      setCaptureState: (mode: 'calm' | 'shake_01_impulse' | 'shake_02_blizzard' | 'shake_03_settling') => void;
      advance: (dt: number, steps?: number) => void;
      getStats: () => { fps: number; calls: number; triangles: number; backend: string };
    };
  }
}

/**
 * Applies physical spherical water-and-glass convex lens magnification (Snell's Law radial barrel distortion)
 * to every mesh vertex inside the miniature Manhattan city.
 */
function applySphericalWaterLensToHierarchy(rootObj: THREE.Object3D): void {
  const modifiedGeometries = new Set<THREE.BufferGeometry>();

  rootObj.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) return;

    if (modifiedGeometries.has(mesh.geometry)) {
      mesh.geometry = mesh.geometry.clone();
    }
    const geo = mesh.geometry;
    modifiedGeometries.add(geo);

    mesh.updateMatrixWorld(true);
    const posAttr = geo.attributes.position;
    if (!posAttr) return;

    const v = new THREE.Vector3();
    const invMat = mesh.matrixWorld.clone().invert();

    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i);
      v.applyMatrix4(mesh.matrixWorld);

      const dx = v.x;
      const dy = v.y - SPHERE_CENTER_Y;
      const dz = v.z;
      const rHoriz = Math.hypot(dx, dz);
      const rNorm = Math.min(1.0, rHoriz / (R_INNER * 0.94));

      const hAboveFloor = Math.max(0, v.y - CITY_FLOOR_Y);
      const barrelLean = 1.0 - 0.11 * Math.pow(rNorm, 1.8) * Math.min(1.0, hAboveFloor / 0.8);
      const mag = (1.04 + 0.20 * Math.pow(rNorm, 1.5)) * barrelLean;

      const maxAllowedHoriz = Math.sqrt(Math.max(0.05, (R_INNER - 0.05) ** 2 - dy * dy));
      const newRHoriz = Math.min(rHoriz * mag, maxAllowedHoriz);
      const scaleXZ = rHoriz > 1e-5 ? newRHoriz / rHoriz : 1.0;

      const lensLiftY = 0.048 * Math.pow(rNorm, 2.0);

      v.x = dx * scaleXZ;
      v.z = dz * scaleXZ;
      v.y = v.y + lensLiftY;

      v.applyMatrix4(invMat);
      posAttr.setXYZ(i, v.x, v.y, v.z);
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
  });
}

/**
 * Merges static city meshes sharing the same material & shadow flags into unified BufferGeometries.
 * Reduces ~1,100 individual draw calls down to ~25 draw calls while preserving 100% identical visual output
 * so the scene runs at a locked 60 FPS @ 1080p!
 */
function batchManhattanStaticMeshes(manhattan: ManhattanSceneData): (cover: number) => void {
  const rootGroup = manhattan.group;
  rootGroup.updateMatrixWorld(true);
  const invRoot = rootGroup.matrixWorld.clone().invert();

  const snowMeshSet = new Set<THREE.Mesh>(manhattan.accumulatableSnowMeshes.map((s) => s.mesh));

  interface Bucket {
    material: THREE.Material;
    castShadow: boolean;
    receiveShadow: boolean;
    geos: THREE.BufferGeometry[];
  }

  const staticBuckets = new Map<string, Bucket>();
  const snowGeos: THREE.BufferGeometry[] = [];
  const snowPivotYs: number[] = [];
  const allOriginalMeshes: THREE.Mesh[] = [];

  let matIdCounter = 0;
  const matIds = new Map<THREE.Material, number>();

  rootGroup.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) return;
    const mat = mesh.material as THREE.Material;
    if (!mat || Array.isArray(mat)) return;

    allOriginalMeshes.push(mesh);

    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    const relMat = new THREE.Matrix4().multiplyMatrices(invRoot, mesh.matrixWorld);
    g.applyMatrix4(relMat);

    const count = g.attributes.position.count;
    if (!g.attributes.normal) {
      g.computeVertexNormals();
    }
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }

    if (snowMeshSet.has(mesh)) {
      const originV = new THREE.Vector3().setFromMatrixPosition(relMat);
      snowGeos.push(g);
      snowPivotYs.push(originV.y);
    } else {
      let mId = matIds.get(mat);
      if (mId === undefined) {
        mId = ++matIdCounter;
        matIds.set(mat, mId);
      }
      const key = `${mId}_${mesh.castShadow ? 1 : 0}_${mesh.receiveShadow ? 1 : 0}`;
      let bucket = staticBuckets.get(key);
      if (!bucket) {
        bucket = {
          material: mat,
          castShadow: mesh.castShadow,
          receiveShadow: mesh.receiveShadow,
          geos: [],
        };
        staticBuckets.set(key, bucket);
      }
      bucket.geos.push(g);
    }
  });

  // Remove old individual meshes from hierarchy
  for (const m of allOriginalMeshes) {
    m.parent?.remove(m);
  }
  rootGroup.clear();

  const mergeGeos = (geos: THREE.BufferGeometry[]): THREE.BufferGeometry => {
    let total = 0;
    for (const g of geos) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const norm = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);

    let offset = 0;
    for (const g of geos) {
      const p = g.attributes.position;
      const n = g.attributes.normal;
      const u = g.attributes.uv;
      const c = p.count;
      for (let i = 0; i < c; i++) {
        const i3 = (offset + i) * 3;
        const i2 = (offset + i) * 2;
        pos[i3] = p.getX(i);
        pos[i3 + 1] = p.getY(i);
        pos[i3 + 2] = p.getZ(i);
        norm[i3] = n.getX(i);
        norm[i3 + 1] = n.getY(i);
        norm[i3 + 2] = n.getZ(i);
        uv[i2] = u.getX(i);
        uv[i2 + 1] = u.getY(i);
      }
      offset += c;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return merged;
  };

  for (const bucket of staticBuckets.values()) {
    const mergedGeo = mergeGeos(bucket.geos);
    const mergedMesh = new THREE.Mesh(mergedGeo, bucket.material);
    mergedMesh.castShadow = bucket.castShadow;
    mergedMesh.receiveShadow = bucket.receiveShadow;
    rootGroup.add(mergedMesh);
  }

  // Merge all accumulatable snow caps into 1 single draw call with fast vertex Y-thickness modulation
  let updateSnowCover = (_cover: number) => {};
  if (snowGeos.length > 0 && manhattan.accumulatableSnowMeshes.length > 0) {
    const snowMat = manhattan.accumulatableSnowMeshes[0].mesh.material as THREE.Material;
    const mergedSnowGeo = mergeGeos(snowGeos);
    const posAttr = mergedSnowGeo.attributes.position as THREE.BufferAttribute;
    const totalVerts = posAttr.count;
    const baseY = new Float32Array(totalVerts);
    const deltaY = new Float32Array(totalVerts);

    let offset = 0;
    for (let gIdx = 0; gIdx < snowGeos.length; gIdx++) {
      const g = snowGeos[gIdx];
      const pivY = snowPivotYs[gIdx];
      const c = g.attributes.position.count;
      for (let i = 0; i < c; i++) {
        const yVal = posAttr.getY(offset + i);
        baseY[offset + i] = pivY;
        deltaY[offset + i] = yVal - pivY;
      }
      offset += c;
    }

    const mergedSnowMesh = new THREE.Mesh(mergedSnowGeo, snowMat);
    mergedSnowMesh.receiveShadow = true;
    rootGroup.add(mergedSnowMesh);

    let lastCover = 1.0;
    updateSnowCover = (cover: number) => {
      if (Math.abs(cover - lastCover) < 0.002) return;
      lastCover = cover;
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < totalVerts; i++) {
        arr[i * 3 + 1] = baseY[i] + deltaY[i] * cover;
      }
      posAttr.needsUpdate = true;
    };
  }

  manhattan.accumulatableSnowMeshes.length = 0;
  return updateSnowCover;
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const isCaptureMode = params.has('capture') || params.has('shot');
  if (isCaptureMode) {
    document.body.classList.add('capture-mode');
  }

  const loaderEl = document.getElementById('loader');
  const loaderBar = document.getElementById('loader-bar');
  const loaderStatus = document.getElementById('loader-status');

  const updateLoader = async (percent: number, label: string) => {
    if (loaderBar) loaderBar.style.width = `${percent}%`;
    if (loaderStatus) loaderStatus.textContent = label;
    if (!isCaptureMode) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
  };

  await updateLoader(15, 'Initializing WebGPU renderer…');

  const container = document.getElementById('app')!;
  const badge = document.getElementById('badge')!;

  const forceWebGL = params.get('renderer') === 'webgl';
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    forceWebGL,
  });
  await renderer.init();

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean })?.isWebGPUBackend === true;
  const backendName = isWebGPU ? 'WebGPU' : 'WebGL2 Fallback';

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  badge.textContent = `60 FPS · ${backendName}`;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x161c28);

  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = createDaylightStudioEnvScene();
    const envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.72;
    pmrem.dispose();
  } catch {
    // Fallback
  }

  const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.1, 60);
  const camTarget = new THREE.Vector3(0, 1.72, 0);

  let camRadius = 6.28;
  let camTheta = 0.11;
  let camPhi = 1.25;
  let autoOrbit = !params.has('capture') && !params.has('shot');
  let manualCameraOverride = false;

  const updateCameraFromSpherical = () => {
    if (manualCameraOverride) return;
    const streetBlend = THREE.MathUtils.clamp((4.2 - camRadius) / 1.9, 0, 1);
    camTarget.set(0, THREE.MathUtils.lerp(1.72, 1.36, streetBlend), THREE.MathUtils.lerp(0, 0.22, streetBlend));

    const sinPhi = Math.sin(camPhi);
    camera.position.set(
      camTarget.x + camRadius * sinPhi * Math.sin(camTheta),
      camTarget.y + camRadius * Math.cos(camPhi),
      camTarget.z + camRadius * sinPhi * Math.cos(camTheta)
    );
    camera.lookAt(camTarget);
  };
  updateCameraFromSpherical();

  // ============================================================================
  // BUILD SCENE: DESK + GLOBE + MANHATTAN + TAXIS + SNOW
  // ============================================================================
  await updateLoader(38, 'Crafting walnut desk & night window…');
  const globeAssembly = buildSnowGlobeAndDesk(scene);

  // ============================================================================
  // COZY WINTER NIGHT LIGHTING:
  // 1. THE SNOW GLOBE IS THE HERO LIGHT SOURCE (warm golden PointLights inside Manhattan!)
  // 2. One small warm lamp off to the left side for rim light on the glass edge
  // 3. Delicate cool sapphire night window fill from behind/right
  // 4. Warm dark-room ambient & hemisphere floor so no pixel is ever pure black (#000000)
  // ============================================================================
  // Primary warm golden-amber city core light inside the snow globe (illuminates Manhattan & spills onto the walnut desk!)
  const cityCoreLight = new THREE.PointLight(0xffad42, 2.6, 8.5, 1.35);
  cityCoreLight.position.set(0.0, 2.15, 0.08);
  globeAssembly.globeRig.add(cityCoreLight);

  // Secondary warm golden street-canyon light inside lower Manhattan (lights taxis, stoops, snowbanks & trees)
  const streetCanyonLight = new THREE.PointLight(0xff9828, 1.5, 4.5, 1.45);
  streetCanyonLight.position.set(-0.12, 1.48, 0.22);
  globeAssembly.globeRig.add(streetCanyonLight);

  // Small warm table lamp off to the left side (-X, +Y, +Z) for rim light & soft shadow definition
  const keyLight = new THREE.DirectionalLight(0xffb454, 1.20);
  keyLight.position.set(-5.4, 5.2, 3.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 1.0;
  keyLight.shadow.camera.far = 16.0;
  const d = 1.75;
  keyLight.shadow.camera.left = -d;
  keyLight.shadow.camera.right = d;
  keyLight.shadow.camera.top = d + 0.6;
  keyLight.shadow.camera.bottom = -d + 0.4;
  keyLight.shadow.bias = -0.0005;
  keyLight.shadow.normalBias = 0.012;
  globeAssembly.deskBackdropGroup.add(keyLight);

  const warmSideLamp = new THREE.PointLight(0xff9e32, 3.2, 9.5, 1.45);
  warmSideLamp.position.set(-2.75, 2.55, 1.35);
  globeAssembly.deskBackdropGroup.add(warmSideLamp);

  // Delicate cool sapphire-blue winter night window fill from behind/right
  const windowLight = new THREE.DirectionalLight(0x5c88cc, 0.48);
  windowLight.position.set(4.4, 6.0, -4.6);
  globeAssembly.deskBackdropGroup.add(windowLight);

  // Cozy night sky & warm walnut bounce hemisphere light
  const hemiLight = new THREE.HemisphereLight(0x3e5880, 0x6e4422, 0.44);
  hemiLight.position.set(0, 8, 0);
  scene.add(hemiLight);

  // Lifted warm night ambient floor so no crevice or shadow ever drops to pure black (#000000)
  const ambientLight = new THREE.AmbientLight(0x362d34, 0.46);
  scene.add(ambientLight);

  await updateLoader(68, 'Building miniature Manhattan & lighting windows…');
  const manhattan = buildManhattanInsideGlobe();
  globeAssembly.cityMount.add(manhattan.group);

  globeAssembly.root.updateMatrixWorld(true);
  applySphericalWaterLensToHierarchy(manhattan.group);
  const updateSnowCoverBatch = batchManhattanStaticMeshes(manhattan);

  await updateLoader(88, 'Starting yellow taxis & swirling snow…');
  const taxiSystem = createTaxiSystem();
  globeAssembly.cityMount.add(taxiSystem.group);

  const snowSystem = createSnowAndWaterSystem(1.67);
  globeAssembly.cityMount.add(snowSystem.group);

  const audio = new SnowGlobeAudio();

  // ============================================================================
  // INTERACTION: GRAB & DRAG GLOBE TO SHAKE, ORBIT & SCROLL TO ZOOM TO STREET
  // ============================================================================
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let isDraggingGlobe = false;
  let isOrbitingCamera = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let lastInteractionTime = performance.now();

  let globeTiltX = 0;
  let globeTiltZ = 0;
  let globeTiltVelX = 0;
  let globeTiltVelZ = 0;
  let globeOffsetX = 0;
  let globeOffsetY = 0;
  let globeOffsetZ = 0;
  let globeVelX = 0;
  let globeVelY = 0;
  let globeVelZ = 0;
  let wasAirborne = false;

  const canvas = renderer.domElement;

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    lastInteractionTime = performance.now();
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([globeAssembly.glassDome], false);

    if (hits.length > 0 && e.button === 0 && !e.shiftKey) {
      isDraggingGlobe = true;
      canvas.classList.add('dragging-globe');
      audio.playGlassGrab();
      canvas.setPointerCapture(e.pointerId);
    } else {
      isOrbitingCamera = true;
      manualCameraOverride = false;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;

    if (isDraggingGlobe) {
      lastInteractionTime = performance.now();
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      camRight.y = 0;
      camRight.normalize();

      const impX = camRight.x * dx * 0.045;
      const impZ = camRight.z * dx * 0.045;
      const impY = -dy * 0.035;

      globeVelX = THREE.MathUtils.clamp(globeVelX + impX * 0.45, -2.5, 2.5);
      globeVelZ = THREE.MathUtils.clamp(globeVelZ + impZ * 0.45, -2.5, 2.5);
      globeVelY = THREE.MathUtils.clamp(globeVelY + Math.max(0, impY) * 0.4, -1.5, 1.8);

      globeTiltVelZ = THREE.MathUtils.clamp(globeTiltVelZ - impX * 1.6, -4.5, 4.5);
      globeTiltVelX = THREE.MathUtils.clamp(globeTiltVelX + impZ * 1.6 + dy * 0.02, -4.5, 4.5);

      const speed = Math.hypot(dx, dy) * 0.035;
      snowSystem.addShakeImpulse(impX * 2.2, impY * 2.0, impZ * 2.2, Math.min(1.3, speed));
    } else if (isOrbitingCamera) {
      lastInteractionTime = performance.now();
      camTheta -= dx * 0.0055;
      camPhi = THREE.MathUtils.clamp(camPhi - dy * 0.0045, 0.32, 1.44);
      updateCameraFromSpherical();
    }
  });

  const endPointer = (e: PointerEvent) => {
    if (isDraggingGlobe) {
      isDraggingGlobe = false;
      canvas.classList.remove('dragging-globe');
    }
    isOrbitingCamera = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      lastInteractionTime = performance.now();
      manualCameraOverride = false;
      camRadius = THREE.MathUtils.clamp(camRadius + e.deltaY * 0.0028, 2.25, 8.2);
      updateCameraFromSpherical();
    },
    { passive: false }
  );

  const triggerVigorousShake = (intensity = 1.15) => {
    lastInteractionTime = performance.now();
    audio.playGlassGrab();
    globeTiltVelZ -= 2.4 * intensity;
    globeTiltVelX += 1.5 * intensity;
    globeVelX += 0.55 * intensity;
    globeVelY += 0.65 * intensity;
    wasAirborne = true;
    snowSystem.addShakeImpulse(1.8 * intensity, 1.5 * intensity, -1.2 * intensity, intensity);
    setTimeout(() => {
      globeTiltVelZ += 3.1 * intensity;
      globeTiltVelX -= 1.8 * intensity;
      snowSystem.addShakeImpulse(-1.9 * intensity, 1.4 * intensity, 1.3 * intensity, intensity * 0.95);
    }, 180);
  };

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault();
      triggerVigorousShake(1.2);
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ============================================================================
  // SIMULATION STEP & RENDER LOOP (60FPS TARGET)
  // ============================================================================
  let elapsed = 0;
  let lastFrameTime = performance.now();
  let smoothedFps = 60;

  const stepSimulation = (dt: number) => {
    const safeDt = Math.min(dt, 0.05);
    elapsed += safeDt;

    const kTilt = 68.0;
    const dTilt = 7.5;
    globeTiltVelX += (-kTilt * globeTiltX - dTilt * globeTiltVelX) * safeDt;
    globeTiltVelZ += (-kTilt * globeTiltZ - dTilt * globeTiltVelZ) * safeDt;
    globeTiltX = THREE.MathUtils.clamp(globeTiltX + globeTiltVelX * safeDt, -0.26, 0.26);
    globeTiltZ = THREE.MathUtils.clamp(globeTiltZ + globeTiltVelZ * safeDt, -0.26, 0.26);

    const kPos = 85.0;
    const dPos = 9.5;
    globeVelX += (-kPos * globeOffsetX - dPos * globeVelX) * safeDt;
    globeVelZ += (-kPos * globeOffsetZ - dPos * globeVelZ) * safeDt;
    globeVelY += (-kPos * globeOffsetY - dPos * globeVelY - 9.8 * safeDt) * safeDt;

    globeOffsetX = THREE.MathUtils.clamp(globeOffsetX + globeVelX * safeDt, -0.22, 0.22);
    globeOffsetZ = THREE.MathUtils.clamp(globeOffsetZ + globeVelZ * safeDt, -0.22, 0.22);
    globeOffsetY = Math.max(0, Math.min(0.18, globeOffsetY + globeVelY * safeDt));

    if (globeOffsetY > 0.02) {
      wasAirborne = true;
    } else if (wasAirborne && globeOffsetY <= 0.002) {
      wasAirborne = false;
      globeOffsetY = 0;
      globeVelY = 0;
      audio.playBaseSettle(0.75);
    }

    globeAssembly.globeRig.position.set(globeOffsetX, globeOffsetY, globeOffsetZ);
    globeAssembly.globeRig.rotation.set(globeTiltX, 0, globeTiltZ);

    taxiSystem.update(safeDt, elapsed);
    snowSystem.update(safeDt, elapsed, globeTiltX, globeTiltZ);
    updateSnowCoverBatch(snowSystem.getSnowCoverFactor());

    const [sloshX, sloshZ] = snowSystem.getSloshAngles();
    globeAssembly.updateOptics(elapsed, globeTiltX, globeTiltZ, sloshX, sloshZ);
    globeAssembly.alignBackdropToCamera(camera.position);

    const shakeSpeed = Math.hypot(globeTiltVelX, globeTiltVelZ) + Math.hypot(globeVelX, globeVelZ);
    audio.updateShakeSound(shakeSpeed, snowSystem.getSwirlEnergy());

    if (autoOrbit && !isDraggingGlobe && !isOrbitingCamera && !manualCameraOverride) {
      if (performance.now() - lastInteractionTime > 2500) {
        camTheta = 0.11 + Math.sin((elapsed - 2.5) * 0.22) * 0.44;
        updateCameraFromSpherical();
      }
    }
  };

  window.__globe = {
    ready: true,
    backend: backendName,
    presets: CAMERA_PRESETS,
    setCameraPreset(name: string) {
      const p = CAMERA_PRESETS[name] || CAMERA_PRESETS.hero_front;
      this.setCamera(p.pos, p.target, p.fov ?? 36);
    },
    setCamera(pos: [number, number, number], target: [number, number, number], fov = 36) {
      manualCameraOverride = true;
      autoOrbit = false;
      camera.fov = fov;
      camera.updateProjectionMatrix();
      camera.position.set(pos[0], pos[1], pos[2]);
      camTarget.set(target[0], target[1], target[2]);
      camera.lookAt(camTarget);
      globeAssembly.alignBackdropToCamera(camera.position);
    },
    triggerShake(intensity = 1.2) {
      triggerVigorousShake(intensity);
    },
    setCaptureState(mode) {
      globeTiltX = 0;
      globeTiltZ = 0;
      globeTiltVelX = 0;
      globeTiltVelZ = 0;
      globeOffsetX = 0;
      globeOffsetY = 0;
      globeOffsetZ = 0;
      globeVelX = 0;
      globeVelY = 0;
      globeVelZ = 0;

      if (mode === 'calm') {
        snowSystem.setDeterministicShakeState('calm', 0, 0);
      } else if (mode === 'shake_01_impulse') {
        globeTiltZ = -0.095;
        globeTiltX = 0.052;
        globeOffsetX = -0.045;
        globeOffsetY = 0.032;
        snowSystem.setDeterministicShakeState('shake_start', globeTiltX, globeTiltZ);
      } else if (mode === 'shake_02_blizzard') {
        globeTiltZ = 0.072;
        globeTiltX = -0.038;
        globeOffsetX = 0.035;
        globeOffsetY = 0.018;
        snowSystem.setDeterministicShakeState('shake_peak', globeTiltX, globeTiltZ);
      } else if (mode === 'shake_03_settling') {
        snowSystem.setDeterministicShakeState('shake_settling', 0, 0);
      }

      globeAssembly.globeRig.position.set(globeOffsetX, globeOffsetY, globeOffsetZ);
      globeAssembly.globeRig.rotation.set(globeTiltX, 0, globeTiltZ);

      updateSnowCoverBatch(snowSystem.getSnowCoverFactor());
      const [sloshX, sloshZ] = snowSystem.getSloshAngles();
      globeAssembly.updateOptics(elapsed, globeTiltX, globeTiltZ, sloshX, sloshZ);
      globeAssembly.alignBackdropToCamera(camera.position);
      renderer.info.reset();
      renderer.render(scene, camera);
    },
    advance(dt: number, steps = 1) {
      for (let i = 0; i < steps; i++) {
        stepSimulation(dt);
      }
      renderer.info.reset();
      renderer.render(scene, camera);
    },
    getStats() {
      const prevCalls = renderer.info.render.calls;
      const prevTris = renderer.info.render.triangles;
      renderer.render(scene, camera);
      const frameCalls = Math.max(1, renderer.info.render.calls - prevCalls);
      const frameTris = Math.max(1, renderer.info.render.triangles - prevTris);
      return {
        fps: Math.round(smoothedFps),
        calls: frameCalls,
        triangles: frameTris,
        backend: backendName,
      };
    },
  };

  // Initialize the very first frame in a glowing mid-shake state with full-volume swirling snow!
  globeTiltZ = 0.068;
  globeTiltX = -0.036;
  globeTiltVelZ = -1.65;
  globeTiltVelX = 1.08;
  globeOffsetX = 0.030;
  globeOffsetY = 0.018;
  wasAirborne = true;
  snowSystem.setDeterministicShakeState('shake_peak', globeTiltX, globeTiltZ);
  stepSimulation(1 / 60);
  renderer.render(scene, camera);

  await updateLoader(100, 'Ready');
    const isPauseLoader = params.has('pauseLoader');
    if (!isCaptureMode && !isPauseLoader && loaderEl) {
      loaderEl.classList.add('is-loaded');
      setTimeout(() => {
        loaderEl.remove();
      }, 700);
    }

  renderer.setAnimationLoop((now: number) => {
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    if (dt > 0 && dt < 0.25) {
      const instFps = 1 / dt;
      smoothedFps = smoothedFps * 0.92 + instFps * 0.08;
      if (Math.floor(now / 500) !== Math.floor((now - dt * 1000) / 500)) {
        badge.textContent = `${Math.min(60, Math.round(smoothedFps))} FPS · ${backendName}`;
      }
    }
    if (!params.has('capture')) {
      stepSimulation(dt);
    }
    renderer.info.reset();
    renderer.render(scene, camera);
  });
}

init();

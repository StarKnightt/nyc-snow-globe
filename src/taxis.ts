import * as THREE from 'three/webgpu';

interface WaypointLoop {
  points: Array<[number, number]>;
  lengths: number[];
  totalLength: number;
}

interface TaxiAgent {
  mesh: THREE.Group;
  loop: WaypointLoop;
  distance: number;
  speed: number;
  baseSpeed: number;
  phaseOffset: number;
}

export interface TaxiSystem {
  group: THREE.Group;
  update: (dt: number, elapsed: number) => void;
}

function mergeNonIndexedGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let totalVerts = 0;
  for (const g of nonIndexed) {
    totalVerts += g.attributes.position.count;
  }
  const posArr = new Float32Array(totalVerts * 3);
  const normArr = new Float32Array(totalVerts * 3);
  let offset = 0;
  for (const g of nonIndexed) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      posArr[(offset + i) * 3] = p.getX(i);
      posArr[(offset + i) * 3 + 1] = p.getY(i);
      posArr[(offset + i) * 3 + 2] = p.getZ(i);
      if (n) {
        normArr[(offset + i) * 3] = n.getX(i);
        normArr[(offset + i) * 3 + 1] = n.getY(i);
        normArr[(offset + i) * 3 + 2] = n.getZ(i);
      }
    }
    offset += p.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
  return merged;
}

function buildWaypointLoop(pts: Array<[number, number]>): WaypointLoop {
  const smoothed: Array<[number, number]> = [];
  const n = pts.length;
  const cornerRadius = 0.055;

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    const dx1 = curr[0] - prev[0];
    const dz1 = curr[1] - prev[1];
    const len1 = Math.hypot(dx1, dz1) || 1;

    const dx2 = next[0] - curr[0];
    const dz2 = next[1] - curr[1];
    const len2 = Math.hypot(dx2, dz2) || 1;

    const r = Math.min(cornerRadius, len1 * 0.25, len2 * 0.25);
    const pEnter: [number, number] = [curr[0] - (dx1 / len1) * r, curr[1] - (dz1 / len1) * r];
    const pExit: [number, number] = [curr[0] + (dx2 / len2) * r, curr[1] + (dz2 / len2) * r];

    const arcSteps = 5;
    for (let s = 0; s <= arcSteps; s++) {
      const t = s / arcSteps;
      const omt = 1 - t;
      const x = omt * omt * pEnter[0] + 2 * omt * t * curr[0] + t * t * pExit[0];
      const z = omt * omt * pEnter[1] + 2 * omt * t * curr[1] + t * t * pExit[1];
      smoothed.push([x, z]);
    }
  }

  const lengths: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < smoothed.length; i++) {
    const a = smoothed[i];
    const b = smoothed[(i + 1) % smoothed.length];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    lengths.push(seg);
    totalLength += seg;
  }

  return { points: smoothed, lengths, totalLength };
}

function sampleLoop(loop: WaypointLoop, dist: number): { x: number; z: number; angle: number } {
  let d = ((dist % loop.totalLength) + loop.totalLength) % loop.totalLength;
  const pts = loop.points;
  for (let i = 0; i < pts.length; i++) {
    const segLen = loop.lengths[i];
    if (d <= segLen || i === pts.length - 1) {
      const t = segLen > 1e-6 ? d / segLen : 0;
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[1] + (b[1] - a[1]) * t;
      const angle = Math.atan2(b[0] - a[0], b[1] - a[1]);
      return { x, z, angle };
    }
    d -= segLen;
  }
  return { x: pts[0][0], z: pts[0][1], angle: 0 };
}

// Tapered 2D side-profile sedan geometry with sloped front/rear windshields
const sedanChassisShape = new THREE.Shape();
sedanChassisShape.moveTo(-0.060, 0.006);
sedanChassisShape.lineTo(0.060, 0.006);
sedanChassisShape.lineTo(0.062, 0.019); // Front grille
sedanChassisShape.lineTo(0.032, 0.024); // Sloped front hood
sedanChassisShape.lineTo(0.015, 0.041); // Sloped front windshield A-pillar
sedanChassisShape.lineTo(-0.026, 0.041); // Roofline
sedanChassisShape.lineTo(-0.042, 0.024); // Sloped rear backlight C-pillar
sedanChassisShape.lineTo(-0.060, 0.021); // Rear trunk deck
sedanChassisShape.closePath();

const sedanBodyGeo = new THREE.ExtrudeGeometry(sedanChassisShape, {
  depth: 0.048,
  bevelEnabled: true,
  bevelThickness: 0.003,
  bevelSize: 0.0025,
  bevelSegments: 2,
});
sedanBodyGeo.center();
sedanBodyGeo.rotateY(Math.PI / 2);
sedanBodyGeo.translate(0, 0.0235, 0);

/**
 * Creates a fleet of miniature NYC Yellow Taxis (vivid Chrome Yellow #F7B500)
 * with true tapered sedan profiles, sloped windshields, recessed slate-blue glazed windows with yellow A/B/C pillars,
 * chrome bumpers, lifted charcoal tires (zero pure black!), and pre-merged per-material geometries for 60fps performance.
 */
export function createTaxiSystem(): TaxiSystem {
  const group = new THREE.Group();

  const taxiYellowMat = new THREE.MeshPhysicalMaterial({
    color: 0xffae00,
    emissive: 0x3d2400,
    emissiveIntensity: 0.28,
    roughness: 0.18,
    metalness: 0.08,
    clearcoat: 0.95,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.45,
  });

  // Lifted cool slate-blue cabin glass (never pure black!)
  const cabinGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x32465a,
    emissive: 0x1c2836,
    emissiveIntensity: 0.34,
    roughness: 0.08,
    metalness: 0.30,
    clearcoat: 1.0,
    envMapIntensity: 1.85,
  });

  // Lifted charcoal rubber tire & trim material (never pure black!)
  const tireAndTrimMat = new THREE.MeshStandardMaterial({
    color: 0x343940,
    emissive: 0x1c1f24,
    emissiveIntensity: 0.32,
    roughness: 0.72,
    metalness: 0.12,
  });

  const chromeTrimMat = new THREE.MeshStandardMaterial({
    color: 0xdce2ea,
    emissive: 0x22262c,
    emissiveIntensity: 0.20,
    roughness: 0.22,
    metalness: 0.86,
  });

  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff8dc });
  const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff3824 });
  const medallionLightMat = new THREE.MeshBasicMaterial({ color: 0xffe48c });

  // Canvas texture for dual warm headlight beams ahead of the cab + subtle ruby taillight reflection behind
  const beamCanvas = document.createElement('canvas');
  beamCanvas.width = 64;
  beamCanvas.height = 128;
  const bCtx = beamCanvas.getContext('2d')!;
  // Front headlight cones (y from 0 to 80 in canvas, mapped to +Z in front of taxi)
  for (const bx of [21, 43]) {
    const hGrad = bCtx.createRadialGradient(bx, 68, 1, bx, 28, 36);
    hGrad.addColorStop(0.0, 'rgba(255, 232, 160, 0.85)');
    hGrad.addColorStop(0.45, 'rgba(255, 204, 110, 0.42)');
    hGrad.addColorStop(1.0, 'rgba(255, 180, 80, 0.0)');
    bCtx.fillStyle = hGrad;
    bCtx.fillRect(0, 0, 64, 96);
  }
  // Rear ruby taillight wet-asphalt glow (y from 96 to 128 in canvas, mapped to -Z behind taxi)
  for (const bx of [21, 43]) {
    const tGrad = bCtx.createRadialGradient(bx, 106, 1, bx, 112, 16);
    tGrad.addColorStop(0.0, 'rgba(255, 64, 42, 0.62)');
    tGrad.addColorStop(1.0, 'rgba(255, 42, 24, 0.0)');
    bCtx.fillStyle = tGrad;
    bCtx.fillRect(0, 90, 64, 38);
  }
  const beamTex = new THREE.CanvasTexture(beamCanvas);
  beamTex.colorSpace = THREE.SRGBColorSpace;
  const beamMat = new THREE.MeshBasicMaterial({
    map: beamTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  const beamPlaneGeo = new THREE.PlaneGeometry(0.095, 0.24);
  beamPlaneGeo.rotateX(-Math.PI / 2);
  beamPlaneGeo.translate(0, 0.0022, 0.042);

  const W = 0.052;
  const L = 0.122;

  // Pre-build merged static sub-geometries shared across all 12 taxis!
  // 1. Merged Cabin Glass (front/rear sloped windshields + 2 recessed side windows)
  const fWinGeo = new THREE.BoxGeometry(W * 0.82, 0.018, 0.003);
  fWinGeo.rotateX(-0.76);
  fWinGeo.translate(0, 0.032, 0.022);

  const rWinGeo = new THREE.BoxGeometry(W * 0.80, 0.017, 0.003);
  rWinGeo.rotateX(0.74);
  rWinGeo.translate(0, 0.032, -0.033);

  const fsWinGeo = new THREE.BoxGeometry(W + 0.0025, 0.012, 0.017);
  fsWinGeo.translate(0, 0.0315, 0.006);

  const rsWinGeo = new THREE.BoxGeometry(W + 0.0025, 0.012, 0.017);
  rsWinGeo.translate(0, 0.0315, -0.016);

  const mergedGlassGeo = mergeNonIndexedGeometries([fWinGeo, rWinGeo, fsWinGeo, rsWinGeo]);

  // 2. Merged Charcoal Rubber Tires + Side Trim + Medallion Base
  const tireGeos: THREE.BufferGeometry[] = [];
  const sideBandGeo = new THREE.BoxGeometry(W + 0.003, 0.0038, L * 0.72);
  sideBandGeo.translate(0, 0.017, 0);
  tireGeos.push(sideBandGeo);

  const signBaseGeo = new THREE.BoxGeometry(0.022, 0.0025, 0.011);
  signBaseGeo.translate(0, 0.0425, -0.004);
  tireGeos.push(signBaseGeo);

  for (const wx of [-W * 0.48, W * 0.48]) {
    for (const wz of [-L * 0.31, L * 0.31]) {
      const wg = new THREE.CylinderGeometry(0.0095, 0.0095, 0.007, 12);
      wg.rotateZ(Math.PI / 2);
      wg.translate(wx, 0.0095, wz);
      tireGeos.push(wg);
    }
  }
  const mergedTireTrimGeo = mergeNonIndexedGeometries(tireGeos);

  // 3. Merged Chrome Grille, Bumpers & 4 Hubcaps
  const chromeGeos: THREE.BufferGeometry[] = [];
  const grilleGeo = new THREE.BoxGeometry(W * 0.48, 0.0075, 0.003);
  grilleGeo.translate(0, 0.0155, L * 0.5 + 0.001);
  chromeGeos.push(grilleGeo);

  const fbGeo = new THREE.BoxGeometry(W * 0.98, 0.0055, 0.005);
  fbGeo.translate(0, 0.0095, L * 0.5 + 0.002);
  chromeGeos.push(fbGeo);

  const rbGeo = new THREE.BoxGeometry(W * 0.98, 0.0055, 0.005);
  rbGeo.translate(0, 0.0095, -L * 0.5 - 0.002);
  chromeGeos.push(rbGeo);

  for (const wx of [-W * 0.48, W * 0.48]) {
    for (const wz of [-L * 0.31, L * 0.31]) {
      const hg = new THREE.CylinderGeometry(0.0052, 0.0052, 0.0078, 10);
      hg.rotateZ(Math.PI / 2);
      hg.translate(wx, 0.0095, wz);
      chromeGeos.push(hg);
    }
  }
  const mergedChromeGeo = mergeNonIndexedGeometries(chromeGeos);

  // 4. Merged Headlights & Taillights & Medallion Light
  const hlGeos: THREE.BufferGeometry[] = [];
  const tlGeos: THREE.BufferGeometry[] = [];
  for (const sx of [-W * 0.34, W * 0.34]) {
    const hlg = new THREE.BoxGeometry(0.012, 0.0075, 0.0045);
    hlg.translate(sx, 0.0165, L * 0.5 + 0.002);
    hlGeos.push(hlg);

    const hlOrb = new THREE.SphereGeometry(0.0058, 8, 8);
    hlOrb.translate(sx, 0.0165, L * 0.5 + 0.003);
    hlGeos.push(hlOrb);

    const tlg = new THREE.BoxGeometry(0.0125, 0.0075, 0.0045);
    tlg.translate(sx, 0.0165, -L * 0.5 - 0.002);
    tlGeos.push(tlg);

    const tlOrb = new THREE.SphereGeometry(0.0058, 8, 8);
    tlOrb.translate(sx, 0.0165, -L * 0.5 - 0.003);
    tlGeos.push(tlOrb);
  }
  const mergedHlGeo = mergeNonIndexedGeometries(hlGeos);
  const mergedTlGeo = mergeNonIndexedGeometries(tlGeos);

  const signBoxGeo = new THREE.ConeGeometry(0.012, 0.009, 4);
  signBoxGeo.rotateY(Math.PI / 4);
  signBoxGeo.scale(1.3, 0.85, 0.7);
  signBoxGeo.translate(0, 0.047, -0.004);

  const createSingleTaxiMesh = (): THREE.Group => {
    const car = new THREE.Group();

    const body = new THREE.Mesh(sedanBodyGeo, taxiYellowMat);
    body.castShadow = true;
    body.receiveShadow = true;
    car.add(body);

    car.add(new THREE.Mesh(mergedGlassGeo, cabinGlassMat));
    car.add(new THREE.Mesh(mergedTireTrimGeo, tireAndTrimMat));
    car.add(new THREE.Mesh(mergedChromeGeo, chromeTrimMat));
    car.add(new THREE.Mesh(mergedHlGeo, headlightMat));
    car.add(new THREE.Mesh(mergedTlGeo, taillightMat));
    car.add(new THREE.Mesh(signBoxGeo, medallionLightMat));
    car.add(new THREE.Mesh(beamPlaneGeo, beamMat));

    return car;
  };

  // Dedicated non-overlapping straight & loop lanes along Fifth Ave, Sixth Ave, Madison Ave, and 42nd/34th Streets
  const loopFifthSouth = buildWaypointLoop([
    [0.042, -0.34],
    [0.042, 0.92],
    [0.54, 0.92],
    [0.54, -0.34],
  ]);

  const loopFifthNorth = buildWaypointLoop([
    [0.118, 0.92],
    [0.118, -0.34],
    [-0.41, -0.34],
    [-0.41, 0.92],
  ]);

  const loop42ndCrosstown = buildWaypointLoop([
    [-0.92, 0.195],
    [0.88, 0.195],
    [0.88, 0.695],
    [-0.92, 0.695],
  ]);

  const loopSixthAve = buildWaypointLoop([
    [-0.488, -0.34],
    [-0.488, 0.64],
    [-0.92, 0.64],
    [-0.92, -0.34],
  ]);

  const loops = [loopFifthSouth, loopFifthNorth, loop42ndCrosstown, loopSixthAve];
  const agents: TaxiAgent[] = [];

  loops.forEach((loop, loopIdx) => {
    const count = 3;
    for (let i = 0; i < count; i++) {
      const mesh = createSingleTaxiMesh();
      group.add(mesh);
      const baseSpeed = 0.16;
      agents.push({
        mesh,
        loop,
        distance: (loop.totalLength * i) / count + loopIdx * 0.38,
        speed: baseSpeed,
        baseSpeed,
        phaseOffset: loopIdx * 1.7 + i * 2.1,
      });
    }
  });

  const update = (dt: number, _elapsed: number) => {
    for (const agent of agents) {
      agent.distance += agent.baseSpeed * dt;
      const pose = sampleLoop(agent.loop, agent.distance);
      const rHoriz = Math.hypot(pose.x, pose.z);
      const rNorm = Math.min(1.0, rHoriz / (1.57 * 0.94));
      const mag = 1.04 + 0.20 * Math.pow(rNorm, 1.5);
      const lensLiftY = 0.048 * Math.pow(rNorm, 2.0);
      agent.mesh.position.set(pose.x * mag, 0.0175 + lensLiftY, pose.z * mag);
      agent.mesh.rotation.y = pose.angle;
    }
  };

  update(0, 0);

  return { group, update };
}

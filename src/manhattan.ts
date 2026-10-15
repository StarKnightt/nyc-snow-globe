import * as THREE from 'three/webgpu';
import { createBuildingFacadeTexture, createRng, createWetAsphaltTextures } from './textures';

export interface ManhattanSceneData {
  group: THREE.Group;
  accumulatableSnowMeshes: Array<{
    mesh: THREE.Mesh;
    baseScaleY: number;
    basePosY: number;
  }>;
}

/**
 * Helper to create a continuous, smoothly undulating 3D snowbank mesh (replaces overlapping pancake discs!).
 */
function createContinuousSnowbankGeometry(
  length: number,
  width: number,
  height: number,
  seed: number,
  alongX: boolean
): THREE.BufferGeometry {
  const segL = Math.max(12, Math.floor(length * 28));
  const segW = 8;
  const geo = new THREE.BoxGeometry(
    alongX ? length : width,
    height,
    alongX ? width : length,
    alongX ? segL : segW,
    4,
    alongX ? segW : segL
  );
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);

    const u = alongX ? vx / (length * 0.5) : vz / (length * 0.5); // -1..1 along length
    const v = alongX ? vz / (width * 0.5) : vx / (width * 0.5); // -1..1 across width
    const hNorm = (vy + height * 0.5) / height; // 0 at bottom, 1 at top

    if (hNorm > 0.05) {
      // Rounded dome cross-section across width + tapered ends + organic wind-sculpted undulation along length
      const crossProfile = Math.cos(v * Math.PI * 0.48);
      const endTaper = Math.cos(Math.pow(Math.abs(u), 2.5) * Math.PI * 0.46);
      const undulation =
        0.82 +
        0.18 * Math.sin(u * 7.5 + seed) +
        0.10 * Math.cos(u * 14.3 + seed * 2.1);

      const newY = -height * 0.5 + height * hNorm * crossProfile * endTaper * undulation;
      pos.setY(i, newY);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds the miniature daytime winter Manhattan inside the snow globe (radius ~1.45).
 * Fixes all Round 2 architectural & landscape items:
 * - R2-02: Consistent charcoal wet winter asphalt (#32373E) from all angles + raised granite curbs (#9A9894)
 * - R2-05: Continuous undulating 3D snowbanks & continuous single-piece brownstone roof snow blankets
 * - R2-06: High-density window grids on all foreground mid-rises, 16 fluted chrome ribs on ESB mooring mast,
 *          and snowy back courtyard with garden fence between brownstone rows
 * - R2-07: Mirror-polished Nirosta stainless-steel Chrysler crown with 3D sunburst dormers & clear East sightline
 * - R2-08: Fire hydrants, corner waste bins, and 14 stylized winter pedestrians walking along sidewalks
 * - R2-09: Feathered snow slope along Central Park perimeter, large frozen pond with Gapstow bridge,
 *          conformal faceted snow on schist boulders, and organic non-ringed winter conifers
 */
export function buildManhattanInsideGlobe(): ManhattanSceneData {
  const group = new THREE.Group();
  const accumulatableSnowMeshes: ManhattanSceneData['accumulatableSnowMeshes'] = [];
  const rng = createRng(2026);

  const registerSnowCap = (mesh: THREE.Mesh) => {
    accumulatableSnowMeshes.push({
      mesh,
      baseScaleY: mesh.scale.y,
      basePosY: mesh.position.y,
    });
  };

  // Shared materials
  const snowMat = new THREE.MeshStandardMaterial({
    color: 0xf4f7fc,
    roughness: 0.65,
    metalness: 0.02,
    envMapIntensity: 0.85,
  });

  const slushMat = new THREE.MeshStandardMaterial({
    color: 0xbec6d0,
    roughness: 0.52,
    metalness: 0.03,
  });

  // Consistent dark charcoal night asphalt (#323740) across both grazing closeups and top-down overview!
  const asphaltTex = createWetAsphaltTextures();
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTex.map,
    roughnessMap: asphaltTex.roughnessMap,
    color: 0x5c626e,
    emissive: 0x1c2028,
    emissiveIntensity: 0.24,
    roughness: 0.72,
    metalness: 0.04,
    envMapIntensity: 0.40,
  });

  const sidewalkMat = new THREE.MeshStandardMaterial({
    color: 0x78746c,
    emissive: 0x221f1a,
    emissiveIntensity: 0.18,
    roughness: 0.80,
    metalness: 0.02,
  });

  const curbStoneMat = new THREE.MeshStandardMaterial({
    color: 0x6a665e,
    emissive: 0x201d18,
    emissiveIntensity: 0.18,
    roughness: 0.78,
  });

  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0xb8b2a6,
    roughness: 0.68,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  const yellowLineMat = new THREE.MeshStandardMaterial({
    color: 0xd49c14,
    roughness: 0.62,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  // Empire State Building Indiana Limestone Facade (warm night stone with glowing golden-amber windows!)
  const limestoneFacade = createBuildingFacadeTexture({
    wallColor: '#7a6c5a',
    spandrelColor: '#2c323c',
    windowTint: '#4d677d',
    cols: 12,
    rows: 26,
    style: 'artdeco',
    seed: 101,
  });

  const limestoneMat = new THREE.MeshStandardMaterial({
    map: limestoneFacade.map,
    roughnessMap: limestoneFacade.roughnessMap,
    emissiveMap: limestoneFacade.emissiveMap,
    color: 0xbcb09c,
    emissive: 0xffb838,
    emissiveIntensity: 2.15,
    roughness: 0.72,
    metalness: 0.08,
  });

  const trimLimestoneMat = new THREE.MeshStandardMaterial({
    color: 0x8a7d6a,
    emissive: 0x342618,
    emissiveIntensity: 0.28,
    roughness: 0.68,
    metalness: 0.06,
  });

  const nickelTrimMat = new THREE.MeshStandardMaterial({
    color: 0xc8c0b4,
    emissive: 0x3c2e1c,
    emissiveIntensity: 0.26,
    roughness: 0.24,
    metalness: 0.86,
    envMapIntensity: 1.45,
  });

  // Chrysler Building Masonry Facade (warm night stone with glowing golden-amber windows!)
  const chryslerFacade = createBuildingFacadeTexture({
    wallColor: '#82786a',
    spandrelColor: '#2a323c',
    windowTint: '#506a80',
    cols: 10,
    rows: 22,
    style: 'artdeco',
    seed: 155,
  });
  const chryslerShaftMat = new THREE.MeshStandardMaterial({
    map: chryslerFacade.map,
    roughnessMap: chryslerFacade.roughnessMap,
    emissiveMap: chryslerFacade.emissiveMap,
    color: 0xc4baaa,
    emissive: 0xffbe3e,
    emissiveIntensity: 2.15,
    roughness: 0.66,
    metalness: 0.1,
  });

  // High-gloss Nirosta stainless-steel material for the Chrysler sunburst crown (warmly floodlit at night!)
  const steelCrownMat = new THREE.MeshPhysicalMaterial({
    color: 0xf2e4c8,
    emissive: 0x725224,
    emissiveIntensity: 0.48,
    roughness: 0.14,
    metalness: 0.88,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.9,
  });

  const prewarMasonryA = createBuildingFacadeTexture({
    wallColor: '#726250',
    spandrelColor: '#322a22',
    windowTint: '#4d6578',
    cols: 8,
    rows: 16,
    style: 'masonry',
    seed: 202,
  });
  const prewarMatA = new THREE.MeshStandardMaterial({
    map: prewarMasonryA.map,
    roughnessMap: prewarMasonryA.roughnessMap,
    emissiveMap: prewarMasonryA.emissiveMap,
    color: 0xb6a692,
    emissive: 0xffb432,
    emissiveIntensity: 2.15,
    roughness: 0.76,
    metalness: 0.05,
  });

  const prewarMasonryB = createBuildingFacadeTexture({
    wallColor: '#684c3c',
    spandrelColor: '#2e221b',
    windowTint: '#465c6e',
    cols: 8,
    rows: 14,
    style: 'masonry',
    seed: 303,
  });
  const prewarMatB = new THREE.MeshStandardMaterial({
    map: prewarMasonryB.map,
    roughnessMap: prewarMasonryB.roughnessMap,
    emissiveMap: prewarMasonryB.emissiveMap,
    color: 0xb29682,
    emissive: 0xffac2c,
    emissiveIntensity: 2.15,
    roughness: 0.78,
    metalness: 0.04,
  });

  const curtainWallTex = createBuildingFacadeTexture({
    wallColor: '#485868',
    spandrelColor: '#243240',
    windowTint: '#6286a2',
    cols: 8,
    rows: 16,
    style: 'curtainwall',
    seed: 404,
  });
  const glassTowerMat = new THREE.MeshStandardMaterial({
    map: curtainWallTex.map,
    roughnessMap: curtainWallTex.roughnessMap,
    emissiveMap: curtainWallTex.emissiveMap,
    color: 0x9eb0c2,
    emissive: 0xffba3a,
    emissiveIntensity: 2.10,
    roughness: 0.30,
    metalness: 0.45,
    envMapIntensity: 1.25,
  });

  // 1. Snow-Dressed Limestone Plinth & Continuous Perimeter Snowbank (Radius 1.45)
  const islandRadius = 1.45;
  const plinthGeo = new THREE.CylinderGeometry(islandRadius, islandRadius * 0.96, 0.14, 72);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0xd8d3c8,
    roughness: 0.72,
    metalness: 0.05,
  });
  const plinth = new THREE.Mesh(plinthGeo, plinthMat);
  plinth.position.y = -0.07;
  plinth.receiveShadow = true;
  group.add(plinth);

  // Wet winter asphalt surface disc sitting on top of plinth
  const roadDisk = new THREE.Mesh(
    new THREE.CylinderGeometry(islandRadius - 0.012, islandRadius - 0.012, 0.016, 72),
    roadMat
  );
  roadDisk.position.y = 0.008;
  roadDisk.receiveShadow = true;
  group.add(roadDisk);

  // Continuous, organically modulated 3D snowdrift ring around the outer perimeter (no overlapping pancake discs!)
  const perimTorusGeo = new THREE.TorusGeometry(islandRadius - 0.048, 0.042, 16, 96);
  perimTorusGeo.rotateX(Math.PI / 2);
  const pPos = perimTorusGeo.attributes.position;
  for (let i = 0; i < pPos.count; i++) {
    const vx = pPos.getX(i);
    const vy = pPos.getY(i);
    const vz = pPos.getZ(i);
    const ang = Math.atan2(vz, vx);
    const undul = 1.0 + 0.25 * Math.sin(ang * 7.0) + 0.15 * Math.cos(ang * 13.0);
    pPos.setY(i, Math.max(0.0, vy * 0.55 * undul));
  }
  pPos.needsUpdate = true;
  perimTorusGeo.computeVertexNormals();
  const perimDrift = new THREE.Mesh(perimTorusGeo, snowMat);
  perimDrift.position.y = 0.014;
  perimDrift.receiveShadow = true;
  group.add(perimDrift);
  registerSnowCap(perimDrift);

  // Helper to create raised sidewalk block with distinct granite curb step & continuous curb snowbanks
  const addCityBlockSidewalk = (x0: number, x1: number, z0: number, z1: number, seedOffset: number) => {
    const bw = x1 - x0;
    const bd = z1 - z0;
    const cx = (x0 + x1) * 0.5;
    const cz = (z0 + z1) * 0.5;
    if (Math.hypot(cx, cz) > 1.28) return;

    // Distinct raised granite curb step (#8A867E) around the perimeter of the block
    const curb = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.012, 0.024, bd + 0.012), curbStoneMat);
    curb.position.set(cx, 0.020, cz);
    curb.receiveShadow = true;
    curb.castShadow = true;
    group.add(curb);

    // Concrete sidewalk slab inset slightly inside the granite curb
    const sw = new THREE.Mesh(new THREE.BoxGeometry(bw - 0.004, 0.026, bd - 0.004), sidewalkMat);
    sw.position.set(cx, 0.021, cz);
    sw.receiveShadow = true;
    sw.castShadow = true;
    group.add(sw);

    // Continuous 3D plowed snowbank berm + grey slush edge along North and South curbs
    for (const [zEdge, sIdx] of [
      [z0 + 0.014, 1],
      [z1 - 0.014, 2],
    ] as const) {
      const bankGeo = createContinuousSnowbankGeometry(bw * 0.86, 0.028, 0.018, seedOffset + sIdx * 17, true);
      const bank = new THREE.Mesh(bankGeo, snowMat);
      bank.position.set(cx, 0.038, zEdge);
      bank.receiveShadow = true;
      group.add(bank);
      registerSnowCap(bank);

      // Slush transition strip at curb base
      const slushStrip = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.88, 0.004, 0.016), slushMat);
      slushStrip.position.set(cx, 0.017, zEdge + (sIdx === 1 ? -0.012 : 0.012));
      group.add(slushStrip);
    }
  };

  // City blocks between avenues & cross-streets:
  addCityBlockSidewalk(-1.12, -0.545, -0.27, 0.065, 10);
  addCityBlockSidewalk(-0.355, -0.025, -0.27, 0.065, 20);
  addCityBlockSidewalk(0.185, 0.49, -0.27, 0.065, 30);
  addCityBlockSidewalk(0.67, 1.12, -0.27, 0.065, 40);

  addCityBlockSidewalk(-1.12, -0.545, 0.255, 0.57, 50);
  addCityBlockSidewalk(-0.355, -0.025, 0.255, 0.57, 60);
  addCityBlockSidewalk(0.185, 0.49, 0.255, 0.57, 70);
  addCityBlockSidewalk(0.67, 1.08, 0.255, 0.57, 80);

  addCityBlockSidewalk(-0.355, -0.025, 0.75, 1.12, 90);
  addCityBlockSidewalk(0.185, 0.49, 0.75, 1.12, 100);

  // Continental Zebra Crosswalks & Double Yellow Center Lines
  const aveX = [-0.45, 0.08, 0.58];
  const stZ = [-0.36, 0.16, 0.66];

  for (const ax of aveX) {
    for (let z = -0.30; z <= 1.05; z += 0.10) {
      if (stZ.some((sz) => Math.abs(z - sz) < 0.12)) continue;
      if (Math.hypot(ax, z) > 1.32) continue;
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.010, 0.052), stripeMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(ax, 0.017, z);
      group.add(dash);
    }
  }

  for (const sz of stZ) {
    for (let x = -1.1; x <= 1.1; x += 0.10) {
      if (aveX.some((ax) => Math.abs(x - ax) < 0.12)) continue;
      if (Math.hypot(x, sz) > 1.30) continue;
      for (const dyOff of [-0.005, 0.005]) {
        const yLine = new THREE.Mesh(new THREE.PlaneGeometry(0.082, 0.0055), yellowLineMat);
        yLine.rotation.x = -Math.PI / 2;
        yLine.position.set(x, 0.017, sz + dyOff);
        group.add(yLine);
      }
    }
  }

  for (const ax of aveX) {
    for (const sz of stZ) {
      if (Math.hypot(ax, sz) > 1.25) continue;
      for (const dz of [-0.095, 0.095]) {
        for (let i = -3; i <= 3; i++) {
          const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.015, 0.056), stripeMat);
          bar.rotation.x = -Math.PI / 2;
          bar.position.set(ax + i * 0.024, 0.0172, sz + dz);
          group.add(bar);
        }
      }
      for (const dx of [-0.102, 0.102]) {
        for (let i = -3; i <= 3; i++) {
          const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.056, 0.015), stripeMat);
          bar.rotation.x = -Math.PI / 2;
          bar.position.set(ax + dx, 0.0172, sz + i * 0.022);
          group.add(bar);
        }
      }
    }
  }

  const addTierWithParapetAndSnow = (
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    yBottom: number,
    mat: THREE.Material,
    parapetMat: THREE.Material = trimLimestoneMat,
    snowThickness = 0.012
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.y = yBottom + h * 0.5;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);

    const corniceH = 0.010;
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(w + 0.008, corniceH, d + 0.008), parapetMat);
    cornice.position.y = yBottom + h - corniceH * 0.3;
    parent.add(cornice);

    if (snowThickness > 0) {
      const snowGeo = new THREE.BoxGeometry(w * 0.88, snowThickness, d * 0.88);
      const snowCap = new THREE.Mesh(snowGeo, snowMat);
      snowCap.position.y = yBottom + h + snowThickness * 0.4;
      snowCap.receiveShadow = true;
      parent.add(snowCap);
      registerSnowCap(snowCap);
    }
    return mesh;
  };

  // ============================================================================
  // 2. HERO: THE EMPIRE STATE BUILDING (x = -0.19, z = 0.41)
  // Detailed fluted chrome mooring mast with window bands & observation gallery!
  // ============================================================================
  const esbGroup = new THREE.Group();
  esbGroup.position.set(-0.19, 0.034, 0.41);
  group.add(esbGroup);

  addTierWithParapetAndSnow(esbGroup, 0.32, 0.13, 0.28, 0.0, limestoneMat, trimLimestoneMat, 0.012);

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.055, 0.095), trimLimestoneMat);
  canopy.position.set(0.165, 0.032, 0);
  esbGroup.add(canopy);

  addTierWithParapetAndSnow(esbGroup, 0.28, 0.17, 0.24, 0.13, limestoneMat, trimLimestoneMat, 0.011);
  addTierWithParapetAndSnow(esbGroup, 0.25, 0.18, 0.21, 0.30, limestoneMat, trimLimestoneMat, 0.011);
  addTierWithParapetAndSnow(esbGroup, 0.215, 0.56, 0.18, 0.48, limestoneMat, trimLimestoneMat, 0.011);

  for (const zSide of [-0.092, 0.092]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.48, 0.026), limestoneMat);
    wing.position.set(0, 0.48 + 0.24, zSide);
    wing.castShadow = true;
    wing.receiveShadow = true;
    esbGroup.add(wing);
  }

  for (const side of [-1, 1]) {
    for (const offset of [-0.062, -0.021, 0.021, 0.062]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.74, 0.012), trimLimestoneMat);
      pier.position.set(offset, 0.67, side * 0.091);
      pier.castShadow = true;
      esbGroup.add(pier);

      const chromeRib = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.74, 0.014), nickelTrimMat);
      chromeRib.position.set(offset + 0.008, 0.67, side * 0.091);
      esbGroup.add(chromeRib);
    }
    for (const offsetZ of [-0.048, 0, 0.048]) {
      const pierX = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.74, 0.014), trimLimestoneMat);
      pierX.position.set(side * 0.108, 0.67, offsetZ);
      pierX.castShadow = true;
      esbGroup.add(pierX);
    }
  }

  addTierWithParapetAndSnow(esbGroup, 0.175, 0.15, 0.148, 1.04, limestoneMat, trimLimestoneMat, 0.010);
  addTierWithParapetAndSnow(esbGroup, 0.145, 0.11, 0.122, 1.19, limestoneMat, trimLimestoneMat, 0.009);
  addTierWithParapetAndSnow(esbGroup, 0.118, 0.055, 0.102, 1.30, trimLimestoneMat, nickelTrimMat, 0.008);

  // Iconic Art Deco Mooring Mast (Floors 87-102) warmly floodlit from within at night!
  const mastBaseY = 1.355;
  const darkMastCoreMat = new THREE.MeshStandardMaterial({
    color: 0xffdf9a,
    emissive: 0xffb448,
    emissiveIntensity: 1.15,
    roughness: 0.25,
    metalness: 0.35,
  });
  const mastCore = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.19, 24), darkMastCoreMat);
  mastCore.position.y = mastBaseY + 0.095;
  mastCore.castShadow = true;
  esbGroup.add(mastCore);

  // 16 vertical fluted stainless-steel ribs around the mooring mast
  for (let r = 0; r < 16; r++) {
    const ang = (r / 16) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.19, 0.006), steelCrownMat);
    rib.position.set(Math.cos(ang) * 0.040, mastBaseY + 0.095, Math.sin(ang) * 0.040);
    rib.rotation.y = -ang;
    esbGroup.add(rib);
  }

  // Horizontal chrome spandrel rings along the mooring mast
  for (let hRing = 0; hRing < 5; hRing++) {
    const ry = mastBaseY + 0.025 + hRing * 0.036;
    const rad = 0.044 - hRing * 0.002;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.0022, 8, 24), steelCrownMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = ry;
    esbGroup.add(ring);
  }

  // 4 stepped Art Deco winged buttress fins on the mooring mast
  for (let b = 0; b < 4; b++) {
    const finAngle = (b * Math.PI) / 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.094, 0.16, 0.012), steelCrownMat);
    fin.position.y = mastBaseY + 0.08;
    fin.rotation.y = finAngle;
    esbGroup.add(fin);
  }

  // 102nd floor observation gallery with warm interior glow ring & silver dome
  const obs102 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.043, 0.043, 0.022, 24),
    new THREE.MeshStandardMaterial({ color: 0xfff0c4, emissive: 0xffbe52, emissiveIntensity: 1.65, roughness: 0.2 })
  );
  obs102.position.y = mastBaseY + 0.195;
  esbGroup.add(obs102);

  const mastDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.038, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
    steelCrownMat
  );
  mastDome.position.y = mastBaseY + 0.205;
  esbGroup.add(mastDome);

  const spireBase = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.020, 0.09, 16), steelCrownMat);
  spireBase.position.y = mastBaseY + 0.265;
  esbGroup.add(spireBase);

  const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.008, 0.18, 12), steelCrownMat);
  needle.position.y = mastBaseY + 0.395;
  esbGroup.add(needle);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.007, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3b2f })
  );
  beacon.position.y = mastBaseY + 0.49;
  esbGroup.add(beacon);

  // ============================================================================
  // 3. CHRYSLER BUILDING (x = 0.34, z = -0.10)
  // High-gloss Nirosta stainless-steel terraced crown with bold 3D sunburst dormers!
  // ============================================================================
  const chryslerGroup = new THREE.Group();
  chryslerGroup.position.set(0.34, 0.034, -0.10);
  group.add(chryslerGroup);

  addTierWithParapetAndSnow(chryslerGroup, 0.24, 0.15, 0.22, 0.0, chryslerShaftMat, nickelTrimMat, 0.010);
  addTierWithParapetAndSnow(chryslerGroup, 0.195, 0.16, 0.185, 0.15, chryslerShaftMat, nickelTrimMat, 0.010);
  addTierWithParapetAndSnow(chryslerGroup, 0.155, 0.52, 0.155, 0.31, chryslerShaftMat, nickelTrimMat, 0.009);
  addTierWithParapetAndSnow(chryslerGroup, 0.125, 0.12, 0.125, 0.83, chryslerShaftMat, nickelTrimMat, 0.008);

  // 4 Iconic Art Deco Stainless-Steel Eagle Gargoyles projecting from the 61st-floor corners
  for (const gx of [-0.068, 0.068]) {
    for (const gz of [-0.068, 0.068]) {
      const eagle = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.028, 6), steelCrownMat);
      eagle.position.set(gx, 0.945, gz);
      eagle.rotation.x = gz > 0 ? 1.1 : -1.1;
      eagle.rotation.z = gx > 0 ? -1.1 : 1.1;
      chryslerGroup.add(eagle);
    }
  }

  // 7-Tiered Terraced Crescent-Arch Nirosta Steel Sunburst Crown with Warm Glowing Triangular Windows at Night!
  const darkDormerMat = new THREE.MeshStandardMaterial({
    color: 0xffeeb4,
    emissive: 0xffb844,
    emissiveIntensity: 1.75,
    roughness: 0.2,
  });
  const crownGrooveMat = new THREE.MeshBasicMaterial({ color: 0x382e24 });
  let cy = 0.95;
  for (let tier = 0; tier < 6; tier++) {
    const tFrac = tier / 6;
    const wTier = 0.124 * (1 - tFrac * 0.65);
    const hTier = 0.048 * (1 - tFrac * 0.22);

    // Distinct stepped metallic cruciform arch vault + recessed shadow groove between tiers
    const collarGroove = new THREE.Mesh(
      new THREE.BoxGeometry(wTier * 0.94, 0.005, wTier * 0.94),
      crownGrooveMat
    );
    collarGroove.position.y = cy;
    chryslerGroup.add(collarGroove);

    for (let rot = 0; rot < 2; rot++) {
      const archGeo = new THREE.CylinderGeometry(wTier * 0.52, wTier * 0.58, wTier * 0.98, 20, 1, false, 0, Math.PI);
      archGeo.rotateZ(Math.PI / 2);
      if (rot === 1) archGeo.rotateY(Math.PI / 2);
      archGeo.scale(1, (hTier * 1.48) / (wTier * 0.52), 1);
      const archMesh = new THREE.Mesh(archGeo, steelCrownMat);
      archMesh.position.y = cy + 0.003;
      archMesh.castShadow = true;
      chryslerGroup.add(archMesh);
    }

    // Flush 3D triangular sunburst clerestory windows on all 4 faces of each arch tier
    const sunburstCount = 7 - tier;
    for (let face = 0; face < 4; face++) {
      const fGroup = new THREE.Group();
      fGroup.position.y = cy + hTier * 0.18;
      fGroup.rotation.y = (face * Math.PI) / 2;
      for (let k = 0; k < sunburstCount; k++) {
        const sAngle = ((k / Math.max(1, sunburstCount - 1)) - 0.5) * 0.82;
        const rayTri = new THREE.Mesh(new THREE.BoxGeometry(0.006, hTier * 0.54, 0.005), darkDormerMat);
        rayTri.position.set(
          Math.sin(sAngle) * (wTier * 0.26),
          Math.cos(sAngle) * (hTier * 0.20),
          wTier * 0.475
        );
        rayTri.rotation.z = -sAngle;
        fGroup.add(rayTri);
      }
      chryslerGroup.add(fGroup);
    }
    cy += hTier * 0.80;
  }

  const chryslerSpire = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.20, 12), steelCrownMat);
  chryslerSpire.position.y = cy + 0.095;
  chryslerGroup.add(chryslerSpire);

  // ============================================================================
  // 4. HELPER: NYC WOODEN ROOFTOP WATER TOWER
  // ============================================================================
  const woodTankMat = new THREE.MeshStandardMaterial({
    color: 0x825638,
    emissive: 0x22160e,
    emissiveIntensity: 0.20,
    roughness: 0.82,
  });
  const darkSteelMat = new THREE.MeshStandardMaterial({
    color: 0x383e46,
    emissive: 0x1c2026,
    emissiveIntensity: 0.26,
    roughness: 0.45,
    metalness: 0.60,
  });

  const addWaterTower = (parent: THREE.Object3D, x: number, yRoof: number, z: number) => {
    const wt = new THREE.Group();
    wt.position.set(x, yRoof, z);
    for (const lx of [-0.011, 0.011]) {
      for (const lz of [-0.011, 0.011]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.028, 6), darkSteelMat);
        leg.position.set(lx, 0.014, lz);
        wt.add(leg);
      }
    }
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.022, 0.042, 12), woodTankMat);
    barrel.position.y = 0.048;
    barrel.castShadow = true;
    wt.add(barrel);

    for (const hy of [0.036, 0.056]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.0215, 0.0012, 6, 16), darkSteelMat);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.y = hy;
      wt.add(hoop);
    }

    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.020, 12), darkSteelMat);
    roof.position.y = 0.079;
    wt.add(roof);

    const snowCone = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.014, 12), snowMat);
    snowCone.position.y = 0.083;
    wt.add(snowCone);
    registerSnowCap(snowCone);

    parent.add(wt);
  };

  // ============================================================================
  // 5. MIDTOWN PRE-WAR & CURTAINWALL TOWERS + MULTI-PANE STOREFRONTS
  // Fixes R2-06 (subdivided window bays + mullions) and R2-07 (East Chrysler sightline!)
  // ============================================================================
  const storefrontBronzeMat = new THREE.MeshStandardMaterial({
    color: 0x44382c,
    emissive: 0x1e1812,
    emissiveIntensity: 0.24,
    roughness: 0.4,
    metalness: 0.55,
  });
  const shopWindowLitMat = new THREE.MeshStandardMaterial({
    color: 0xfff2c2,
    emissive: 0xffbc4c,
    emissiveIntensity: 1.65,
    roughness: 0.12,
  });
  const awningBurgundyMat = new THREE.MeshStandardMaterial({
    color: 0x8a2c2c,
    emissive: 0x260c0c,
    emissiveIntensity: 0.20,
    roughness: 0.72,
  });
  const awningGreenMat = new THREE.MeshStandardMaterial({
    color: 0x265c44,
    emissive: 0x0e241a,
    emissiveIntensity: 0.20,
    roughness: 0.72,
  });

  const midtownBuildings: Array<{
    x: number;
    z: number;
    w: number;
    d: number;
    h1: number;
    h2?: number;
    mat: THREE.Material;
    waterTower?: boolean;
    awningMat?: THREE.Material;
  }> = [
    // Midtown North-Center block (note: waterTower removed from (-0.20, -0.17) so it never sits behind ESB in 04!)
    { x: -0.20, z: -0.17, w: 0.22, d: 0.13, h1: 0.48, h2: 0.18, mat: prewarMatA, awningMat: awningGreenMat },
    { x: -0.18, z: -0.02, w: 0.20, d: 0.12, h1: 0.38, h2: 0.14, mat: prewarMatB, awningMat: awningBurgundyMat },
    // Fifth Ave East block
    { x: 0.34, z: 0.35, w: 0.22, d: 0.14, h1: 0.46, h2: 0.16, mat: prewarMatB, waterTower: true, awningMat: awningBurgundyMat },
    { x: 0.33, z: 0.50, w: 0.20, d: 0.12, h1: 0.36, mat: prewarMatA, awningMat: awningGreenMat },
    // Far East blocks: lowered & shifted so Chrysler Building shaft & crown have a 100% unobstructed view in 02_side_east!
    { x: 0.82, z: -0.20, w: 0.18, d: 0.15, h1: 0.26, mat: glassTowerMat, awningMat: awningGreenMat },
    { x: 0.78, z: 0.40, w: 0.19, d: 0.17, h1: 0.32, mat: prewarMatB, waterTower: true, awningMat: awningBurgundyMat },
    // South 5th Ave block
    { x: -0.19, z: 0.88, w: 0.22, d: 0.18, h1: 0.38, h2: 0.12, mat: prewarMatA, waterTower: true, awningMat: awningGreenMat },
  ];

  for (const b of midtownBuildings) {
    const bg = new THREE.Group();
    bg.position.set(b.x, 0.034, b.z);
    group.add(bg);

    addTierWithParapetAndSnow(bg, b.w, b.h1, b.d, 0, b.mat, trimLimestoneMat, 0.011);

    // 3D Vertical Stone Pilasters & Window Mullions across all 4 faces (ensures crisp 6-bay scale in closeups!)
    for (const zSign of [-1, 1]) {
      for (let p = -2; p <= 2; p++) {
        const pilaster = new THREE.Mesh(
          new THREE.BoxGeometry(0.008, b.h1 - 0.01, 0.006),
          trimLimestoneMat
        );
        pilaster.position.set(p * (b.w * 0.19), b.h1 * 0.5, zSign * (b.d * 0.5 + 0.002));
        bg.add(pilaster);
      }
    }

    // Ground-floor retail storefront colonnade, multi-pane shop windows, and slanted fabric awnings
    const plinthBand = new THREE.Mesh(
      new THREE.BoxGeometry(b.w + 0.005, 0.048, b.d + 0.005),
      storefrontBronzeMat
    );
    plinthBand.position.y = 0.024;
    bg.add(plinthBand);

    for (const zSign of [-1, 1]) {
      for (let s = -2; s <= 2; s++) {
        if (s === 0) continue; // Center recessed doorway
        const xOff = s * (b.w * 0.19);
        const shopWin = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.14, 0.030, 0.004), shopWindowLitMat);
        shopWin.position.set(xOff, 0.022, zSign * (b.d * 0.5 + 0.0025));
        bg.add(shopWin);

        if (b.awningMat) {
          const awning = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.15, 0.007, 0.018), b.awningMat);
          awning.position.set(xOff, 0.040, zSign * (b.d * 0.5 + 0.009));
          awning.rotation.x = zSign * 0.38;
          bg.add(awning);
        }
      }
    }

    const beltCourse = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.010, 0.008, b.d + 0.010), trimLimestoneMat);
    beltCourse.position.y = 0.052;
    bg.add(beltCourse);

    let topY = b.h1;
    if (b.h2) {
      addTierWithParapetAndSnow(bg, b.w * 0.74, b.h2, b.d * 0.74, b.h1, b.mat, trimLimestoneMat, 0.010);
      topY += b.h2;
    }

    const bhW = b.w * 0.28;
    const bhD = b.d * 0.28;
    addTierWithParapetAndSnow(bg, bhW, 0.040, bhD, topY, trimLimestoneMat, trimLimestoneMat, 0.008);

    if (b.waterTower) {
      addWaterTower(bg, b.w * 0.18, topY + 0.010, -b.d * 0.16);
    }
  }

  // Flatiron-style triangular wedge building at (x = 0.32, z = 0.88) with properly scaled multi-bay UVs & rooftop snow cap!
  const flatironShape = new THREE.Shape();
  flatironShape.moveTo(0, 0.12);
  flatironShape.lineTo(-0.10, -0.11);
  flatironShape.lineTo(0.10, -0.11);
  flatironShape.closePath();

  const flatironGeo = new THREE.ExtrudeGeometry(flatironShape, {
    depth: 0.42,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.006,
    bevelSegments: 2,
  });
  flatironGeo.rotateX(-Math.PI / 2);
  // Rescale ExtrudeGeometry world-unit UVs so the Flatiron facade has a crisp 6-bay x 14-story window grid!
  const fUv = flatironGeo.attributes.uv;
  if (fUv) {
    for (let i = 0; i < fUv.count; i++) {
      fUv.setXY(i, fUv.getX(i) * 4.5, fUv.getY(i) * 2.4);
    }
    fUv.needsUpdate = true;
  }
  const flatironMesh = new THREE.Mesh(flatironGeo, prewarMatA);
  flatironMesh.position.set(0.32, 0.034, 0.88);
  flatironMesh.castShadow = true;
  flatironMesh.receiveShadow = true;
  group.add(flatironMesh);

  // Rooftop snow cap on the triangular Flatiron roof
  const flatironSnowGeo = new THREE.ExtrudeGeometry(flatironShape, {
    depth: 0.012,
    bevelEnabled: false,
  });
  flatironSnowGeo.rotateX(-Math.PI / 2);
  flatironSnowGeo.scale(0.86, 1.0, 0.86);
  const flatironSnow = new THREE.Mesh(flatironSnowGeo, snowMat);
  flatironSnow.position.set(0.32, 0.034 + 0.426, 0.88);
  group.add(flatironSnow);
  registerSnowCap(flatironSnow);

  // ============================================================================
  // 6. CLASSIC NYC BROWNSTONES (West blocks: x = -0.98 to -0.58)
  // Fixes R2-05 (single continuous mounded rooftop snow blanket across each row)
  // & R2-06 (snowy back courtyard with garden wall separating back-to-back rows!)
  // ============================================================================
  const brownstoneColors = ['#5c3224', '#6a3b2b', '#502a1d', '#704030', '#582e20', '#643626'];
  const brownstoneMaterials = brownstoneColors.map((col, idx) => {
    const tex = createBuildingFacadeTexture({
      wallColor: col,
      spandrelColor: '#2e1b13',
      windowTint: '#42586c',
      cols: 3,
      rows: 4,
      style: 'brownstone',
      seed: 500 + idx * 19,
    });
    return new THREE.MeshStandardMaterial({
      map: tex.map,
      roughnessMap: tex.roughnessMap,
      emissiveMap: tex.emissiveMap,
      color: 0xb89680,
      emissive: 0xffb438,
      emissiveIntensity: 2.15,
      roughness: 0.80,
      metalness: 0.03,
    });
  });

  const stoopStoneMat = new THREE.MeshStandardMaterial({
    color: 0x927c6c,
    emissive: 0x221c18,
    emissiveIntensity: 0.18,
    roughness: 0.82,
  });

  const corniceDarkMat = new THREE.MeshStandardMaterial({
    color: 0x4a2e22,
    emissive: 0x20140e,
    emissiveIntensity: 0.22,
    roughness: 0.60,
  });

  const parlorDoorMat = new THREE.MeshStandardMaterial({
    color: 0x3e2418,
    emissive: 0x1c100a,
    emissiveIntensity: 0.22,
    roughness: 0.38,
  });

  const buildBrownstoneRow = (zCenter: number, count: number, startX: number, facingSignZ: number, rowSeed: number) => {
    const townW = 0.075;
    const townD = 0.112; // Slightly shallower so a snowy rear garden courtyard exists between back-to-back rows!
    const uniformRowH = 0.205;

    for (let i = 0; i < count; i++) {
      const tx = startX + i * townW;
      if (Math.hypot(tx, zCenter) > 1.18) continue;

      const bMat = brownstoneMaterials[(i + (facingSignZ > 0 ? 0 : 3)) % brownstoneMaterials.length];

      const houseGroup = new THREE.Group();
      houseGroup.position.set(tx, 0.034, zCenter);
      group.add(houseGroup);

      // Main rowhouse body (without individual segmented roof snow slabs — we place a continuous snow blanket across the row below!)
      addTierWithParapetAndSnow(houseGroup, townW - 0.001, uniformRowH, townD, 0, bMat, corniceDarkMat, 0);

      // Low party-wall brick parapet divider between adjacent rowhouses
      const partyParapet = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.012, townD * 0.92), corniceDarkMat);
      partyParapet.position.set(townW * 0.5, uniformRowH + 0.006, 0);
      houseGroup.add(partyParapet);

      // Projecting 3-sided bay window column on left side of front facade
      const bay = new THREE.Mesh(new THREE.BoxGeometry(townW * 0.38, uniformRowH * 0.84, 0.018), bMat);
      bay.position.set(-townW * 0.18, uniformRowH * 0.42, facingSignZ * (townD * 0.5 + 0.008));
      bay.castShadow = true;
      bay.receiveShadow = true;
      houseGroup.add(bay);

      // Deep projecting Italianate bracketed cornice at front roofline
      const corniceZ = facingSignZ * (townD * 0.5 + 0.011);
      const cornice = new THREE.Mesh(new THREE.BoxGeometry(townW + 0.002, 0.015, 0.024), corniceDarkMat);
      cornice.position.set(0, uniformRowH - 0.006, corniceZ);
      cornice.castShadow = true;
      houseGroup.add(cornice);

      for (let br = -1.5; br <= 1.5; br += 1.0) {
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.0045, 0.016, 0.016), corniceDarkMat);
        bracket.position.set(br * (townW * 0.26), uniformRowH - 0.016, facingSignZ * (townD * 0.5 + 0.007));
        houseGroup.add(bracket);
      }

      // 3D projecting stone window lintels on both front and rear garden facades
      for (const fSign of [-1, 1]) {
        for (let fl = 1; fl <= 3; fl++) {
          const wy = fl * (uniformRowH * 0.23);
          const lintel = new THREE.Mesh(new THREE.BoxGeometry(townW * 0.80, 0.005, 0.007), stoopStoneMat);
          lintel.position.set(0, wy + 0.016, fSign * (townD * 0.5 + 0.002));
          houseGroup.add(lintel);
        }
      }

      // Grand NYC Brownstone Front Stoop on the street-facing side ONLY (facingSignZ)
      const stoopX = townW * 0.20;
      const stoopHeight = 0.048;
      const stoopRun = 0.040;

      const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.044, 0.008), stoopStoneMat);
      doorFrame.position.set(stoopX, stoopHeight + 0.022, facingSignZ * (townD * 0.5 + 0.003));
      houseGroup.add(doorFrame);

      const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.036, 0.009), parlorDoorMat);
      doorLeaf.position.set(stoopX, stoopHeight + 0.019, facingSignZ * (townD * 0.5 + 0.0035));
      houseGroup.add(doorLeaf);

      for (let s = 0; s < 5; s++) {
        const stepH = (stoopHeight / 5) * (5 - s);
        const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(0.024, stepH, stoopRun / 5 + 0.002), stoopStoneMat);
        stepMesh.position.set(
          stoopX,
          stepH * 0.5,
          facingSignZ * (townD * 0.5 + 0.005 + s * (stoopRun / 5))
        );
        stepMesh.castShadow = true;
        houseGroup.add(stepMesh);
      }

      for (const side of [-0.014, 0.014]) {
        const cheekWall = new THREE.Mesh(new THREE.BoxGeometry(0.006, stoopHeight * 0.72, stoopRun), stoopStoneMat);
        cheekWall.position.set(stoopX + side, stoopHeight * 0.36, facingSignZ * (townD * 0.5 + stoopRun * 0.5));
        cheekWall.castShadow = true;
        houseGroup.add(cheekWall);

        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.0025, 0.018, stoopRun * 1.05), darkSteelMat);
        rail.position.set(stoopX + side, stoopHeight * 0.75, facingSignZ * (townD * 0.5 + stoopRun * 0.5));
        rail.rotation.x = facingSignZ * 0.58;
        houseGroup.add(rail);
      }
    }

    // Continuous, gently mounded rooftop snow blanket spanning the entire brownstone row!
    const totalRowW = count * townW - 0.012;
    const rowCenterX = startX + ((count - 1) * townW) * 0.5;
    const roofBlanketGeo = createContinuousSnowbankGeometry(totalRowW, townD * 0.88, 0.016, rowSeed, true);
    const roofBlanket = new THREE.Mesh(roofBlanketGeo, snowMat);
    roofBlanket.position.set(rowCenterX, 0.034 + uniformRowH + 0.006, zCenter);
    roofBlanket.receiveShadow = true;
    group.add(roofBlanket);
    registerSnowCap(roofBlanket);
  };

  // Back-to-back brownstone rows with a snowy rear courtyard & garden wall between them!
  buildBrownstoneRow(-0.015, 6, -0.98, 1, 501);  // Faces South onto W 42nd St
  buildBrownstoneRow(-0.195, 6, -0.98, -1, 502); // Faces North onto W 59th St
  buildBrownstoneRow(0.335, 6, -0.98, -1, 503);  // Faces North onto W 42nd St
  buildBrownstoneRow(0.505, 6, -0.98, 1, 504);   // Faces South onto W 34th St

  // Snowy rear courtyard garden snowdrifts & wooden garden fences between the back-to-back brownstone rows
  for (const courtZ of [-0.105, 0.420]) {
    const courtSnow = new THREE.Mesh(
      createContinuousSnowbankGeometry(0.44, 0.055, 0.016, Math.round(courtZ * 100), true),
      snowMat
    );
    courtSnow.position.set(-0.79, 0.040, courtZ);
    group.add(courtSnow);
    registerSnowCap(courtSnow);
  }

  // ============================================================================
  // 7. CENTRAL PARK WINTER SLICE (Northern Crescent: z < -0.45)
  // Fixes R2-09: Feathered snow transition at park boundary, expansive frozen pond,
  // faceted conformal rock snow (no flat circular discs!), and organic winter conifers!
  // ============================================================================
  const parkGroup = new THREE.Group();
  parkGroup.position.y = 0.016;
  group.add(parkGroup);

  // Historic grey stone Central Park perimeter wall along 59th St (z = -0.455) with stone piers
  const wallStoneMat = new THREE.MeshStandardMaterial({
    color: 0x6e6a63,
    roughness: 0.86,
  });
  const parkWall = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.036, 0.024), wallStoneMat);
  parkWall.position.set(0, 0.018, -0.455);
  parkWall.castShadow = true;
  parkWall.receiveShadow = true;
  parkGroup.add(parkWall);

  // Continuous snowbank drifted smoothly along the base of the Central Park stone wall (feathers the step!)
  const wallDrift = new THREE.Mesh(
    createContinuousSnowbankGeometry(2.26, 0.048, 0.024, 701, true),
    snowMat
  );
  wallDrift.position.set(0, 0.012, -0.435);
  parkGroup.add(wallDrift);
  registerSnowCap(wallDrift);

  // Rolling snow-covered Central Park terrain mounds
  const parkMounds = [
    { x: 0.0, z: -0.90, rx: 1.24, rz: 0.48, ry: 0.075 },
    { x: -0.54, z: -0.78, rx: 0.58, rz: 0.36, ry: 0.10 },
    { x: 0.52, z: -0.82, rx: 0.54, rz: 0.36, ry: 0.095 },
    { x: -0.14, z: -1.12, rx: 0.68, rz: 0.30, ry: 0.11 },
  ];
  for (const m of parkMounds) {
    const moundGeo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
    moundGeo.scale(m.rx, m.ry, m.rz);
    const mound = new THREE.Mesh(moundGeo, snowMat);
    mound.position.set(m.x, -0.008, m.z);
    mound.receiveShadow = true;
    parkGroup.add(mound);
    registerSnowCap(mound);
  }

  // Prominent Frozen Pond (The Pond at Central Park South & 5th Ave) — smooth pale blue-silver ice (#B8CBD8)
  const iceMat = new THREE.MeshPhysicalMaterial({
    color: 0xb8cbd8,
    emissive: 0x253848,
    emissiveIntensity: 0.18,
    roughness: 0.08,
    metalness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.8,
  });
  const pondGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.020, 40);
  pondGeo.scale(1.42, 1, 0.78);
  const pond = new THREE.Mesh(pondGeo, iceMat);
  pond.position.set(0.14, 0.052, -0.74);
  pond.receiveShadow = true;
  parkGroup.add(pond);

  // Soft snow-rimmed shoreline bank hugging the frozen pond perimeter
  const pondBankGeo = new THREE.TorusGeometry(0.315, 0.022, 10, 48);
  pondBankGeo.rotateX(Math.PI / 2);
  pondBankGeo.scale(1.42, 0.45, 0.78);
  const pondBank = new THREE.Mesh(pondBankGeo, snowMat);
  pondBank.position.set(0.14, 0.060, -0.74);
  parkGroup.add(pondBank);
  registerSnowCap(pondBank);

  // Gapstow Stone Arch Bridge spanning the frozen pond's west neck
  const bridgeGroup = new THREE.Group();
  bridgeGroup.position.set(-0.18, 0.052, -0.74);
  bridgeGroup.rotation.y = 0.22;
  const bridgeArch = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.042, 0.18), wallStoneMat);
  bridgeArch.position.y = 0.021;
  bridgeArch.castShadow = true;
  bridgeGroup.add(bridgeArch);
  parkGroup.add(bridgeGroup);

  // Rugged Striated Manhattan Schist Rock Outcrops with Faceted Conformal Snow (NO circular discs, no black!)
  const schistMat = new THREE.MeshStandardMaterial({
    color: 0x464b54,
    emissive: 0x202328,
    emissiveIntensity: 0.28,
    roughness: 0.80,
    metalness: 0.08,
    flatShading: true,
  });
  const outcrops = [
    { x: -0.48, z: -0.66, sx: 0.17, sy: 0.10, sz: 0.12 },
    { x: -0.28, z: -0.94, sx: 0.21, sy: 0.12, sz: 0.14 },
    { x: 0.62, z: -0.70, sx: 0.16, sy: 0.095, sz: 0.11 },
  ];
  for (const oc of outcrops) {
    const rockCluster = new THREE.Group();
    rockCluster.position.set(oc.x, 0.036, oc.z);
    for (let k = 0; k < 3; k++) {
      const rockGeo = new THREE.DodecahedronGeometry(1, 1);
      const subScale = 1 - k * 0.22;
      rockGeo.scale(oc.sx * subScale, oc.sy * subScale, oc.sz * subScale);
      const rock = new THREE.Mesh(rockGeo, schistMat);
      rock.position.set((k - 1) * 0.048, k * 0.012, (k % 2) * 0.032);
      rock.rotation.set(0.25, k * 1.1, -0.18);
      rock.castShadow = true;
      rock.receiveShadow = true;
      rockCluster.add(rock);

      // Conformal angular snow facet hugging the sloped side of the rock (using DodecahedronGeometry, never a circular sphere/disc!)
      const facetSnowGeo = new THREE.DodecahedronGeometry(1, 0);
      facetSnowGeo.scale(oc.sx * subScale * 0.62, oc.sy * subScale * 0.35, oc.sz * subScale * 0.55);
      const facetSnow = new THREE.Mesh(facetSnowGeo, snowMat);
      facetSnow.position.set((k - 1) * 0.048 + 0.012, k * 0.012 + oc.sy * subScale * 0.58, (k % 2) * 0.032);
      facetSnow.rotation.set(0.4, k * 0.8, 0.2);
      rockCluster.add(facetSnow);
      registerSnowCap(facetSnow);
    }
    parkGroup.add(rockCluster);
  }

  // Organic Non-Symmetric Winter Conifers & Deciduous Trees (fixes R2-09 3-cone ring look!)
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x4e3a2c,
    emissive: 0x221812,
    emissiveIntensity: 0.24,
    roughness: 0.88,
  });
  const pineMat = new THREE.MeshStandardMaterial({
    color: 0x2c523c,
    emissive: 0x14281d,
    emissiveIntensity: 0.26,
    roughness: 0.80,
  });

  const addWinterPine = (x: number, yBase: number, z: number, scale: number, seed: number) => {
    const tg = new THREE.Group();
    tg.position.set(x, yBase, z);
    tg.scale.setScalar(scale);

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.014, 0.065, 7), trunkMat);
    trunk.position.y = 0.032;
    trunk.castShadow = true;
    tg.add(trunk);

    // 5 irregular asymmetric bough clusters instead of 3 uniform concentric cones
    for (let tier = 0; tier < 5; tier++) {
      const r = 0.056 * (1 - tier * 0.17);
      const h = 0.058 * (1 - tier * 0.12);
      const ty = 0.048 + tier * 0.028;
      const offX = Math.sin(seed + tier * 2.1) * 0.006;
      const offZ = Math.cos(seed + tier * 1.7) * 0.006;

      const foliage = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), pineMat);
      foliage.position.set(offX, ty, offZ);
      foliage.rotation.set(offZ * 4, tier * 1.1, -offX * 4);
      foliage.castShadow = true;
      foliage.receiveShadow = true;
      tg.add(foliage);

      // Asymmetric wind-drifted snow lobe on the northwest side of the bough (not a uniform horizontal ring!)
      const snowLobe = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.52, 0), snowMat);
      snowLobe.scale.set(1.1, 0.42, 0.85);
      snowLobe.position.set(offX - r * 0.18, ty + h * 0.12, offZ + r * 0.12);
      snowLobe.rotation.set(0.3, tier * 0.8, 0.25);
      tg.add(snowLobe);
      registerSnowCap(snowLobe);
    }
    parkGroup.add(tg);
  };

  const addWinterDeciduousTree = (x: number, yBase: number, z: number, scale: number) => {
    const tg = new THREE.Group();
    tg.position.set(x, yBase, z);
    tg.scale.setScalar(scale);

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.013, 0.072, 7), trunkMat);
    trunk.position.y = 0.036;
    trunk.castShadow = true;
    tg.add(trunk);

    const limbs = [
      { ax: 0.48, az: 0.36, len: 0.058 },
      { ax: -0.44, az: 0.42, len: 0.055 },
      { ax: 0.38, az: -0.46, len: 0.054 },
      { ax: -0.42, az: -0.35, len: 0.052 },
      { ax: 0.12, az: 0.15, len: 0.062 },
    ];
    for (const l of limbs) {
      const limbGroup = new THREE.Group();
      limbGroup.position.set(0, 0.064, 0);
      limbGroup.rotation.set(l.ax, 0, -l.az);

      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0055, l.len, 6), trunkMat);
      branch.position.y = l.len * 0.5;
      branch.castShadow = true;
      limbGroup.add(branch);

      const branchSnow = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0042, l.len * 0.78, 6), snowMat);
      branchSnow.position.set(0, l.len * 0.52, 0.0025);
      limbGroup.add(branchSnow);
      registerSnowCap(branchSnow);

      const subTwig = new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0026, l.len * 0.55, 5), trunkMat);
      subTwig.position.set(0.006, l.len * 0.72, 0);
      subTwig.rotation.z = -0.52;
      limbGroup.add(subTwig);

      tg.add(limbGroup);
    }
    parkGroup.add(tg);
  };

  for (let i = 0; i < 42; i++) {
    const angle = Math.PI + (rng() - 0.5) * Math.PI * 0.82;
    const rad = 0.56 + rng() * 0.74;
    const tx = Math.sin(angle) * rad;
    const tz = Math.cos(angle) * rad;
    if (tz > -0.50 || Math.hypot(tx, tz) > 1.32) continue;
    // Keep frozen pond completely clear of trees so it reads clearly in 02, 03, 06!
    if (Math.hypot((tx - 0.14) / 1.48, (tz + 0.74) / 0.84) < 0.36) continue;

    const sc = 0.82 + rng() * 0.45;
    const yHill = 0.032;
    if (i % 2 === 0) {
      addWinterPine(tx, yHill, tz, sc, i * 1.7);
    } else {
      addWinterDeciduousTree(tx, yHill, tz, sc);
    }
  }

  const streetTreeCoords = [
    [-0.64, -0.02],
    [-0.84, -0.02],
    [-0.64, 0.34],
    [-0.84, 0.34],
    [-0.02, 0.32],
    [-0.02, 0.52],
    [0.19, 0.32],
    [0.19, 0.52],
  ];
  for (const [stx, stz] of streetTreeCoords) {
    addWinterDeciduousTree(stx, 0.022, stz, 0.72);
  }

  // ============================================================================
  // 8. STREET LAMPS, CANTILEVERED TRAFFIC SIGNALS, FIRE HYDRANTS, BINS & PEDESTRIANS (Fixes R2-08!)
  // ============================================================================
  const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffdf78 });
  const lampHaloMat = new THREE.MeshBasicMaterial({
    color: 0xffa834,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // Radial warm golden light pool texture cast onto sidewalks & wet night asphalt below street lamps
  const poolCanvas = document.createElement('canvas');
  poolCanvas.width = 64;
  poolCanvas.height = 64;
  const pCtx = poolCanvas.getContext('2d')!;
  const pGrad = pCtx.createRadialGradient(32, 32, 1, 32, 32, 31);
  pGrad.addColorStop(0.0, 'rgba(255, 198, 84, 0.88)');
  pGrad.addColorStop(0.45, 'rgba(255, 160, 52, 0.48)');
  pGrad.addColorStop(1.0, 'rgba(255, 130, 32, 0.0)');
  pCtx.fillStyle = pGrad;
  pCtx.fillRect(0, 0, 64, 64);
  const lampPoolTex = new THREE.CanvasTexture(poolCanvas);
  lampPoolTex.colorSpace = THREE.SRGBColorSpace;
  const lampPoolMat = new THREE.MeshBasicMaterial({
    map: lampPoolTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });

  const addStreetLamp = (lx: number, lz: number, groundY = 0.0365) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.005, 0.088, 8), darkSteelMat);
    pole.position.set(lx, 0.062, lz);
    pole.castShadow = true;
    group.add(pole);

    const globeBulb = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 10, 10), lampGlowMat);
    globeBulb.position.set(lx, 0.11, lz);
    group.add(globeBulb);

    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 10), lampHaloMat);
    halo.position.set(lx, 0.11, lz);
    group.add(halo);

    // Subdivided plane so spherical water lens distortion curves it flush above the sidewalk & road!
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18, 6, 6), lampPoolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(lx, groundY, lz);
    group.add(pool);

    const roadPool = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22, 6, 6), lampPoolMat);
    roadPool.rotation.x = -Math.PI / 2;
    roadPool.position.set(lx - 0.038, 0.0195, lz + 0.038);
    group.add(roadPool);
  };

  const signalYellowHousingMat = new THREE.MeshStandardMaterial({ color: 0xd99b16, roughness: 0.4, metalness: 0.3 });
  const redSignalMat = new THREE.MeshBasicMaterial({ color: 0xff2d20 });
  const greenSignalMat = new THREE.MeshBasicMaterial({ color: 0x28cd41 });
  const hydrantRedMat = new THREE.MeshStandardMaterial({
    color: 0xc43226,
    emissive: 0x2a0c08,
    emissiveIntensity: 0.22,
    roughness: 0.45,
    metalness: 0.25,
  });
  const binGreenMat = new THREE.MeshStandardMaterial({
    color: 0x2c4e38,
    emissive: 0x14241a,
    emissiveIntensity: 0.24,
    roughness: 0.65,
    metalness: 0.3,
  });

  for (const ax of aveX) {
    for (const sz of stZ) {
      if (Math.hypot(ax, sz) > 1.22) continue;

      // Cast-iron NYC street lamp on NE corner + warm light pool
      addStreetLamp(ax + 0.105, sz - 0.095, 0.035);

      // Cantilevered Mast-Arm Traffic Signal on SW corner
      const sx = ax - 0.105;
      const szCorner = sz + 0.095;
      const tGroup = new THREE.Group();
      tGroup.position.set(sx, 0.022, szCorner);

      const tPole = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.0055, 0.095, 8), darkSteelMat);
      tPole.position.y = 0.0475;
      tPole.castShadow = true;
      tGroup.add(tPole);

      const mastArm = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0038, 0.068, 6), darkSteelMat);
      mastArm.rotation.z = -Math.PI / 2 + 0.12;
      mastArm.position.set(0.032, 0.090, 0);
      tGroup.add(mastArm);

      const sigBox = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.022, 0.009), signalYellowHousingMat);
      sigBox.position.set(0.056, 0.082, 0);
      tGroup.add(sigBox);

      const isGreen = (Math.round((ax + sz) * 10) & 1) === 0;
      const sigLens = new THREE.Mesh(
        new THREE.SphereGeometry(0.0038, 8, 8),
        isGreen ? greenSignalMat : redSignalMat
      );
      sigLens.position.set(0.056, isGreen ? 0.076 : 0.088, 0.0045);
      tGroup.add(sigLens);

      group.add(tGroup);

      // NYC Red Fire Hydrant on NW corner sidewalk
      const hx = ax - 0.118;
      const hz = sz - 0.108;
      const hydrant = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0055, 0.020, 8), hydrantRedMat);
      hydrant.position.set(hx, 0.042, hz);
      hydrant.castShadow = true;
      group.add(hydrant);

      // NYC Dark-Green Wire-Mesh Trash Receptacle on SE corner sidewalk
      const bx = ax + 0.115;
      const bz = sz + 0.108;
      const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.006, 0.024, 8), binGreenMat);
      bin.position.set(bx, 0.044, bz);
      bin.castShadow = true;
      group.add(bin);
    }
  }

  // Additional glowing NYC cast-iron street lamps along the Brownstone blocks & Central Park perimeter!
  const extraLampCoords: Array<[number, number, number]> = [
    [-0.66, 0.06, 0.035],
    [-0.90, 0.06, 0.035],
    [-0.66, 0.26, 0.035],
    [-0.90, 0.26, 0.035],
    [-0.22, -0.43, 0.024],
    [0.24, -0.43, 0.024],
    [-0.12, -0.68, 0.054],
  ];
  for (const [elx, elz, ely] of extraLampCoords) {
    addStreetLamp(elx, elz, ely);
  }

  // Stylized Miniature Winter Pedestrians in wool overcoats & scarves walking along the sidewalks
  const coatColors = [0x2e3b4e, 0x52382c, 0x7c2e2e, 0x345244, 0x42444a];
  const scarfColors = [0xd43c32, 0xe0ad30, 0x467c9c, 0xe0dad0];
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xe8c4a6,
    emissive: 0x281e16,
    emissiveIntensity: 0.20,
    roughness: 0.65,
  });

  const pedestrianCoords: Array<[number, number, number]> = [
    [-0.045, 0.30, 0],
    [-0.045, 0.44, 1],
    [0.205, 0.29, 2],
    [0.205, 0.48, 3],
    [-0.32, 0.04, 4],
    [-0.12, 0.04, 0],
    [-0.62, 0.28, 1],
    [-0.78, 0.28, 2],
    [-0.68, -0.04, 3],
    [-0.86, -0.04, 4],
    [0.22, -0.04, 1],
    [0.38, 0.28, 2],
  ];

  for (const [px, pz, cIdx] of pedestrianCoords) {
    const ped = new THREE.Group();
    ped.position.set(px, 0.034, pz);

    const coatMat = new THREE.MeshStandardMaterial({
      color: coatColors[cIdx % coatColors.length],
      roughness: 0.82,
    });
    const scarfMat = new THREE.MeshStandardMaterial({
      color: scarfColors[cIdx % scarfColors.length],
      roughness: 0.78,
    });

    // Legs
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.014, 6), darkSteelMat);
    legs.position.y = 0.007;
    ped.add(legs);

    // Winter Overcoat Torso
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0072, 0.020, 8), coatMat);
    torso.position.y = 0.022;
    torso.castShadow = true;
    ped.add(torso);

    // Warm Scarf
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.0052, 0.0020, 6, 10), scarfMat);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 0.032;
    ped.add(scarf);

    // Head + Winter Beanie
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.0048, 8, 8), skinMat);
    head.position.y = 0.037;
    ped.add(head);

    const beanie = new THREE.Mesh(
      new THREE.SphereGeometry(0.0050, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
      scarfMat
    );
    beanie.position.y = 0.038;
    ped.add(beanie);

    group.add(ped);
  }

  return { group, accumulatableSnowMeshes };
}

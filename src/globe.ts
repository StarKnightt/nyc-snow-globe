import * as THREE from 'three/webgpu';
import {
  cameraPosition,
  clamp,
  cross,
  dot,
  exp,
  float,
  Fn,
  max,
  min,
  mix,
  normalLocal,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
  sqrt,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  createBrassPlaqueTexture,
  createPaleWoodDeskTextures,
  createWalnutBaseTexture,
  createWinterWindowRoomTexture,
} from './textures';

export interface GlobeAssembly {
  root: THREE.Group;
  deskBackdropGroup: THREE.Group;
  globeRig: THREE.Group;
  cityMount: THREE.Group;
  glassDome: THREE.Mesh;
  alignBackdropToCamera: (camPos: THREE.Vector3) => void;
  updateOptics: (elapsed: number, tiltX: number, tiltZ: number, sloshX: number, sloshZ: number) => void;
}

export const SPHERE_CENTER_Y = 1.82;
export const R_OUTER = 1.66;
export const R_INNER = 1.57;
export const CITY_FLOOR_Y = 1.24;

/**
 * Generates a soft, out-of-focus Gaussian bokeh snowflake sprite texture for the light snow
 * falling outside the night window behind the desk.
 */
function createSoftExteriorSnowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size * 0.5, size * 0.5, 2, size * 0.5, size * 0.5, size * 0.48);
  grad.addColorStop(0.0, 'rgba(198, 220, 248, 0.42)');
  grad.addColorStop(0.45, 'rgba(182, 208, 242, 0.30)');
  grad.addColorStop(0.75, 'rgba(164, 194, 234, 0.12)');
  grad.addColorStop(1.0, 'rgba(150, 180, 225, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds the Cozy Winter Night scene:
 * - Warm straight-grain walnut desk illuminated primarily by the warm golden glow spilling out of the snow globe
 *   around the base, with gentle warm golden & prismatic caustics rippling across the wood grain.
 * - Distant curved night window backdrop at `R_WINDOW = 10.5` (well outside camera orbit `camRadius <= 8.2` so it
 *   never clips!), showing an out-of-focus night NYC skyline, warm/cool circular bokeh, thin softly blurred window
 *   frames, and real-time light snow falling outside the window.
 * - Turned American walnut & brushed champagne brass pedestal base.
 * - Crystal-clear borosilicate glass dome with a warm side-lamp rim light on the left edge and delicate cool night
 *   window rim highlight on the right edge.
 */
export function buildSnowGlobeAndDesk(scene: THREE.Scene): GlobeAssembly {
  const root = new THREE.Group();
  scene.add(root);

  // ============================================================================
  // 1. WARM STRAIGHT-GRAIN WALNUT DESK (LIT BY GLOBE GLOW + GENTLE CAUSTICS)
  //    & CURVED OUT-OF-FOCUS NIGHT NYC WINDOW BACKDROP AT R = 10.5
  // ============================================================================
  const deskBackdropGroup = new THREE.Group();
  root.add(deskBackdropGroup);

  const deskTex = createPaleWoodDeskTextures();
  const uCausticShift = uniform(new THREE.Vector2(0, 0));
  const uTime = uniform(0.0);

  const deskMat = new THREE.MeshStandardNodeMaterial({
    roughnessMap: deskTex.roughnessMap,
    bumpMap: deskTex.bumpMap,
    bumpScale: 0.004,
    roughness: 0.44,
    metalness: 0.02,
    envMapIntensity: 0.35,
  });

  // TSL colorNode on the walnut desk:
  // - Away from the globe, the straight-grain walnut desk sits in cozy, warm-dark night room light (never pure black!).
  // - Around the base (r = 1.33..4.6), the warm golden glow spilling out of the snow globe illuminates the walnut
  //   tabletop with a rich warm golden-amber pool of light and gentle warm golden + prismatic caustics!
  const deskSurfaceNode = Fn(() => {
    const woodUv = uv().mul(vec2(2.5, 2.0));
    const baseWood = texture(deskTex.map, woodUv).rgb;

    const x = positionLocal.x.sub(uCausticShift.x);
    const z = positionLocal.z.sub(uCausticShift.y);
    const r = sqrt(x.mul(x).add(z.mul(z)));

    // Key light & dispersive caustic axis pointing to the right-front of the base (+x, +z at ~14 deg)
    const cosA = float(0.970);
    const sinA = float(0.242);
    const u = x.mul(cosA).add(z.mul(sinA));
    const v = z.mul(cosA).sub(x.mul(sinA));

    // 1. Tight contact AO directly under the walnut base foot (r = 1.33)
    const contactAO = mix(float(0.34), float(1.0), smoothstep(1.30, 1.44, r));

    // 2. Soft globe shadow penumbra on the right (+u) from the warm side lamp, blended with the globe's own internal glow
    const eu = u.sub(1.42).div(0.98);
    const ev = v.div(0.86);
    const eDistSq = eu.mul(eu).add(ev.mul(ev));
    const penumbra = exp(eDistSq.mul(-1.60)).mul(0.28).mul(smoothstep(0.0, 0.65, u));

    const topFaceMask = smoothstep(0.2, 0.8, normalLocal.y);

    // 3. Warm Golden Glow Spilling Out of the Snow Globe onto the Walnut Desk (r from 1.32 out to 4.2)
    //    with subtle multi-rayed architectural window modulation so it looks physically cast by the city inside!
    const rFromBase = max(0.0, r.sub(1.32));
    const rayPattern = float(0.82)
      .add(float(0.12).mul(u.mul(3.6).add(v.mul(2.4)).cos()))
      .add(float(0.08).mul(u.mul(6.2).sub(v.mul(5.1)).sin()));
    const innerGlobeSpill = exp(rFromBase.mul(rFromBase).div(-1.85)).mul(smoothstep(1.26, 1.38, r)).mul(rayPattern);
    const wideGlobeSpill = exp(r.mul(r).div(-10.5)).mul(smoothstep(1.26, 1.40, r));
    const totalGlobeSpill = innerGlobeSpill.mul(0.76).add(wideGlobeSpill.mul(0.38)).mul(topFaceMask);

    // Cozy dark-warm night room ambient falloff toward the outer edges of the desk (never drops to black!)
    const roomVignette = mix(float(0.28), float(0.64), exp(r.mul(r).div(-12.0)));
    const shadowMult = mix(float(0.48), min(contactAO, float(1.0).sub(penumbra)).mul(roomVignette), topFaceMask);

    // Base walnut wood shaded by cozy night room light + illuminated warmly by the glowing snow globe!
    const nightWood = baseWood.mul(vec3(shadowMult.mul(1.08), shadowMult.mul(0.92), shadowMult.mul(0.76)));
    const spillColor = vec3(1.42, 0.92, 0.38).mul(totalGlobeSpill);
    const shadedWood = nightWood.mul(vec3(1.0).add(spillColor)).add(baseWood.mul(spillColor.mul(0.26))).toVar();

    // 4. Organic, Non-Concentric Refracted Warm Golden Caustic Cusps & Lobes (NO concentric bullseye circles!)
    //    Formed by light from the miniature city & side lamp refracting through the spherical water lens onto the wood grain
    const shiftA = u.sub(0.28).mul(0.85).add(v.mul(v).mul(0.32));
    const rWarpA = sqrt(shiftA.mul(shiftA).add(v.mul(v).mul(0.92)));
    const dCuspA = rWarpA.sub(float(1.42).add(u.mul(3.1).add(v.mul(4.4)).sin().mul(0.08))).div(0.11);

    const shiftB = u.add(0.18).mul(0.92).sub(v.mul(v).mul(0.24));
    const rWarpB = sqrt(shiftB.mul(shiftB).add(v.sub(0.12).mul(v.sub(0.12)).mul(0.88)));
    const dCuspB = rWarpB.sub(float(1.58).add(u.mul(4.5).sub(v.mul(3.6)).cos().mul(0.09))).div(0.14);

    // Intersecting organic caustic filaments modulated by directional window lobes
    const lobeMask = float(0.45)
      .add(float(0.35).mul(smoothstep(-0.4, 0.9, u)))
      .add(float(0.25).mul(u.mul(2.4).sub(v.mul(3.1)).add(uTime.mul(0.6)).sin()));
    const organicCaustic = exp(dCuspA.mul(dCuspA).negate()).mul(0.52)
      .add(exp(dCuspB.mul(dCuspB).negate()).mul(0.38))
      .mul(lobeMask)
      .mul(smoothstep(1.33, 1.42, r))
      .mul(float(1.0).sub(smoothstep(2.15, 2.75, r)))
      .mul(topFaceMask);

    const warmGoldenCaustic = vec3(1.18, 0.76, 0.26).mul(organicCaustic);

    // 5. Focused Cardioid Dispersive Warm-Prismatic Caustic on the right-front of the base (r in 1.36..1.92)
    const cu = u.sub(0.14);
    const cv = v.mul(1.14);
    const cr = sqrt(cu.mul(cu).add(cv.mul(cv)));

    const angEnv = exp(v.mul(v).div(-0.145))
      .mul(smoothstep(1.34, 1.40, r))
      .mul(float(1.0).sub(smoothstep(1.88, 2.15, r)))
      .mul(smoothstep(0.75, 1.18, u))
      .mul(topFaceMask);

    const curveMod = v.mul(v).mul(0.15);
    const dR = cr.sub(float(1.64).sub(curveMod)).div(0.046);
    const dG = cr.sub(float(1.57).sub(curveMod)).div(0.044);
    const dB = cr.sub(float(1.50).sub(curveMod)).div(0.046);

    const cR = exp(dR.mul(dR).negate()).mul(angEnv);
    const dInner = cr.sub(float(1.44).sub(curveMod.mul(0.5))).div(0.072);
    const innerGold = exp(dInner.mul(dInner).negate()).mul(angEnv).mul(0.78);
    const cG = exp(dG.mul(dG).negate()).mul(angEnv);
    const cB = exp(dB.mul(dB).negate()).mul(angEnv);

    const caustRGB = vec3(
      cR.mul(1.25).add(innerGold.mul(1.45)),
      cG.mul(1.02).add(innerGold.mul(1.02)),
      cB.mul(0.92).add(innerGold.mul(0.38))
    ).add(warmGoldenCaustic);

    // Modulate the walnut wood grain itself so the straight walnut fibers glow inside the warm pool & caustics!
    shadedWood.assign(shadedWood.mul(vec3(1.0).add(caustRGB.mul(1.75))).add(caustRGB.mul(0.14)));

    return shadedWood;
  })();

  deskMat.colorNode = deskSurfaceNode;

  // Large walnut tabletop (20.0 wide x 11.2 deep, spanning z in [-5.6, +5.6]) so 06_top_overview sees 100% continuous walnut wood
  // and hero/side/north views cleanly meet the bottom of the curved night window at z = -10.5!
  const deskGeo = new THREE.BoxGeometry(20.0, 0.24, 11.2);
  const deskMesh = new THREE.Mesh(deskGeo, deskMat);
  deskMesh.position.set(0.0, -0.12, 0.0);
  deskMesh.receiveShadow = false;
  deskBackdropGroup.add(deskMesh);

  // Distant curved Cozy Winter Night Window Backdrop at R_WINDOW = 10.5 (well outside max camera orbit radius 8.2!)
  // Zero flat planes at z = -2.55 and zero sharp 3D BoxGeometry mullions!
  const R_WINDOW = 10.5;
  const WINDOW_ARC = 0.96; // ±55 deg around -Z
  const WINDOW_H = 7.0;    // spans y in [-1.20, +5.80]
  const winterWindowTex = createWinterWindowRoomTexture();
  const windowBackdropMat = new THREE.MeshBasicMaterial({
    map: winterWindowTex,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const windowWallGeo = new THREE.CylinderGeometry(
    R_WINDOW,
    R_WINDOW,
    WINDOW_H,
    72,
    1,
    true,
    Math.PI - WINDOW_ARC,
    WINDOW_ARC * 2
  );
  // Explicitly map UVs so u = 0 is left (-X), u = 1 is right (+X), v = 0 is bottom, v = 1 is top
  const wPos = windowWallGeo.attributes.position;
  const wUv = windowWallGeo.attributes.uv;
  for (let i = 0; i < wPos.count; i++) {
    const vx = wPos.getX(i);
    const vy = wPos.getY(i);
    const vz = wPos.getZ(i);
    const angFromNegZ = Math.atan2(vx, -vz);
    const uCoord = THREE.MathUtils.clamp((angFromNegZ / WINDOW_ARC) * 0.5 + 0.5, 0, 1);
    const vCoord = THREE.MathUtils.clamp((vy + WINDOW_H * 0.5) / WINDOW_H, 0, 1);
    wUv.setXY(i, uCoord, vCoord);
  }
  wUv.needsUpdate = true;

  const windowWallMesh = new THREE.Mesh(windowWallGeo, windowBackdropMat);
  windowWallMesh.position.set(0.0, 2.30, 0.0);
  deskBackdropGroup.add(windowWallMesh);

  // Light Snow Falling Outside the Night Window (240 soft out-of-focus bokeh snowflakes drifting down behind the desk!)
  const EXT_SNOW_COUNT = 240;
  const extSnowGeo = new THREE.PlaneGeometry(0.24, 0.24);
  const extSnowMat = new THREE.MeshBasicMaterial({
    map: createSoftExteriorSnowTexture(),
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const extSnowMesh = new THREE.InstancedMesh(extSnowGeo, extSnowMat, EXT_SNOW_COUNT);
  extSnowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  deskBackdropGroup.add(extSnowMesh);

  const extSnowAng = new Float32Array(EXT_SNOW_COUNT);
  const extSnowRad = new Float32Array(EXT_SNOW_COUNT);
  const extSnowY0 = new Float32Array(EXT_SNOW_COUNT);
  const extSnowSpeed = new Float32Array(EXT_SNOW_COUNT);
  const extSnowScale = new Float32Array(EXT_SNOW_COUNT);
  const extSnowPhase = new Float32Array(EXT_SNOW_COUNT);

  for (let i = 0; i < EXT_SNOW_COUNT; i++) {
    // Spread across the 3 window panes (angle within ±0.56 * WINDOW_ARC, avoiding the outer room walls)
    const u = ((i * 0.61803398875) % 1.0) * 2.0 - 1.0;
    extSnowAng[i] = u * (WINDOW_ARC * 0.56);
    extSnowRad[i] = 8.6 + ((i * 0.381966) % 1.0) * 1.4; // r in [8.6, 10.0], right in front of the R=10.5 window!
    extSnowY0[i] = ((i * 0.75487766) % 1.0) * 6.8 - 1.2; // y in [-1.2, +5.6]
    extSnowSpeed[i] = 0.28 + ((i * 0.29) % 0.24);
    extSnowScale[i] = 0.72 + ((i * 0.43) % 0.90);
    extSnowPhase[i] = i * 1.73;
  }

  const updateExteriorSnow = (elapsed: number) => {
    const arr = extSnowMesh.instanceMatrix.array as Float32Array;
    const yMin = -1.2;
    const yMax = 5.5;
    const ySpan = yMax - yMin;

    for (let i = 0; i < EXT_SNOW_COUNT; i++) {
      const mOff = i * 16;
      const swayAng = extSnowAng[i] + Math.sin(elapsed * 0.55 + extSnowPhase[i]) * 0.018;
      // Gently fade flakes if they pass behind the two thin vertical mullions (nx = ±0.26)
      const nx = swayAng / WINDOW_ARC;
      const nearMullion = Math.min(Math.abs(nx - 0.26), Math.abs(nx + 0.26));
      const mulFade = THREE.MathUtils.smoothstep(nearMullion, 0.008, 0.024);

      const rawY = extSnowY0[i] - elapsed * extSnowSpeed[i];
      const y = yMin + (((rawY - yMin) % ySpan) + ySpan) % ySpan;

      const r = extSnowRad[i];
      const x = Math.sin(swayAng) * r;
      const z = -Math.cos(swayAng) * r;
      const s = extSnowScale[i] * mulFade;

      arr[mOff] = s;
      arr[mOff + 1] = 0;
      arr[mOff + 2] = 0;
      arr[mOff + 3] = 0;
      arr[mOff + 4] = 0;
      arr[mOff + 5] = s;
      arr[mOff + 6] = 0;
      arr[mOff + 7] = 0;
      arr[mOff + 8] = 0;
      arr[mOff + 9] = 0;
      arr[mOff + 10] = s;
      arr[mOff + 11] = 0;
      arr[mOff + 12] = x;
      arr[mOff + 13] = y;
      arr[mOff + 14] = z;
      arr[mOff + 15] = 1;
    }
    extSnowMesh.instanceMatrix.needsUpdate = true;
  };
  updateExteriorSnow(0);

  // Cozy dark warm-espresso outer room enclosure (never pure black #000000!)
  const roomGeo = new THREE.SphereGeometry(28, 32, 24);
  const roomMesh = new THREE.Mesh(
    roomGeo,
    new THREE.MeshBasicMaterial({
      color: 0x221b18,
      side: THREE.BackSide,
      depthWrite: false,
    })
  );
  root.add(roomMesh);

  // ============================================================================
  // 2. GLOBE RIG (TILTS & SHAKES AS ONE PHYSICAL OBJECT)
  // ============================================================================
  const globeRig = new THREE.Group();
  root.add(globeRig);

  // Lifted warm dark-umber felt pad under the base (never pure black!)
  const feltMat = new THREE.MeshStandardMaterial({
    color: 0x3e3229,
    emissive: 0x1e1712,
    emissiveIntensity: 0.38,
    roughness: 0.88,
  });
  const feltPad = new THREE.Mesh(new THREE.CylinderGeometry(1.33, 1.33, 0.025, 64), feltMat);
  feltPad.position.y = 0.0125;
  globeRig.add(feltPad);

  // Turned American Walnut Pedestal Base
  const walnutTex = createWalnutBaseTexture();
  const walnutMat = new THREE.MeshPhysicalMaterial({
    map: walnutTex.map,
    roughnessMap: walnutTex.roughnessMap,
    color: 0xc89268,
    emissive: 0x2a190e,
    emissiveIntensity: 0.30,
    roughness: 0.28,
    metalness: 0.04,
    clearcoat: 0.68,
    clearcoatRoughness: 0.16,
    envMapIntensity: 1.35,
  });

  const lathePoints: THREE.Vector2[] = [
    new THREE.Vector2(0.0, 0.022),
    new THREE.Vector2(1.33, 0.022),
    new THREE.Vector2(1.35, 0.058),
    new THREE.Vector2(1.31, 0.098),
    new THREE.Vector2(1.25, 0.128),
    new THREE.Vector2(1.19, 0.22),
    new THREE.Vector2(1.17, 0.36),
    new THREE.Vector2(1.21, 0.48),
    new THREE.Vector2(1.24, 0.55),
    new THREE.Vector2(1.19, 0.60),
    new THREE.Vector2(0.0, 0.60),
  ];
  const baseGeo = new THREE.LatheGeometry(lathePoints, 64);
  const baseMesh = new THREE.Mesh(baseGeo, walnutMat);
  baseMesh.castShadow = false;
  baseMesh.receiveShadow = true;
  globeRig.add(baseMesh);

  // Brushed Champagne Brass Collar / Bezel clasping the glass neck
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xdcc07a,
    emissive: 0x2c2210,
    emissiveIntensity: 0.20,
    roughness: 0.22,
    metalness: 0.86,
    envMapIntensity: 1.55,
  });

  const collarPoints: THREE.Vector2[] = [
    new THREE.Vector2(1.18, 0.56),
    new THREE.Vector2(1.238, 0.59),
    new THREE.Vector2(1.228, 0.68),
    new THREE.Vector2(1.195, 0.745),
    new THREE.Vector2(1.12, 0.745),
    new THREE.Vector2(1.12, 0.56),
  ];
  const collarGeo = new THREE.LatheGeometry(collarPoints, 64);
  const collarMesh = new THREE.Mesh(collarGeo, brassMat);
  collarMesh.receiveShadow = true;
  globeRig.add(collarMesh);

  // Brass Gasket Ring seated inside the top of the brass collar
  const gasketMat = new THREE.MeshStandardMaterial({
    color: 0x826836,
    emissive: 0x221a0c,
    emissiveIntensity: 0.22,
    roughness: 0.42,
    metalness: 0.62,
  });
  const gasketTorus = new THREE.Mesh(new THREE.TorusGeometry(1.175, 0.028, 14, 64), gasketMat);
  gasketTorus.rotation.x = Math.PI / 2;
  gasketTorus.position.y = 0.742;
  globeRig.add(gasketTorus);

  // Decorative brass accent ring near bottom foot of walnut base
  const lowerBrassRing = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.015, 12, 64), brassMat);
  lowerBrassRing.rotation.x = Math.PI / 2;
  lowerBrassRing.position.y = 0.115;
  globeRig.add(lowerBrassRing);

  // Curved Engraved Brass Nameplate ("NEW YORK · MANHATTAN · WINTER")
  const plaqueTex = createBrassPlaqueTexture();
  const plaqueMat = new THREE.MeshStandardMaterial({
    map: plaqueTex,
    emissive: 0x261c0c,
    emissiveIntensity: 0.18,
    roughness: 0.26,
    metalness: 0.80,
    envMapIntensity: 1.4,
  });
  const plaqueGeo = new THREE.CylinderGeometry(1.192, 1.192, 0.168, 32, 1, true, -0.35, 0.70);
  const plaqueMesh = new THREE.Mesh(plaqueGeo, plaqueMat);
  plaqueMesh.position.y = 0.295;
  globeRig.add(plaqueMesh);

  // Sculpted Snow-Dressed Limestone & Brass Pedestal Plinth inside the lower hemisphere of the globe
  const riserPoints: THREE.Vector2[] = [
    new THREE.Vector2(0.0, 0.68),
    new THREE.Vector2(1.14, 0.68),
    new THREE.Vector2(1.25, 0.86),
    new THREE.Vector2(1.36, 1.06),
    new THREE.Vector2(1.42, CITY_FLOOR_Y - 0.012),
    new THREE.Vector2(0.0, CITY_FLOOR_Y - 0.012),
  ];
  const riserGeo = new THREE.LatheGeometry(riserPoints, 64);
  const riserMat = new THREE.MeshStandardMaterial({
    color: 0xeae4d8,
    emissive: 0x282622,
    emissiveIntensity: 0.20,
    roughness: 0.58,
    metalness: 0.04,
  });
  const riserMesh = new THREE.Mesh(riserGeo, riserMat);
  riserMesh.receiveShadow = true;
  globeRig.add(riserMesh);

  // Decorative inner brass plinth molding ring inside the lower water volume
  const innerPlinthRing = new THREE.Mesh(new THREE.TorusGeometry(1.31, 0.016, 12, 64), brassMat);
  innerPlinthRing.rotation.x = Math.PI / 2;
  innerPlinthRing.position.y = 0.98;
  globeRig.add(innerPlinthRing);

  // Mount group for the miniature Manhattan city + taxis + snow system
  const cityMount = new THREE.Group();
  cityMount.position.y = CITY_FLOOR_Y;
  cityMount.scale.setScalar(0.93);
  globeRig.add(cityMount);

  // ============================================================================
  // 3. PHYSICAL DUAL-RIM BOROSILICATE GLASS DOME & NIGHT RIM OPTICS (TSL)
  // - Zero central or mid-sphere reflection blobs (`rDisk < 0.83` is 100% transparent!)
  // - Concentric double-walled borosilicate glass shell rim (`rDisk` in 0.938..1.000) catching the warm
  //   side lamp on the left and the warm golden city glow from inside!
  // - Subtle grazing-angle-only (`fresnel = pow(1.0 - ndotv, 4.2)`) curved crescent rim reflections
  //   along the outer edge (`rDisk` in 0.83..0.94) from the warm lamp (left) and cool night window (right).
  // ============================================================================
  const maxTheta = Math.PI * 0.765;

  const glassGeo = new THREE.SphereGeometry(R_OUTER, 84, 56, 0, Math.PI * 2, 0, maxTheta);
  const glassMat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  const glassOpticsNode = Fn(() => {
    const N = normalWorld.normalize();
    const V = cameraPosition.sub(positionWorld).normalize();
    const ndotv = clamp(dot(N, V), 0.0, 1.0);

    const rDisk = sqrt(max(0.0, float(1.0).sub(ndotv.mul(ndotv))));
    const collarFeather = smoothstep(-1.22, -0.82, positionLocal.y);

    const worldUp = vec3(0.0, 1.0, 0.0);
    const camRight = cross(worldUp, V).normalize();
    const nRight = dot(N, camRight);
    const nUp = N.y;

    // 1. Concentric Double-Walled Glass Shell Rim (rDisk in [0.938, 1.000])
    const dInnerRing = rDisk.sub(0.944).div(0.0080);
    const innerMeniscusRing = exp(dInnerRing.mul(dInnerRing).negate());

    const wallBand = smoothstep(0.938, 0.948, rDisk).mul(float(1.0).sub(smoothstep(0.985, 0.995, rDisk)));

    const dOuterRing = rDisk.sub(0.993).div(0.0068);
    const outerFresnelRing = exp(dOuterRing.mul(dOuterRing).negate());

    // 2. Subtle Grazing-Angle-Only Curved Crescent Rim Reflections (rDisk > 0.83)
    const fresnel = pow(float(1.0).sub(ndotv), 4.2).mul(collarFeather);
    const rimCrescentBand = smoothstep(0.83, 0.90, rDisk)
      .mul(float(1.0).sub(smoothstep(0.930, 0.944, rDisk)))
      .mul(fresnel);

    const rightWinArc = smoothstep(0.20, 0.72, nRight).mul(smoothstep(0.0, 0.45, nUp));
    const coolWindowRimRefl = rimCrescentBand.mul(rightWinArc).mul(0.38);

    const leftLampArc = smoothstep(0.18, 0.72, nRight.negate()).mul(smoothstep(-0.12, 0.45, nUp));
    const warmLampRimRefl = rimCrescentBand.mul(leftLampArc).mul(0.54);

    // 3. Compositing: warm golden side-lamp rim light on the left + warm city inner glow + cool night window on right
    const sideLampMix = clamp(nRight.negate().mul(0.5).add(0.5), 0.0, 1.0);
    const col = vec3(0.95, 0.78, 0.50).toVar();
    const alpha = float(0.0).toVar();

    const wallCoolCol = vec3(0.55, 0.80, 1.05);
    const wallWarmCol = vec3(1.15, 0.68, 0.22);
    const borosilicateWallCol = mix(wallCoolCol, wallWarmCol, sideLampMix.mul(0.86));
    col.assign(mix(col, borosilicateWallCol, wallBand.mul(0.92)));
    alpha.assign(max(alpha, wallBand.mul(0.46)));

    const innerRingCol = mix(vec3(0.88, 0.86, 0.78), vec3(1.15, 0.78, 0.34), sideLampMix.mul(0.75));
    col.assign(mix(col, innerRingCol, innerMeniscusRing));
    alpha.assign(max(alpha, innerMeniscusRing.mul(0.86)));

    const outerRingCol = mix(vec3(0.62, 0.84, 1.05), vec3(1.18, 0.70, 0.22), sideLampMix.mul(0.82));
    col.assign(mix(col, outerRingCol, outerFresnelRing.mul(0.94)));
    alpha.assign(max(alpha, outerFresnelRing.mul(0.84)));

    col.assign(mix(col, vec3(0.68, 0.86, 1.05), clamp(coolWindowRimRefl.mul(1.8), 0.0, 1.0)));
    alpha.assign(max(alpha, coolWindowRimRefl));

    col.assign(mix(col, vec3(1.22, 0.72, 0.20), clamp(warmLampRimRefl.mul(2.0), 0.0, 1.0)));
    alpha.assign(max(alpha, warmLampRimRefl));

    alpha.assign(clamp(alpha.add(fresnel.mul(0.09)), 0.0, 0.92));

    return vec4(col, alpha);
  })();

  glassMat.colorNode = glassOpticsNode.xyz;
  glassMat.opacityNode = glassOpticsNode.w;

  const glassDome = new THREE.Mesh(glassGeo, glassMat);
  glassDome.position.y = SPHERE_CENTER_Y;
  glassDome.renderOrder = 10;
  globeRig.add(glassDome);

  const alignBackdropToCamera = (camPos: THREE.Vector3) => {
    const azim = Math.atan2(camPos.x, camPos.z);
    deskBackdropGroup.rotation.y = azim;
  };

  const updateOptics = (elapsed: number, tiltX: number, tiltZ: number, sloshX: number, _sloshZ: number) => {
    uTime.value = elapsed;
    uCausticShift.value.set(
      -tiltZ * 0.16 + Math.sin(elapsed * 2.0 + sloshX) * 0.004,
      tiltX * 0.16 + Math.cos(elapsed * 1.8) * 0.004
    );
    updateExteriorSnow(elapsed);
  };

  return {
    root,
    deskBackdropGroup,
    globeRig,
    cityMount,
    glassDome,
    alignBackdropToCamera,
    updateOptics,
  };
}

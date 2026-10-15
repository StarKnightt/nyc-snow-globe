import * as THREE from 'three/webgpu';

export function createRng(seed = 1337): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise2D(x: number, y: number, seed = 1): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const hash = (ix: number, iy: number) => {
    let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };

  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);

  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm2D(x: number, y: number, octaves = 4, seed = 1): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * valueNoise2D(x * freq, y * freq, seed + i * 31);
    freq *= 2.02;
    amp *= 0.5;
  }
  return val;
}

export interface DeskTextures {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

/**
 * Generates a warm medium-brown American Walnut desk texture (`1024x1024`)
 * with straight, natural quarter-sawn / rift-sawn wood grain and subtle plank variations.
 * Strictly NO circular, oval, or log-cut ring patterns, and seamlessly periodic in X so there are
 * zero vertical tiling seams!
 * (Note: The globe's cast shadow and refractive rainbow caustic are computed in world/local 3D coordinates
 * directly inside the desk's TSL material node in `src/globe.ts` so they sit 100% accurately next to the base!)
 */
export function createPaleWoodDeskTextures(): DeskTextures {
  const size = 1024;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;

  const imgData = ctx.createImageData(size, size);
  const rData = rCtx.createImageData(size, size);
  const bData = bCtx.createImageData(size, size);

  const plankCount = 5;
  const plankHeight = size / plankCount;
  const plankOffsets = [-7, 6, -4, 8, -3];

  for (let y = 0; y < size; y++) {
    const plankIdx = Math.floor(y / plankHeight);
    const py = (y % plankHeight) / plankHeight;
    const seamDist = Math.min(py, 1.0 - py) * plankHeight;
    const plankSeed = plankIdx * 197 + 43;
    const plankWarmth = plankOffsets[plankIdx % plankOffsets.length];

    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nx = x / size;
      // Seamless periodic X coordinates
      const px1 = Math.cos(nx * Math.PI * 2) * 0.75 + 2.0;
      const px2 = Math.sin(nx * Math.PI * 2) * 0.75 + 2.0;

      // Straight quarter-sawn / rift-sawn walnut fibers running horizontally along X
      const gentleDrift =
        (valueNoise2D(px1 * 1.2, py * 3.0 + px2 * 0.4, plankSeed) - 0.5) * 0.008 +
        (valueNoise2D(px1 * 3.5, py * 8.0 + px2 * 1.0, plankSeed + 11) - 0.5) * 0.003;
      const yCoord = py + gentleDrift;

      const ribbonBroad = Math.sin(yCoord * Math.PI * 16.0 + plankSeed * 0.9) * 0.5 + 0.5;
      const ribbonMed = valueNoise2D(px1 * 1.8 + px2 * 0.6, yCoord * 48.0, plankSeed + 19);
      const darkStreak = Math.pow(valueNoise2D(px1 * 1.4 + px2 * 0.5, yCoord * 85.0, plankSeed + 29), 2.0);
      const fineFiber = valueNoise2D(px1 * 12.0 + px2 * 5.0, yCoord * 240.0, plankSeed + 37);
      const microStreak = valueNoise2D(px1 * 36.0 + px2 * 14.0, yCoord * 460.0, plankSeed + 53);

      // Elongated walnut wood pores running straight along X
      const poreField = valueNoise2D(px1 * 64.0 + px2 * 24.0, yCoord * 520.0, plankSeed + 71);
      const poreDepth = poreField < 0.28 ? (0.28 - poreField) / 0.28 : 0.0;

      const grainShade = ribbonBroad * 0.30 + ribbonMed * 0.35 + fineFiber * 0.20 + microStreak * 0.15;

      // Warm medium-brown American Walnut base color (#6A442B to #986642)
      let r = 115 + plankWarmth + (grainShade - 0.5) * 38 - darkStreak * 15 - poreDepth * 14;
      let g = 74 + plankWarmth * 0.72 + (grainShade - 0.5) * 27 - darkStreak * 11 - poreDepth * 10;
      let b = 47 + plankWarmth * 0.48 + (grainShade - 0.5) * 18 - darkStreak * 8 - poreDepth * 7;

      let seamFactor = 1.0;
      if (seamDist < 1.8) {
        seamFactor = 0.88 + (seamDist / 1.8) * 0.12;
      }
      r *= seamFactor;
      g *= seamFactor;
      b *= seamFactor;

      imgData.data[idx] = Math.max(66, Math.min(190, Math.round(r)));
      imgData.data[idx + 1] = Math.max(42, Math.min(135, Math.round(g)));
      imgData.data[idx + 2] = Math.max(26, Math.min(92, Math.round(b)));
      imgData.data[idx + 3] = 255;

      const roughVal = Math.round(
        Math.max(80, Math.min(180, 112 + (1 - grainShade) * 32 + poreDepth * 28 + (seamDist < 1.8 ? 20 : 0)))
      );
      rData.data[idx] = roughVal;
      rData.data[idx + 1] = roughVal;
      rData.data[idx + 2] = roughVal;
      rData.data[idx + 3] = 255;

      const bumpVal = Math.round(
        Math.max(40, Math.min(220, 132 + (grainShade - 0.5) * 32 - poreDepth * 36 - (seamDist < 1.8 ? 32 : 0)))
      );
      bData.data[idx] = bumpVal;
      bData.data[idx + 1] = bumpVal;
      bData.data[idx + 2] = bumpVal;
      bData.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  rCtx.putImageData(rData, 0, 0);
  bCtx.putImageData(bData, 0, 0);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2.0, 2.0);
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(2.0, 2.0);

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(2.0, 2.0);

  return { map, roughnessMap, bumpMap };
}

/**
 * Generates the out-of-focus exterior Cozy Winter Night NYC skyline, bokeh & thin window frames
 * (`createWinterWindowRoomTexture`).
 * - Deep cozy twilight/night indigo-blue winter sky (`#151F32` to `#263852` — strictly zero `#000000`!)
 * - Below `ny = 0.48`: a slightly out-of-focus night NYC rooftop & skyscraper vista with warm glowing window tiers,
 *   snow-dusted parapets, classic rooftop water tower silhouettes, and overlapping warm golden-amber & cool sapphire
 *   circular optical bokeh discs!
 * - Framed by thin, softly blurred dark warm-espresso/slate window mullions (`nx = -0.26` and `nx = +0.26`) and
 *   1 high horizontal transom bar (`ny = 0.76`), with a warm dark-wood windowsill (`ny < 0.055`) and cozy warm
 *   dark interior wall (`|nx| > 0.62`) — ZERO repeating grid tiles and ZERO sharp 3D polygon edges!
 */
export function createWinterWindowRoomTexture(): THREE.CanvasTexture {
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);

  const gauss = (dist: number, sigma: number) => Math.exp(-(dist * dist) / (2 * sigma * sigma));
  const smoothstep = (e0: number, e1: number, val: number) => {
    const t = Math.max(0, Math.min(1, (val - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  // Out-of-focus night NYC skyline buildings across the 3 large window panes (nx in [-0.60, +0.60])
  const skylineBuildings = [
    { x0: -0.60, x1: -0.46, h: 0.34, color: [22, 32, 48], towerX: -0.52, towerH: 0.065, seed: 11 },
    { x0: -0.47, x1: -0.34, h: 0.46, color: [26, 38, 56], stepped: true, seed: 23 },
    { x0: -0.35, x1: -0.21, h: 0.30, color: [20, 30, 46], towerX: -0.29, towerH: 0.060, seed: 37 },
    { x0: -0.22, x1: -0.08, h: 0.40, color: [25, 36, 52], stepped: true, seed: 53 },
    { x0: -0.09, x1: 0.07, h: 0.32, color: [22, 33, 49], towerX: -0.01, towerH: 0.062, seed: 71 },
    { x0: 0.06, x1: 0.21, h: 0.43, color: [27, 38, 55], stepped: true, seed: 89 },
    { x0: 0.20, x1: 0.34, h: 0.31, color: [21, 31, 47], towerX: 0.28, towerH: 0.064, seed: 103 },
    { x0: 0.33, x1: 0.47, h: 0.47, color: [28, 40, 58], stepped: true, seed: 127 },
    { x0: 0.46, x1: 0.60, h: 0.33, color: [24, 34, 50], towerX: 0.52, towerH: 0.060, seed: 149 },
  ];

  // Rich out-of-focus night NYC circular bokeh lights (warm golden-amber, honey-gold, ruby tail-light, and cool cyan/sapphire)
  const bokehDiscs = [
    // Left pane bokeh
    { x: -0.54, y: 0.16, r: 0.028, col: [235, 168, 68], alpha: 0.68 },
    { x: -0.48, y: 0.26, r: 0.035, col: [245, 188, 88], alpha: 0.64 },
    { x: -0.43, y: 0.36, r: 0.024, col: [110, 182, 248], alpha: 0.58 },
    { x: -0.39, y: 0.19, r: 0.030, col: [96, 168, 242], alpha: 0.56 },
    { x: -0.35, y: 0.30, r: 0.024, col: [240, 174, 72], alpha: 0.62 },
    { x: -0.31, y: 0.14, r: 0.026, col: [232, 104, 68], alpha: 0.54 },
    // Center pane bokeh (visible around the snow globe & in closeups 04/05!)
    { x: -0.20, y: 0.24, r: 0.030, col: [242, 178, 76], alpha: 0.64 },
    { x: -0.15, y: 0.34, r: 0.025, col: [104, 176, 246], alpha: 0.58 },
    { x: -0.11, y: 0.16, r: 0.028, col: [236, 166, 66], alpha: 0.60 },
    { x: -0.04, y: 0.28, r: 0.024, col: [244, 186, 84], alpha: 0.56 },
    { x: 0.05, y: 0.26, r: 0.025, col: [102, 174, 244], alpha: 0.54 },
    { x: 0.11, y: 0.18, r: 0.027, col: [238, 170, 70], alpha: 0.60 },
    { x: 0.15, y: 0.31, r: 0.032, col: [246, 188, 86], alpha: 0.64 },
    { x: 0.20, y: 0.22, r: 0.024, col: [98, 170, 240], alpha: 0.56 },
    // Right pane bokeh
    { x: 0.32, y: 0.18, r: 0.030, col: [240, 174, 72], alpha: 0.66 },
    { x: 0.37, y: 0.29, r: 0.036, col: [248, 192, 90], alpha: 0.66 },
    { x: 0.41, y: 0.38, r: 0.026, col: [106, 178, 248], alpha: 0.58 },
    { x: 0.44, y: 0.15, r: 0.025, col: [234, 106, 70], alpha: 0.54 },
    { x: 0.50, y: 0.25, r: 0.032, col: [242, 178, 76], alpha: 0.64 },
    { x: 0.55, y: 0.19, r: 0.026, col: [100, 172, 242], alpha: 0.56 },
  ];

  for (let y = 0; y < h; y++) {
    const ny = 1.0 - y / h; // 0 at bottom (desk horizon), 1 at top

    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const nx = (x / w) * 2.0 - 1.0; // -1..+1 across the curved backdrop arc

      // ----------------------------------------------------------------------
      // 1. DEEP COZY NIGHT INDIGO-BLUE WINTER SKY + WARM HORIZON CITY GLOW
      // ----------------------------------------------------------------------
      const skyGrad = smoothstep(0.08, 0.90, ny);
      const softCloud = fbm2D(nx * 2.2 + 3.1, ny * 2.8 + 1.7, 3, 811);
      const horizonGlow = gauss(ny - 0.18, 0.20) * gauss(nx, 0.58);

      let r = THREE.MathUtils.lerp(42, 26, skyGrad) + horizonGlow * 28 + (softCloud - 0.5) * 8;
      let g = THREE.MathUtils.lerp(58, 38, skyGrad) + horizonGlow * 20 + (softCloud - 0.5) * 9;
      let b = THREE.MathUtils.lerp(86, 62, skyGrad) + horizonGlow * 14 + (softCloud - 0.5) * 12;

      // ----------------------------------------------------------------------
      // 2. OUT-OF-FOCUS NIGHT NYC SKYLINE, LIT WINDOW BANDS & BOKEH (ny < 0.54)
      // ----------------------------------------------------------------------
      if (ny < 0.54 && Math.abs(nx) < 0.64) {
        for (const bld of skylineBuildings) {
          const inX =
            smoothstep(bld.x0 - 0.022, bld.x0 + 0.018, nx) *
            (1.0 - smoothstep(bld.x1 - 0.018, bld.x1 + 0.022, nx));
          if (inX > 0.001) {
            let roofH = bld.h;
            const midX = (bld.x0 + bld.x1) * 0.5;
            const spanX = bld.x1 - bld.x0;
            if (bld.stepped && Math.abs(nx - midX) < spanX * 0.28) {
              roofH += 0.052;
            }
            const inY = 1.0 - smoothstep(roofH - 0.020, roofH + 0.020, ny);
            const bWeight = inX * inY;

            if (bWeight > 0.001) {
              // Dark night building massing
              let br = bld.color[0];
              let bg = bld.color[1];
              let bb = bld.color[2];

              // Softly blurred warm golden apartment/office window tiers inside the distant building
              const winRow = 0.5 + 0.5 * Math.sin(ny * 135.0 + bld.seed);
              const winCol = 0.5 + 0.5 * Math.sin((nx - bld.x0) * 190.0 + bld.seed * 0.7);
              const winNoise = valueNoise2D(nx * 42.0, ny * 58.0, bld.seed);
              const winGlow = Math.max(0, winRow * winCol - 0.22) * (winNoise > 0.28 ? 1.65 : 0.35);

              br += winGlow * 118;
              bg += winGlow * 82;
              bb += winGlow * 32;

              r = THREE.MathUtils.lerp(r, br, bWeight * 0.88);
              g = THREE.MathUtils.lerp(g, bg, bWeight * 0.88);
              b = THREE.MathUtils.lerp(b, bb, bWeight * 0.88);
            }

            // Soft moonlight/city-lit snow blanket cap resting on the rooftop ledge
            const snowCap = gauss(ny - roofH, 0.013) * inX;
            if (snowCap > 0.01) {
              r = THREE.MathUtils.lerp(r, 118, Math.min(1.0, snowCap * 0.80));
              g = THREE.MathUtils.lerp(g, 144, Math.min(1.0, snowCap * 0.80));
              b = THREE.MathUtils.lerp(b, 182, Math.min(1.0, snowCap * 0.80));
            }
          }

          // Classic NYC rooftop wooden water tower silhouette + snow cap
          if (bld.towerX !== undefined && bld.towerH !== undefined) {
            const dxWT = Math.abs(nx - bld.towerX);
            if (dxWT < 0.036) {
              const tankMask =
                gauss(nx - bld.towerX, 0.012) *
                smoothstep(bld.h + 0.010, bld.h + 0.022, ny) *
                (1.0 - smoothstep(bld.h + bld.towerH - 0.012, bld.h + bld.towerH + 0.012, ny));
              r = THREE.MathUtils.lerp(r, 24, tankMask * 0.82);
              g = THREE.MathUtils.lerp(g, 34, tankMask * 0.82);
              b = THREE.MathUtils.lerp(b, 50, tankMask * 0.82);

              const wtSnow = gauss(nx - bld.towerX, 0.011) * gauss(ny - (bld.h + bld.towerH), 0.010);
              r = THREE.MathUtils.lerp(r, 120, Math.min(1.0, wtSnow * 0.76));
              g = THREE.MathUtils.lerp(g, 146, Math.min(1.0, wtSnow * 0.76));
              b = THREE.MathUtils.lerp(b, 184, Math.min(1.0, wtSnow * 0.76));
            }
          }
        }

        // Overlapping soft optical bokeh discs (flat-top disc + subtle bright bokeh ring edge)
        for (const bd of bokehDiscs) {
          const d = Math.hypot((nx - bd.x) * 1.32, ny - bd.y);
          if (d < bd.r * 1.45) {
            const discFill = 1.0 - smoothstep(bd.r * 0.65, bd.r * 1.25, d);
            const ringEdge = gauss(d - bd.r * 0.82, bd.r * 0.18) * 0.42;
            const weight = Math.min(1.0, (discFill * 0.85 + ringEdge) * bd.alpha);
            r = THREE.MathUtils.lerp(r, bd.col[0], weight);
            g = THREE.MathUtils.lerp(g, bd.col[1], weight);
            b = THREE.MathUtils.lerp(b, bd.col[2], weight);
          }
        }
      }

      // ----------------------------------------------------------------------
      // 3. SOFT-FOCUS THIN WARM-WOOD WINDOW FRAMES & COZY NIGHT ROOM WALL
      //    (Zero repeating grid tiles, softly blurred edges for f/2.8 depth-of-field!)
      // ----------------------------------------------------------------------
      // Two thin vertical mullions at nx = -0.26 and nx = +0.26 (cleanly framing the snow globe)
      const thinVertMullion =
        ny > 0.050 && ny < 0.90 ? Math.max(gauss(nx + 0.26, 0.0052), gauss(nx - 0.26, 0.0052)) : 0.0;
      // One thin upper horizontal transom bar at ny = 0.76 (above the snow globe apex)
      const thinHorzTransom = Math.abs(nx) < 0.60 ? gauss(ny - 0.76, 0.0052) : 0.0;
      const thinMullionMask = Math.min(1.0, Math.max(thinVertMullion, thinHorzTransom));

      // Warm dark walnut mullion (#3A2C24) catching a warm golden edge highlight from the glowing globe & side lamp
      const mullionWarmth = gauss(nx, 0.42) * gauss(ny - 0.30, 0.32);
      r = THREE.MathUtils.lerp(r, 56 + mullionWarmth * 42, thinMullionMask * 0.90);
      g = THREE.MathUtils.lerp(g, 42 + mullionWarmth * 28, thinMullionMask * 0.90);
      b = THREE.MathUtils.lerp(b, 34 + mullionWarmth * 14, thinMullionMask * 0.90);

      // Softly blurred outer window casing frame at |nx| in [0.58, 0.63] & bottom wooden sill at ny < 0.062
      const outerCasingV = smoothstep(0.580, 0.602, Math.abs(nx)) * (1.0 - smoothstep(0.630, 0.655, Math.abs(nx)));
      const outerHeaderH = Math.abs(nx) < 0.64 ? smoothstep(0.895, 0.920, ny) : 0.0;
      const bottomSill = Math.abs(nx) < 0.65 ? 1.0 - smoothstep(0.046, 0.068, ny) : 0.0;
      const casingMask = Math.min(1.0, Math.max(outerCasingV, outerHeaderH, bottomSill));

      // Warm walnut/espresso window trim (#48362B) illuminated warmly near the center by the glowing snow globe
      const globeSillGlow = gauss(nx, 0.32) * gauss(ny - 0.05, 0.09);
      r = THREE.MathUtils.lerp(r, 68 + globeSillGlow * 58, casingMask * 0.92);
      g = THREE.MathUtils.lerp(g, 50 + globeSillGlow * 40, casingMask * 0.92);
      b = THREE.MathUtils.lerp(b, 38 + globeSillGlow * 18, casingMask * 0.92);

      // Cozy dark warm interior room wall outside the window casing (|nx| > 0.635 or ny < 0.045): never pure black!
      const roomWallMask = Math.max(smoothstep(0.630, 0.658, Math.abs(nx)), 1.0 - smoothstep(0.030, 0.050, ny));
      if (roomWallMask > 0.001) {
        const wallGrad = 0.88 + 0.12 * ny;
        r = THREE.MathUtils.lerp(r, 46 * wallGrad, roomWallMask * 0.95);
        g = THREE.MathUtils.lerp(g, 36 * wallGrad, roomWallMask * 0.95);
        b = THREE.MathUtils.lerp(b, 32 * wallGrad, roomWallMask * 0.95);
      }

      // 4. Warm golden-amber side lamp light washing onto the left interior wall & window casing (nx < 0)
      const lampWash = gauss(nx + 0.54, 0.36) * gauss(ny - 0.42, 0.34);
      r += lampWash * 36;
      g += lampWash * 24;
      b += lampWash * 8;

      // Strictly clamp minimum RGB above [22, 26, 34] so no background pixel is ever #000000!
      img.data[idx] = Math.max(22, Math.min(242, Math.round(r)));
      img.data[idx + 1] = Math.max(26, Math.min(228, Math.round(g)));
      img.data[idx + 2] = Math.max(34, Math.min(245, Math.round(b)));
      img.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  // Apply optical out-of-focus depth-of-field blur pass so the window frames, rooftops, and bokeh
  // have a cohesive, silky f/2.8 shallow depth-of-field softness!
  try {
    const blurCanvas = document.createElement('canvas');
    blurCanvas.width = w;
    blurCanvas.height = h;
    const bCtx = blurCanvas.getContext('2d')!;
    bCtx.filter = 'blur(6px)';
    bCtx.drawImage(canvas, 0, 0);
    ctx.globalAlpha = 0.72;
    ctx.drawImage(blurCanvas, 0, 0);
    ctx.globalAlpha = 1.0;
  } catch {
    // Fallback if canvas filter is unsupported
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Generates rich, lifted warm espresso-walnut wood texture for the turned snow-globe base.
 */
export function createWalnutBaseTexture(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const img = ctx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const angle = (x / size) * Math.PI * 2;
      const u = Math.cos(angle) * 1.2;
      const ny = y / size;

      const drift = valueNoise2D(u + 3.0, ny * 4.5, 301) * 0.08;
      const grain = Math.sin((ny * 24 + drift * 6) * Math.PI) * 0.5 + 0.5;
      const fine = valueNoise2D(x * 0.35, y * 1.6, 317);

      const r = 92 + grain * 32 + fine * 10;
      const g = 58 + grain * 21 + fine * 7;
      const b = 38 + grain * 14 + fine * 5;

      img.data[idx] = Math.min(255, Math.round(r));
      img.data[idx + 1] = Math.min(255, Math.round(g));
      img.data[idx + 2] = Math.min(255, Math.round(b));
      img.data[idx + 3] = 255;

      const rv = Math.round(54 + (1 - grain) * 20 + (1 - fine) * 12);
      rImg.data[idx] = rv;
      rImg.data[idx + 1] = rv;
      rImg.data[idx + 2] = rv;
      rImg.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;

  return { map, roughnessMap };
}

/**
 * Generates an engraved brushed-brass plaque texture ("NEW YORK") for the front of the base.
 */
export function createBrassPlaqueTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 160;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#c8a35a');
  grad.addColorStop(0.5, '#ebd08e');
  grad.addColorStop(1, '#b8924a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const rng = createRng(77);
  for (let y = 0; y < h; y++) {
    const alpha = (rng() - 0.5) * 0.08;
    ctx.fillStyle = alpha > 0 ? `rgba(255,250,230,${alpha})` : `rgba(70,48,20,${-alpha})`;
    ctx.fillRect(0, y, w, 1);
  }

  ctx.strokeStyle = '#4e3618';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  ctx.strokeStyle = 'rgba(255, 244, 210, 0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(15, 15, w - 30, h - 30);

  const corners = [
    [28, 28],
    [w - 28, 28],
    [28, h - 28],
    [w - 28, h - 28],
  ];
  for (const [cx, cy] of corners) {
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#886830';
    ctx.fill();
    ctx.strokeStyle = '#4c3416';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.font = 'bold 46px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255, 248, 220, 0.65)';
  ctx.fillText('NEW  YORK', w / 2, h / 2 - 8);
  ctx.fillStyle = '#483014';
  ctx.fillText('NEW  YORK', w / 2, h / 2 - 10);

  ctx.font = 'bold 18px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = '#4e3416';
  ctx.fillText('MANHATTAN · WINTER', w / 2, h / 2 + 30);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Generates consistent slate-charcoal winter NYC asphalt road texture (#4A525E to #5A6270).
 */
export function createWetAsphaltTextures(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const img = ctx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nx = x / size;
      const ny = y / size;

      const grit = valueNoise2D(nx * 220, ny * 220, 601);
      const aggregate = valueNoise2D(nx * 95, ny * 95, 607);
      const puddle = fbm2D(nx * 8, ny * 8, 3, 613);
      const tireWear = Math.sin(nx * Math.PI * 6) * 0.5 + 0.5;

      const base = 78 + grit * 14 + aggregate * 10 - tireWear * 6 - (puddle > 0.56 ? 5 : 0);
      img.data[idx] = Math.round(base * 0.94);
      img.data[idx + 1] = Math.round(base * 0.98);
      img.data[idx + 2] = Math.round(base * 1.06);
      img.data[idx + 3] = 255;

      const rough = puddle > 0.55 ? 122 + grit * 24 : 152 + grit * 26;
      rImg.data[idx] = Math.round(rough);
      rImg.data[idx + 1] = Math.round(rough);
      rImg.data[idx + 2] = Math.round(rough);
      rImg.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(5, 5);
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(5, 5);

  return { map, roughnessMap };
}

/**
 * Generates an architectural facade texture for Manhattan buildings with crisp recessed window grids,
 * stone spandrels, lintels, sills, and glowing warm yellow/amber night windows (88% lit) with a dedicated emissiveMap!
 */
export function createBuildingFacadeTexture(options: {
  wallColor: string;
  spandrelColor: string;
  windowTint: string;
  cols: number;
  rows: number;
  style: 'artdeco' | 'masonry' | 'brownstone' | 'curtainwall';
  seed: number;
}): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
  const w = 512;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = w;
  rCanvas.height = h;
  const rCtx = rCanvas.getContext('2d')!;

  const eCanvas = document.createElement('canvas');
  eCanvas.width = w;
  eCanvas.height = h;
  const eCtx = eCanvas.getContext('2d')!;

  const rng = createRng(options.seed);

  ctx.fillStyle = options.wallColor;
  ctx.fillRect(0, 0, w, h);

  // Keep stone/brick walls low in the emissiveMap so only the windows radiate intense warm golden-amber light!
  eCtx.fillStyle = options.style === 'brownstone' ? 'rgb(14, 8, 5)' : 'rgb(16, 12, 8)';
  eCtx.fillRect(0, 0, w, h);

  const blockRows = options.rows * 4;
  const blockH = h / blockRows;
  for (let r = 0; r < blockRows; r++) {
    for (let c = 0; c < 16; c++) {
      const v = (rng() - 0.5) * 16;
      ctx.fillStyle = v > 0 ? `rgba(255,250,240,${v / 255})` : `rgba(60,48,36,${-v / 255})`;
      ctx.fillRect((c * w) / 16, r * blockH, w / 16 - 1, blockH - 0.8);
    }
    ctx.fillStyle = 'rgba(65, 52, 40, 0.14)';
    ctx.fillRect(0, r * blockH, w, 1);
  }

  rCtx.fillStyle = 'rgb(218, 218, 218)';
  rCtx.fillRect(0, 0, w, h);

  const cellW = w / options.cols;
  const cellH = h / options.rows;

  for (let c = 0; c < options.cols; c++) {
    const x0 = c * cellW;

    if (options.style === 'artdeco') {
      const padX = cellW * 0.24;
      ctx.fillStyle = options.spandrelColor;
      ctx.fillRect(x0 + padX, 0, cellW - padX * 2, h);

      ctx.fillStyle = '#c2b6a4';
      ctx.fillRect(x0 + padX - 2.2, 0, 2.2, h);
      ctx.fillRect(x0 + cellW - padX, 0, 2.2, h);
    }

    for (let r = 0; r < options.rows; r++) {
      const y0 = r * cellH;
      const padX =
        options.style === 'curtainwall'
          ? cellW * 0.14
          : options.style === 'artdeco'
            ? cellW * 0.22
            : options.style === 'brownstone'
              ? cellW * 0.24
              : cellW * 0.20;
      const padY =
        options.style === 'curtainwall'
          ? cellH * 0.16
          : options.style === 'artdeco'
            ? cellH * 0.20
            : cellH * 0.22;

      const ww = cellW - padX * 2;
      const wh = cellH - padY * 2;
      const wx = x0 + padX;
      const wy = y0 + padY;

      if (options.style === 'artdeco') {
        ctx.fillStyle = '#6e655a';
        ctx.fillRect(wx, y0, ww, padY * 0.88);
      }

      if (options.style === 'brownstone' || options.style === 'masonry' || options.style === 'curtainwall') {
        ctx.fillStyle =
          options.style === 'brownstone'
            ? '#8c6e58'
            : options.style === 'curtainwall'
              ? '#5a6e82'
              : '#9c8e7c';
        ctx.fillRect(wx - 3, wy - 4, ww + 6, 4);
        ctx.fillStyle = 'rgba(40, 30, 22, 0.45)';
        ctx.fillRect(wx - 2, wy - 1, ww + 4, 1.5);
        ctx.fillStyle =
          options.style === 'brownstone'
            ? '#82644e'
            : options.style === 'curtainwall'
              ? '#506478'
              : '#928472';
        ctx.fillRect(wx - 2, wy + wh, ww + 4, 3.5);
      }

      ctx.fillStyle = options.style === 'brownstone' ? '#38261c' : '#2e3846';
      ctx.fillRect(wx - 1.5, wy - 1.5, ww + 3, wh + 3);

      // 88% of windows glow in rich, saturated warm golden-yellow, deep amber, and honey-gold tones at night!
      const litRoll = rng();
      const grad = ctx.createLinearGradient(wx, wy, wx, wy + wh);
      const eGrad = eCtx.createLinearGradient(wx, wy, wx, wy + wh);

      if (litRoll < 0.38) {
        // Rich warm golden-yellow interior glow
        grad.addColorStop(0, '#ffe484');
        grad.addColorStop(0.5, '#ffbe3c');
        grad.addColorStop(1, '#e68c1c');
        eGrad.addColorStop(0, '#ffe074');
        eGrad.addColorStop(0.5, '#ffb832');
        eGrad.addColorStop(1, '#e08418');
      } else if (litRoll < 0.70) {
        // Deep cozy amber-orange lamp-lit room
        grad.addColorStop(0, '#ffd068');
        grad.addColorStop(0.5, '#f59c28');
        grad.addColorStop(1, '#cc6c12');
        eGrad.addColorStop(0, '#ffca58');
        eGrad.addColorStop(0.5, '#f29422');
        eGrad.addColorStop(1, '#c86610');
      } else if (litRoll < 0.88) {
        // Warm honey-cream office & apartment light
        grad.addColorStop(0, '#fff0a8');
        grad.addColorStop(0.55, '#f6c854');
        grad.addColorStop(1, '#d48e26');
        eGrad.addColorStop(0, '#ffea96');
        eGrad.addColorStop(0.55, '#f2c048');
        eGrad.addColorStop(1, '#cc8420');
      } else {
        // Softly dimmed night window reflecting warm neighbor glow (never black!)
        grad.addColorStop(0, '#4c5a70');
        grad.addColorStop(0.5, '#3c485a');
        grad.addColorStop(1, '#323c4c');
        eGrad.addColorStop(0, '#36281c');
        eGrad.addColorStop(1, '#241c14');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(wx, wy, ww, wh);

      eCtx.fillStyle = eGrad;
      eCtx.fillRect(wx, wy, ww, wh);

      ctx.fillStyle = options.style === 'brownstone' ? '#3c281c' : 'rgba(48, 38, 28, 0.76)';
      ctx.fillRect(wx, wy + wh * 0.5 - 1.0, ww, 2.0);
      eCtx.fillStyle = 'rgba(32, 22, 14, 0.72)';
      eCtx.fillRect(wx, wy + wh * 0.5 - 1.0, ww, 2.0);
      if (options.style !== 'brownstone') {
        ctx.fillRect(wx + ww * 0.5 - 0.8, wy, 1.6, wh);
        eCtx.fillRect(wx + ww * 0.5 - 0.8, wy, 1.6, wh);
      }

      rCtx.fillStyle = 'rgb(44, 44, 44)';
      rCtx.fillRect(wx, wy, ww, wh);
    }
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;

  const emissiveMap = new THREE.CanvasTexture(eCanvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.anisotropy = 8;

  return { map, roughnessMap, emissiveMap };
}

/**
 * Creates a procedural 3D Cozy Winter Night studio environment scene baked via PMREMGenerator.
 * Combines a warm golden side lamp emitter, warm golden city-core radiance, and a cool sapphire night window diffuser.
 */
export function createDaylightStudioEnvScene(): THREE.Scene {
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x1c2436);

  const domeGeo = new THREE.SphereGeometry(30, 32, 24);
  const pos = domeGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 30;
    const x = pos.getX(i) / 30;
    let r = 0.24;
    let g = 0.26;
    let b = 0.34;
    if (y > 0) {
      const warmSide = Math.max(0, -x);
      r = THREE.MathUtils.lerp(0.26, 0.36, y) + warmSide * 0.42;
      g = THREE.MathUtils.lerp(0.28, 0.40, y) + warmSide * 0.26;
      b = THREE.MathUtils.lerp(0.38, 0.54, y) + warmSide * 0.08;
    } else {
      const t = Math.min(1, -y * 1.5);
      r = THREE.MathUtils.lerp(0.46, 0.32, t);
      g = THREE.MathUtils.lerp(0.32, 0.22, t);
      b = THREE.MathUtils.lerp(0.18, 0.14, t);
    }
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  domeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  envScene.add(new THREE.Mesh(domeGeo, domeMat));

  const windowLightPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(10.0, 7.5),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 2.5, 3.8) })
  );
  windowLightPanel.position.set(8.5, 8.5, 7.0);
  windowLightPanel.lookAt(0, 1.8, 0);
  envScene.add(windowLightPanel);

  const warmLampCard = new THREE.Mesh(
    new THREE.SphereGeometry(4.5, 16, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(6.8, 4.5, 2.0) })
  );
  warmLampCard.position.set(-10.0, 5.8, 5.2);
  envScene.add(warmLampCard);

  return envScene;
}

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const canvas = document.getElementById("c");

// ---------- tiny utils ----------
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(a, b, t) {
  t = clamp((t - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y) {
  // Deterministic-ish hash for float-ish coords.
  const xi = (Math.floor(x * 10) | 0) >>> 0;
  const yi = (Math.floor(y * 10) | 0) >>> 0;
  let h = xi * 374761393 + yi * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function makeToonGradientTexture() {
  // 1D gradient map: fewer bands => more cartoon.
  const c = document.createElement("canvas");
  // Slightly brighter bands for readability (esp. buildings).
  c.width = 6;
  c.height = 1;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, c.width, 0);
  // Brighter bands for a vivid "pixel game" daytime look.
  g.addColorStop(0.0, "#253a66");
  g.addColorStop(0.28, "#4c67b4");
  g.addColorStop(0.52, "#9bb2ff");
  g.addColorStop(0.72, "#d7deff");
  g.addColorStop(1.0, "#ffffff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x0b1635, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();
// For the crisp pixel-city style, keep air super clear.
scene.fog = null;

// Isometric / orthographic camera like a 3D pixel city-builder.
const ISO = {
  yaw: Math.PI / 4, // 45°
  pitch: Math.atan(Math.sqrt(2)), // ~54.7356° from horizon (classic iso)
};

let frustumSize = 420; // bigger = more city visible
function makeOrthoCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const cam = new THREE.OrthographicCamera(
    (-frustumSize * aspect) / 2,
    (frustumSize * aspect) / 2,
    frustumSize / 2,
    -frustumSize / 2,
    0.1,
    2000
  );
  return cam;
}

const camera = makeOrthoCamera();

function setIsometricPose() {
  // Place camera on a diagonal, then tilt down.
  camera.position.set(420, 420, 420);
  camera.rotation.order = "YXZ";
  camera.rotation.y = ISO.yaw;
  camera.rotation.x = -ISO.pitch;
  camera.rotation.z = 0;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}
setIsometricPose();

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
// In ortho, zoom is the main "distance".
controls.enableRotate = true; // user requested mouse rotation
controls.zoomSpeed = 1.0; // we do our own smooth zoom
controls.panSpeed = 0.95;
controls.minZoom = 0.45;
controls.maxZoom = 3.2;
controls.rotateSpeed = 0.7;
controls.minPolarAngle = 0.25;
controls.maxPolarAngle = 1.25;
controls.maxAzimuthAngle = Infinity;
controls.minAzimuthAngle = -Infinity;
controls.target.set(0, 0, 0);
controls.update();

// Smooth zoom (mouse wheel + trackpad pinch). OrbitControls zoom jumps a bit in ortho,
// so we lerp camera.zoom to a target value for a clean "city builder" feel.
let targetZoom = camera.zoom;
function clampZoom(z) {
  return clamp(z, controls.minZoom, controls.maxZoom);
}

canvas.addEventListener(
  "wheel",
  (e) => {
    // prevent page scroll + let OrbitControls still receive pointer events
    e.preventDefault();

    // Normalize wheel across devices (trackpads send small deltas).
    const dy = e.deltaY;
    const isTrackpad = Math.abs(dy) < 40;
    const strength = isTrackpad ? 0.0022 : 0.00135;
    const zoomDelta = Math.exp(-dy * strength);

    targetZoom = clampZoom(targetZoom * zoomDelta);
  },
  { passive: false }
);

// Lighting: bright daytime, game-like saturation.
// Clean diorama lighting like the reference: warm key, cool fill, readable ambient.
const hemi = new THREE.HemisphereLight(0x78b7ff, 0x1a1634, 0.85);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffd3a8, 1.25);
sun.position.set(-220, 320, 120);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 50;
sun.shadow.camera.far = 900;
sun.shadow.camera.left = -260;
sun.shadow.camera.right = 260;
sun.shadow.camera.top = 260;
sun.shadow.camera.bottom = -260;
scene.add(sun);

const fill = new THREE.DirectionalLight(0x8ad2ff, 0.65);
fill.position.set(220, 140, -120);
scene.add(fill);

// Extra ambient lift so the city stays readable even with flat shading.
const ambient = new THREE.AmbientLight(0x5968a6, 0.38);
scene.add(ambient);

// No HUD/options: keep rendering clean + crisp.

// Postprocessing (subtle bloom for neon/windows)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.55, 0.2);
composer.addPass(bloom);

// ---------- city builder ----------
const toonGradientMap = makeToonGradientTexture();
function lambert(colorHex, opts = {}) {
  const m = new THREE.MeshLambertMaterial({
    color: colorHex,
    vertexColors: !!opts.vertexColors,
    flatShading: true,
  });
  if (opts.emissiveHex != null) {
    m.emissive = new THREE.Color(opts.emissiveHex);
    m.emissiveIntensity = opts.emissiveIntensity ?? 0.0;
  }
  return m;
}

function makeWindowGlowMaterial({
  grid = new THREE.Vector2(10, 18),
  border = 0.12,
  intensity = 1.0,
  warm = new THREE.Color(0xfff3c0),
  cool = new THREE.Color(0x9be6ff),
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uGrid: { value: grid },
      uBorder: { value: border },
      uIntensity: { value: intensity },
      uWarm: { value: warm },
      uCool: { value: cool },
    },
    vertexShader: `
      attribute float instanceSeed;
      varying vec2 vUv;
      varying vec3 vN;
      varying float vSeed;
      void main() {
        vUv = uv;
        vN = normalize(normalMatrix * normal);
        vSeed = instanceSeed;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform vec2 uGrid;
      uniform float uBorder;
      uniform float uIntensity;
      uniform vec3 uWarm;
      uniform vec3 uCool;
      varying vec2 vUv;
      varying vec3 vN;
      varying float vSeed;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 345.45));
        p += dot(p, p + 34.345);
        return fract(p.x * p.y);
      }

      void main() {
        // No windows on roofs (top faces).
        if (abs(vN.y) > 0.65) discard;

        vec2 uv = vUv * uGrid;
        vec2 cell = floor(uv);
        vec2 f = fract(uv);

        float inside = step(uBorder, f.x) * step(uBorder, f.y) * step(f.x, 1.0 - uBorder) * step(f.y, 1.0 - uBorder);

        float r1 = hash21(cell + vSeed * 17.13);
        float r2 = hash21(cell.yx + vSeed * 41.77);

        // Some windows off, some on.
        float on = step(0.58, r1);
        // Slight vertical variation so tall buildings don't look uniform.
        on *= step(0.06, fract((cell.y + vSeed * 9.0) * 0.17));

        vec3 tint = mix(uWarm, uCool, smoothstep(0.25, 0.95, r2));

        float glow = inside * on;
        float alpha = glow * 0.85;
        vec3 col = tint * (uIntensity * (0.6 + r2 * 0.7)) * glow;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

const CONFIG = {
  seedBase: (Math.random() * 1e9) | 0,
  tileCount: 30, // total tiles per axis (roughly), centered at 0
  tileSpacing: 13.2,
  roadEvery: 4, // every N tiles is a road line
  roadWidth: 5.1,
  sidewalkWidth: 1.25,
  groundPadding: 24,
  maxBuildings: 1600,
  maxRoofBits: 2500,
  maxTrees: 2600,
  maxStreetBits: 2200,
  maxHouses: 4200,
  maxHouseRoofs: 4200,
  maxParkingPads: 700,
  maxParkingLines: 5200,
  maxStreetTrees: 4200,
  maxProps: 2600,
  carCountX: 200,
  carCountZ: 200,
};

function isRoadIndex(i, roadEvery) {
  return i % roadEvery === 0;
}

function worldSizeFromConfig() {
  const worldHalf = CONFIG.tileCount * CONFIG.tileSpacing * 0.5;
  return {
    worldHalf,
    worldMin: -worldHalf,
    worldMax: worldHalf,
    roadPeriod: CONFIG.roadEvery * CONFIG.tileSpacing,
  };
}

function getRoadCoords() {
  const coords = [];
  const half = Math.floor(CONFIG.tileCount / 2);
  for (let i = -half; i <= half; i++) {
    if (isRoadIndex(i, CONFIG.roadEvery)) coords.push(i * CONFIG.tileSpacing);
  }
  return coords;
}

function makeSkyDome() {
  const geo = new THREE.SphereGeometry(900, 20, 20);
  geo.scale(-1, 1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(0x0a1230) },
      mid: { value: new THREE.Color(0x2a2c67) },
      bottom: { value: new THREE.Color(0xffb36b) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 mid;
      uniform vec3 bottom;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y * 0.5 + 0.5;
        vec3 c = mix(bottom, mid, smoothstep(0.0, 0.55, h));
        c = mix(c, top, smoothstep(0.55, 1.0, h));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

function makeSignTexture(text, fg = "#e9f0ff", bg = "rgba(0,0,0,0)") {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);

  // glow-ish plate
  ctx.fillStyle = "rgba(10,12,22,0.85)";
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 4;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(10, 18, 236, 92, 14);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(10, 18, 236, 92);
    ctx.strokeRect(10, 18, 236, 92);
  }

  ctx.font = "800 30px ui-sans-serif, system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = fg;
  ctx.shadowColor = "rgba(120,190,255,0.55)";
  ctx.shadowBlur = 14;
  ctx.fillText(text, 128, 64);
  ctx.shadowBlur = 0;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

class CityWorld {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = "CityWorld";

    this.trafficRoot = new THREE.Group();
    this.trafficRoot.name = "Traffic";

    this.streetLightRoot = new THREE.Group();
    this.streetLightRoot.name = "StreetLights";

    this.root.add(this.trafficRoot);
    this.root.add(this.streetLightRoot);

    this.seed = CONFIG.seedBase;
    this.rand = mulberry32(this.seed);

    this.buildings = null;
    this.buildingWindows = null;
    this.roofBits = null;
    this.treesTrunk = null;
    this.treesCrown = null;
    this.streetTreesTrunk = null;
    this.streetTreesCrown = null;
    this.housesBase = null;
    this.housesRoof = null;
    this.houseWindows = null;
    this.parkingPads = null;
    this.parkingLines = null;
    this.propsBoxes = null;
    this.propsPosts = null;
    this.roadsH = null;
    this.roadsV = null;
    this.sideH = null;
    this.sideV = null;
    this.roadMarks = null;
    this.crosswalks = null;

    this.streetPoles = null;
    this.streetBulbs = null;
    this.streetSignalX = null;
    this.streetSignalZ = null;

    this.carSystem = null;

    this.counts = {
      buildings: 0,
      roofBits: 0,
      trees: 0,
      streetTrees: 0,
      houses: 0,
      parking: 0,
      props: 0,
      cars: 0,
      intersections: 0,
    };
  }

  dispose() {
    this.root.traverse((obj) => {
      if (obj.isMesh) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      }
    });
  }

  rebuild(seed) {
    this.seed = seed >>> 0;
    this.rand = mulberry32(this.seed);
    this.root.clear();
    this.root.add(this.trafficRoot);
    this.root.add(this.streetLightRoot);

    this.trafficRoot.clear();
    this.streetLightRoot.clear();

    this.counts = {
      buildings: 0,
      roofBits: 0,
      trees: 0,
      streetTrees: 0,
      houses: 0,
      parking: 0,
      props: 0,
      cars: 0,
      intersections: 0,
    };

    // Ground
    const { worldHalf } = worldSizeFromConfig();
    const groundSize = worldHalf * 2 + CONFIG.groundPadding * 2;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, 1, 1);
    // Bright grass like a game-map base.
    const groundMat = lambert(0x63d77c, {});
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);

    // Soft "district tint" to avoid flatness (subtle huge decal-ish plane).
    const tintGeo = new THREE.PlaneGeometry(groundSize * 0.9, groundSize * 0.9, 1, 1);
    const tintMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(this.rand(), 0.28, 0.55),
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    });
    const tint = new THREE.Mesh(tintGeo, tintMat);
    tint.rotation.x = -Math.PI / 2;
    tint.position.y = 0.02;
    this.root.add(tint);

    // Roads / sidewalks / markings
    this._buildStreets();

    // Buildings / props / lots
    this._buildBuildingsAndProps();

    // Street trees + tiny sidewalk props for that dense city-builder feel.
    this._buildStreetTreesAndProps();

    // Some "hero" billboards
    this._buildBillboards();

    // Traffic
    this.carSystem = new CarSystem(this.rand, this.trafficRoot);
    this.carSystem.build();
    this.counts.cars = this.carSystem.totalCars;

    // Streetlights + signals
    this._buildStreetLightsAndSignals();

    // Bring root back
    this.root.add(this.trafficRoot);
    this.root.add(this.streetLightRoot);
  }

  _buildStreets() {
    const dummy = new THREE.Object3D();
    const roadCoords = getRoadCoords();
    const { worldHalf } = worldSizeFromConfig();
    const len = worldHalf * 2 + CONFIG.groundPadding * 1.5;

    const roadGeo = new THREE.BoxGeometry(1, 1, 1);
    roadGeo.translate(0, 0.5, 0);
    const roadMat = lambert(0x2b2f3f, {});

    this.roadsH = new THREE.InstancedMesh(roadGeo, roadMat, roadCoords.length);
    this.roadsV = new THREE.InstancedMesh(roadGeo, roadMat, roadCoords.length);
    this.roadsH.castShadow = false;
    this.roadsH.receiveShadow = true;
    this.roadsV.castShadow = false;
    this.roadsV.receiveShadow = true;

    // Horizontal roads (along X, varying Z).
    for (let i = 0; i < roadCoords.length; i++) {
      dummy.position.set(0, 0.035, roadCoords[i]);
      dummy.scale.set(len, 0.14, CONFIG.roadWidth);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      this.roadsH.setMatrixAt(i, dummy.matrix);
    }
    // Vertical roads (along Z, varying X).
    for (let i = 0; i < roadCoords.length; i++) {
      dummy.position.set(roadCoords[i], 0.035, 0);
      dummy.scale.set(CONFIG.roadWidth, 0.14, len);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      this.roadsV.setMatrixAt(i, dummy.matrix);
    }
    this.roadsH.instanceMatrix.needsUpdate = true;
    this.roadsV.instanceMatrix.needsUpdate = true;
    this.root.add(this.roadsH, this.roadsV);

    // Sidewalk strips
    const sideGeo = new THREE.BoxGeometry(1, 1, 1);
    sideGeo.translate(0, 0.5, 0);
    const sideMat = lambert(0xc7c7d6, {});
    const perRoad = 2; // left/right sidewalk per road strip
    this.sideH = new THREE.InstancedMesh(sideGeo, sideMat, roadCoords.length * perRoad);
    this.sideV = new THREE.InstancedMesh(sideGeo, sideMat, roadCoords.length * perRoad);
    this.sideH.receiveShadow = true;
    this.sideV.receiveShadow = true;
    let idx = 0;
    const sideOffset = CONFIG.roadWidth * 0.5 + CONFIG.sidewalkWidth * 0.5;
    for (const z of roadCoords) {
      // north sidewalk
      dummy.position.set(0, 0.02, z + sideOffset);
      dummy.scale.set(len, 0.09, CONFIG.sidewalkWidth);
      dummy.updateMatrix();
      this.sideH.setMatrixAt(idx++, dummy.matrix);
      // south sidewalk
      dummy.position.set(0, 0.02, z - sideOffset);
      dummy.scale.set(len, 0.09, CONFIG.sidewalkWidth);
      dummy.updateMatrix();
      this.sideH.setMatrixAt(idx++, dummy.matrix);
    }
    this.sideH.instanceMatrix.needsUpdate = true;
    idx = 0;
    for (const x of roadCoords) {
      dummy.position.set(x + sideOffset, 0.02, 0);
      dummy.scale.set(CONFIG.sidewalkWidth, 0.09, len);
      dummy.updateMatrix();
      this.sideV.setMatrixAt(idx++, dummy.matrix);
      dummy.position.set(x - sideOffset, 0.02, 0);
      dummy.scale.set(CONFIG.sidewalkWidth, 0.09, len);
      dummy.updateMatrix();
      this.sideV.setMatrixAt(idx++, dummy.matrix);
    }
    this.sideV.instanceMatrix.needsUpdate = true;
    this.root.add(this.sideH, this.sideV);

    // Road markings: dashed center lines
    const markGeo = new THREE.PlaneGeometry(1, 1);
    const markMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.roadMarks = new THREE.InstancedMesh(markGeo, markMat, CONFIG.maxStreetBits);
    this.roadMarks.rotation.x = -Math.PI / 2;

    const dashLen = 2.0;
    const gap = 2.1;
    const dashW = 0.26;
    let markCount = 0;

    // Horizontal roads: dashes along X near center
    for (const z of roadCoords) {
      for (let x = -worldHalf - CONFIG.groundPadding; x < worldHalf + CONFIG.groundPadding; x += dashLen + gap) {
        if (markCount >= CONFIG.maxStreetBits) break;
        dummy.position.set(x + dashLen * 0.5, 0.12, z);
        dummy.scale.set(dashLen, dashW, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        this.roadMarks.setMatrixAt(markCount++, dummy.matrix);
      }
    }
    // Vertical roads: dashes along Z
    for (const x of roadCoords) {
      for (let z = -worldHalf - CONFIG.groundPadding; z < worldHalf + CONFIG.groundPadding; z += dashLen + gap) {
        if (markCount >= CONFIG.maxStreetBits) break;
        dummy.position.set(x, 0.12, z + dashLen * 0.5);
        dummy.scale.set(dashW, dashLen, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        this.roadMarks.setMatrixAt(markCount++, dummy.matrix);
      }
    }
    this.roadMarks.count = markCount;
    this.roadMarks.instanceMatrix.needsUpdate = true;
    this.root.add(this.roadMarks);

    // Crosswalks near intersections
    const crossGeo = new THREE.PlaneGeometry(1, 1);
    const crossMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    this.crosswalks = new THREE.InstancedMesh(crossGeo, crossMat, CONFIG.maxStreetBits);
    this.crosswalks.rotation.x = -Math.PI / 2;
    let crossCount = 0;

    const stripeW = 0.35;
    const stripeL = 2.6;
    const stripes = 7;
    const spacing = 0.45;
    const inset = CONFIG.roadWidth * 0.32;

    for (const x of roadCoords) {
      for (const z of roadCoords) {
        // Four sides: two aligned with X road, two with Z road
        for (let s = 0; s < stripes; s++) {
          if (crossCount >= CONFIG.maxStreetBits) break;
          const o = (s - (stripes - 1) * 0.5) * spacing;

          // Crosswalk across X road (stripes along X, offset in Z)
          dummy.position.set(x + o, 0.13, z + inset);
          dummy.scale.set(stripeW, stripeL, 1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          this.crosswalks.setMatrixAt(crossCount++, dummy.matrix);

          if (crossCount >= CONFIG.maxStreetBits) break;
          dummy.position.set(x + o, 0.13, z - inset);
          dummy.scale.set(stripeW, stripeL, 1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          this.crosswalks.setMatrixAt(crossCount++, dummy.matrix);

          // Crosswalk across Z road (rotate 90 degrees)
          if (crossCount >= CONFIG.maxStreetBits) break;
          dummy.position.set(x + inset, 0.13, z + o);
          dummy.scale.set(stripeL, stripeW, 1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          this.crosswalks.setMatrixAt(crossCount++, dummy.matrix);

          if (crossCount >= CONFIG.maxStreetBits) break;
          dummy.position.set(x - inset, 0.13, z + o);
          dummy.scale.set(stripeL, stripeW, 1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          this.crosswalks.setMatrixAt(crossCount++, dummy.matrix);
        }
      }
    }
    this.crosswalks.count = crossCount;
    this.crosswalks.instanceMatrix.needsUpdate = true;
    this.root.add(this.crosswalks);
  }

  _buildBuildingsAndProps() {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const roadCoords = new Set(getRoadCoords().map((v) => v.toFixed(3)));

    const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
    buildingGeo.translate(0, 0.5, 0);
    const buildingMat = lambert(0xffffff, {
      vertexColors: true,
      emissiveHex: 0xffffff,
      emissiveIntensity: 0.05,
    });

    this.buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, CONFIG.maxBuildings);
    this.buildings.castShadow = true;
    this.buildings.receiveShadow = true;
    this.buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.buildings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CONFIG.maxBuildings * 3), 3);

    // Building windows (glow overlay)
    const buildingWinGeo = buildingGeo.clone();
    buildingWinGeo.setAttribute("instanceSeed", new THREE.InstancedBufferAttribute(new Float32Array(CONFIG.maxBuildings), 1));
    const buildingWinMat = makeWindowGlowMaterial({ grid: new THREE.Vector2(9, 18), border: 0.14, intensity: 1.25 });
    this.buildingWindows = new THREE.InstancedMesh(buildingWinGeo, buildingWinMat, CONFIG.maxBuildings);
    this.buildingWindows.frustumCulled = true;

    const roofGeo = new THREE.BoxGeometry(1, 1, 1);
    roofGeo.translate(0, 0.5, 0);
    const roofMat = lambert(0x6a74a9, {});
    this.roofBits = new THREE.InstancedMesh(roofGeo, roofMat, CONFIG.maxRoofBits);
    this.roofBits.castShadow = true;
    this.roofBits.receiveShadow = true;

    // Trees: trunk + crown (instanced)
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.22, 1.0, 7, 1);
    trunkGeo.translate(0, 0.5, 0);
    const trunkMat = lambert(0x7a4c2f, {});
    this.treesTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, CONFIG.maxTrees);
    this.treesTrunk.castShadow = true;
    this.treesTrunk.receiveShadow = true;

    const crownGeo = new THREE.IcosahedronGeometry(0.72, 0);
    const crownMat = lambert(0x29ff7a, {});
    this.treesCrown = new THREE.InstancedMesh(crownGeo, crownMat, CONFIG.maxTrees);
    this.treesCrown.castShadow = true;
    this.treesCrown.receiveShadow = true;

    // Residential houses (base + roof)
    const houseBaseGeo = new THREE.BoxGeometry(1, 1, 1);
    houseBaseGeo.translate(0, 0.5, 0);
    const houseRoofGeo = new THREE.ConeGeometry(0.85, 0.9, 4, 1);
    houseRoofGeo.rotateY(Math.PI / 4);
    houseRoofGeo.translate(0, 0.45, 0);

    const houseBaseMat = lambert(0xffffff, { vertexColors: true });
    const houseRoofMat = lambert(0xffffff, { vertexColors: true });

    this.housesBase = new THREE.InstancedMesh(houseBaseGeo, houseBaseMat, CONFIG.maxHouses);
    this.housesRoof = new THREE.InstancedMesh(houseRoofGeo, houseRoofMat, CONFIG.maxHouseRoofs);
    this.housesBase.castShadow = true;
    this.housesBase.receiveShadow = true;
    this.housesRoof.castShadow = true;
    this.housesRoof.receiveShadow = true;
    this.housesBase.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CONFIG.maxHouses * 3), 3);
    this.housesRoof.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CONFIG.maxHouseRoofs * 3), 3);

    // House windows (subtler)
    const houseWinGeo = houseBaseGeo.clone();
    houseWinGeo.setAttribute("instanceSeed", new THREE.InstancedBufferAttribute(new Float32Array(CONFIG.maxHouses), 1));
    const houseWinMat = makeWindowGlowMaterial({
      grid: new THREE.Vector2(6, 6),
      border: 0.18,
      intensity: 0.85,
      warm: new THREE.Color(0xffe6b3),
      cool: new THREE.Color(0x9be6ff),
    });
    this.houseWindows = new THREE.InstancedMesh(houseWinGeo, houseWinMat, CONFIG.maxHouses);

    // Parking lots (pad + lines)
    const padGeo = new THREE.BoxGeometry(1, 1, 1);
    padGeo.translate(0, 0.5, 0);
    const padMat = lambert(0x3c3f52, {});
    this.parkingPads = new THREE.InstancedMesh(padGeo, padMat, CONFIG.maxParkingPads);
    this.parkingPads.receiveShadow = true;
    this.parkingPads.castShadow = false;

    const lineGeo = new THREE.PlaneGeometry(1, 1);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    this.parkingLines = new THREE.InstancedMesh(lineGeo, lineMat, CONFIG.maxParkingLines);
    this.parkingLines.rotation.x = -Math.PI / 2;

    const half = Math.floor(CONFIG.tileCount / 2);
    const buildRegion = CONFIG.tileSpacing - (CONFIG.roadWidth * 0.42);
    const margin = 1.05;

    let bCount = 0;
    let roofCount = 0;
    let treeCount = 0;
    let houseCount = 0;
    let houseRoofCount = 0;
    let parkPadCount = 0;
    let parkLineCount = 0;

    for (let iz = -half; iz <= half; iz++) {
      for (let ix = -half; ix <= half; ix++) {
        const cx = ix * CONFIG.tileSpacing;
        const cz = iz * CONFIG.tileSpacing;
        const keyX = cx.toFixed(3);
        const keyZ = cz.toFixed(3);

        // If this tile aligns with a road line, don't place buildings.
        if (roadCoords.has(keyX) || roadCoords.has(keyZ)) continue;

        // Tile RNG (stable per tile).
        const tileSeed = (this.seed ^ ((ix * 73856093) ^ (iz * 19349663))) >>> 0;
        const r = mulberry32(tileSeed);

        // District selection per tile (park / residential / mixed / highrise)
        const parkChance = r();
        const isPark = parkChance < 0.08;
        const district = isPark ? "park" : parkChance < 0.52 ? "residential" : parkChance < 0.74 ? "mixed" : "highrise";

        const lots = district === "highrise" ? 3 + Math.floor(r() * 7) : district === "mixed" ? 2 + Math.floor(r() * 4) : 0;
        // Bright colorful palette (pixel-game city blocks).
        const palette = [
          0x5b8cff, // blue
          0xff6bd6, // pink
          0xffc24a, // orange
          0x7aff68, // green
          0x9b7bff, // purple
          0x45e6ff, // cyan
          0xff5b5b, // red
        ];
        color.setHex(palette[(r() * palette.length) | 0]);
        const tileHue = (color.getHSL(_hsl).h + (r() - 0.5) * 0.05 + 1) % 1;
        const baseSat = 0.58 + r() * 0.22;

        const attempts = lots * 2 + 4;
        const placed = [];

        // Tall / mid-rise buildings (skip for residential).
        for (let a = 0; a < attempts; a++) {
          if (placed.length >= lots) break;
          if (bCount >= CONFIG.maxBuildings) break;

          const w = lerp(1.8, district === "highrise" ? 5.1 : 4.3, r());
          const d = lerp(1.8, district === "highrise" ? 5.1 : 4.3, r());
          const h =
            district === "highrise"
              ? lerp(10, 52, Math.pow(r(), 0.52))
              : lerp(5, 18, Math.pow(r(), 0.8));

          const x = cx + (r() - 0.5) * (buildRegion - w - margin);
          const z = cz + (r() - 0.5) * (buildRegion - d - margin);

          // simple overlap test inside tile
          let ok = true;
          for (const p of placed) {
            const dx = Math.abs(x - p.x);
            const dz = Math.abs(z - p.z);
            if (dx < (w + p.w) * 0.55 && dz < (d + p.d) * 0.55) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          placed.push({ x, z, w, d, h });

          dummy.position.set(x, 0, z);
          dummy.scale.set(w, h, d);
          dummy.rotation.set(0, (r() - 0.5) * 0.2, 0);
          dummy.updateMatrix();
          this.buildings.setMatrixAt(bCount, dummy.matrix);

          // windows overlay (slightly inflated to avoid z-fighting)
          dummy.position.set(x, 0, z);
          dummy.scale.set(w * 1.003, h * 1.003, d * 1.003);
          dummy.rotation.set(0, dummy.rotation.y, 0);
          dummy.updateMatrix();
          this.buildingWindows.setMatrixAt(bCount, dummy.matrix);
          buildingWinGeo.attributes.instanceSeed.setX(bCount, r());

          const l = 0.56 + r() * 0.18;
          color.setHSL((tileHue + (r() - 0.5) * 0.04 + (h / 80) * 0.02 + 1) % 1, baseSat, l);
          this.buildings.setColorAt(bCount, color);
          bCount++;

          // Rooftop bits (AC units / little towers)
          const roofBitsHere = 1 + Math.floor(r() * 4);
          for (let rb = 0; rb < roofBitsHere; rb++) {
            if (roofCount >= CONFIG.maxRoofBits) break;
            const rw = lerp(0.35, 1.2, r());
            const rd = lerp(0.35, 1.2, r());
            const rh = lerp(0.35, 2.4, r());
            dummy.position.set(x + (r() - 0.5) * (w * 0.6), h + 0.03, z + (r() - 0.5) * (d * 0.6));
            dummy.scale.set(rw, rh, rd);
            dummy.rotation.set(0, r() * Math.PI, 0);
            dummy.updateMatrix();
            this.roofBits.setMatrixAt(roofCount++, dummy.matrix);
          }
        }

        // Residential houses (lots of small structures + roofs)
        if (district === "residential") {
          const housesHere = 6 + Math.floor(r() * 14);
          const tries = housesHere * 3 + 10;
          const hp = [];
          const housePalette = [0xfff2d8, 0xf7f0ff, 0xdff6ff, 0xe9ffe8, 0xffe3ef, 0xfff7c7];
          const roofPalette = [0xb24a3a, 0x3b4a86, 0x2c2c34, 0x2e6b3f, 0x6b2e6a, 0x8a6a2e];

          for (let a = 0; a < tries; a++) {
            if (hp.length >= housesHere) break;
            if (houseCount >= CONFIG.maxHouses || houseRoofCount >= CONFIG.maxHouseRoofs) break;

            const w = lerp(1.6, 3.4, r());
            const d = lerp(1.6, 3.4, r());
            const h = lerp(1.2, 2.9, Math.pow(r(), 0.75));
            const x = cx + (r() - 0.5) * (buildRegion - w - margin);
            const z = cz + (r() - 0.5) * (buildRegion - d - margin);

            let ok = true;
            for (const p of hp) {
              const dx = Math.abs(x - p.x);
              const dz = Math.abs(z - p.z);
              if (dx < (w + p.w) * 0.62 && dz < (d + p.d) * 0.62) {
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            hp.push({ x, z, w, d });

            dummy.position.set(x, 0.0, z);
            dummy.scale.set(w, h, d);
            dummy.rotation.set(0, (r() - 0.5) * 0.45, 0);
            dummy.updateMatrix();
            this.housesBase.setMatrixAt(houseCount, dummy.matrix);

            // house window overlay
            dummy.position.set(x, 0.0, z);
            dummy.scale.set(w * 1.004, h * 1.004, d * 1.004);
            dummy.rotation.set(0, dummy.rotation.y, 0);
            dummy.updateMatrix();
            this.houseWindows.setMatrixAt(houseCount, dummy.matrix);
            houseWinGeo.attributes.instanceSeed.setX(houseCount, r());

            color.setHex(housePalette[(r() * housePalette.length) | 0]);
            this.housesBase.setColorAt(houseCount, color);
            houseCount++;

            // Roof
            const roofH = lerp(0.75, 1.35, r());
            dummy.position.set(x, h + 0.02, z);
            dummy.scale.set(Math.max(w, d) * 0.7, roofH, Math.max(w, d) * 0.7);
            dummy.rotation.set(0, dummy.rotation.y, 0);
            dummy.updateMatrix();
            this.housesRoof.setMatrixAt(houseRoofCount, dummy.matrix);
            color.setHex(roofPalette[(r() * roofPalette.length) | 0]);
            this.housesRoof.setColorAt(houseRoofCount, color);
            houseRoofCount++;
          }
        }

        // Commercial-ish parking pads in mixed/highrise districts
        if (district !== "park" && district !== "residential" && r() < 0.28) {
          if (parkPadCount < CONFIG.maxParkingPads) {
            const pw = lerp(5.2, 10.2, r());
            const pd = lerp(4.0, 9.2, r());
            const px = cx + (r() - 0.5) * (buildRegion - pw - margin);
            const pz = cz + (r() - 0.5) * (buildRegion - pd - margin);
            dummy.position.set(px, 0.02, pz);
            dummy.scale.set(pw, 0.08, pd);
            dummy.rotation.set(0, (r() - 0.5) * 0.2, 0);
            dummy.updateMatrix();
            this.parkingPads.setMatrixAt(parkPadCount++, dummy.matrix);

            // Painted parking lines
            const cols = Math.max(3, Math.floor(pw / 1.6));
            const rows = Math.max(2, Math.floor(pd / 2.6));
            const cellW = pw / cols;
            const cellD = pd / rows;
            for (let rr = 0; rr < rows; rr++) {
              for (let cc = 0; cc < cols; cc++) {
                if (parkLineCount + 2 >= CONFIG.maxParkingLines) break;
                const ox = (cc - (cols - 1) * 0.5) * cellW;
                const oz = (rr - (rows - 1) * 0.5) * cellD;

                // Two border lines per spot (quick readable pattern)
                dummy.position.set(px + ox, 0.09, pz + oz);
                dummy.scale.set(cellW * 0.9, 0.06, 1);
                dummy.rotation.set(0, dummy.rotation.y, 0);
                dummy.updateMatrix();
                this.parkingLines.setMatrixAt(parkLineCount++, dummy.matrix);

                dummy.position.set(px + ox, 0.09, pz + oz + cellD * 0.42);
                dummy.scale.set(cellW * 0.9, 0.06, 1);
                dummy.updateMatrix();
                this.parkingLines.setMatrixAt(parkLineCount++, dummy.matrix);
              }
            }
          }
        }

        // Trees: parks have more trees, otherwise a few along sidewalks
        const treeTarget = isPark ? 22 + Math.floor(r() * 26) : 3 + Math.floor(r() * 6);
        for (let t = 0; t < treeTarget; t++) {
          if (treeCount >= CONFIG.maxTrees) break;
          const tx = cx + (r() - 0.5) * (buildRegion - 1.2);
          const tz = cz + (r() - 0.5) * (buildRegion - 1.2);
          const th = lerp(0.8, 1.5, r());
          dummy.position.set(tx, 0.01, tz);
          dummy.scale.set(1, th, 1);
          dummy.rotation.set(0, r() * Math.PI * 2, 0);
          dummy.updateMatrix();
          this.treesTrunk.setMatrixAt(treeCount, dummy.matrix);

          dummy.position.set(tx, th + 0.22, tz);
          const crownS = lerp(0.9, 1.35, r());
          dummy.scale.setScalar(crownS);
          dummy.rotation.set(0, r() * Math.PI * 2, 0);
          dummy.updateMatrix();
          this.treesCrown.setMatrixAt(treeCount, dummy.matrix);
          treeCount++;
        }
      }
    }

    this.buildings.count = bCount;
    this.buildings.instanceMatrix.needsUpdate = true;
    if (this.buildings.instanceColor) this.buildings.instanceColor.needsUpdate = true;
    this.buildingWindows.count = bCount;
    this.buildingWindows.instanceMatrix.needsUpdate = true;
    this.buildingWindows.geometry.attributes.instanceSeed.needsUpdate = true;
    this.roofBits.count = roofCount;
    this.roofBits.instanceMatrix.needsUpdate = true;
    this.treesTrunk.count = treeCount;
    this.treesCrown.count = treeCount;
    this.treesTrunk.instanceMatrix.needsUpdate = true;
    this.treesCrown.instanceMatrix.needsUpdate = true;

    this.counts.buildings = bCount;
    this.counts.roofBits = roofCount;
    this.counts.trees = treeCount;

    this.housesBase.count = houseCount;
    this.housesRoof.count = houseRoofCount;
    this.housesBase.instanceMatrix.needsUpdate = true;
    this.housesRoof.instanceMatrix.needsUpdate = true;
    if (this.housesBase.instanceColor) this.housesBase.instanceColor.needsUpdate = true;
    if (this.housesRoof.instanceColor) this.housesRoof.instanceColor.needsUpdate = true;
    this.houseWindows.count = houseCount;
    this.houseWindows.instanceMatrix.needsUpdate = true;
    this.houseWindows.geometry.attributes.instanceSeed.needsUpdate = true;
    this.parkingPads.count = parkPadCount;
    this.parkingPads.instanceMatrix.needsUpdate = true;
    this.parkingLines.count = parkLineCount;
    this.parkingLines.instanceMatrix.needsUpdate = true;

    this.counts.houses = houseCount;
    this.counts.parking = parkPadCount;

    this.root.add(
      this.buildings,
      this.buildingWindows,
      this.roofBits,
      this.housesBase,
      this.houseWindows,
      this.housesRoof,
      this.parkingPads,
      this.parkingLines,
      this.treesTrunk,
      this.treesCrown
    );
  }

  _buildBillboards() {
    const roadCoords = getRoadCoords();
    const pick = (arr) => arr[Math.floor(this.rand() * arr.length)];
    const names = ["NEON NOODLES", "BYTE BAKERY", "STAR LAUNDRY", "CAT CAFÉ", "MEGA MART", "PIXEL PHARM"];

    const group = new THREE.Group();

    for (let i = 0; i < 10; i++) {
      const x = pick(roadCoords) + (this.rand() - 0.5) * 8;
      const z = pick(roadCoords) + (this.rand() - 0.5) * 8;
      const y = 6 + this.rand() * 30;

      const tex = makeSignTexture(pick(names), "#eaf3ff");
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const geo = new THREE.PlaneGeometry(10, 5);
      const sign = new THREE.Mesh(geo, mat);
      sign.position.set(x, y, z);
      sign.rotation.y = this.rand() * Math.PI * 2;
      group.add(sign);
    }

    this.root.add(group);
  }

  _buildStreetLightsAndSignals() {
    const roadCoords = getRoadCoords();
    const { worldHalf } = worldSizeFromConfig();
    const dummy = new THREE.Object3D();
    const signalColor = new THREE.Color();

    // Street poles (instanced) and bulbs (instanced)
    const poleGeo = new THREE.CylinderGeometry(0.11, 0.16, 3.4, 7, 1);
    poleGeo.translate(0, 1.7, 0);
    const poleMat = lambert(0x4b556f, {});
    this.streetPoles = new THREE.InstancedMesh(poleGeo, poleMat, CONFIG.maxStreetBits);
    this.streetPoles.castShadow = true;
    this.streetPoles.receiveShadow = true;

    const bulbGeo = new THREE.SphereGeometry(0.22, 8, 8);
    const bulbMat = lambert(0xffffff, { emissiveHex: 0xffffff, emissiveIntensity: 0.45 });
    this.streetBulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, CONFIG.maxStreetBits);
    this.streetBulbs.castShadow = false;
    this.streetBulbs.receiveShadow = false;

    // Traffic signals (two colors sets) updated each frame
    const sigGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    const sigMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    sigMat.vertexColors = true;
    this.streetSignalX = new THREE.InstancedMesh(sigGeo, sigMat, CONFIG.maxStreetBits);
    this.streetSignalZ = new THREE.InstancedMesh(sigGeo, sigMat, CONFIG.maxStreetBits);
    this.streetSignalX.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CONFIG.maxStreetBits * 3), 3);
    this.streetSignalZ.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CONFIG.maxStreetBits * 3), 3);
    this.streetSignalX.count = 0;
    this.streetSignalZ.count = 0;

    const curb = CONFIG.roadWidth * 0.5 + CONFIG.sidewalkWidth * 0.55;
    let poleCount = 0;
    let bulbCount = 0;
    let sigXCount = 0;
    let sigZCount = 0;

    // A few real point lights for sparkle (not everywhere).
    const sparkle = new THREE.Group();
    const sparkleBudget = 38;
    let sparklePlaced = 0;

    for (const x of roadCoords) {
      for (const z of roadCoords) {
        if (Math.abs(x) > worldHalf - 1 || Math.abs(z) > worldHalf - 1) continue;
        if (poleCount + 4 >= CONFIG.maxStreetBits) continue;

        // Four corner streetlamps
        const corners = [
          [x + curb, z + curb],
          [x + curb, z - curb],
          [x - curb, z + curb],
          [x - curb, z - curb],
        ];

        for (const [px, pz] of corners) {
          dummy.position.set(px, 0.0, pz);
          dummy.scale.setScalar(1);
          dummy.rotation.set(0, (this.rand() - 0.5) * 0.25, 0);
          dummy.updateMatrix();
          this.streetPoles.setMatrixAt(poleCount++, dummy.matrix);

          dummy.position.set(px, 3.35, pz);
          dummy.scale.setScalar(1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          this.streetBulbs.setMatrixAt(bulbCount++, dummy.matrix);

          // Occasionally add a real light (costly), for "alive" vibes.
          if (sparklePlaced < sparkleBudget && this.rand() < 0.08) {
            const pl = new THREE.PointLight(0xfff0c8, 0.5 + this.rand() * 0.6, 36, 2.0);
            pl.position.set(px, 3.8, pz);
            sparkle.add(pl);
            sparklePlaced++;
          }
        }

        // Traffic signals: two per intersection (X and Z directions)
        const sx = x + curb * 0.72;
        const sz = z - curb * 0.72;
        dummy.position.set(sx, 3.0, sz);
        dummy.scale.setScalar(1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        this.streetSignalX.setMatrixAt(sigXCount, dummy.matrix);
        signalColor.setHex(0x00ff88);
        this.streetSignalX.setColorAt(sigXCount, signalColor);
        sigXCount++;

        const sx2 = x - curb * 0.72;
        const sz2 = z + curb * 0.72;
        dummy.position.set(sx2, 3.0, sz2);
        dummy.updateMatrix();
        this.streetSignalZ.setMatrixAt(sigZCount, dummy.matrix);
        signalColor.setHex(0xff3344);
        this.streetSignalZ.setColorAt(sigZCount, signalColor);
        sigZCount++;

        this.counts.intersections++;
      }
    }

    this.streetPoles.count = poleCount;
    this.streetBulbs.count = bulbCount;
    this.streetSignalX.count = sigXCount;
    this.streetSignalZ.count = sigZCount;
    this.streetPoles.instanceMatrix.needsUpdate = true;
    this.streetBulbs.instanceMatrix.needsUpdate = true;
    this.streetSignalX.instanceMatrix.needsUpdate = true;
    this.streetSignalZ.instanceMatrix.needsUpdate = true;
    if (this.streetSignalX.instanceColor) this.streetSignalX.instanceColor.needsUpdate = true;
    if (this.streetSignalZ.instanceColor) this.streetSignalZ.instanceColor.needsUpdate = true;

    this.streetLightRoot.add(this.streetPoles, this.streetBulbs, this.streetSignalX, this.streetSignalZ, sparkle);
  }

  _buildStreetTreesAndProps() {
    const roadCoords = getRoadCoords();
    const roadSet = new Set(roadCoords.map((v) => v.toFixed(3)));
    const { worldHalf } = worldSizeFromConfig();
    const dummy = new THREE.Object3D();

    // Street trees
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.15, 7, 1);
    trunkGeo.translate(0, 0.575, 0);
    const crownGeo = new THREE.IcosahedronGeometry(0.78, 0);

    const trunkMat = lambert(0x7a4c2f, {});
    const crownMat = lambert(0x27f26d, {});

    this.streetTreesTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, CONFIG.maxStreetTrees);
    this.streetTreesCrown = new THREE.InstancedMesh(crownGeo, crownMat, CONFIG.maxStreetTrees);
    this.streetTreesTrunk.castShadow = true;
    this.streetTreesCrown.castShadow = true;
    this.streetTreesTrunk.receiveShadow = true;
    this.streetTreesCrown.receiveShadow = true;

    // Sidewalk props (benches/boxes/hydrants-ish)
    const propBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    propBoxGeo.translate(0, 0.5, 0);
    const propPostGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.65, 7, 1);
    propPostGeo.translate(0, 0.325, 0);

    const propBoxMat = lambert(0x6a74a9, {});
    const propPostMat = lambert(0xff5b5b, { emissiveHex: 0xff5b5b, emissiveIntensity: 0.05 });

    this.propsBoxes = new THREE.InstancedMesh(propBoxGeo, propBoxMat, CONFIG.maxProps);
    this.propsPosts = new THREE.InstancedMesh(propPostGeo, propPostMat, CONFIG.maxProps);
    this.propsBoxes.castShadow = true;
    this.propsBoxes.receiveShadow = true;
    this.propsPosts.castShadow = true;
    this.propsPosts.receiveShadow = true;

    const curb = CONFIG.roadWidth * 0.5 + CONFIG.sidewalkWidth * 0.72;
    const spacing = 9.6;
    let stCount = 0;
    let propB = 0;
    let propP = 0;

    // Trees along horizontal roads
    for (const z of roadCoords) {
      for (let x = -worldHalf; x <= worldHalf; x += spacing) {
        if (stCount >= CONFIG.maxStreetTrees) break;
        if (roadSet.has(x.toFixed(3))) continue; // avoid intersections
        // two sidewalks
        for (const s of [-1, 1]) {
          if (stCount >= CONFIG.maxStreetTrees) break;
          if (Math.random() < 0.25) continue;
          const tx = x + (hash2(x, z) - 0.5) * 1.1;
          const tz = z + s * curb + (hash2(z, x) - 0.5) * 0.6;
          const th = 0.95 + hash2(tx, tz) * 0.55;
          dummy.position.set(tx, 0.01, tz);
          dummy.scale.set(1, th, 1);
          dummy.rotation.set(0, hash2(tx * 0.3, tz * 0.3) * Math.PI * 2, 0);
          dummy.updateMatrix();
          this.streetTreesTrunk.setMatrixAt(stCount, dummy.matrix);
          dummy.position.set(tx, th + 0.35, tz);
          dummy.scale.setScalar(0.95 + hash2(tx * 0.7, tz * 0.7) * 0.55);
          dummy.updateMatrix();
          this.streetTreesCrown.setMatrixAt(stCount, dummy.matrix);
          stCount++;
        }
      }
    }

    // Trees along vertical roads
    for (const x of roadCoords) {
      for (let z = -worldHalf; z <= worldHalf; z += spacing) {
        if (stCount >= CONFIG.maxStreetTrees) break;
        if (roadSet.has(z.toFixed(3))) continue; // avoid intersections
        for (const s of [-1, 1]) {
          if (stCount >= CONFIG.maxStreetTrees) break;
          if (Math.random() < 0.25) continue;
          const tx = x + s * curb + (hash2(x, z) - 0.5) * 0.6;
          const tz = z + (hash2(z, x) - 0.5) * 1.1;
          const th = 0.95 + hash2(tx, tz) * 0.55;
          dummy.position.set(tx, 0.01, tz);
          dummy.scale.set(1, th, 1);
          dummy.rotation.set(0, hash2(tx * 0.3, tz * 0.3) * Math.PI * 2, 0);
          dummy.updateMatrix();
          this.streetTreesTrunk.setMatrixAt(stCount, dummy.matrix);
          dummy.position.set(tx, th + 0.35, tz);
          dummy.scale.setScalar(0.95 + hash2(tx * 0.7, tz * 0.7) * 0.55);
          dummy.updateMatrix();
          this.streetTreesCrown.setMatrixAt(stCount, dummy.matrix);
          stCount++;
        }
      }
    }

    // Props around intersections (adds a LOT of perceived detail)
    for (const x of roadCoords) {
      for (const z of roadCoords) {
        if (propB >= CONFIG.maxProps || propP >= CONFIG.maxProps) break;
        if (Math.abs(x) > worldHalf - 1 || Math.abs(z) > worldHalf - 1) continue;
        const corners = [
          [x + curb, z + curb],
          [x + curb, z - curb],
          [x - curb, z + curb],
          [x - curb, z - curb],
        ];
        for (const [px, pz] of corners) {
          if (propB < CONFIG.maxProps && hash2(px, pz) < 0.5) {
            dummy.position.set(px + (hash2(px * 2, pz) - 0.5) * 0.6, 0.02, pz + (hash2(pz * 2, px) - 0.5) * 0.6);
            dummy.scale.set(0.45 + hash2(px, pz) * 0.35, 0.35 + hash2(pz, px) * 0.35, 0.45 + hash2(px + 1, pz + 1) * 0.35);
            dummy.rotation.set(0, hash2(px * 0.2, pz * 0.2) * Math.PI * 2, 0);
            dummy.updateMatrix();
            this.propsBoxes.setMatrixAt(propB++, dummy.matrix);
          }
          if (propP < CONFIG.maxProps && hash2(px + 10, pz + 10) < 0.45) {
            dummy.position.set(px + (hash2(px, pz + 3) - 0.5) * 0.35, 0.02, pz + (hash2(pz, px + 3) - 0.5) * 0.35);
            dummy.scale.setScalar(0.9 + hash2(px * 3, pz * 3) * 0.8);
            dummy.rotation.set(0, hash2(px * 0.15, pz * 0.15) * Math.PI * 2, 0);
            dummy.updateMatrix();
            this.propsPosts.setMatrixAt(propP++, dummy.matrix);
          }
        }
      }
    }

    this.streetTreesTrunk.count = stCount;
    this.streetTreesCrown.count = stCount;
    this.propsBoxes.count = propB;
    this.propsPosts.count = propP;
    this.streetTreesTrunk.instanceMatrix.needsUpdate = true;
    this.streetTreesCrown.instanceMatrix.needsUpdate = true;
    this.propsBoxes.instanceMatrix.needsUpdate = true;
    this.propsPosts.instanceMatrix.needsUpdate = true;

    this.counts.streetTrees = stCount;
    this.counts.props = propB + propP;

    this.root.add(this.streetTreesTrunk, this.streetTreesCrown, this.propsBoxes, this.propsPosts);
  }

  updateTrafficSignals(timeSeconds) {
    if (!this.streetSignalX || !this.streetSignalZ) return;

    const greenX = new THREE.Color(0x00ff88);
    const red = new THREE.Color(0xff3344);
    const yellow = new THREE.Color(0xffcc44);

    const cycle = 7.2;
    const yellowWindow = 0.11;

    // Update per instance color (cheap-ish)
    for (let i = 0; i < this.streetSignalX.count; i++) {
      // Pull intersection coords from the matrix translation (fast enough).
      this.streetSignalX.getMatrixAt(i, _m4);
      _v3.setFromMatrixPosition(_m4);
      const jitter = hash2(_v3.x, _v3.z) * 0.9;
      const ph = ((timeSeconds + jitter) / cycle) % 1;

      // X direction green for first half, Z green for second half.
      const xGreen = ph < 0.5;
      const inYellow = Math.abs(ph - 0.5) < yellowWindow || ph < yellowWindow || ph > 1 - yellowWindow;

      const cx = xGreen ? greenX : inYellow ? yellow : red;
      const cz = !xGreen ? greenX : inYellow ? yellow : red;
      this.streetSignalX.setColorAt(i, cx);
      if (i < this.streetSignalZ.count) this.streetSignalZ.setColorAt(i, cz);
    }
    if (this.streetSignalX.instanceColor) this.streetSignalX.instanceColor.needsUpdate = true;
    if (this.streetSignalZ.instanceColor) this.streetSignalZ.instanceColor.needsUpdate = true;
  }
}

// Reusable temp objects to avoid GC
const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _hsl = { h: 0, s: 0, l: 0 };

class CarSystem {
  constructor(randFn, parent) {
    this.randFn = randFn;
    this.parent = parent;
    this.totalCars = 0;
    this.enabled = true;

    this.cars = []; // metadata per car
    this.body = null;
    this.cabin = null;
    this.headlights = null;

    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
  }

  build() {
    this.parent.clear();
    this.cars.length = 0;

    const bodyGeo = new THREE.BoxGeometry(1.0, 0.42, 0.58, 1, 1, 1);
    bodyGeo.translate(0, 0.21, 0);
    const cabinGeo = new THREE.BoxGeometry(0.56, 0.26, 0.52, 1, 1, 1);
    cabinGeo.translate(0.05, 0.42, 0);

    const bodyMat = lambert(0xffffff, { vertexColors: true, emissiveHex: 0xffffff, emissiveIntensity: 0.03 });
    const cabinMat = lambert(0xffffff, { vertexColors: true, emissiveHex: 0xffffff, emissiveIntensity: 0.02 });

    const cap = CONFIG.carCountX + CONFIG.carCountZ;
    this.body = new THREE.InstancedMesh(bodyGeo, bodyMat, cap);
    this.cabin = new THREE.InstancedMesh(cabinGeo, cabinMat, cap);
    this.body.castShadow = true;
    this.body.receiveShadow = false;
    this.cabin.castShadow = true;
    this.cabin.receiveShadow = false;

    this.body.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(cap * 3),
      3
    );
    this.cabin.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(cap * 3),
      3
    );

    // Headlights (2 per car) add a LOT of perceived motion/detail.
    const hlGeo = new THREE.BoxGeometry(0.12, 0.08, 0.12);
    hlGeo.translate(0, 0.04, 0);
    const hlMat = lambert(0xffffff, { emissiveHex: 0xfff3c0, emissiveIntensity: 0.55 });
    this.headlights = new THREE.InstancedMesh(hlGeo, hlMat, cap * 2);
    this.headlights.castShadow = false;
    this.headlights.receiveShadow = false;

    const roadCoords = getRoadCoords();
    const { worldHalf } = worldSizeFromConfig();

    const lane = CONFIG.roadWidth * 0.22;
    const lane2 = CONFIG.roadWidth * 0.38;

    const makeCarColor = () => {
      const h = (this.randFn() * 1.0 + 0.02) % 1;
      const s = 0.55 + this.randFn() * 0.35;
      const l = 0.48 + this.randFn() * 0.18;
      return new THREE.Color().setHSL(h, s, l);
    };

    let idx = 0;

    const spawnX = (count, dir) => {
      for (let i = 0; i < count; i++) {
        const z = roadCoords[(Math.random() * roadCoords.length) | 0] + (dir > 0 ? -lane : lane);
        const x = lerp(-worldHalf, worldHalf, this.randFn());
        const speed = lerp(16.0, 36.0, Math.pow(this.randFn(), 0.6));
        const wobble = this.randFn() * 10;
        const length = lerp(0.9, 1.25, this.randFn());
        const c = makeCarColor();
        this.cars.push({ axis: "x", dir, x, z, speed, wobble, length });

        this._color.copy(c);
        this.body.setColorAt(idx, this._color);
        this._color.offsetHSL(0, -0.15, 0.05);
        this.cabin.setColorAt(idx, this._color);
        idx++;
      }
    };

    const spawnZ = (count, dir) => {
      for (let i = 0; i < count; i++) {
        const x = roadCoords[(Math.random() * roadCoords.length) | 0] + (dir > 0 ? lane2 : -lane2);
        const z = lerp(-worldHalf, worldHalf, this.randFn());
        const speed = lerp(16.0, 36.0, Math.pow(this.randFn(), 0.6));
        const wobble = this.randFn() * 10;
        const length = lerp(0.9, 1.25, this.randFn());
        const c = makeCarColor();
        this.cars.push({ axis: "z", dir, x, z, speed, wobble, length });

        this._color.copy(c);
        this.body.setColorAt(idx, this._color);
        this._color.offsetHSL(0, -0.15, 0.05);
        this.cabin.setColorAt(idx, this._color);
        idx++;
      }
    };

    spawnX(Math.floor(CONFIG.carCountX * 0.5), +1);
    spawnX(Math.ceil(CONFIG.carCountX * 0.5), -1);
    spawnZ(Math.floor(CONFIG.carCountZ * 0.5), +1);
    spawnZ(Math.ceil(CONFIG.carCountZ * 0.5), -1);

    this.totalCars = this.cars.length;
    this.body.count = this.totalCars;
    this.cabin.count = this.totalCars;
    if (this.headlights) this.headlights.count = this.totalCars * 2;
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cabin.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.headlights) this.headlights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.parent.add(this.body, this.cabin, this.headlights);
  }

  // returns 0..1 slowdown factor (1 = go, 0 = stop)
  _signalSlowdown(timeSeconds, axis, x, z, dir) {
    // Approximate next intersection ahead, because our roads are evenly spaced.
    const { worldMin, worldMax, roadPeriod } = worldSizeFromConfig();
    const cycle = 7.2;
    const yellowWindow = 0.11;
    const jitter = hash2(x * 0.2, z * 0.2) * 0.9;
    const ph = ((timeSeconds + jitter) / cycle) % 1;
    const xGreen = ph < 0.5;
    const inYellow = Math.abs(ph - 0.5) < yellowWindow || ph < yellowWindow || ph > 1 - yellowWindow;

    const greenForAxis = axis === "x" ? xGreen : !xGreen;
    const caution = inYellow && !greenForAxis;
    const red = !greenForAxis && !inYellow;

    if (!(red || caution)) return 1;

    // Find stopline position along movement axis
    const pos = axis === "x" ? x : z;
    const t = (pos - worldMin) / roadPeriod;
    const next = dir > 0 ? (Math.floor(t + 1) * roadPeriod + worldMin) : (Math.ceil(t - 1) * roadPeriod + worldMin);
    const dist = (next - pos) * dir; // forward distance

    // start slowing down within this range
    const slowRange = 10.5;
    const stopRange = 3.3;

    if (dist < 0 || dist > slowRange) return 1;
    const s = smoothstep(slowRange, stopRange, dist);
    const minGo = caution ? 0.15 : 0.0;
    return lerp(1, minGo, s);
  }

  update(dt, timeSeconds) {
    if (!this.enabled) {
      this.body.visible = false;
      this.cabin.visible = false;
      if (this.headlights) this.headlights.visible = false;
      return;
    }
    this.body.visible = true;
    this.cabin.visible = true;
    if (this.headlights) this.headlights.visible = true;

    const { worldHalf } = worldSizeFromConfig();
    const dummy = this._dummy;

    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const slow = this._signalSlowdown(timeSeconds, c.axis, c.x, c.z, c.dir);
      const sp = c.speed * lerp(0.25, 1.0, slow);

      if (c.axis === "x") {
        c.x += sp * dt * c.dir;
        if (c.x > worldHalf) c.x = -worldHalf;
        if (c.x < -worldHalf) c.x = worldHalf;
      } else {
        c.z += sp * dt * c.dir;
        if (c.z > worldHalf) c.z = -worldHalf;
        if (c.z < -worldHalf) c.z = worldHalf;
      }

      const bob = Math.sin(timeSeconds * 2.2 + c.wobble) * 0.015;
      const y = 0.16 + bob;

      const rotY =
        c.axis === "x" ? (c.dir > 0 ? 0 : Math.PI) : c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;

      dummy.position.set(c.x, y, c.z);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.set(1.25 * c.length, 1, 1);
      dummy.updateMatrix();
      this.body.setMatrixAt(i, dummy.matrix);

      dummy.position.set(c.x, y, c.z);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.set(1.25 * c.length, 1, 1);
      dummy.updateMatrix();
      this.cabin.setMatrixAt(i, dummy.matrix);

      // Headlights (two small emissive cubes at the front)
      if (this.headlights) {
        const cos = Math.cos(rotY);
        const sin = Math.sin(rotY);
        const fwd = 0.7 * c.length;
        const side = 0.22;
        const hy = y + 0.1;

        // left
        let ox = fwd;
        let oz = side;
        let hx = c.x + ox * cos - oz * sin;
        let hz = c.z + ox * sin + oz * cos;
        dummy.position.set(hx, hy, hz);
        dummy.rotation.set(0, rotY, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        this.headlights.setMatrixAt(i * 2 + 0, dummy.matrix);

        // right
        ox = fwd;
        oz = -side;
        hx = c.x + ox * cos - oz * sin;
        hz = c.z + ox * sin + oz * cos;
        dummy.position.set(hx, hy, hz);
        dummy.rotation.set(0, rotY, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        this.headlights.setMatrixAt(i * 2 + 1, dummy.matrix);
      }
    }

    this.body.instanceMatrix.needsUpdate = true;
    this.cabin.instanceMatrix.needsUpdate = true;
    if (this.headlights) this.headlights.instanceMatrix.needsUpdate = true;
  }
}

// ---------- build initial world ----------
scene.add(makeSkyDome());
let world = new CityWorld();
scene.add(world.root);

world.rebuild(CONFIG.seedBase);

// ---------- resize ----------
window.addEventListener("resize", () => {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = (-frustumSize * aspect) / 2;
  camera.right = (frustumSize * aspect) / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.updateProjectionMatrix();
  targetZoom = clampZoom(camera.zoom);
});

// ---------- animate ----------
let last = performance.now();
function tick() {
  requestAnimationFrame(tick);

  const now = performance.now();
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  // Smooth zoom towards target.
  targetZoom = clampZoom(targetZoom);
  camera.zoom = lerp(camera.zoom, targetZoom, 1 - Math.pow(0.001, dt)); // framerate independent
  camera.updateProjectionMatrix();

  // subtle city drift (tiny) so it feels alive
  sun.position.x = -220 + Math.sin(t * 0.12) * 20;
  sun.position.z = 120 + Math.cos(t * 0.11) * 18;

  controls.update();

  // traffic + signals
  if (world.carSystem) {
    world.carSystem.enabled = true;
    world.carSystem.update(dt, t);
  }
  world.updateTrafficSignals(t);

  composer.render();
}
tick();


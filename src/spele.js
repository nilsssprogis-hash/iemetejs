// Disku golfs 3D — reālistiska disku golfa spēle Iemetējā.
// Diska lidojums tiek rēķināts ar aerodinamiku (cēlējspēks, pretestība, uzbrukuma leņķis),
// un turn/fade rodas no diska lidojuma skaitļiem un ātruma (žiroskopiskā precesija).
// Vējš, koki (stumbri un zari), grozs ar ķēdēm, ūdens (OB), slīdēšana un ripošana pa zemi.
import * as THREE from "three";

const D2R = Math.PI / 180, G = 9.81, RHO = 1.225, MASS = 0.175, DISC_R = 0.106, AREA = Math.PI * DISC_R * DISC_R;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem("disku-golfs:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("disku-golfs:" + k, JSON.stringify(v)); } catch {} },
};

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }
function makeNoise(seed) {
  const r = rng(seed), g = new Float32Array(65536);
  for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
  const at = (x, y) => g[((y & 255) << 8) | (x & 255)];
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, o) => { let s = 0, a = 0.5, f = 1, t = 0; for (let i = 0; i < o; i++) { s += a * n2(x * f, y * f); t += a; a *= 0.5; f *= 2.03; } return s / t; };
  return { n2, fbm };
}

// ---------------------------------------------------------------- diski un laukums
const DISCS = [
  { id: "drv", name: "Draiveris", speed: 12, glide: 5, turn: -1, fade: 3, color: "#e8452c" },
  { id: "ctl", name: "Kontroles draiveris", speed: 9, glide: 5, turn: -2, fade: 1, color: "#8b5cf6" },
  { id: "fw", name: "Fairway", speed: 7, glide: 5, turn: 0, fade: 2, color: "#f59e0b" },
  { id: "mid", name: "Midrange", speed: 5, glide: 5, turn: 0, fade: 1, color: "#22c55e" },
  { id: "put", name: "Puteris", speed: 2, glide: 3, turn: 0, fade: 1, color: "#eef2f5" },
];
const HOLES = [
  { name: "Sākums", par: 3, len: 78, bend: 0, end: 0, elev: 0, hills: 3, width: 11, dens: 0.8 },
  { name: "Kreisais līkums", par: 3, len: 104, bend: -24, end: -16, elev: 2, hills: 4, width: 9, dens: 0.95 },
  { name: "Tunelis", par: 3, len: 66, bend: 4, end: 0, elev: -4, hills: 3, width: 5.5, dens: 1.1 },
  { name: "Garais", par: 4, len: 172, bend: 28, end: 14, elev: 3, hills: 5, width: 12, dens: 0.85 },
  { name: "Dīķis", par: 3, len: 92, bend: 0, end: 4, elev: 0, hills: 2, width: 15, dens: 0.6, pond: { t: 0.52, off: 0, rx: 19, rz: 17 } },
  { name: "Kalnā", par: 3, len: 86, bend: -8, end: -4, elev: 8, hills: 3, width: 9, dens: 0.95 },
  { name: "Labais līkums", par: 4, len: 150, bend: 32, end: 24, elev: -3, hills: 4, width: 10, dens: 0.9, pond: { t: 0.45, off: -27, rx: 15, rz: 24 } },
  { name: "Pilskalns", par: 3, len: 56, bend: 0, end: 0, elev: 0, hills: 2, width: 10, dens: 0.75, mound: 3.6 },
  { name: "Fināls", par: 3, len: 120, bend: -6, end: 6, elev: -2, hills: 3, width: 13, dens: 0.8, pond: { t: 0.86, off: 15, rx: 11, rz: 9 } },
];

// ---------------------------------------------------------------- lidojuma fizika
function aero(d) { const g = 0.7 + d.glide * 0.06; return { cd0: 0.078 - d.speed * 0.0037, cla: 1.4 * g, cl0: 0.12 * g, vN: 9 + d.speed * 1.6 }; }
const _va = new THREE.Vector3(), _vh = new THREE.Vector3(), _L = new THREE.Vector3(), _F = new THREE.Vector3(), _ax = new THREE.Vector3();
// Viens aerodinamikas solis. s = {p, v, n, hand, disc, a}
function aeroStep(s, dt, wind) {
  _va.copy(s.v).sub(wind);
  const sp = _va.length();
  if (sp < 1e-4) { s.v.y -= G * dt; s.p.addScaledVector(s.v, dt); return; }
  _vh.copy(_va).divideScalar(sp);
  const al = Math.asin(clamp(-_vh.dot(s.n), -1, 1));
  const a = s.a;
  const CL = Math.abs(al) < 0.4 ? a.cl0 + a.cla * al : Math.sign(al) * (a.cl0 + a.cla * 0.4) * Math.max(0.3, 1 - (Math.abs(al) - 0.4) * 1.2);
  const CD = Math.min(1.2, a.cd0 + 1.3 * (al + 0.03) ** 2);
  const q = 0.5 * RHO * sp * sp * AREA;
  _L.copy(s.n).addScaledVector(_vh, -s.n.dot(_vh));
  const ll = _L.length(); if (ll > 1e-6) _L.divideScalar(ll); else _L.set(0, 0, 0);
  _F.copy(_L).multiplyScalar(CL * q).addScaledVector(_vh, -CD * q);
  _F.y -= MASS * G;
  s.v.addScaledVector(_F, dt / MASS);
  s.p.addScaledVector(s.v, dt);
  // Turn (ātrumā) un fade (lēnāk) — diska sasvere ap lidojuma virzienu
  const r = sp / a.vN;
  const fade = (s.disc.fade + 0.4) * 16 * D2R * Math.pow(clamp((0.98 - r) / 0.5, 0, 1), 1.5) * s.spin;
  const turn = -s.disc.turn * 6 * D2R * clamp((r - 0.72) / 0.35, 0, 1.4);
  _ax.set(_vh.x, 0, _vh.z);
  if (_ax.lengthSq() > 1e-6) { _ax.normalize(); s.n.applyAxisAngle(_ax, -s.hand * (fade - turn) * dt).normalize(); }
  s.spin = Math.max(0.6, s.spin - 0.01 * dt);
}
function launchState(disc, hand, pos, yaw, speed, elevDeg, noseDeg, hyzerDeg) {
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const v = fwd.clone().multiplyScalar(Math.cos(elevDeg * D2R)).setY(Math.sin(elevDeg * D2R)).multiplyScalar(speed);
  const n = new THREE.Vector3(0, 1, 0).applyAxisAngle(right, (elevDeg + noseDeg) * D2R).applyAxisAngle(fwd, -hand * hyzerDeg * D2R);
  return { p: pos.clone(), v, n, hand, disc, a: aero(disc), spin: 1 };
}

// ---------------------------------------------------------------- skaņas (sintezētas, bez failiem)
let AC = null;
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { AC = null; } }
  if (AC && AC.state === "suspended") AC.resume();
  return AC;
}
let noiseBuf = null;
function noise(ac) {
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = ac.createBufferSource(); s.buffer = noiseBuf; return s;
}
function burst(type, f, q, dur, vol, f2) {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime, s = noise(ac), fl = ac.createBiquadFilter(), g = ac.createGain();
  fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(fl).connect(g).connect(ac.destination); s.start(t); s.stop(t + dur + 0.05);
}
function tone(f, dur, vol, at = 0, type = "sine") {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.05);
}
const SFX = {
  throw() { burst("bandpass", 500, 0.8, 0.45, 0.35, 2200); },
  leaves() { burst("highpass", 2500, 0.5, 0.18, 0.25); },
  wood() { tone(140, 0.18, 0.5, 0, "triangle"); burst("lowpass", 900, 0.7, 0.08, 0.3); },
  ground() { burst("lowpass", 400, 0.7, 0.18, 0.35); },
  metal() { tone(1650, 0.35, 0.18, 0, "triangle"); tone(2470, 0.25, 0.1); },
  splash() { burst("lowpass", 1800, 0.5, 0.7, 0.45, 300); },
  chains(strength = 1) {
    for (let i = 0; i < 26; i++) tone(2600 + Math.random() * 4200, 0.12 + Math.random() * 0.35, 0.05 * strength, Math.random() * 0.55, "triangle");
    burst("highpass", 4000, 0.4, 0.6, 0.12 * strength);
    try { navigator.vibrate && navigator.vibrate(strength > 0.6 ? [40, 30, 60] : 25); } catch {}
  },
};

// ---------------------------------------------------------------- renderētājs un ainava
const canvas = $("#view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
const MOBILE = matchMedia("(pointer:coarse)").matches;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.6 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const HORIZON = new THREE.Color("#cfe2ee");
scene.background = HORIZON.clone();
scene.fog = new THREE.Fog(HORIZON, 70, 420);
const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 1500);

const hemi = new THREE.HemisphereLight("#cfe6ff", "#4d5a2a", 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#fff1d6", 2.6);
const SUN_DIR = new THREE.Vector3(-0.45, 0.78, 0.35).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(MOBILE ? 2048 : 4096, MOBILE ? 2048 : 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

// Debesis: gradienta sfēra + saule + mākoņi
{
  const g = new THREE.SphereGeometry(1200, 32, 16), pos = g.attributes.position, col = [];
  const top = new THREE.Color("#3d7cc9"), mid = new THREE.Color("#8fbde6"), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 1200;
    if (y > 0.25) c.copy(mid).lerp(top, smooth(0.25, 0.9, y)); else c.copy(HORIZON).lerp(mid, smooth(-0.02, 0.25, y));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  sky.renderOrder = -10;
  sky.name = "sky";
  scene.add(sky);
  const glowC = document.createElement("canvas"); glowC.width = glowC.height = 128;
  const gx = glowC.getContext("2d"), gr = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,245,1)"); gr.addColorStop(0.12, "rgba(255,250,225,.95)"); gr.addColorStop(0.3, "rgba(255,240,200,.25)"); gr.addColorStop(1, "rgba(255,240,200,0)");
  gx.fillStyle = gr; gx.fillRect(0, 0, 128, 128);
  const sunS = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowC), fog: false, depthWrite: false, toneMapped: false, transparent: true }));
  sunS.scale.set(260, 260, 1); sunS.position.copy(SUN_DIR).multiplyScalar(1100); sky.add(sunS);
  const cc = document.createElement("canvas"); cc.width = 256; cc.height = 128;
  const cx = cc.getContext("2d"), r = rng(7);
  for (let i = 0; i < 26; i++) {
    const x = 40 + r() * 176, y = 50 + r() * 40, rad = 18 + r() * 30, g2 = cx.createRadialGradient(x, y, 0, x, y, rad);
    g2.addColorStop(0, "rgba(255,255,255,.85)"); g2.addColorStop(1, "rgba(255,255,255,0)"); cx.fillStyle = g2; cx.fillRect(0, 0, 256, 128);
  }
  const ctex = new THREE.CanvasTexture(cc);
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, fog: false, depthWrite: false, transparent: true, opacity: 0.6 + r() * 0.35, toneMapped: false }));
    const a = r() * Math.PI * 2, el = 0.12 + r() * 0.35;
    s.position.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).multiplyScalar(1000);
    const w = 260 + r() * 300; s.scale.set(w, w * 0.45, 1); sky.add(s);
  }
}

// Zāles tekstūra (smalka graudainība virs krāsu toņiem)
function grassTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const x = c.getContext("2d"), r = rng(3), img = x.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) { const v = 200 + r() * 55; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0);
  for (let i = 0; i < 2200; i++) { x.strokeStyle = `rgba(${r() < 0.5 ? "255,255,255" : "60,60,60"},${0.08 + r() * 0.12})`; x.beginPath(); const px = r() * 256, py = r() * 256; x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 3, py - 2 - r() * 5); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const GRASS = grassTexture();

// Groza modelis (ķēdes ir atsevišķa grupa, lai tās varētu šūpoties)
function makeBasket() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: "#b9c1c6", metalness: 0.75, roughness: 0.35 });
  const yellow = new THREE.MeshStandardMaterial({ color: "#ffc21a", metalness: 0.3, roughness: 0.45 });
  const add = (m) => { m.castShadow = true; g.add(m); return m; };
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 1.4, 10), metal)).position.y = 0.7;
  const tray = add(new THREE.Mesh(new THREE.CylinderGeometry(0.335, 0.3, 0.2, 28, 1, true), new THREE.MeshStandardMaterial({ color: "#a9b3b8", metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })));
  tray.position.y = 0.6;
  add(new THREE.Mesh(new THREE.CircleGeometry(0.3, 28).rotateX(-Math.PI / 2), metal)).position.y = 0.505;
  add(new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.012, 6, 32).rotateX(Math.PI / 2), metal)).position.y = 0.7;
  const band = add(new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.07, 28, 1, true), new THREE.MeshStandardMaterial({ color: "#ffc21a", metalness: 0.3, roughness: 0.45, side: THREE.DoubleSide })));
  band.position.y = 1.335;
  add(new THREE.Mesh(new THREE.CircleGeometry(0.31, 28).rotateX(-Math.PI / 2), yellow)).position.y = 1.37;
  const chains = new THREE.Group(); chains.position.y = 0.74; g.add(chains);
  const chainMat = new THREE.MeshStandardMaterial({ color: "#d7dde0", metalness: 0.9, roughness: 0.25 });
  const mk = (rTop, rBot, n, off) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + off;
      const top = new THREE.Vector3(Math.cos(a) * rTop, 0.59, Math.sin(a) * rTop);
      const bot = new THREE.Vector3(Math.cos(a + 0.5) * rBot, 0, Math.sin(a + 0.5) * rBot);
      const mid = top.clone().lerp(bot, 0.5); mid.multiplyScalar(1).add(new THREE.Vector3(Math.cos(a + 0.25) * 0.03, -0.04, Math.sin(a + 0.25) * 0.03));
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(top, mid, bot), 8, 0.006, 4), chainMat);
      chains.add(m);
    }
  };
  mk(0.28, 0.07, 14, 0); mk(0.17, 0.06, 10, 0.3);
  g.userData.chains = chains;
  return g;
}

function makeDiscMesh(color) {
  const pts = [[0, 0.0115], [0.04, 0.0118], [0.075, 0.0105], [0.095, 0.0075], [0.104, 0.003], [0.106, -0.003], [0.103, -0.009], [0.094, -0.0115], [0.086, -0.008], [0.084, -0.002], [0.0, -0.0005]].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 40);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.0, side: THREE.DoubleSide }));
  m.castShadow = true;
  // Apdruka (zīmogs) uz augšas
  const sc = document.createElement("canvas"); sc.width = sc.height = 128; const x = sc.getContext("2d");
  x.strokeStyle = "rgba(0,0,0,.55)"; x.lineWidth = 6; x.beginPath(); x.arc(64, 64, 40, 0, Math.PI * 2); x.stroke();
  x.fillStyle = "rgba(0,0,0,.55)"; x.font = "bold 30px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("IEM", 64, 66);
  const stamp = new THREE.Mesh(new THREE.CircleGeometry(0.06, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  stamp.position.y = 0.0122; m.add(stamp);
  return m;
}

function teeSign(num, def, lenM) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 160; const x = c.getContext("2d");
  x.fillStyle = "#0e6a3d"; x.fillRect(0, 0, 256, 160); x.fillStyle = "#ffc21a"; x.fillRect(0, 0, 256, 10);
  x.fillStyle = "#fff"; x.font = "bold 76px 'Barlow Condensed',sans-serif"; x.textBaseline = "top"; x.fillText(String(num), 16, 18);
  x.font = "600 26px sans-serif"; x.fillText(def.name, 92, 26); x.fillStyle = "#cfe9da"; x.fillText("Par " + def.par + " · " + lenM + " m", 92, 66);
  x.fillStyle = "#ffc21a"; x.font = "600 22px sans-serif"; x.fillText("Iemetējs DG", 92, 110);
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), new THREE.MeshStandardMaterial({ color: "#5b4632", roughness: 0.9 })); post.position.y = 0.6; post.castShadow = true;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), roughness: 0.7 }));
  board.position.set(0, 1.2, 0.05); board.castShadow = true;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.52, 0.03), new THREE.MeshStandardMaterial({ color: "#2b2b2b" })); back.position.set(0, 1.2, 0.02);
  g.add(post, back, board);
  return g;
}

// ---------------------------------------------------------------- groza (laukuma) uzbūve
let W = null; // pašreizējā groza pasaule
const holeGroup = new THREE.Group(); scene.add(holeGroup);

function buildHole(idx) {
  while (holeGroup.children.length) {
    const o = holeGroup.children.pop();
    o.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) [].concat(m.material).forEach((mt) => { if (mt.map && mt.map !== GRASS) mt.map.dispose(); mt.dispose(); }); });
  }
  const def = HOLES[idx], R = rng(1000 + idx * 77), N = makeNoise(31 + idx * 13);
  const T = new THREE.Vector2(0, 0), C = new THREE.Vector2(def.bend, -def.len * 0.5), B = new THREE.Vector2(def.end, -def.len);
  const path = [];
  for (let i = 0; i <= 60; i++) { const t = i / 60, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t; path.push(new THREE.Vector2(a * T.x + b * C.x + c * B.x, a * T.y + b * C.y + c * B.y)); }
  let plen = 0; for (let i = 1; i < path.length; i++) plen += path[i].distanceTo(path[i - 1]);
  const axis = B.clone().sub(T); const L = axis.length(); axis.divideScalar(L);
  const nearest = (x, z) => {
    let best = 1e9, bt = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], ex = b.x - a.x, ez = b.y - a.y, l2 = ex * ex + ez * ez;
      const u = clamp(((x - a.x) * ex + (z - a.y) * ez) / l2, 0, 1), dx = a.x + ex * u - x, dz = a.y + ez * u - z, d = dx * dx + dz * dz;
      if (d < best) { best = d; bt = (i - 1 + u) / 60; }
    }
    return { d: Math.sqrt(best), t: bt };
  };
  let pond = null;
  if (def.pond) {
    const i = Math.round(def.pond.t * 60), p = path[i], q = path[Math.min(60, i + 1)], dir = q.clone().sub(path[Math.max(0, i - 1)]).normalize();
    const nrm = new THREE.Vector2(-dir.y, dir.x);
    pond = { x: p.x + nrm.x * def.pond.off, z: p.y + nrm.y * def.pond.off, rx: def.pond.rx, rz: def.pond.rz, ang: Math.atan2(dir.x, -dir.y) };
  }
  const pondE = (x, z) => {
    if (!pond) return 9;
    const dx = x - pond.x, dz = z - pond.z, c = Math.cos(pond.ang), s = Math.sin(pond.ang);
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    return (lx / pond.rx) ** 2 + (lz / pond.rz) ** 2 + N.n2(x / 9, z / 9) * 0.18;
  };
  const base = (x, z) => {
    const u = clamp(((x - T.x) * axis.x + (z - T.y) * axis.y) / L, -0.25, 1.25);
    return N.fbm(x / 60 + 3.1, z / 60 - 7.3, 4) * def.hills + N.fbm(x / 13, z / 13, 2) * 0.3 + def.elev * smooth(0, 1, u);
  };
  const teeH = base(T.x, T.y), bH = base(B.x, B.y);
  const pondH = pond ? base(pond.x, pond.z) : 0;
  const H = (x, z) => {
    let h = base(x, z);
    const dt = Math.hypot(x - T.x, z - T.y); h = teeH + (h - teeH) * smooth(2.5, 9, dt);
    const db = Math.hypot(x - B.x, z - B.y); h = bH + (h - bH) * (0.35 + 0.65 * smooth(2, 8, db));
    if (def.mound) h += def.mound * Math.exp(-(db * db) / (2 * 6.5 * 6.5));
    if (pond) { const e = pondE(x, z); if (e < 2.4) { const k = smooth(1.2, 2.4, e); h = pondH + (h - pondH) * k; h -= 2.4 * (1 - smooth(0.45, 1.15, e)); } }
    return h;
  };
  const water = pond ? pondH - 0.75 : -1e9;
  const inWater = (x, z) => pond && pondE(x, z) < 1.25 && H(x, z) < water;

  // Robežas
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of path) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, size = Math.max(maxX - minX, maxZ - minZ) + 150;
  const half = size / 2;

  // Reljefs
  const seg = Math.min(220, Math.round(size / 1.3));
  const geo = new THREE.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
  const cFair = new THREE.Color("#73a84a"), cRough = new THREE.Color("#4f7f31"), cForest = new THREE.Color("#4a5a2b"), cDirt = new THREE.Color("#6b5636"), cSand = new THREE.Color("#b9a774"), cMud = new THREE.Color("#3f3d26"), cGreen = new THREE.Color("#7fb553"), cTee = new THREE.Color("#8c8c86");
  const c = new THREE.Color(), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, z = pos.getZ(i) + cz, h = H(x, z);
    pos.setXYZ(i, x, h, z);
    const { d } = nearest(x, z);
    c.copy(cRough).lerp(cFair, 1 - smooth(def.width * 0.75, def.width * 1.25, d));
    tmp.copy(cForest).lerp(cDirt, smooth(-0.2, 0.5, N.n2(x / 7, z / 7))); c.lerp(tmp, smooth(def.width + 4, def.width + 16, d));
    const proj = (x - T.x) * axis.x + (z - T.y) * axis.y;
    if (d < def.width) c.multiplyScalar(Math.floor(proj / 4) % 2 ? 1.04 : 0.96);
    const db = Math.hypot(x - B.x, z - B.y); if (db < 11) c.lerp(cGreen, (1 - smooth(8, 11, db)) * 0.6);
    if (pond) { const e = pondE(x, z); if (e < 1.6) { if (h < water + 0.35) c.lerp(cSand, 1 - smooth(0.2, 0.45, water + 0.35 - h)); if (h < water - 0.1) c.copy(cMud); } }
    c.multiplyScalar(0.88 + 0.24 * (N.n2(x / 3.3, z / 3.3) * 0.5 + 0.5));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  geo.translate(0, 0, 0);
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / 3, uv.getY(i) * size / 3);
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: GRASS, roughness: 0.95, metalness: 0 }));
  terrain.receiveShadow = true; holeGroup.add(terrain);

  if (pond) {
    const wg = new THREE.CircleGeometry(1, 48); wg.rotateX(-Math.PI / 2);
    const wm = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: "#2f5f6e", roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.86 }));
    wm.scale.set(pond.rx * 1.6, 1, pond.rz * 1.6); wm.rotation.y = -pond.ang; wm.position.set(pond.x, water, pond.z); wm.receiveShadow = true;
    holeGroup.add(wm);
  }

  // Koki
  const trees = [];
  const grid = new Map(), CELL = 8, key = (i, j) => i * 10007 + j;
  const addTree = (x, z, kind, scale) => {
    const h0 = H(x, z); if (inWater(x, z) || h0 < water + 0.2) return;
    let t;
    if (kind === 0) { const h = (11 + R() * 9) * scale; t = { kind, x, z, y: h0, h, tr: 0.16 + R() * 0.12, c0: 1.0 + R() * 1.2, c1: h, cr: h * (0.2 + R() * 0.05) }; }
    else if (kind === 1) { const h = (14 + R() * 9) * scale; const cr = 2.2 + R() * 1.6; t = { kind, x, z, y: h0, h, tr: 0.17 + R() * 0.14, c0: h - cr * 1.6, c1: h, cr }; }
    else { const h = (9 + R() * 7) * scale; const cr = 2.4 + R() * 1.8; t = { kind, x, z, y: h0, h, tr: 0.11 + R() * 0.08, c0: h - cr * 2.0, c1: h, cr }; }
    trees.push(t);
    const gi = Math.floor(x / CELL), gj = Math.floor(z / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const k = key(gi + a, gj + b); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); }
  };
  const step = 4.6;
  for (let x = cx - half + 3; x < cx + half - 3; x += step) {
    for (let z = cz - half + 3; z < cz + half - 3; z += step) {
      const px = x + (R() - 0.5) * step * 0.9, pz = z + (R() - 0.5) * step * 0.9;
      const { d } = nearest(px, pz);
      if (Math.hypot(px - T.x, pz - T.y) < 9 || Math.hypot(px - B.x, pz - B.y) < 8) { R(); R(); continue; }
      let p = smooth(def.width + 0.5, def.width + 9, d) * 0.88 * def.dens;
      if (d > def.width + 55) p *= 0.55;
      p *= 0.75 + 0.5 * (N.n2(px / 25, pz / 25) * 0.5 + 0.5);
      if (pond && pondE(px, pz) < 1.9) p = 0;
      const kr = R();
      if (R() < p) addTree(px, pz, kr < 0.42 ? 0 : kr < 0.75 ? 1 : 2, 0.85 + R() * 0.35);
    }
  }
  // Atsevišķi koki fairway — šķēršļi kā īstos laukumos
  const nFair = 1 + Math.floor(def.len / 55);
  for (let i = 0; i < nFair; i++) {
    const t = 0.28 + R() * 0.5, k = Math.round(t * 60), p = path[k], q = path[Math.min(60, k + 1)], dir = q.clone().sub(path[k - 1]).normalize();
    const off = (R() < 0.5 ? -1 : 1) * def.width * (0.25 + R() * 0.6);
    const x = p.x - dir.y * off, z = p.y + dir.x * off;
    if (pond && pondE(x, z) < 1.6) continue;
    addTree(x, z, R() < 0.5 ? 2 : 1, 0.8);
  }

  // Koku instancētie modeļi
  const nTrunk = trees.length, nCone = trees.filter((t) => t.kind === 0).length * 3, nBlob = trees.filter((t) => t.kind !== 0).length * 3;
  const trunkM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.75, 1, 1, 7).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.95 }), nTrunk);
  const coneM = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 9).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), Math.max(1, nCone));
  const bg = new THREE.IcosahedronGeometry(1, 1); { const p = bg.attributes.position, r = rng(11); for (let i = 0; i < p.count; i++) { const s = 0.82 + r() * 0.3; p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s); } bg.computeVertexNormals(); }
  const blobM = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), Math.max(1, nBlob));
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s4 = new THREE.Vector3(), p4 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const barkP = new THREE.Color("#7a4a2c"), barkS = new THREE.Color("#4a3a2a"), barkB = new THREE.Color("#e8e4da"), needle = new THREE.Color("#1f4a2a"), pineC = new THREE.Color("#2f5a2c"), leaf = new THREE.Color("#4e8a34");
  let ti = 0, ci = 0, bi = 0;
  for (const t of trees) {
    const lean = (R() - 0.5) * 0.06;
    q4.setFromAxisAngle(up, R() * 6.28).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean));
    const trunkH = t.kind === 0 ? t.h * 0.7 : t.c0 + (t.c1 - t.c0) * 0.4;
    m4.compose(p4.set(t.x, t.y - 0.3, t.z), q4, s4.set(t.tr, trunkH + 0.3, t.tr)); trunkM.setMatrixAt(ti, m4);
    trunkM.setColorAt(ti++, (t.kind === 0 ? barkS : t.kind === 1 ? barkP : barkB).clone().multiplyScalar(0.85 + R() * 0.3));
    if (t.kind === 0) {
      const hh = t.c1 - t.c0;
      for (let k = 0; k < 3; k++) {
        const y0 = t.c0 + hh * k * 0.26, ch = hh * (0.62 - k * 0.12), rr = t.cr * (1 - k * 0.27);
        m4.compose(p4.set(t.x, t.y + y0, t.z), q4, s4.set(rr, ch + (k === 2 ? hh * 0.3 : 0), rr)); coneM.setMatrixAt(ci, m4);
        coneM.setColorAt(ci++, needle.clone().multiplyScalar(0.8 + R() * 0.35 + k * 0.06));
      }
    } else {
      const mid = (t.c0 + t.c1) / 2, ry = (t.c1 - t.c0) / 2;
      for (let k = 0; k < 3; k++) {
        const ox = (R() - 0.5) * t.cr * 0.7, oz = (R() - 0.5) * t.cr * 0.7, oy = (R() - 0.5) * ry * 0.5, s = 0.65 + R() * 0.25;
        m4.compose(p4.set(t.x + ox, t.y + mid + oy, t.z + oz), q4, s4.set(t.cr * s, ry * s, t.cr * s)); blobM.setMatrixAt(bi, m4);
        blobM.setColorAt(bi++, (t.kind === 1 ? pineC : leaf).clone().multiplyScalar(0.78 + R() * 0.4));
      }
    }
  }
  for (const m of [trunkM, coneM, blobM]) { m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; holeGroup.add(m); }

  // Tī un grozs
  const tee = new THREE.Vector3(T.x, teeH, T.y), basket = new THREE.Vector3(B.x, H(B.x, B.y), B.y);
  const teeDir = Math.atan2(path[8].x - T.x, -(path[8].y - T.y));
  const pad = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 3.6), new THREE.MeshStandardMaterial({ color: "#7b7d78", roughness: 0.85 }));
  pad.position.set(T.x, teeH + 0.02, T.y + 0); pad.rotation.y = -teeDir; pad.translateZ(-0.9); pad.receiveShadow = true; holeGroup.add(pad);
  const sign = teeSign(idx + 1, def, Math.round(plen)); sign.position.set(T.x, teeH, T.y); sign.rotation.y = -teeDir; sign.translateX(-1.6); sign.translateZ(1.2); sign.rotation.y += 0.5; holeGroup.add(sign);
  const bk = makeBasket(); bk.position.copy(basket); holeGroup.add(bk);

  const wr = rng(500 + idx * 31 + (store.get("seed", 0) | 0));
  const windSpeed = 0.5 + wr() * 4.8, windAng = wr() * Math.PI * 2;

  return {
    idx, def, H, inWater, water, pond, path, plen, axis, T, B, tee, basket, teeDir, trees, grid, CELL, key,
    half, cx, cz, basketObj: bk, wind: new THREE.Vector3(Math.sin(windAng), 0, -Math.cos(windAng)).multiplyScalar(windSpeed), windAng, windSpeed,
    treesNear(x, z) { return grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || []; },
    normal(x, z, out) { const e = 0.3; return out.set(H(x - e, z) - H(x + e, z), 2 * e, H(x, z - e) - H(x, z + e)).normalize(); },
  };
}

// ---------------------------------------------------------------- spēles stāvoklis
const discMesh = new THREE.Group(); scene.add(discMesh);
let discModel = null;
function setDiscModel(d) { if (discModel) { discMesh.remove(discModel); discModel.traverse((m) => { m.geometry && m.geometry.dispose(); }); } discModel = makeDiscMesh(d.color); discMesh.add(discModel); }

const trailMax = 3000, trailPos = new Float32Array(trailMax * 3), trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3)); trailGeo.setDrawRange(0, 0);
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55 })); trail.frustumCulled = false; scene.add(trail);
let trailN = 0;
const aimGeo = new THREE.BufferGeometry(); aimGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
const aimLine = new THREE.Line(aimGeo, new THREE.LineDashedMaterial({ color: "#ffc21a", dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.85 })); aimLine.frustumCulled = false; scene.add(aimLine);
const landRing = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8, depthWrite: false })); landRing.visible = false; scene.add(landRing);

const G0 = {
  hole: 0, scores: [], strokes: 0, lie: new THREE.Vector3(), lastLie: new THREE.Vector3(),
  yaw: 0, hand: store.get("hand", 1), disc: DISCS[0], mode: "intro", hyzer: 0, elev: 8,
  power: 0, holdT: 0, s: null, phase: "", t: 0, timer: 0, flyover: 0, decided: false, hitCd: 0, skips: 0,
  roll: null, slide: null, chainsT: 0, chainsAmp: 0, putt: false, maxSpeed: 31, throwFrom: new THREE.Vector3(), clock: 0, landAt: null,
};
const tmpV = new THREE.Vector3(), tmpN = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

function fwdOf(yaw, out = new THREE.Vector3()) { return out.set(Math.sin(yaw), 0, -Math.cos(yaw)); }
function distToBasket(p) { return Math.hypot(p.x - W.basket.x, p.z - W.basket.z); }
function yawTo(p, q) { return Math.atan2(q.x - p.x, -(q.z - p.z)); }

// Nepieciešamais ātrums putam (bez vēja), lai disks sasniegtu ķēdes
function puttSpeed(dist) {
  const from = G0.lie.clone().setY(G0.lie.y + 1.0), yaw = yawTo(G0.lie, W.basket), target = W.basket.y + 0.95;
  const zero = new THREE.Vector3();
  const heightAt = (v) => {
    const s = launchState(G0.disc, G0.hand, from, yaw, v, G0.elev, 0, 0);
    for (let i = 0; i < 2400; i++) {
      aeroStep(s, 1 / 240, zero);
      const dh = Math.hypot(s.p.x - from.x, s.p.z - from.z);
      if (dh >= dist) return s.p.y - target;
      if (s.p.y < W.H(s.p.x, s.p.z)) return -99;
    }
    return -99;
  };
  let lo = 2, hi = 30;
  if (heightAt(hi) < 0) return 6 + dist * 0.62;
  for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (heightAt(m) < 0) lo = m; else hi = m; }
  return hi;
}

function suggestDisc(d) { return d <= 20 ? "put" : d <= 55 ? "mid" : d <= 85 ? "fw" : "drv"; }
function selectDisc(id, keepAngles) {
  G0.disc = DISCS.find((d) => d.id === id) || DISCS[0];
  setDiscModel(G0.disc);
  document.querySelectorAll(".disc").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === G0.disc.id)));
  if (!keepAngles) updatePutt();
}
function updatePutt() {
  const d = distToBasket(G0.lie);
  G0.putt = d <= 20;
  G0.maxSpeed = G0.putt ? puttSpeed(d) / 0.8 : G0.hand === 1 ? 31 : 28;
  $("#throwSub").textContent = G0.putt ? "puts · " + d.toFixed(1) + " m" : "turi un atlaid";
}

function startHole(i) {
  G0.hole = i; G0.strokes = 0;
  W = buildHole(i);
  G0.lie.copy(W.tee); G0.lastLie.copy(W.tee);
  G0.yaw = W.teeDir;
  const sz = W.half * 2;
  sun.position.set(W.cx, 0, W.cz).addScaledVector(SUN_DIR, 260); sun.target.position.set(W.cx, 0, W.cz);
  Object.assign(sun.shadow.camera, { left: -sz / 2, right: sz / 2, top: sz / 2, bottom: -sz / 2, near: 10, far: 600 });
  sun.shadow.camera.updateProjectionMatrix();
  trailN = 0; trailGeo.setDrawRange(0, 0); landRing.visible = false;
  newLie(true);
  G0.mode = "flyover"; G0.flyover = 0;
  drawMapBase(); updateHud();
  const lenM = Math.round(W.plen);
  showToast("Grozs " + (i + 1), W.def.name + " · Par " + W.def.par + " · " + lenM + " m", 2600);
}

function newLie(first) {
  const d = distToBasket(G0.lie);
  if (!first) G0.yaw = yawTo(G0.lie, W.basket);
  G0.elev = d <= 20 ? 3 : d <= 55 ? 6 : 8;
  if (d <= 20) G0.hyzer = 0;
  $("#elev").value = G0.elev; $("#hyzer").value = G0.hyzer; sliderText();
  selectDisc(suggestDisc(d));
  placeDiscInHand();
}

function placeDiscInHand() {
  const f = fwdOf(G0.yaw), right = tmpV.set(Math.cos(G0.yaw), 0, Math.sin(G0.yaw));
  discMesh.position.copy(G0.lie).addScaledVector(f, 0.55).addScaledVector(right, 0.28 * G0.hand).setY(G0.lie.y + (G0.putt ? 0.95 : 1.15));
  const s = launchState(G0.disc, G0.hand, discMesh.position, G0.yaw, 1, G0.elev, 0, G0.hyzer);
  discMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), s.n);
  discMesh.scale.setScalar(1);
}

// ---------------------------------------------------------------- metiens
function release(p) {
  audio();
  const r = Math.random;
  const over = Math.max(0, p - 1), err = 1 + over * 7, pw = Math.min(p, 1) * (1 + over * 0.35);
  const speed = Math.max(1.5, G0.maxSpeed * pw);
  const yaw = G0.yaw + gauss(r) * 0.7 * D2R * err * (G0.putt ? 0.6 : 1);
  const hyz = G0.hyzer + gauss(r) * (G0.putt ? 1 : 2.5) * err;
  const nose = gauss(r) * 1.0 * err + over * 5;
  const elev = G0.elev + gauss(r) * 0.6 * err;
  const from = G0.lie.clone().addScaledVector(fwdOf(G0.yaw), 0.3).setY(G0.lie.y + (G0.putt ? 1.0 : 1.3));
  G0.s = launchState(G0.disc, G0.hand, from, yaw, speed, elev, nose, hyz);
  G0.throwFrom.copy(from); G0.lastLie.copy(G0.lie);
  G0.strokes++; G0.mode = "flight"; G0.phase = "air"; G0.t = 0; G0.decided = false; G0.hitCd = 0; G0.skips = 0; G0.landAt = null;
  G0.camFwd = fwdOf(yaw);
  trailN = 0; landRing.visible = false; aimLine.visible = false;
  if (!G0.putt) SFX.throw();
  updateHud();
  $("#bottom").style.visibility = "hidden";
}

const _gn = new THREE.Vector3();
function physics(dt) {
  const s = G0.s; G0.t += dt; G0.hitCd -= dt;
  const wind = tmpV.copy(W.wind).multiplyScalar(1 + 0.22 * Math.sin(G0.clock * 0.7) + 0.08 * Math.sin(G0.clock * 2.3));
  if (G0.phase === "air") {
    const prevY = s.p.y - W.basket.y;
    aeroStep(s, dt, wind);
    if (basketHit(s, prevY)) return;
    treeHit(s, dt);
    if (Math.abs(s.p.x - W.cx) > W.half - 2 || Math.abs(s.p.z - W.cz) > W.half - 2) return finish("ob");
    const gh = W.H(s.p.x, s.p.z);
    if (s.p.y <= gh + 0.01) groundContact(s, gh);
    if (G0.t > 20) finish("rest");
  } else if (G0.phase === "slide") {
    const sp = G0.slide.length(); const nsp = Math.max(0, sp - 4.8 * dt);
    if (nsp <= 0) return finish("rest");
    G0.slide.multiplyScalar(nsp / sp); s.p.addScaledVector(G0.slide, dt); s.p.y = W.H(s.p.x, s.p.z) + 0.012;
    if (W.inWater(s.p.x, s.p.z)) return finish("water");
    s.n.lerp(W.normal(s.p.x, s.p.z, _gn), 6 * dt).normalize();
    trunkOnly(s);
  } else if (G0.phase === "roll") {
    const R = G0.roll;
    W.normal(s.p.x, s.p.z, _gn);
    const downhill = -( _gn.x * R.dir.x + _gn.z * R.dir.z );
    R.speed += (G * downhill * 0.55 - 1.7 - (R.t > 1.5 ? 1.5 : 0)) * dt;
    R.t += dt;
    R.dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), -R.lean * (0.25 + 1.2 * (1 - clamp(R.speed / R.v0, 0, 1))) * dt);
    if (R.speed <= 0.25) { s.n.copy(_gn); return finish("rest"); }
    s.p.addScaledVector(R.dir, R.speed * dt); s.p.y = W.H(s.p.x, s.p.z) + DISC_R;
    if (W.inWater(s.p.x, s.p.z)) return finish("water");
    if (Math.abs(s.p.x - W.cx) > W.half - 2 || Math.abs(s.p.z - W.cz) > W.half - 2) return finish("ob");
    s.n.set(-R.dir.z, 0, R.dir.x).multiplyScalar(R.lean).addScaledVector(_gn, 0.25).normalize();
    R.spinA = (R.spinA || 0) + R.speed / DISC_R * dt;
    if (trunkOnly(s)) { R.speed *= 0.3; R.dir.multiplyScalar(-1); }
  }
}

function groundContact(s, gh) {
  if (W.inWater(s.p.x, s.p.z)) return finish("water");
  const gn = W.normal(s.p.x, s.p.z, _gn), vn = s.v.dot(gn), vt = s.v.clone().addScaledVector(gn, -vn), sp = vt.length();
  const flat = Math.abs(s.n.dot(gn));
  if (!G0.landAt) G0.landAt = s.p.clone();
  SFX.ground();
  s.p.y = gh + 0.012;
  if (flat < 0.5 && sp > 4) {
    const dir = vt.setY(0).normalize();
    const lean = Math.sign(s.n.x * -dir.z + s.n.z * dir.x) || 1;
    G0.roll = { dir, speed: sp * 0.7, v0: sp * 0.7, lean, t: 0 };
    G0.phase = "roll"; return;
  }
  if (sp > 9 && -vn < sp * 0.35 && G0.skips < 2) {
    G0.skips++;
    s.v.copy(vt.multiplyScalar(0.62)).addScaledVector(gn, Math.abs(vn) * 0.3);
    s.n.lerp(gn, 0.4).normalize();
    s.p.y = gh + 0.03; return;
  }
  G0.slide = vt.multiplyScalar(0.42).setY(0);
  G0.phase = "slide";
}

function trunkOnly(s) {
  for (const t of W.treesNear(s.p.x, s.p.z)) {
    const dx = s.p.x - t.x, dz = s.p.z - t.z, d = Math.hypot(dx, dz), rr = t.tr + DISC_R * 0.6;
    if (d < rr && s.p.y < t.y + t.c1) { s.p.x = t.x + dx / d * (rr + 0.01); s.p.z = t.z + dz / d * (rr + 0.01); if (G0.slide) G0.slide.multiplyScalar(0.2); SFX.wood(); return true; }
  }
  return false;
}

function treeHit(s, dt) {
  const r = Math.random;
  for (const t of W.treesNear(s.p.x, s.p.z)) {
    const dx = s.p.x - t.x, dz = s.p.z - t.z, d = Math.hypot(dx, dz), y = s.p.y - t.y;
    // stumbrs
    const rr = t.tr * (1 - Math.max(0, y) / (t.h * 1.6)) + DISC_R * 0.7;
    if (d < rr && y < t.c1 * 0.85) {
      const nx = dx / d, nz = dz / d, vn = s.v.x * nx + s.v.z * nz;
      if (vn < 0) { s.v.x -= (1 + 0.35) * vn * nx; s.v.z -= (1 + 0.35) * vn * nz; s.v.multiplyScalar(0.4); }
      s.p.x = t.x + nx * (rr + 0.01); s.p.z = t.z + nz * (rr + 0.01);
      s.n.applyAxisAngle(tmpN.set(r() - 0.5, 0, r() - 0.5).normalize(), (r() - 0.5) * 1.2).normalize();
      if (G0.hitCd <= 0) { SFX.wood(); G0.hitCd = 0.15; }
      continue;
    }
    // zari / skujas
    if (y < t.c0 || y > t.c1) continue;
    let rad, depth;
    if (t.kind === 0) { rad = t.cr * (1 - (y - t.c0) / (t.c1 - t.c0)) * 0.9 + 0.2; depth = 1 - d / rad; }
    else { const mid = (t.c0 + t.c1) / 2, ry = (t.c1 - t.c0) / 2, e = (d / (t.cr * 0.9)) ** 2 + ((y - mid) / ry) ** 2; if (e > 1) continue; rad = 1; depth = 1 - Math.sqrt(e); }
    if (depth <= 0) continue;
    const dens = (t.kind === 0 ? 0.55 : 0.4) * (0.35 + depth * 1.4);
    if (r() < 1 - Math.exp(-s.v.length() * dt * dens)) {
      const keep = 0.2 + r() * 0.4;
      s.v.applyAxisAngle(tmpN.set(0, 1, 0), (r() - 0.5) * 2.2);
      s.v.y = s.v.y * 0.5 - r() * 2;
      s.v.multiplyScalar(keep);
      s.n.applyAxisAngle(tmpN.set(r() - 0.5, 0, r() - 0.5).normalize(), (r() - 0.5) * 1.6).normalize();
      s.spin *= 0.7;
      if (G0.hitCd <= 0) { SFX.leaves(); G0.hitCd = 0.1; }
    }
  }
}

function basketHit(s, prevY) {
  const B = W.basket, dx = s.p.x - B.x, dz = s.p.z - B.z, rh = Math.hypot(dx, dz), y = s.p.y - B.y, r = Math.random;
  const radial = (k) => { const nx = dx / (rh || 1), nz = dz / (rh || 1), vn = s.v.x * nx + s.v.z * nz; if (vn < 0) { s.v.x -= (1 + k) * vn * nx; s.v.z -= (1 + k) * vn * nz; } };
  // ķēdes
  if (y > 0.68 && y < 1.3 && rh < 0.3) {
    if (!G0.decided) {
      G0.decided = true;
      const sp = s.v.length(), edge = rh / 0.3;
      let p = sp < 7 ? 0.985 : sp < 12 ? 0.93 : sp < 18 ? 0.75 : 0.45;
      if (edge > 0.72) p *= 0.5;
      G0.chainsAmp = Math.min(0.35, sp * 0.025);
      if (r() < p) { SFX.chains(1); finish("in"); return true; }
      SFX.chains(0.5); SFX.metal();
      s.v.multiplyScalar(0.25 + r() * 0.2); radial(0.2);
      s.v.applyAxisAngle(tmpN.set(0, 1, 0), (r() - 0.5) * 2.4);
    }
    return false;
  }
  if (rh > 0.4) G0.decided = false;
  // grozs no augšas vai sāniem
  if (y > 0.5 && y < 0.72 && rh < 0.34) {
    if (prevY >= 0.7 && s.v.y < 0) { SFX.chains(0.7); finish("in"); return true; }
    radial(0.3); s.v.multiplyScalar(0.5); SFX.metal(); return false;
  }
  // augšējā josla
  if (y > 1.3 && y < 1.4 && rh < 0.36) { s.v.y = Math.abs(s.v.y) * 0.3 + 0.6; radial(0.4); s.v.multiplyScalar(0.6); SFX.metal(); return false; }
  // stabs
  if (y < 0.5 && rh < 0.024 + DISC_R) { radial(0.3); s.v.multiplyScalar(0.5); SFX.metal(); }
  return false;
}

function finish(kind) {
  const s = G0.s;
  G0.phase = kind; G0.mode = "rest"; G0.timer = 0;
  if (kind === "in") {
    G0.chainsT = 0; G0.inFrom = s.p.clone();
    const sc = G0.strokes;
    showToast(scoreName(sc, W.def.par), sc + (sc === 1 ? " metiens" : " metieni"), 2200, true);
    G0.scores[G0.hole] = sc;
    updateHud();
    return;
  }
  if (kind === "water" || kind === "ob") {
    if (kind === "water") SFX.splash();
    G0.strokes++;
    showToast(kind === "water" ? "Ūdenī!" : "Ārpus laukuma", "+1 soda metiens · met no iepriekšējās vietas", 2200);
    G0.nextLie = G0.lastLie.clone();
    updateHud();
    return;
  }
  // rest
  s.p.y = W.H(s.p.x, s.p.z) + 0.012;
  s.n.copy(W.normal(s.p.x, s.p.z, _gn));
  const thrown = Math.hypot(s.p.x - G0.throwFrom.x, s.p.z - G0.throwFrom.z), left = distToBasket(s.p);
  showToast(Math.round(thrown) + " m", "līdz grozam " + (left < 10 ? left.toFixed(1) : Math.round(left)) + " m", 1700);
  G0.nextLie = s.p.clone().setY(W.H(s.p.x, s.p.z));
  landRing.position.copy(G0.nextLie).setY(G0.nextLie.y + 0.03); landRing.visible = true;
  if (G0.strokes >= 10) { G0.scores[G0.hole] = G0.strokes + 1; G0.phase = "max"; showToast("Maksimums", "groza rezultāts " + (G0.strokes + 1), 2000); }
}

function scoreName(s, par) {
  if (s === 1) return "ACE!";
  const d = s - par;
  return d <= -3 ? "Albatross!" : d === -2 ? "Eagle!" : d === -1 ? "Birdie!" : d === 0 ? "Par" : d === 1 ? "Bogey" : d === 2 ? "Double bogey" : "+" + d;
}

// ---------------------------------------------------------------- kamera
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
function aimCam(out, look) {
  const f = fwdOf(G0.yaw), back = G0.putt ? 2.6 : 3.4;
  out.copy(G0.lie).addScaledVector(f, -back); out.y = Math.max(W.H(out.x, out.z), G0.lie.y) + (G0.putt ? 1.65 : 1.95);
  const ahead = G0.putt ? Math.max(2, distToBasket(G0.lie)) : 28;
  look.copy(G0.lie).addScaledVector(f, ahead);
  look.y = (G0.putt ? W.basket.y + 0.9 : Math.max(W.H(look.x, look.z), G0.lie.y - 2) + 1.4);
}
function updateCamera(dt) {
  const k = 1 - Math.exp(-dt * 5);
  if (G0.mode === "flyover") {
    G0.flyover += dt / 3.2;
    const u = smooth(0, 1, G0.flyover);
    aimCam(wantPos, wantLook);
    const sPos = W.basket.clone().add(new THREE.Vector3(0, 28, 0)).addScaledVector(fwdOf(W.teeDir), 22);
    camPos.copy(sPos).lerp(wantPos, u); camLook.copy(W.basket).lerp(wantLook, smooth(0.2, 1, u));
    if (G0.flyover >= 1) G0.mode = "aim";
  } else if (G0.mode === "aim" || G0.mode === "power") {
    aimCam(wantPos, wantLook); camPos.lerp(wantPos, k); camLook.lerp(wantLook, k);
  } else if (G0.s) {
    const p = G0.s.p;
    if (G0.putt) {
      camLook.lerp(tmpV.copy(p).lerp(W.basket.clone().setY(W.basket.y + 0.9), 0.5), k);
    } else {
      if (G0.phase === "air" && G0.s.v.lengthSq() > 4) G0.camFwd.lerp(tmpV.set(G0.s.v.x, 0, G0.s.v.z).normalize(), 1 - Math.exp(-dt * 1.2)).normalize();
      wantPos.copy(p).addScaledVector(G0.camFwd, -7.5); wantPos.y = Math.max(p.y + 2.4, W.H(wantPos.x, wantPos.z) + 1.6);
      camPos.lerp(wantPos, 1 - Math.exp(-dt * 2.6)); camLook.lerp(p, 1 - Math.exp(-dt * 8));
    }
  }
  camera.position.copy(camPos); camera.lookAt(camLook);
}

// ---------------------------------------------------------------- HUD
const holeT = $("#holeT"), holeS = $("#holeS"), scoreT = $("#scoreT"), scoreS = $("#scoreS");
function totalRel() { let r = 0; G0.scores.forEach((s, i) => { if (s != null) r += s - HOLES[i].par; }); return r; }
function relTxt(r) { return r === 0 ? "E" : r > 0 ? "+" + r : String(r); }
function updateHud() {
  if (!W) return;
  holeT.textContent = "Grozs " + (G0.hole + 1) + " · " + W.def.name;
  holeS.textContent = "Par " + W.def.par + " · " + Math.round(W.plen) + " m";
  scoreT.textContent = relTxt(totalRel());
  scoreS.textContent = "Metieni: " + G0.strokes;
}
let toastTimer = 0;
function showToast(t, s, ms, gold) {
  $("#toastT").textContent = t; $("#toastS").textContent = s || "";
  $("#toastT").style.color = gold ? "#ffc21a" : "#fff";
  $("#toast").classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("#toast").classList.remove("on"), ms || 1800);
}
function sliderText() {
  const h = G0.hyzer;
  $("#hyzerO").textContent = h === 0 ? "plakans" : Math.abs(h) + "° " + (h > 0 ? "hyzer" : "anhyzer");
  $("#elevO").textContent = G0.elev + "°";
}
const marker = $("#marker"), markerD = $("#markerD"), windArrow = $("#windArrow");
function updateOverlay() {
  const p = tmpV.copy(W.basket).setY(W.basket.y + 1.55).project(camera);
  const show = p.z < 1 && G0.mode !== "flyover";
  marker.style.display = show ? "flex" : "none";
  if (show) {
    const x = (p.x * 0.5 + 0.5) * innerWidth, y = (-p.y * 0.5 + 0.5) * innerHeight;
    marker.style.transform = `translate(${clamp(x, 30, innerWidth - 30)}px,${clamp(y, 120, innerHeight - 40)}px) translate(-50%,-100%)`;
    const from = G0.mode === "flight" || G0.mode === "rest" ? G0.s.p : G0.lie, d = distToBasket(from);
    markerD.textContent = (d < 10 ? d.toFixed(1) : Math.round(d)) + " m";
  }
  const camYaw = Math.atan2(camLook.x - camPos.x, -(camLook.z - camPos.z));
  windArrow.style.transform = `rotate(${(W.windAng - camYaw) / D2R}deg)`;
  $("#windV").textContent = W.windSpeed.toFixed(1) + " m/s";
  const rel = Math.cos(W.windAng - G0.yaw);
  $("#windL").textContent = rel < -0.5 ? "pretvējš" : rel > 0.5 ? "pa vējam" : "sānu vējš";
}

// ---------------------------------------------------------------- minikarte
const mapC = $("#map"), mapX = mapC.getContext("2d"); let mapBase = null, mapT = null;
function drawMapBase() {
  const w = mapC.width, h = mapC.height;
  mapBase = document.createElement("canvas"); mapBase.width = w; mapBase.height = h;
  const x = mapBase.getContext("2d");
  const ax = W.axis, rgt = { x: -ax.y, y: ax.x };
  let mu = 1e9, Mu = -1e9, mv = 1e9, Mv = -1e9;
  const toUV = (px, pz) => ({ u: (px - W.T.x) * rgt.x + (pz - W.T.y) * rgt.y, v: (px - W.T.x) * ax.x + (pz - W.T.y) * ax.y });
  for (const p of W.path) { const q = toUV(p.x, p.y); mu = Math.min(mu, q.u); Mu = Math.max(Mu, q.u); mv = Math.min(mv, q.v); Mv = Math.max(Mv, q.v); }
  const pad = W.def.width + 14; mu -= pad; Mu += pad; mv -= 10; Mv += 12;
  const sc = Math.min(w / (Mu - mu), h / (Mv - mv)), ox = w / 2 - ((mu + Mu) / 2) * sc, oy = h / 2 + ((mv + Mv) / 2) * sc;
  mapT = (px, pz) => { const q = toUV(px, pz); return [ox + q.u * sc, oy - q.v * sc]; };
  x.fillStyle = "#2c4d22"; x.fillRect(0, 0, w, h);
  x.lineCap = "round"; x.lineJoin = "round";
  x.strokeStyle = "#5f9a3d"; x.lineWidth = W.def.width * 2 * sc; x.beginPath(); W.path.forEach((p, i) => { const [a, b] = mapT(p.x, p.y); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.stroke();
  if (W.pond) { x.save(); const [a, b] = mapT(W.pond.x, W.pond.z); x.translate(a, b); const rot = Math.atan2(ax.x, -ax.y) - W.pond.ang; x.rotate(rot); x.fillStyle = "#3b7ea0"; x.beginPath(); x.ellipse(0, 0, W.pond.rx * sc * 1.0, W.pond.rz * sc * 1.0, 0, 0, Math.PI * 2); x.fill(); x.restore(); }
  for (const t of W.trees) { const [a, b] = mapT(t.x, t.z); if (a < -5 || b < -5 || a > w + 5 || b > h + 5) continue; x.fillStyle = t.kind === 0 ? "#173a1f" : t.kind === 1 ? "#21452a" : "#2f5e2c"; x.beginPath(); x.arc(a, b, Math.max(1.2, t.cr * sc * 0.8), 0, Math.PI * 2); x.fill(); }
  const [ta, tb] = mapT(W.T.x, W.T.y); x.fillStyle = "#c9cbc5"; x.fillRect(ta - 3, tb - 3, 6, 6);
}
function drawMap() {
  if (!mapBase) return;
  const x = mapX, w = mapC.width, h = mapC.height;
  x.clearRect(0, 0, w, h); x.drawImage(mapBase, 0, 0);
  if (trailN > 1) { x.strokeStyle = "rgba(255,255,255,.85)"; x.lineWidth = 2; x.beginPath(); for (let i = 0; i < trailN; i += 4) { const [a, b] = mapT(trailPos[i * 3], trailPos[i * 3 + 2]); i ? x.lineTo(a, b) : x.moveTo(a, b); } x.stroke(); }
  const [la, lb] = mapT(G0.lie.x, G0.lie.z);
  if (G0.mode === "aim" || G0.mode === "power") {
    const f = fwdOf(G0.yaw), [ea, eb] = mapT(G0.lie.x + f.x * 60, G0.lie.z + f.z * 60);
    x.setLineDash([4, 4]); x.strokeStyle = "#ffc21a"; x.lineWidth = 1.6; x.beginPath(); x.moveTo(la, lb); x.lineTo(ea, eb); x.stroke(); x.setLineDash([]);
  }
  const [ba, bb] = mapT(W.basket.x, W.basket.z);
  x.fillStyle = "#ffc21a"; x.strokeStyle = "#241a00"; x.lineWidth = 2; x.beginPath(); x.arc(ba, bb, 5, 0, Math.PI * 2); x.fill(); x.stroke();
  const dp = G0.s && (G0.mode === "flight" || G0.mode === "rest") ? G0.s.p : G0.lie, [da, db] = mapT(dp.x, dp.z);
  x.fillStyle = G0.disc.color; x.strokeStyle = "#000"; x.lineWidth = 1.5; x.beginPath(); x.arc(da, db, 4, 0, Math.PI * 2); x.fill(); x.stroke();
  // vēja bulta
  const ax = W.axis, rgt = { x: -ax.y, y: ax.x }, wu = W.wind.x * rgt.x + W.wind.z * rgt.y, wv = W.wind.x * ax.x + W.wind.z * ax.y, wl = Math.hypot(wu, wv) || 1;
  x.save(); x.translate(w - 16, 16); x.rotate(Math.atan2(wu / wl, wv / wl)); x.strokeStyle = "#fff"; x.lineWidth = 2; x.beginPath(); x.moveTo(0, 8); x.lineTo(0, -8); x.moveTo(-4, -4); x.lineTo(0, -8); x.lineTo(4, -4); x.stroke(); x.restore();
}

// ---------------------------------------------------------------- ievade
function buildDiscButtons() {
  $("#discs").innerHTML = DISCS.map((d) => `<button class="disc" data-id="${d.id}" aria-pressed="false"><span class="dot" style="background:${d.color}"></span><span><span class="n">${d.name}</span><br><span class="f">${d.speed} | ${d.glide} | ${d.turn} | ${d.fade}</span></span></button>`).join("");
  document.querySelectorAll(".disc").forEach((b) => b.addEventListener("click", () => { if (G0.mode === "aim") { selectDisc(b.dataset.id); placeDiscInHand(); } }));
}
document.querySelectorAll("#style button").forEach((b) => b.addEventListener("click", () => {
  G0.hand = +b.dataset.h; store.set("hand", G0.hand);
  document.querySelectorAll("#style button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  updatePutt(); placeDiscInHand();
}));
document.querySelectorAll("#style button").forEach((x) => x.setAttribute("aria-pressed", String(+x.dataset.h === G0.hand)));
$("#hyzer").addEventListener("input", (e) => { G0.hyzer = +e.target.value; sliderText(); placeDiscInHand(); });
$("#elev").addEventListener("input", (e) => { G0.elev = +e.target.value; sliderText(); if (G0.putt) updatePutt(); placeDiscInHand(); });
const nudge = (a) => { if (G0.mode === "aim") { G0.yaw += a; placeDiscInHand(); } };
$("#aimL").addEventListener("click", () => nudge(-1.5 * D2R));
$("#aimR").addEventListener("click", () => nudge(1.5 * D2R));
$("#aimC").addEventListener("click", () => { if (G0.mode === "aim") { G0.yaw = yawTo(G0.lie, W.basket); placeDiscInHand(); } });
mapC.addEventListener("click", () => mapC.classList.toggle("big"));

let drag = null;
canvas.addEventListener("pointerdown", (e) => { if (G0.mode === "flyover") { G0.flyover = 1; return; } if (G0.mode === "aim") drag = { x: e.clientX, id: e.pointerId }; });
canvas.addEventListener("pointermove", (e) => { if (drag && e.pointerId === drag.id && G0.mode === "aim") { G0.yaw += (e.clientX - drag.x) * (G0.putt ? 0.0015 : 0.0035); drag.x = e.clientX; placeDiscInHand(); } });
addEventListener("pointerup", () => { drag = null; });

const throwBtn = $("#throwBtn");
function holdStart(e) { if (e) e.preventDefault(); if (G0.mode !== "aim") return; audio(); G0.mode = "power"; G0.holdT = performance.now(); throwBtn.classList.add("hold"); }
function holdEnd(e) {
  if (e) e.preventDefault();
  if (G0.mode !== "power") return;
  throwBtn.classList.remove("hold");
  const p = powerNow(); $("#fill").style.width = "0";
  if (p < 0.03) { G0.mode = "aim"; return; }
  release(p);
}
function powerNow() { const u = ((performance.now() - G0.holdT) / 1000) % 2.4; return u < 1.2 ? u : 2.4 - u; }
throwBtn.addEventListener("pointerdown", holdStart);
throwBtn.addEventListener("pointerup", holdEnd);
throwBtn.addEventListener("pointercancel", holdEnd);
throwBtn.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "Space") holdStart(e);
  if (e.code === "ArrowLeft") nudge(-1.5 * D2R);
  if (e.code === "ArrowRight") nudge(1.5 * D2R);
});
addEventListener("keyup", (e) => { if (e.code === "Space") holdEnd(e); });
$("#backBtn").addEventListener("click", () => { if (history.length > 1) history.back(); else location.href = "index.html"; });

// ---------------------------------------------------------------- lapas (ievads, groza beigas, rezultātu karte)
const sheet = $("#sheet"), card = $("#sheetCard");
function openSheet(html, bind) { card.innerHTML = html; sheet.hidden = false; bind && bind(); }
function closeSheet() { sheet.hidden = true; }
function scoreCls(s, par) { const d = s - par; return d <= -2 ? "e" : d === -1 ? "b" : d === 0 ? "p" : d === 1 ? "o" : "d"; }
function introSheet() {
  const best = store.get("best", null);
  openSheet(`<div class="eyebrow">Iemetējs · treniņu laukums</div><h1>Disku golfs 3D</h1>
  <p>9 grozi mežā ar līkumiem, pakalniem un dīķiem. Diska lidojums ir fizikāli aprēķināts — ātrums, leņķis, vējš un diska lidojuma skaitļi (speed | glide | turn | fade) nosaka, kur tas nolidos.</p>
  <ul class="tips">
  <li><b>Tēmē</b> — velc pa ekrānu vai spied ◀ ▶.</li>
  <li><b>Met</b> — turi dzelteno pogu, jauda aug līdz baltajai svītrai (100%). Pārspīlējot disks lido ātrāk, bet neprecīzi.</li>
  <li><b>Hyzer</b> liek diskam liekties pa kreisi (bekhendā), <b>anhyzer</b> — pa labi. Stabili diski beigās vienmēr "fadē".</li>
  <li>20 m no groza ieslēdzas <b>puts</b> — tad jauda ir pielāgota attālumam; ~80% ir tieši līdz ķēdēm.</li>
  <li>Koki aptur disku, ūdens un laukuma mala = +1 soda metiens.</li></ul>
  ${best != null ? `<p>Tavs labākais rezultāts: <b class="num" style="font-size:20px;color:#fff">${relTxt(best)}</b></p>` : ""}
  <div class="row"><button class="btn primary" id="go">Sākt raundu</button></div>`, () => $("#go").addEventListener("click", () => { audio(); closeSheet(); startHole(0); }));
}
function holeSheet() {
  const sc = G0.scores[G0.hole], par = W.def.par, last = G0.hole === HOLES.length - 1;
  openSheet(`<div class="eyebrow">Grozs ${G0.hole + 1} · ${W.def.name}</div>
  <div class="row" style="align-items:flex-end;gap:14px"><div class="big num">${sc}</div><div><h2>${scoreName(sc, par)}</h2><p>Par ${par} · kopā ${relTxt(totalRel())}</p></div></div>
  <div class="row"><button class="btn primary" id="next">${last ? "Rezultātu karte" : "Nākamais grozs"}</button></div>`,
  () => $("#next").addEventListener("click", () => { closeSheet(); if (last) finalSheet(); else startHole(G0.hole + 1); }));
}
function finalSheet() {
  const tot = G0.scores.reduce((a, b) => a + b, 0), par = HOLES.reduce((a, h) => a + h.par, 0), rel = tot - par;
  const best = store.get("best", null); const isBest = best == null || rel < best; if (isBest) store.set("best", rel);
  const rows = (a, b) => `<tr><th></th>${HOLES.slice(a, b).map((_, i) => `<th>${a + i + 1}</th>`).join("")}</tr><tr><td class="n muted">Par</td>${HOLES.slice(a, b).map((h) => `<td>${h.par}</td>`).join("")}</tr><tr><td class="n">Tu</td>${G0.scores.slice(a, b).map((s, i) => `<td><span class="sc ${scoreCls(s, HOLES[a + i].par)}">${s}</span></td>`).join("")}</tr>`;
  openSheet(`<div class="eyebrow">Raunds pabeigts</div>
  <div class="row" style="align-items:flex-end;gap:14px"><div class="big num">${relTxt(rel)}</div><div><h2>${tot} metieni</h2><p>Par ${par}${isBest ? " · jauns personīgais rekords!" : ` · labākais ${relTxt(best)}`}</p></div></div>
  <table>${rows(0, 5)}</table><table>${rows(5, 9)}</table>
  <div class="row"><button class="btn primary" id="again">Spēlēt vēlreiz</button><button class="btn" id="home">Uz Iemetēju</button></div>`, () => {
    $("#again").addEventListener("click", () => { store.set("seed", (store.get("seed", 0) | 0) + 1); G0.scores = []; closeSheet(); startHole(0); });
    $("#home").addEventListener("click", () => $("#backBtn").click());
  });
}

// ---------------------------------------------------------------- galvenais cikls
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();

let last = performance.now(), mapTick = 0, acc = 0;
const SUB = 1 / 240;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; G0.clock += dt;
  if (!W) { renderer.render(scene, camera); return; }
  if (G0.mode === "power") { const p = powerNow(); $("#fill").style.width = (p / 1.2 * 100).toFixed(1) + "%"; }
  if (G0.mode === "flight") {
    acc += dt;
    while (acc >= SUB && G0.mode === "flight") { physics(SUB); acc -= SUB; }
    if (G0.mode === "flight" && trailN < trailMax && G0.phase === "air") { trailPos.set([G0.s.p.x, G0.s.p.y, G0.s.p.z], trailN * 3); trailN++; trailGeo.setDrawRange(0, trailN); trailGeo.attributes.position.needsUpdate = true; }
  } else acc = 0;
  if (G0.mode === "rest") {
    G0.timer += dt;
    if (G0.phase === "in") {
      G0.chainsT += dt;
      const u = clamp(G0.chainsT / 0.45, 0, 1);
      G0.s.p.copy(G0.inFrom).lerp(tmpV.copy(W.basket).setY(W.basket.y + 0.53), u);
      G0.s.n.lerp(tmpN.set(0.15, 1, 0.1).normalize(), u).normalize();
      if (G0.timer > 2.3) { G0.mode = "done"; holeSheet(); }
    } else if (G0.phase === "max") {
      if (G0.timer > 2.2) { G0.mode = "done"; holeSheet(); }
    } else if (G0.timer > (G0.phase === "rest" ? 2.0 : 2.4)) {
      G0.lie.copy(G0.nextLie); landRing.visible = false;
      newLie(false); G0.mode = "aim"; updateHud();
      $("#bottom").style.visibility = "visible";
    }
  }
  if (G0.mode === "aim" || G0.mode === "flyover") $("#bottom").style.visibility = "visible";
  // diska modelis
  if ((G0.mode === "flight" || G0.mode === "rest") && G0.s) {
    discMesh.position.copy(G0.s.p);
    discMesh.quaternion.setFromUnitVectors(tmpN.set(0, 1, 0), G0.s.n);
    if (G0.phase === "air" || G0.phase === "slide") discModel.rotation.y -= dt * 40 * G0.hand * (G0.phase === "air" ? G0.s.spin : 0.3);
    discMesh.scale.setScalar(G0.putt ? 1 : 1.35);
  }
  // ķēžu šūpošanās
  if (G0.chainsAmp > 0.002) {
    G0.chainsAmp *= Math.exp(-dt * 2.2);
    const ch = W.basketObj.userData.chains; ch.rotation.x = Math.sin(G0.clock * 17) * G0.chainsAmp * 0.4; ch.rotation.z = Math.cos(G0.clock * 13) * G0.chainsAmp * 0.4;
  }
  // tēmēšanas līnija
  aimLine.visible = G0.mode === "aim" || G0.mode === "power";
  if (aimLine.visible) {
    const f = fwdOf(G0.yaw), a = aimGeo.attributes.position, len = G0.putt ? Math.min(distToBasket(G0.lie), 20) : 22;
    for (let i = 0; i < 40; i++) { const t = 0.6 + (i / 39) * len, x = G0.lie.x + f.x * t, z = G0.lie.z + f.z * t; a.setXYZ(i, x, W.H(x, z) + 0.06, z); }
    a.needsUpdate = true; aimLine.computeLineDistances();
  }
  updateCamera(dt);
  updateOverlay();
  if ((mapTick += dt) > 0.07) { mapTick = 0; drawMap(); }
  renderer.render(scene, camera);
}

buildDiscButtons();
selectDisc("drv", true);
sliderText();
$("#loading").remove();
introSheet();
// Fona skats aiz ievada lapas
W = buildHole(0); G0.lie.copy(W.tee); G0.yaw = W.teeDir; G0.mode = "intro";
{ const sz = W.half * 2; sun.position.set(W.cx, 0, W.cz).addScaledVector(SUN_DIR, 260); sun.target.position.set(W.cx, 0, W.cz); Object.assign(sun.shadow.camera, { left: -sz / 2, right: sz / 2, top: sz / 2, bottom: -sz / 2, near: 10, far: 600 }); sun.shadow.camera.updateProjectionMatrix(); }
camPos.copy(W.basket).add(new THREE.Vector3(14, 9, 18)); camLook.copy(W.basket).setY(W.basket.y + 1);
placeDiscInHand(); drawMapBase(); updateHud();
requestAnimationFrame(frame);
window.__dg = { G0, get W() { return W; }, release, startHole, physics };

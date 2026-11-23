import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PARTS, PART_BY_ID, type PartId } from './parts';
import {
  COLORS, PILL_COLORS, glassMat, grilleTexture, metalMat, pcbMat, pillMat, plasticMat, qrTexture, shellMat,
} from './materials';

type V3 = [number, number, number];
type LedMode = 'idle' | 'alert' | 'dispense' | 'tray' | 'skip';

export interface SceneEvents {
  onSelect?: (id: PartId | null) => void;
  onStatus?: (text: string) => void;
  onBusy?: (busy: boolean) => void;
  onExplode?: (value: number) => void;
  onXray?: (on: boolean) => void;
  onSpin?: (on: boolean) => void;
}

interface Piece { obj: THREE.Object3D; base: THREE.Vector3; off: THREE.Vector3; part: PartId }
interface Tween { t0: number; ms: number; fn: (k: number) => void; done: () => void }

const SLOTS = 29;
const STEP = (Math.PI * 2) / SLOTS;
const XRAY_PARTS = new Set<PartId>(['shell', 'front', 'lid']);
const SCREENS: Record<LedMode, [string, string, string]> = {
  idle: ['12:00', 'รอบถัดไป · กลางวัน', '#F2C14E'],
  alert: ['ถึงเวลา', 'กินยารอบกลางวัน', '#F09A4E'],
  dispense: ['กำลังจ่าย…', 'กรุณารอสักครู่', '#5FD0C0'],
  tray: ['หยิบยา', 'ยาอยู่ในถาดแล้วค่ะ', '#7BE08F'],
  skip: ['ข้ามรอบ', 'ยาไปกล่องหลัง', '#F07A5A'],
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Imperative three.js scene for the exploded view.
 * React owns the UI around it; this class owns the canvas, the model and the animations.
 */
export class DeviceScene {
  readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.5, 600);
  private controls: OrbitControls;
  private ground: THREE.Mesh;
  private pieces: Piece[] = [];
  private meshes: THREE.Mesh[] = [];
  private tweens: Tween[] = [];
  private pins = new Map<PartId, HTMLButtonElement>();
  private slotPills: THREE.Mesh[][] = [];
  private dish!: THREE.Group;
  private flap!: THREE.Group;
  private ring!: THREE.MeshStandardMaterial;
  private screenCtx!: CanvasRenderingContext2D;
  private screenTex!: THREE.CanvasTexture;
  private pill: THREE.Mesh;
  private raf = 0;
  private resizeObs: ResizeObserver;
  private downAt: [number, number] | null = null;

  explode = 0;
  xray = false;
  spin: boolean;
  busy = false;
  selected: PartId | null = null;
  private led: LedMode = 'idle';
  private slot = 0;

  constructor(private host: HTMLElement, private events: SceneEvents = {}) {
    this.spin = !this.reducedMotion;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.className = 'stage-canvas';
    host.prepend(r.domElement);

    // studio lighting: soft environment for reflections + one key light for shadows
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    const key = new THREE.DirectionalLight(0xfff3e3, 1.9);
    key.position.set(26, 58, 30);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    Object.assign(key.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 200 });
    this.scene.add(key);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xe0d4c0, 0.35));

    this.ground = new THREE.Mesh(new THREE.CircleGeometry(90, 72), new THREE.ShadowMaterial({ opacity: 0.16 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.camera.position.set(40, 42, 50);
    const c = (this.controls = new OrbitControls(this.camera, r.domElement));
    c.enableDamping = true;
    c.target.set(0, 7, 0);
    c.minDistance = 25;
    c.maxDistance = 170;
    c.maxPolarAngle = Math.PI * 0.62;
    c.autoRotateSpeed = 0.55;
    c.addEventListener('start', () => { if (this.spin) this.setSpin(false); });

    this.buildShell();
    this.buildElectronics();
    this.buildBin();
    this.buildTray();
    this.buildRamps();
    this.buildServo();
    this.buildStepper();
    this.buildBase();
    this.buildDish();
    this.buildFront();
    this.buildLid();

    this.pill = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 6, 14), pillMat(PILL_COLORS[1]));
    this.pill.castShadow = true;
    this.pill.visible = false;
    this.scene.add(this.pill);

    this.buildPins();
    this.setMode('idle');
    document.fonts?.ready.then(() => this.setMode(this.led));
    this.applyExplode(0);
    this.setSpin(this.spin);

    r.domElement.addEventListener('pointerdown', this.onPointerDown);
    r.domElement.addEventListener('pointerup', this.onPointerUp);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- public API

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.pins.forEach((p) => p.remove());
    this.renderer.domElement.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mm) => {
          const mt = mm as THREE.MeshStandardMaterial;
          mt.map?.dispose();
          mm.dispose();
        });
      }
    });
    this.renderer.dispose();
  }

  setExplode(v: number) { this.applyExplode(v); }

  async animateExplode(to: number) {
    const from = this.explode;
    const cam0 = this.camera.position.clone();
    const tgt0 = this.controls.target.clone();
    const dir = cam0.clone().sub(tgt0).normalize();
    const d0 = cam0.distanceTo(tgt0);
    const d1 = lerp(68, 122, to);
    const tgt1 = new THREE.Vector3(0, lerp(7, 9, to), 0);
    await this.tween(1500, (k) => {
      const e = ease(k);
      this.applyExplode(lerp(from, to, e));
      const tgt = tgt0.clone().lerp(tgt1, e);
      this.controls.target.copy(tgt);
      this.camera.position.copy(tgt).addScaledVector(dir, lerp(d0, d1, e));
    });
  }

  setXray(on: boolean) {
    this.xray = on;
    for (const m of this.meshes) {
      if (!XRAY_PARTS.has(m.userData.part)) continue;
      const mat = m.material as THREE.MeshStandardMaterial;
      if ((mat as THREE.Material & { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial) continue;
      if (m.userData.part === 'lid') { m.visible = !on || m.userData.isGlass !== true; continue; }
      const base = (m.userData.baseOpacity as number) ?? 1;
      mat.transparent = on || base < 1;
      mat.opacity = on ? Math.min(base, 0.13) : base;
      mat.depthWrite = !on;
      m.castShadow = !on;
      mat.needsUpdate = true;
    }
    this.events.onXray?.(on);
  }

  setSpin(on: boolean) {
    this.spin = on;
    this.controls.autoRotate = on;
    this.events.onSpin?.(on);
  }

  select(id: PartId | null) {
    this.selected = id;
    for (const m of this.meshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      if (!mat.emissive || mat === this.ring) continue;
      const hit = id !== null && m.userData.part === id;
      mat.emissive.setHex(hit ? 0xe07a2f : 0x000000);
      mat.emissiveIntensity = hit ? 0.32 : 1;
    }
    this.pins.forEach((el, k) => el.classList.toggle('sel', k === id));
    this.events.onSelect?.(id);
  }

  /** Plays one dose: alert → (take | skip) → servo → dish turns one slot → pill travels. */
  async runRound(taken: boolean) {
    if (this.busy) return;
    this.setBusy(true);
    const hadXray = this.xray;
    if (this.explode > 0.01) await this.animateExplode(0);
    if (!this.xray) this.setXray(true);
    this.select(null);

    this.setMode('alert');
    this.say('12:00 ถึงเวลากินยา · เครื่องพูดเตือน ไฟส้มกระพริบ');
    await this.wait(1900);
    this.say(taken ? 'คุณยายกดปุ่มใหญ่ที่ตัวเครื่อง' : 'ไม่มีใครกด · ระบบปิดรอบและส่งยาไปกล่องหลัง');
    await this.wait(1200);
    this.setMode(taken ? 'dispense' : 'skip');

    const r0 = this.flap.rotation.x;
    const r1 = taken ? 0.55 : -0.6;
    this.say(taken ? 'เซอร์โวชี้ 0° → ทางไปถาดหน้า' : 'เซอร์โวชี้ 60° → ทางไปกล่องหลัง');
    await this.tween(500, (k) => { this.flap.rotation.x = lerp(r0, r1, ease(k)); });

    this.say('มอเตอร์หมุนจาน 1 ช่อง (12.4°)');
    const d0 = this.dish.rotation.y;
    await this.tween(1100, (k) => { this.dish.rotation.y = d0 - STEP * ease(k); });
    this.slot = (this.slot % 28) + 1;
    (this.slotPills[this.slot] ?? []).forEach((p) => (p.visible = false));
    (this.pill.material as THREE.MeshPhysicalMaterial).color.setHex(PILL_COLORS[(this.slot - 1) % 4]);
    this.pill.visible = true;
    this.say('ยาของช่องนี้ตกลงรูทิ้งยา');

    if (taken) {
      await this.travel([[0, 11.9, 7], [0, 10.6, 7], [0, 9.75, 7.1], [0, 8.6, 8.1], [0, 7, 9.1], [0, 4.2, 8.6], [0, 3.55, 8.2]], 1600);
      this.setMode('tray');
      this.say('ยาอยู่ในถาด · วงแหวนไฟเป็นสีเขียว');
      await this.wait(1700);
      this.say('เซนเซอร์ IR เห็นว่าหยิบยาแล้ว → บันทึก “กินแล้ว” และหยุดเตือนทุกช่องทาง');
      const p0 = this.pill.position.clone();
      await this.tween(600, (k) => { this.pill.position.set(p0.x, p0.y + 6 * ease(k), p0.z + 6 * ease(k)); });
      await this.wait(900);
    } else {
      await this.travel([[0, 11.9, 7], [0, 10.6, 7], [0, 9.75, 6.6], [0, 8.8, 4.5], [0, 7.2, 0], [0, 5.6, -4.5], [0, 4, -6.5], [0, 3.55, -7.2]], 1900);
      this.say('ยาเก่าอยู่ในกล่องหลัง ไม่ปนกับยารอบใหม่ · ผู้ดูแลเปิดเก็บภายหลัง');
      await this.wait(1900);
    }
    this.pill.visible = false;
    const f0 = this.flap.rotation.x;
    await this.tween(400, (k) => { this.flap.rotation.x = lerp(f0, 0.55, k); });
    this.setMode('idle');
    this.say('');
    if (!hadXray) this.setXray(false);
    this.setBusy(false);
  }

  // ---------------------------------------------------------------- internals

  private setBusy(b: boolean) { this.busy = b; this.events.onBusy?.(b); }
  private say(t: string) { this.events.onStatus?.(t); }
  private wait(ms: number) { return new Promise<void>((r) => setTimeout(r, this.reducedMotion ? Math.min(ms, 200) : ms)); }

  private tween(ms: number, fn: (k: number) => void) {
    return new Promise<void>((done) => {
      this.tweens.push({ t0: performance.now(), ms: this.reducedMotion ? Math.min(ms, 120) : ms, fn, done });
    });
  }

  private async travel(points: V3[], ms: number) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    await this.tween(ms, (k) => { this.pill.position.copy(curve.getPoint(k)); this.pill.rotation.z += 0.15; });
  }

  private applyExplode(e: number) {
    this.explode = e;
    for (const p of this.pieces) p.obj.position.copy(p.base).addScaledVector(p.off, e);
    this.ground.position.y = -0.02 - 10.6 * e;
    this.events.onExplode?.(e);
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (now: number) => {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i];
      const k = Math.min(1, (now - t.t0) / t.ms);
      t.fn(k);
      if (k >= 1) { this.tweens.splice(i, 1); t.done(); }
    }
    this.updateLed(now / 1000);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.placePins();
    this.raf = requestAnimationFrame(this.loop);
  };

  private onPointerDown = (e: PointerEvent) => { this.downAt = [e.clientX, e.clientY]; };
  private onPointerUp = (e: PointerEvent) => {
    if (!this.downAt || Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 5) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray
      .intersectObjects(this.meshes.filter((m) => m.visible), false)
      .filter((h) => !(this.xray && XRAY_PARTS.has(h.object.userData.part)));
    this.select(hits.length ? (hits[0].object.userData.part as PartId) : null);
  };

  // pins -----------------------------------------------------------------

  private buildPins() {
    for (const p of PARTS) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pin';
      el.textContent = String(p.n);
      el.setAttribute('aria-label', `${p.n} ${p.name}`);
      el.addEventListener('click', (ev) => { ev.stopPropagation(); this.select(this.selected === p.id ? null : p.id); });
      this.host.appendChild(el);
      this.pins.set(p.id, el);
    }
  }

  private placePins() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const v = new THREE.Vector3();
    for (const p of PARTS) {
      v.set(...p.anchor).addScaledVector(new THREE.Vector3(...p.off), this.explode);
      if (p.id === 'shell') v.x -= 14 * this.explode;
      v.project(this.camera);
      const el = this.pins.get(p.id)!;
      const outside = ['front', 'lid', 'tray', 'shell'].includes(p.id);
      const hidden = this.busy || v.z > 1 || (this.explode < 0.35 && !outside && !this.xray);
      el.classList.toggle('hide', hidden);
      el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
    }
  }

  // screen + LED ---------------------------------------------------------

  private setMode(m: LedMode) {
    this.led = m;
    const [l1, l2, accent] = SCREENS[m];
    const x = this.screenCtx;
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#13302D'); g.addColorStop(1, '#0B1B1A');
    x.fillStyle = g; x.fillRect(0, 0, 512, 256);
    x.textBaseline = 'middle';
    x.fillStyle = accent; x.font = '700 76px "Inter Variable", "Anuphan", sans-serif'; x.fillText(l1, 30, 96);
    x.fillStyle = '#CFE9E1'; x.font = '500 36px "Inter Variable", "Anuphan", sans-serif'; x.fillText(l2, 32, 188);
    this.screenTex.needsUpdate = true;
  }

  private updateLed(t: number) {
    let c = 0xffffff, k = 0.35 + 0.2 * Math.sin(t * 1.6);
    switch (this.led) {
      case 'alert': c = 0xe07a2f; k = Math.floor(t * 2.2) % 2 ? 2.2 : 0.2; break;
      case 'dispense': c = 0x2fbfae; k = 1.4 + 0.7 * Math.sin(t * 10); break;
      case 'tray': c = 0x3fbf62; k = 1.9; break;
      case 'skip': c = 0xd9532e; k = 1.7; break;
      default: break;
    }
    this.ring.color.setHex(c);
    this.ring.emissive.setHex(c);
    this.ring.emissiveIntensity = this.reducedMotion ? Math.max(k, 0.6) : k;
  }

  // building helpers -------------------------------------------------------

  private piece(part: PartId, base: V3 = [0, 0, 0], off?: V3) {
    const g = new THREE.Group();
    g.position.set(...base);
    this.scene.add(g);
    this.pieces.push({ obj: g, base: new THREE.Vector3(...base), off: new THREE.Vector3(...(off ?? PART_BY_ID[part].off)), part });
    return g;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, part: PartId, pos: V3 = [0, 0, 0], rot?: V3) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.part = part;
    m.userData.baseOpacity = (mat as THREE.MeshStandardMaterial).opacity ?? 1;
    this.meshes.push(m);
    return m;
  }

  private rbox(w: number, h: number, d: number, r = 0.12) { return new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.01, h / 2.01, d / 2.01)); }
  private box(w: number, h: number, d: number) { return new THREE.BoxGeometry(w, h, d); }

  private plank(group: THREE.Group, part: PartId, a: V3, b: V3, width: number, thick: number, mat: THREE.Material) {
    const dy = b[1] - a[1], dz = b[2] - a[2];
    const m = this.mesh(this.rbox(width, thick, Math.hypot(dy, dz), 0.04), mat, part, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    m.rotation.x = Math.atan2(-dy, dz);
    group.add(m);
  }

  // 11 · shell
  private buildShell() {
    const bottom = this.piece('shell', [0, 0, 0], [0, -10, 0]);
    bottom.add(this.mesh(this.rbox(22, 0.4, 22, 0.18), shellMat(), 'shell', [0, 0.2, 0]));
    for (const [x, z] of [[-9.6, -9.6], [9.6, -9.6], [-9.6, 9.6], [9.6, 9.6]]) {
      bottom.add(this.mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.3, 24), plasticMat(COLORS.rubber, { roughness: 0.9 }), 'shell', [x, -0.15, z]));
    }
    const divider = this.piece('shell', [0, 0, 0], [0, -3.5, 0]);
    divider.add(this.mesh(this.rbox(21.4, 0.2, 21.4, 0.08), shellMat(COLORS.shellEdge), 'shell', [0, 2.9, 0]));
    const left = this.piece('shell', [0, 0, 0], [-14, 0, 0]);
    left.add(this.mesh(this.rbox(0.4, 14.7, 22, 0.18), shellMat(), 'shell', [-10.8, 7.35, 0]));
    const right = this.piece('shell', [0, 0, 0], [14, 0, 0]);
    right.add(this.mesh(this.rbox(0.4, 14.7, 22, 0.18), shellMat(), 'shell', [10.8, 7.35, 0]));
    const back = this.piece('shell', [0, 0, 0], [0, 0, -24]);
    back.add(this.mesh(this.rbox(22, 14.7, 0.4, 0.18), shellMat(), 'shell', [0, 7.35, -10.8]));
    back.add(this.mesh(this.rbox(10.4, 3.8, 0.1, 0.05), shellMat(COLORS.shellEdge), 'shell', [0, 4.9, -11.03]));
    back.add(this.mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 24), plasticMat(COLORS.rubber), 'shell', [7.5, 1.6, -11.05], [Math.PI / 2, 0, 0]));
    back.add(this.mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshStandardMaterial({ map: qrTexture(), roughness: 0.6 }), 'shell', [-7, 11.5, -11.03], [0, Math.PI, 0]));
    const frontLow = this.piece('shell', [0, 0, 0], [0, -1.5, 10]);
    frontLow.add(this.mesh(this.rbox(22, 2.9, 0.4, 0.15), shellMat(), 'shell', [0, 1.45, 10.8]));
    frontLow.add(this.mesh(this.rbox(6.6, 4, 0.4, 0.1), shellMat(), 'shell', [-7.7, 4.9, 10.8]));
    frontLow.add(this.mesh(this.rbox(6.6, 4, 0.4, 0.1), shellMat(), 'shell', [7.7, 4.9, 10.8]));
  }

  // 10 · electronics
  private buildElectronics() {
    const g = this.piece('elec');
    const add = (m: THREE.Mesh) => g.add(m);
    add(this.mesh(this.box(5.2, 0.16, 2.8), pcbMat('#14211F', '#3E6E65', 3), 'elec', [-4.5, 0.9, -2]));
    add(this.mesh(this.rbox(1.8, 0.3, 1.6, 0.04), metalMat(0xd7dbdc, 0.25), 'elec', [-5.6, 1.1, -2]));
    add(this.mesh(this.rbox(0.55, 0.28, 0.4, 0.05), metalMat(0xb9bdbf), 'elec', [-2.05, 1.05, -2]));
    const pinGeo = this.box(0.08, 0.3, 0.08), pinMat = metalMat(0x2b2b2b, 0.5);
    for (let i = 0; i < 15; i++) {
      add(this.mesh(pinGeo, pinMat, 'elec', [-6.8 + i * 0.33, 0.75, -3.25]));
      add(this.mesh(pinGeo, pinMat, 'elec', [-6.8 + i * 0.33, 0.75, -0.75]));
    }
    add(this.mesh(this.box(3.5, 0.16, 3.1), pcbMat('#1E6B45', '#8CCB9E', 7), 'elec', [3.5, 0.9, -2]));
    add(this.mesh(this.rbox(1.9, 0.35, 0.8, 0.05), plasticMat(0xf2f2f2), 'elec', [3.4, 1.15, -2.2]));
    for (let i = 0; i < 4; i++) {
      add(this.mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 16), new THREE.MeshStandardMaterial({ color: 0xff5a4d, emissive: 0xff3b2e, emissiveIntensity: 0.6 }), 'elec', [2.3 + i * 0.7, 1.04, -0.9]));
    }
    add(this.mesh(this.box(2.2, 0.16, 1.4), pcbMat('#1F4F8E', '#9BC0F0', 11), 'elec', [-4.2, 0.9, 3.5]));
    add(this.mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.25, 32), metalMat(), 'elec', [-4.2, 1.1, 3.5]));
    for (const z of [3.4, 5.4]) {
      add(this.mesh(new THREE.CylinderGeometry(0.9, 0.9, 6.5, 36), plasticMat(COLORS.battery, { clearcoat: 0.8 }), 'elec', [4.2, 1.15, z], [0, 0, Math.PI / 2]));
      add(this.mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.2, 24), metalMat(), 'elec', [7.55, 1.15, z], [0, 0, Math.PI / 2]));
    }
    const wire = (pts: V3[], col: number) => {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
      add(this.mesh(new THREE.TubeGeometry(curve, 32, 0.07, 8), plasticMat(col, { roughness: 0.5 }), 'elec'));
    };
    wire([[-2.6, 1, -1], [-0.5, 1.8, -0.6], [1.5, 1.6, -0.7], [2.3, 1.1, -0.9]], 0xe07a2f);
    wire([[-2.6, 1, -1.3], [-0.3, 2.1, -1.2], [1.8, 1.9, -1.1], [3, 1.1, -0.9]], 0x2f6fb5);
    wire([[-3.2, 1, -0.6], [-3.6, 1.8, 1.5], [-4.2, 1.1, 2.9]], 0xf2c14e);
    wire([[3.5, 1, -3.6], [1.5, 2.4, -6], [0, 2.6, -6.5], [-0.5, 2.7, -5]], 0x1e3a37);
  }

  // 8 · bin
  private buildBin() {
    const g = this.piece('bin');
    const m = () => plasticMat(COLORS.bin, { roughness: 0.55 });
    g.add(this.mesh(this.rbox(10, 0.2, 7.3, 0.06), m(), 'bin', [0, 3.1, -6.85]));
    g.add(this.mesh(this.rbox(0.2, 3.4, 7.3, 0.06), m(), 'bin', [-5, 4.8, -6.85]));
    g.add(this.mesh(this.rbox(0.2, 3.4, 7.3, 0.06), m(), 'bin', [5, 4.8, -6.85]));
    g.add(this.mesh(this.rbox(10, 3.4, 0.2, 0.06), m(), 'bin', [0, 4.8, -3.2]));
    g.add(this.mesh(this.rbox(10, 3.4, 0.2, 0.06), m(), 'bin', [0, 4.8, -10.5]));
    g.add(this.mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 32), metalMat(0xd8dadb, 0.2), 'bin', [3.5, 5.2, -10.7], [Math.PI / 2, 0, 0]));
  }

  // 7 · tray + IR
  private buildTray() {
    const g = this.piece('tray');
    const w = () => plasticMat(0xfdfcf9, { roughness: 0.3, clearcoat: 0.6 });
    g.add(this.mesh(this.rbox(8, 0.2, 6.8, 0.06), w(), 'tray', [0, 3.1, 7.4]));
    g.add(this.mesh(this.rbox(0.2, 2.9, 6.8, 0.06), w(), 'tray', [-4, 4.5, 7.4]));
    g.add(this.mesh(this.rbox(0.2, 2.9, 6.8, 0.06), w(), 'tray', [4, 4.5, 7.4]));
    g.add(this.mesh(this.rbox(8, 2.9, 0.2, 0.06), w(), 'tray', [0, 4.5, 4]));
    g.add(this.mesh(this.rbox(8.4, 4, 0.4, 0.14), plasticMat(COLORS.teal, { clearcoat: 0.8, clearcoatRoughness: 0.2 }), 'tray', [0, 4.9, 10.95]));
    g.add(this.mesh(this.rbox(3.2, 0.5, 0.6, 0.2), plasticMat(COLORS.tealDeep), 'tray', [0, 5.6, 11.35]));
    g.add(this.mesh(this.box(1.6, 0.1, 1.2), pcbMat('#1F4F8E', '#9BC0F0', 5), 'tray', [2.6, 6.75, 7.4]));
    g.add(this.mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.4, 16), plasticMat(0x222222), 'tray', [2.3, 6.5, 7.4]));
    g.add(this.mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.4, 16), plasticMat(0xeeeeee, { roughness: 0.15 }), 'tray', [2.9, 6.5, 7.4]));
  }

  // 6 · ramps
  private buildRamps() {
    const g = this.piece('ramp');
    const m = () => plasticMat(COLORS.ramp, { roughness: 0.25, clearcoat: 0.7 });
    this.plank(g, 'ramp', [0, 9, 7.6], [0, 6.4, 9.5], 2.2, 0.1, m());
    this.plank(g, 'ramp', [0, 9, 5.6], [0, 5, -6.2], 2.2, 0.1, m());
    for (const x of [-1.15, 1.15]) {
      this.plank(g, 'ramp', [x, 9.25, 7.6], [x, 6.65, 9.5], 0.08, 0.5, m());
      this.plank(g, 'ramp', [x, 9.25, 5.6], [x, 5.25, -6.2], 0.08, 0.5, m());
    }
  }

  // 5 · servo + diverter
  private buildServo() {
    const g = this.piece('servo');
    g.add(this.mesh(this.rbox(1.2, 2.2, 2.3, 0.12), plasticMat(COLORS.servo, { roughness: 0.45 }), 'servo', [2, 9.2, 6.8]));
    g.add(this.mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 20), plasticMat(0xffffff), 'servo', [1.25, 9.6, 6.8], [0, 0, Math.PI / 2]));
    this.flap = new THREE.Group();
    this.flap.position.set(0, 9.6, 6.8);
    g.add(this.flap);
    this.flap.add(this.mesh(this.rbox(2, 0.12, 2.2, 0.05), plasticMat(COLORS.flap, { clearcoat: 0.6 }), 'servo'));
    this.flap.rotation.x = 0.55; // servo 0° → tilted toward the front tray
  }

  // 4 · stepper
  private buildStepper() {
    const g = this.piece('stepper');
    g.add(this.mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.9, 56), metalMat(COLORS.steel, 0.38), 'stepper', [0, 9.75, 0]));
    g.add(this.mesh(this.rbox(4.2, 0.12, 0.9, 0.04), metalMat(COLORS.steel, 0.3), 'stepper', [0, 10.7, 0]));
    g.add(this.mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.3, 20), metalMat(COLORS.brass, 0.25), 'stepper', [0.3, 11.3, 0]));
    g.add(this.mesh(this.rbox(1.4, 0.8, 0.9, 0.08), plasticMat(COLORS.servo), 'stepper', [0, 9.2, -1.6]));
  }

  // 3 · base plate
  private buildBase() {
    const g = this.piece('base', [0, 10.9, 0]);
    const s = new THREE.Shape();
    s.moveTo(-10.7, -10.7); s.lineTo(10.7, -10.7); s.lineTo(10.7, 10.7); s.lineTo(-10.7, 10.7); s.lineTo(-10.7, -10.7);
    const hole = new THREE.Path(); hole.absarc(0, -7, 1, 0, Math.PI * 2, true); s.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.4, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2, curveSegments: 40 });
    const m = this.mesh(geo, plasticMat(COLORS.base, { roughness: 0.35 }), 'base');
    m.rotation.x = -Math.PI / 2;
    g.add(m);
    g.add(this.mesh(new THREE.TorusGeometry(1, 0.08, 10, 48), plasticMat(COLORS.flap), 'base', [0, 0.46, 7], [Math.PI / 2, 0, 0]));
    g.add(this.mesh(this.rbox(0.5, 0.3, 0.4, 0.05), plasticMat(0x1e1e1e), 'base', [0, 0.6, 3.3]));
  }

  // 2 · dish
  private buildDish() {
    const g = (this.dish = this.piece('dish', [0, 11.3, 0]));
    const dm = (o: Parameters<typeof plasticMat>[1] = {}) => plasticMat(COLORS.dish, { roughness: 0.3, clearcoat: 0.55, ...o });
    g.add(this.mesh(new THREE.CylinderGeometry(9.9, 9.9, 2.5, 128, 1, true), dm({ side: THREE.DoubleSide }), 'dish', [0, 1.25, 0]));
    g.add(this.mesh(new THREE.CylinderGeometry(9.6, 9.6, 2.5, 128, 1, true), dm({ side: THREE.DoubleSide }), 'dish', [0, 1.25, 0]));
    g.add(this.mesh(new THREE.RingGeometry(9.6, 9.9, 128), dm({ side: THREE.DoubleSide }), 'dish', [0, 2.5, 0], [-Math.PI / 2, 0, 0]));
    g.add(this.mesh(new THREE.CylinderGeometry(3.8, 3.8, 2.5, 64), dm(), 'dish', [0, 1.25, 0]));
    g.add(this.mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.3, 6), metalMat(), 'dish', [0, 2.62, 0]));
    g.add(this.mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.15, 24), metalMat(0xc2473a, 0.4), 'dish', [0, 0.1, 3.4]));
    const wallGeo = this.rbox(0.14, 2.5, 5.8, 0.05);
    for (let i = 0; i < SLOTS; i++) {
      const b = (i + 0.5) * STEP;
      const w = this.mesh(wallGeo, dm(), 'dish', [6.7 * Math.sin(b), 1.25, 6.7 * Math.cos(b)]);
      w.rotation.y = b;
      g.add(w);
    }
    g.add(this.mesh(new THREE.CircleGeometry(0.5, 32), plasticMat(COLORS.teal), 'dish', [0, 2.52, 8.9], [-Math.PI / 2, 0, 0]));
    const pg = new THREE.CapsuleGeometry(0.34, 0.6, 6, 14);
    const pmats = PILL_COLORS.map((c) => pillMat(c));
    for (let i = 1; i < SLOTS; i++) {
      const a = i * STEP, arr: THREE.Mesh[] = [];
      const count = 2 + (i % 3 === 0 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const r = 5.6 + k * 1.15, da = k % 2 ? 0.08 : -0.08;
        const p = this.mesh(pg, pmats[(i - 1) % 4], 'dish', [r * Math.sin(a + da), 0.4, r * Math.cos(a + da)], [0, a + k, Math.PI / 2]);
        g.add(p);
        arr.push(p);
      }
      this.slotPills[i] = arr;
    }
  }

  // 9 · front panel
  private buildFront() {
    const g = this.piece('front');
    g.add(this.mesh(this.rbox(22, 7.8, 0.45, 0.18), shellMat(), 'front', [0, 10.8, 10.9]));
    g.add(this.mesh(this.rbox(6.6, 3.6, 0.22, 0.12), plasticMat(0x172120, { roughness: 0.2, clearcoat: 1 }), 'front', [-4.8, 11.9, 11.15]));
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    this.screenCtx = cv.getContext('2d')!;
    this.screenTex = new THREE.CanvasTexture(cv);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const scr = this.mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }), 'front', [-4.8, 11.9, 11.27]);
    scr.castShadow = false;
    g.add(scr);
    g.add(this.mesh(new THREE.CircleGeometry(1.4, 48), new THREE.MeshStandardMaterial({ map: grilleTexture(), transparent: true, roughness: 0.7 }), 'front', [-4.8, 8.3, 11.14]));
    g.add(this.mesh(new THREE.CylinderGeometry(2.55, 2.65, 0.9, 72), plasticMat(0xfbf8f1, { clearcoat: 1, clearcoatRoughness: 0.1 }), 'front', [4.6, 10.6, 11.45], [Math.PI / 2, 0, 0]));
    g.add(this.mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.12, 72), plasticMat(COLORS.teal, { clearcoat: 1, clearcoatRoughness: 0.12 }), 'front', [4.6, 10.6, 11.92], [Math.PI / 2, 0, 0]));
    this.ring = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.25, toneMapped: false });
    g.add(this.mesh(new THREE.TorusGeometry(2.95, 0.22, 20, 96), this.ring, 'front', [4.6, 10.6, 11.2]));
  }

  // 1 · lid
  private buildLid() {
    const g = this.piece('lid');
    const lid = this.mesh(this.rbox(22, 0.3, 22, 0.12), glassMat(), 'lid', [0, 14.85, 0]);
    lid.castShadow = false;
    lid.userData.isGlass = true;
    g.add(lid);
    g.add(this.mesh(this.rbox(3.2, 0.14, 2.8, 0.06), plasticMat(COLORS.teal, { transparent: true, opacity: 0.6 }), 'lid', [4.2, 15.07, 6.2]));
    g.add(this.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.25, 24), metalMat(), 'lid', [4.2, 15.2, 7.3]));
  }
}

import * as THREE from 'three';

/** Colour palette shared by the 3D model. */
export const COLORS = {
  shell: 0xefe6d6,
  shellEdge: 0xdccfb9,
  teal: 0x0e6a65,
  tealDeep: 0x0a504c,
  dish: 0xe4f1ea,
  base: 0xd3e5dd,
  ramp: 0xc3ddd3,
  servo: 0x2f6fb5,
  flap: 0xe07a2f,
  steel: 0xc9ced0,
  brass: 0xcaa25a,
  bin: 0xe8d6bb,
  battery: 0x2f9a6c,
  rubber: 0x1d2524,
} as const;

/** Pill colours by round: morning, noon, evening, bedtime. */
export const PILL_COLORS = [0xf2c14e, 0xe07a2f, 0x13867f, 0x3a5a8c] as const;

type Opts = Partial<THREE.MeshPhysicalMaterialParameters>;

/** Milky acrylic / matte PLA look for the body. */
export const shellMat = (color: number = COLORS.shell, o: Opts = {}) =>
  new THREE.MeshPhysicalMaterial({
    color, roughness: 0.42, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.35, sheen: 0.25,
    sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.8, ...o,
  });

/** Smooth 3D-printed plastic. */
export const plasticMat = (color: number, o: Opts = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4, ...o });

/** Coated tablets: glossy and slightly soft. */
export const pillMat = (color: number) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) });

/** Brushed metal (motor can, screws, lock). */
export const metalMat = (color: number = COLORS.steel, roughness = 0.32) =>
  new THREE.MeshStandardMaterial({ color, metalness: 0.92, roughness });

/** Clear acrylic: glossy, see-through, no transmission pass (keeps phones fast). */
export const glassMat = () =>
  new THREE.MeshPhysicalMaterial({
    color: 0xe8f7f2, metalness: 0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03,
    transparent: true, opacity: 0.22, depthWrite: false, specularIntensity: 1,
  });

/** Procedural PCB texture: solder mask, copper traces and pads. */
export function pcbTexture(mask: string, trace: string, seed = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 288;
  const x = c.getContext('2d')!;
  x.fillStyle = mask; x.fillRect(0, 0, c.width, c.height);
  let s = seed * 9301;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  x.strokeStyle = trace; x.lineWidth = 3; x.lineCap = 'round'; x.globalAlpha = 0.7;
  for (let i = 0; i < 46; i++) {
    let px = rnd() * c.width, py = rnd() * c.height;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 3; k++) {
      if (rnd() > 0.5) px += (rnd() - 0.5) * 220; else py += (rnd() - 0.5) * 160;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  x.globalAlpha = 1; x.fillStyle = '#d9c27a';
  for (let i = 0; i < 70; i++) { x.beginPath(); x.arc(rnd() * c.width, rnd() * c.height, 4, 0, Math.PI * 2); x.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export const pcbMat = (mask: string, trace: string, seed: number) =>
  new THREE.MeshStandardMaterial({ map: pcbTexture(mask, trace, seed), roughness: 0.45, metalness: 0.1 });

/** Speaker grille texture. */
export function grilleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#2A3634'; x.beginPath(); x.arc(128, 128, 128, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#0B1211';
  for (let y = 18; y < 256; y += 24) for (let px = 18; px < 256; px += 24) {
    if (Math.hypot(px - 128, y - 128) < 108) { x.beginPath(); x.arc(px, y, 6.5, 0, Math.PI * 2); x.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** QR-style sticker for the back panel (decorative, not a real code). */
export function qrTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#1E3A37';
  for (let y = 0; y < 16; y++) for (let k = 0; k < 16; k++) if ((k * 7 + y * 13 + k * y) % 5 < 2) x.fillRect(k * 8, y * 8, 8, 8);
  for (const [px, py] of [[0, 0], [96, 0], [0, 96]]) {
    x.fillStyle = '#1E3A37'; x.fillRect(px, py, 32, 32);
    x.fillStyle = '#fff'; x.fillRect(px + 6, py + 6, 20, 20);
    x.fillStyle = '#1E3A37'; x.fillRect(px + 11, py + 11, 10, 10);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

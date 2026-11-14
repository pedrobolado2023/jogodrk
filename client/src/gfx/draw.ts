import Phaser from "phaser";

export type Ctx = CanvasRenderingContext2D;

export const FONT = "Cinzel, Georgia, 'Times New Roman', serif";

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

export function fbm(x: number, y: number, seed = 0, octaves = 3): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** CSS rgba from 0xRRGGBB, with brightness k (<1 darkens, >1 mixes toward white). */
export function col(hex: number, k = 1, a = 1): string {
  let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  if (k <= 1) {
    r *= k; g *= k; b *= k;
  } else {
    const t = Math.min(1, k - 1);
    r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t;
  }
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

export function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (((ar + (br - ar) * t) | 0) << 16) | (((ag + (bg - ag) * t) | 0) << 8) | ((ab + (bb - ab) * t) | 0);
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

/** Create a canvas texture once; returns false if it already existed. */
export function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx, w: number, h: number) => void): boolean {
  if (scene.textures.exists(key)) return false;
  const tex = scene.textures.createCanvas(key, w, h)!;
  draw(tex.getContext(), w, h);
  tex.refresh();
  return true;
}

/** Draw `paint` onto ctx with a dark 1px outline around everything it painted. */
export function outlined(ctx: Ctx, w: number, h: number, paint: (c: Ctx) => void, outline = "rgba(5,4,8,0.9)", width = 1.5): void {
  const [art, actx] = makeCanvas(w, h);
  paint(actx);
  const [sil, sctx] = makeCanvas(w, h);
  sctx.drawImage(art, 0, 0);
  sctx.globalCompositeOperation = "source-in";
  sctx.fillStyle = outline;
  sctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.drawImage(sil, Math.cos(a) * width, Math.sin(a) * width);
  }
  ctx.drawImage(art, 0, 0);
}

/** White silhouette of an existing texture, used for hit flashes (Canvas renderer has no tint). */
export function silhouetteTex(scene: Phaser.Scene, srcKey: string, key: string, color = "#ffffff"): void {
  if (scene.textures.exists(key)) return;
  const src = scene.textures.get(srcKey).getSourceImage() as HTMLCanvasElement;
  canvasTex(scene, key, src.width, src.height, (ctx) => {
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, src.width, src.height);
  });
}

export function radial(ctx: Ctx, x: number, y: number, r: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

export function linear(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

export function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function poly(ctx: Ctx, pts: number[], fill: string | CanvasGradient, stroke?: string, lw = 1): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

export function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Soft glow dot, used for eyes, orbs and magic cores. */
export function glowDot(ctx: Ctx, x: number, y: number, r: number, hex: number): void {
  ctx.fillStyle = radial(ctx, x, y, r * 3, [[0, col(hex, 1.3, 0.9)], [0.35, col(hex, 1, 0.45)], [1, col(hex, 1, 0)]]);
  ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  ellipse(ctx, x, y, r, r, col(hex, 1.6));
}

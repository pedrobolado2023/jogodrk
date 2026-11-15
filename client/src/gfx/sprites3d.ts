/**
 * Pre-rendered 3D characters (art-source/render_units.py): one sheet per animation, 8 rows of screen
 * directions clockwise from east, one column per frame. Units without a sheet keep the canvas art.
 *
 * Sheets are big once decoded (~50-120 MB per character), so only the manifest is fetched at login.
 * Each character's sheets are loaded the first time a unit of it appears (`requestSheet`) and freed
 * when it is no longer on screen after a map change (`releaseSheet`).
 */
import Phaser from "phaser";

export interface SheetInfo {
  size: number;
  originY: number;
  scale: number;
  height: number;
  anims: Record<string, { frames: number; fps: number; loop: boolean }>;
  /** render time of the sheet (cache busting) */
  v?: number;
}

export let SHEETS: Record<string, SheetInfo> = {};

const loaded = new Set<string>();
const pending = new Map<string, Promise<boolean>>();
let queue: Promise<unknown> = Promise.resolve();

/** The character's sheets are in memory and its animations exist. */
export const hasSheet = (key: string): boolean => loaded.has(key);
/** The manifest has a 3D version of this character (it may still need loading). */
export const knowsSheet = (key: string): boolean => !!SHEETS[key];
export const loadedSheets = (): string[] => [...loaded];
export const animKey = (key: string, anim: string, dir: number): string => `${key}:${anim}:${dir}`;

/** Screen direction (y down) → row index 0..7, clockwise from east. */
export function dirIndex(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx);
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

/** Fetches the manifest only; the sheets themselves load on demand. */
export async function loadSheets(): Promise<void> {
  try {
    const res = await fetch("sprites/manifest.json", { cache: "no-cache" });
    if (res.ok) SHEETS = await res.json();
  } catch {
    SHEETS = {};
  }
}

/** Loads one character's sheets (queued, one character at a time). Resolves true when usable. */
export function requestSheet(scene: Phaser.Scene, key: string): Promise<boolean> {
  if (loaded.has(key)) return Promise.resolve(true);
  if (!SHEETS[key]) return Promise.resolve(false);
  let p = pending.get(key);
  if (!p) {
    p = queue.then(() => loadOne(scene, key)).catch(() => false);
    queue = p;
    pending.set(key, p);
    void p.finally(() => pending.delete(key));
  }
  return p;
}

async function loadOne(scene: Phaser.Scene, key: string): Promise<boolean> {
  if (loaded.has(key)) return true;
  const info = SHEETS[key];
  if (!info || !scene.sys.isActive()) return false;
  const missing = Object.keys(info.anims).filter((a) => !scene.textures.exists(`${key}:${a}`));
  if (missing.length) {
    await new Promise<void>((resolve) => {
      const done = (): void => {
        scene.load.off(Phaser.Loader.Events.COMPLETE, done);
        scene.events.off(Phaser.Scenes.Events.SHUTDOWN, done);
        resolve();
      };
      for (const a of missing) {
        // ?v= (render time) makes a re-rendered sheet a new URL, so the browser never reuses a stale cached image
        scene.load.spritesheet(`${key}:${a}`, `sprites/${key}/${a}.png?v=${info.v ?? 0}`, { frameWidth: info.size, frameHeight: info.size });
      }
      scene.load.once(Phaser.Loader.Events.COMPLETE, done);
      scene.events.once(Phaser.Scenes.Events.SHUTDOWN, done); // never hang the queue
      scene.load.start();
    });
  }
  if (!scene.textures.exists(`${key}:idle`)) return false;
  makeAnims(scene, key, info);
  loaded.add(key);
  return true;
}

function makeAnims(scene: Phaser.Scene, key: string, info: SheetInfo): void {
  for (const [anim, a] of Object.entries(info.anims)) {
    const tex = `${key}:${anim}`;
    if (!scene.textures.exists(tex)) continue;
    for (let r = 0; r < 8; r++) {
      const k = animKey(key, anim, r);
      if (scene.anims.exists(k)) continue;
      scene.anims.create({
        key: k,
        frames: scene.anims.generateFrameNumbers(tex, { start: r * a.frames, end: r * a.frames + a.frames - 1 }),
        frameRate: a.fps,
        repeat: a.loop ? -1 : 0,
      });
    }
  }
}

/** Colour grade of a skin: desaturate by `desat`, multiply by `tint`, scale by `gain` (as art-source's grade()). */
export interface Grade { desat?: number; tint?: [number, number, number]; gain?: number }

/** Sheet key of a character wearing a recolour skin. */
export const skinKey = (base: string, skin: string): string => `${base}~${skin}`;

function gradePixels(px: Uint8ClampedArray, g: Grade): void {
  const d = g.desat ?? 0, [tr, tg, tb] = g.tint ?? [1, 1, 1], k = g.gain ?? 1;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const r = px[i], gg = px[i + 1], b = px[i + 2];
    const lum = r * 0.299 + gg * 0.587 + b * 0.114;
    px[i] = (r + (lum - r) * d) * tr * k;
    px[i + 1] = (gg + (lum - gg) * d) * tg * k;
    px[i + 2] = (b + (lum - b) * d) * tb * k;
  }
}

/** A character recoloured by a skin: its own sheets, graded once on canvases (no extra download). Sheet by sheet,
 *  one per tick, so the game never freezes. Resolves true when `skinKey(base, skin)` is usable like any sheet. */
export function requestGraded(scene: Phaser.Scene, base: string, skin: string, g: Grade): Promise<boolean> {
  const key = skinKey(base, skin);
  if (loaded.has(key)) return Promise.resolve(true);
  const info = SHEETS[base];
  if (!info) return Promise.resolve(false);
  let p = pending.get(key);
  if (!p) {
    SHEETS[key] = info;
    p = requestSheet(scene, base).then(async (ok) => {
      if (!ok || !scene.sys.isActive()) return false;
      for (const anim of Object.keys(info.anims)) {
        const tex = `${key}:${anim}`;
        if (scene.textures.exists(tex) || !scene.textures.exists(`${base}:${anim}`)) continue;
        const src = scene.textures.get(`${base}:${anim}`).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
        const c = document.createElement("canvas");
        c.width = src.width;
        c.height = src.height;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(src, 0, 0);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        gradePixels(img.data, g);
        ctx.putImageData(img, 0, 0);
        scene.textures.addSpriteSheet(tex, c as unknown as HTMLImageElement, { frameWidth: info.size, frameHeight: info.size });
        await new Promise((r) => setTimeout(r, 0));
        if (!scene.sys.isActive()) return false;
      }
      makeAnims(scene, key, info);
      loaded.add(key);
      return true;
    }).catch(() => false);
    pending.set(key, p);
    void p.finally(() => pending.delete(key));
  }
  return p;
}

/** Frees a character's sheets and animations. Only call when no live sprite uses them. */
export function releaseSheet(scene: Phaser.Scene, key: string): void {
  const info = SHEETS[key];
  if (!info || !loaded.has(key)) return;
  loaded.delete(key);
  for (const anim of Object.keys(info.anims)) {
    for (let r = 0; r < 8; r++) scene.anims.remove(animKey(key, anim, r));
    const tex = `${key}:${anim}`;
    if (scene.textures.exists(tex)) scene.textures.remove(tex);
  }
}

/** Round HUD portrait cut from the front-facing idle frame of a 3D unit. Returns the texture key, or null. */
export function portraitFromSheet(scene: Phaser.Scene, key: string): string | null {
  const info = SHEETS[key];
  const tex = `${key}:idle`;
  if (!info || !scene.textures.exists(tex)) return null;
  const out = `portrait3d_${key}`;
  if (scene.textures.exists(out)) return out;
  const frame = scene.textures.getFrame(tex, 2 * info.anims.idle.frames);
  const src = frame.source.image as HTMLImageElement;
  const c = scene.textures.createCanvas(out, 72, 72)!;
  const ctx = c.context;
  ctx.beginPath();
  ctx.arc(36, 36, 34, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createRadialGradient(36, 30, 4, 36, 36, 40);
  g.addColorStop(0, "#2a2238");
  g.addColorStop(1, "#0b0910");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 72, 72);
  // the head sits near the top of the body: crop a square around the upper body
  const footY = info.originY * info.size;
  const hPx = info.height * (44 / info.scale); // body height in frame pixels (frame px per meter = 44 / scale)
  const side = hPx * 0.62;
  const sx = frame.cutX + info.size / 2 - side / 2;
  const sy = frame.cutY + footY - hPx * 1.02;
  ctx.drawImage(src, sx, sy, side, side, 0, 2, 72, 72);
  c.refresh();
  return out;
}

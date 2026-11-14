import Phaser from "phaser";
import {
  canvasTex, col, ellipse, glowDot, linear, outlined, poly, radial, rng, rrect, silhouetteTex, type Ctx,
} from "./draw";
import {
  drawArenaMaster, drawBladeMaster, drawDeathKnight, drawElder, drawHealer, drawRanger, drawSkeleton, drawSorcerer,
} from "./characters";
import { makeThemeProps } from "./themeProps";

/** Unit textures are painted at this multiple of their display size, for crisper detail when zoomed. */
export const UNIT_RES = 2;

/** Feet anchor (origin) for each unit texture: [originX, originY]. */
export const UNIT_ORIGIN: Record<string, [number, number]> = {};

export const PROP_KEYS = {
  oak: ["tree_oak_0", "tree_oak_1", "tree_oak_2"],
  pine: ["tree_pine_0", "tree_pine_1"],
  dead: ["tree_dead_0", "tree_dead_1"],
  rock: ["rock_0", "rock_1", "rock_2"],
  /** the same rocks without moss, for the lava, blood, ruin and void lands */
  rockBare: ["rock_bare_0", "rock_bare_1", "rock_bare_2"],
  bush: ["bush_0", "bush_1"],
  grave: ["grave_0", "grave_1"],
  stump: ["stump_0"],
  mushroom: ["mushroom_0"],
  tuft: ["tuft_0", "tuft_1", "tuft_2"],
  bones: ["bones_0"],
  flowers: ["flowers_0", "flowers_1"],
  pebbles: ["pebbles_0"],
};

export const GLOW_COLORS: Record<string, number> = {
  white: 0xffffff, gold: 0xffc857, orange: 0xff7a1a, red: 0xe0203a, blood: 0x9a0f1c,
  cyan: 0x5fd8ff, blue: 0x3d6bff, ice: 0xbfefff, green: 0x7dff8a, teal: 0x3fffd0,
  purple: 0xb05cff, warm: 0xffb36b, firefly: 0xd8ff7a, soul: 0x9fe8ff,
};

export function ensureTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists("__gfx_ready")) return;
  makeFx(scene);
  makeUnits(scene);
  makeProps(scene);
  makeUi(scene);
  makeCamp(scene);
  makeThemeProps(scene);
  canvasTex(scene, "__gfx_ready", 1, 1, () => undefined);
}

// ── Units ────────────────────────────────────────────────────────────────

/** Current walk pose while painting a unit: 0 = idle, ±1 = opposite steps. */
let P = 0;

/** Suffixes of the walk-cycle textures generated for every unit. */
export const WALK_FRAMES = ["_w1", "_w2"];

/** Moonlight from the upper left, shadow toward the lower right, over everything already painted. */
function shadeVolume(c: Ctx, w: number, h: number): void {
  c.save();
  c.globalCompositeOperation = "source-atop";
  c.fillStyle = linear(c, 0, 0, w, h, [[0, "rgba(255,244,226,0.22)"], [0.42, "rgba(255,255,255,0)"], [1, "rgba(0,0,18,0.38)"]]);
  c.fillRect(0, 0, w, h);
  c.restore();
}

function unit(scene: Phaser.Scene, key: string, w: number, h: number, footY: number, paint: (c: Ctx, pose: number) => void): void {
  const W = w * UNIT_RES, H = h * UNIT_RES;
  for (const [suffix, pose] of [["", 0], ["_w1", 1], ["_w2", -1]] as [string, number][]) {
    P = pose;
    canvasTex(scene, key + suffix, W, H, (ctx) => outlined(ctx, W, H, (c) => {
      c.scale(UNIT_RES, UNIT_RES);
      paint(c, pose);
      shadeVolume(c, w, h);
    }, "rgba(5,4,8,0.92)", 2.4));
    silhouetteTex(scene, key + suffix, `${key}${suffix}_flash`);
    UNIT_ORIGIN[key + suffix] = [0.5, footY / h];
  }
  P = 0;
}

function makeUnits(scene: Phaser.Scene): void {
  unit(scene, "unit_blade_master", 80, 100, 94, drawBladeMaster);
  unit(scene, "unit_grand_sorcerer", 80, 100, 94, drawSorcerer);
  unit(scene, "unit_night_ranger", 80, 100, 94, drawRanger);
  unit(scene, "npc_elder", 76, 100, 94, drawElder);
  unit(scene, "npc_healer", 76, 100, 94, drawHealer);
  unit(scene, "npc_warrior", 84, 100, 94, drawArenaMaster);
  unit(scene, "mob_wolf", 84, 60, 54, drawWolf);
  unit(scene, "mob_goblin", 60, 66, 62, drawGoblin);
  unit(scene, "mob_treant", 110, 132, 126, drawTreant);
  unit(scene, "mob_skeleton", 64, 92, 87, drawSkeleton);
  unit(scene, "mob_death_knight", 124, 150, 144, drawDeathKnight);
  unit(scene, "mob_generic", 60, 66, 62, drawGoblin);

  for (const cls of ["blade_master", "grand_sorcerer", "night_ranger"]) {
    canvasTex(scene, `portrait_${cls}`, 72, 72, (ctx) => {
      const src = scene.textures.get(`unit_${cls}`).getSourceImage() as HTMLCanvasElement;
      ctx.beginPath();
      ctx.arc(36, 36, 34, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = radial(ctx, 36, 30, 40, [[0, "#2a2238"], [1, "#0b0910"]]);
      ctx.fillRect(0, 0, 72, 72);
      ctx.drawImage(src, 0, 8 * UNIT_RES, 80 * UNIT_RES, 60 * UNIT_RES, -22, 0, 120, 90);
    });
  }
}

function legs(ctx: Ctx, x: number, y: number, h: number, fill: string | CanvasGradient, boot: string, gap = 8, w = 7): void {
  [x - gap / 2 - w / 2, x + gap / 2 - w / 2].forEach((lx0, i) => {
    const s = i === 0 ? P : -P;
    const lift = Math.max(0, s) * 3.5;
    const lx = lx0 + s * 2;
    ctx.fillStyle = fill;
    rrect(ctx, lx, y, w, h - lift, 2);
    ctx.fill();
    ctx.fillStyle = boot;
    rrect(ctx, lx - 1, y + h - lift - 8, w + 2, 9, 2);
    ctx.fill();
  });
}

function drawWolf(ctx: Ctx): void {
  const fur = (_x0: number, _x1: number) => linear(ctx, 0, 14, 0, 44, [[0, "#6b6e78"], [0.5, "#3a3c44"], [1, "#16171c"]]);
  // tail
  ctx.beginPath(); ctx.moveTo(22, 28); ctx.quadraticCurveTo(6, 22, 4, 10); ctx.quadraticCurveTo(12, 18, 24, 24); ctx.closePath();
  ctx.fillStyle = fur(4, 24); ctx.fill();
  // far legs
  ctx.fillStyle = "#1c1d22";
  rrect(ctx, 25 - P * 3, 34, 5, 19 - Math.max(0, -P) * 3, 2); ctx.fill();
  rrect(ctx, 52 + P * 3, 34, 5, 19 - Math.max(0, P) * 3, 2); ctx.fill();
  // body
  ellipse(ctx, 40, 31, 21, 11, fur(19, 61));
  // back spikes
  ctx.fillStyle = "#2a2b31";
  for (let i = 0; i < 8; i++) poly(ctx, [24 + i * 4.5, 23 + Math.abs(i - 4) * 0.6, 26 + i * 4.5, 15 + Math.abs(i - 3.5), 29 + i * 4.5, 23], "#2a2b31");
  // near legs
  ctx.fillStyle = linear(ctx, 0, 34, 0, 54, [[0, "#4a4c55"], [1, "#1a1b20"]]);
  rrect(ctx, 30 + P * 3, 35, 6, 19 - Math.max(0, P) * 3, 2.5); ctx.fill();
  rrect(ctx, 57 - P * 3, 35, 6, 19 - Math.max(0, -P) * 3, 2.5); ctx.fill();
  // neck + head
  poly(ctx, [54, 22, 62, 16, 72, 20, 82, 27, 80, 31, 70, 34, 60, 38, 54, 34], linear(ctx, 54, 16, 70, 38, [[0, "#777a85"], [1, "#2b2c33"]]));
  poly(ctx, [62, 17, 63, 6, 68, 16], "#3a3c44");
  poly(ctx, [67, 17, 70, 7, 72, 18], "#55575f");
  poly(ctx, [70, 31, 80, 31, 76, 35, 70, 34], "#1a1a1e");
  ctx.fillStyle = "#f0ece0";
  for (let i = 0; i < 3; i++) poly(ctx, [72 + i * 2.5, 31, 73 + i * 2.5, 33.5, 74 + i * 2.5, 31], "#f0ece0");
  ellipse(ctx, 81, 28, 1.6, 1.4, "#08080a");
  glowDot(ctx, 70, 22.5, 1.3, 0xff2a2a);
}

function drawGoblin(ctx: Ctx): void {
  const skin = linear(ctx, 12, 0, 46, 0, [[0, "#8fb050"], [0.5, "#5d7d2c"], [1, "#2e4214"]]);
  legs(ctx, 30, 46, 15, "#4d6a22", "#2a1d10", 8, 6);
  ellipse(ctx, 30, 40, 12, 11, skin);
  poly(ctx, [18, 44, 42, 44, 40, 53, 34, 50, 30, 54, 25, 50, 20, 53], "#5a3a1e");
  // arms
  ctx.fillStyle = "#6a8c34"; rrect(ctx, 14, 34, 5.5, 15, 2.5); ctx.fill();
  ctx.fillStyle = "#4a6620"; rrect(ctx, 41, 34, 5.5, 13, 2.5); ctx.fill();
  // dagger
  poly(ctx, [45, 44, 56, 30, 58, 32, 47, 46], linear(ctx, 45, 44, 58, 30, [[0, "#8a6a4a"], [1, "#c9b9a0"]]));
  ctx.fillStyle = "#3a2614"; ctx.fillRect(42, 44, 6, 3);
  // ears
  poly(ctx, [21, 22, 4, 13, 20, 28], skin);
  poly(ctx, [39, 22, 56, 13, 40, 28], skin);
  // head
  ellipse(ctx, 30, 24, 11, 10, radial(ctx, 26, 19, 14, [[0, "#a6c85e"], [0.6, "#5d7d2c"], [1, "#2e4214"]]));
  glowDot(ctx, 25.5, 23, 1.3, 0xffd23a);
  glowDot(ctx, 34.5, 23, 1.3, 0xffd23a);
  poly(ctx, [24, 29, 36, 29, 33, 32, 27, 32], "#1a1208");
  ctx.fillStyle = "#efe6c8"; poly(ctx, [26, 29, 27, 31, 28, 29], "#efe6c8"); poly(ctx, [32, 29, 33, 31, 34, 29], "#efe6c8");
}

function drawTreant(ctx: Ctx): void {
  const cx = 55;
  const bark = linear(ctx, cx - 22, 0, cx + 22, 0, [[0, "#6e5238"], [0.5, "#3e2c1c"], [1, "#1a120a"]]);
  // roots
  poly(ctx, [cx - 18, 100, cx - 30 - P * 4, 126 - Math.max(0, P) * 3, cx - 12 - P * 4, 120 - Math.max(0, P) * 3, cx - 6, 104], bark);
  poly(ctx, [cx + 6, 104, cx + 12 + P * 4, 120 - Math.max(0, -P) * 3, cx + 32 + P * 4, 126 - Math.max(0, -P) * 3, cx + 18, 100], bark);
  // trunk
  ctx.beginPath(); ctx.moveTo(cx - 16, 36); ctx.quadraticCurveTo(cx - 24, 80, cx - 18, 108); ctx.lineTo(cx + 18, 108); ctx.quadraticCurveTo(cx + 24, 80, cx + 16, 36); ctx.closePath();
  ctx.fillStyle = bark; ctx.fill();
  ctx.strokeStyle = "rgba(15,9,4,0.7)"; ctx.lineWidth = 1.5;
  const r = rng(7);
  for (let i = 0; i < 7; i++) {
    const x = cx - 14 + i * 4.5;
    ctx.beginPath(); ctx.moveTo(x, 44 + r() * 10);
    ctx.bezierCurveTo(x + r() * 6 - 3, 64, x + r() * 6 - 3, 84, x + r() * 4 - 2, 104); ctx.stroke();
  }
  // arms
  ctx.lineCap = "round";
  for (const s of [-1, 1]) {
    ctx.strokeStyle = "#4a3624"; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(cx + s * 14, 50); ctx.quadraticCurveTo(cx + s * 34, 56, cx + s * 42, 80); ctx.stroke();
    ctx.lineWidth = 3;
    for (const [dx, dy] of [[4, 10], [-2, 12], [8, 6]]) {
      ctx.beginPath(); ctx.moveTo(cx + s * 42, 80); ctx.lineTo(cx + s * (42 + dx), 80 + dy); ctx.stroke();
    }
  }
  // moss
  ellipse(ctx, cx - 12, 44, 8, 4, "rgba(80,120,50,0.9)");
  ellipse(ctx, cx + 13, 46, 7, 3.5, "rgba(70,110,45,0.9)");
  // face
  ellipse(ctx, cx - 7, 58, 4.5, 6, "#0a0604");
  ellipse(ctx, cx + 7, 58, 4.5, 6, "#0a0604");
  glowDot(ctx, cx - 7, 58, 1.8, 0x7dff8a);
  glowDot(ctx, cx + 7, 58, 1.8, 0x7dff8a);
  poly(ctx, [cx - 8, 72, cx - 4, 70, cx, 74, cx + 4, 70, cx + 8, 72, cx + 5, 78, cx - 5, 78], "#0a0604");
  // crown
  const cr = rng(11);
  for (let i = 0; i < 16; i++) {
    const a = cr() * Math.PI * 2, d = cr() * 22;
    const x = cx + Math.cos(a) * d * 1.4, y = 22 + Math.sin(a) * d * 0.7;
    const rr = 9 + cr() * 8;
    ellipse(ctx, x, y, rr, rr * 0.85, radial(ctx, x - 4, y - 5, rr * 1.4, [[0, "#3f6a35"], [0.6, "#1f3a1e"], [1, "#0d1a0e"]]));
  }
  for (let i = 0; i < 5; i++) ellipse(ctx, cx - 18 + i * 9, 12 + (i % 2) * 6, 3, 2.5, "rgba(170,90,40,0.8)");
}

// ── Props ────────────────────────────────────────────────────────────────

function makeProps(scene: Phaser.Scene): void {
  PROP_KEYS.oak.forEach((k, i) => canvasTex(scene, k, 130, 160, (ctx, w, h) => outlined(ctx, w, h, (c) => drawOak(c, i), "rgba(4,6,4,0.85)", 1.2)));
  PROP_KEYS.pine.forEach((k, i) => canvasTex(scene, k, 96, 176, (ctx, w, h) => outlined(ctx, w, h, (c) => drawPine(c, i), "rgba(4,6,4,0.85)", 1.2)));
  PROP_KEYS.dead.forEach((k, i) => canvasTex(scene, k, 120, 150, (ctx, w, h) => outlined(ctx, w, h, (c) => drawDeadTree(c, i), "rgba(4,4,4,0.85)", 1.2)));
  PROP_KEYS.rock.forEach((k, i) => canvasTex(scene, k, 60, 44, (ctx, w, h) => outlined(ctx, w, h, (c) => drawRock(c, i))));
  PROP_KEYS.rockBare.forEach((k, i) => canvasTex(scene, k, 60, 44, (ctx, w, h) => outlined(ctx, w, h, (c) => drawRock(c, i, false))));
  PROP_KEYS.bush.forEach((k, i) => canvasTex(scene, k, 58, 40, (ctx, w, h) => outlined(ctx, w, h, (c) => drawBush(c, i), "rgba(4,6,4,0.8)", 1.2)));
  PROP_KEYS.grave.forEach((k, i) => canvasTex(scene, k, 40, 54, (ctx, w, h) => outlined(ctx, w, h, (c) => drawGrave(c, i))));
  canvasTex(scene, "stump_0", 44, 34, (ctx, w, h) => outlined(ctx, w, h, drawStump));
  canvasTex(scene, "mushroom_0", 40, 34, drawMushrooms);
  PROP_KEYS.tuft.forEach((k, i) => canvasTex(scene, k, 32, 22, (ctx) => drawTuft(ctx, i)));
  canvasTex(scene, "bones_0", 40, 20, drawBones);
  PROP_KEYS.flowers.forEach((k, i) => canvasTex(scene, k, 28, 16, (ctx) => drawFlowers(ctx, i)));
  canvasTex(scene, "pebbles_0", 30, 14, drawPebbles);
}

/** Prop texture anchor: [originX, originY] in normalized coordinates. */
export function propOrigin(key: string): [number, number] {
  if (key.startsWith("tree_oak")) return [0.5, 156 / 160];
  if (key.startsWith("tree_pine")) return [0.5, 172 / 176];
  if (key.startsWith("tree_dead")) return [0.5, 146 / 150];
  if (key.startsWith("rock")) return [0.5, 0.82];
  if (key.startsWith("bush")) return [0.5, 0.85];
  if (key.startsWith("grave")) return [0.5, 0.9];
  if (key.startsWith("stump")) return [0.5, 0.8];
  if (key.startsWith("mushroom")) return [0.5, 0.85];
  return [0.5, 0.5];
}

function drawTrunk(c: Ctx, x: number, base: number, top: number, w0: number, w1: number): void {
  c.beginPath();
  c.moveTo(x - w0 - 6, base); c.quadraticCurveTo(x - w0, base - 6, x - w1, top);
  c.lineTo(x + w1, top); c.quadraticCurveTo(x + w0, base - 6, x + w0 + 6, base);
  c.closePath();
  c.fillStyle = linear(c, x - w0, 0, x + w0, 0, [[0, "#5a4632"], [0.5, "#33261a"], [1, "#150f09"]]);
  c.fill();
}

function drawOak(c: Ctx, v: number): void {
  const r = rng(100 + v);
  drawTrunk(c, 65, 156, 78, 9, 6);
  c.strokeStyle = "#2c2016"; c.lineWidth = 4; c.lineCap = "round";
  c.beginPath(); c.moveTo(65, 96); c.quadraticCurveTo(48, 86, 40, 72); c.stroke();
  c.beginPath(); c.moveTo(66, 92); c.quadraticCurveTo(82, 84, 90, 70); c.stroke();
  const blobs: [number, number, number][] = [];
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 34;
    blobs.push([65 + Math.cos(a) * d * 1.3, 58 + Math.sin(a) * d * 0.8, 14 + r() * 12]);
  }
  blobs.sort((a, b) => a[1] - b[1]);
  const hue = [[0x1b3b28, 0x2f6040, 0x0c1d13], [0x23392a, 0x3d6a43, 0x0f1e14], [0x2a3624, 0x4c6a3a, 0x121a0e]][v % 3];
  for (const [x, y, rr] of blobs) ellipse(c, x, y + 4, rr, rr * 0.9, col(hue[2]));
  for (const [x, y, rr] of blobs) ellipse(c, x, y, rr * 0.92, rr * 0.82, radial(c, x - rr * 0.35, y - rr * 0.45, rr * 1.2, [[0, col(hue[1])], [0.55, col(hue[0])], [1, col(hue[2])]]));
  for (let i = 0; i < 26; i++) {
    const x = 30 + r() * 70, y = 26 + r() * 50;
    ellipse(c, x, y, 2 + r() * 2.5, 1.5 + r() * 1.5, col(hue[1], 1.15, 0.35));
  }
}

function drawPine(c: Ctx, v: number): void {
  const r = rng(200 + v);
  drawTrunk(c, 48, 172, 140, 6, 4);
  const tiers = 5;
  for (let t = 0; t < tiers; t++) {
    const yb = 150 - t * 26, yt = yb - 46, hw = 40 - t * 7;
    const pts: number[] = [48, yt];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const x = 48 + hw - (2 * hw * i) / n;
      pts.push(x, yb + (i % 2 ? -5 : 2) + r() * 2);
    }
    poly(c, pts, linear(c, 48 - hw, 0, 48 + hw, 0, [[0, "#2c5a4a"], [0.45, "#173a2f"], [1, "#081812"]]));
    c.strokeStyle = "rgba(90,140,120,0.35)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(48, yt + 2); c.lineTo(48 - hw + 4, yb - 2); c.stroke();
  }
}

function drawDeadTree(c: Ctx, v: number): void {
  const r = rng(300 + v);
  c.lineCap = "round";
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    c.strokeStyle = depth > 2 ? "#3b3430" : "#5c524a";
    c.lineWidth = w;
    c.beginPath(); c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(a + 0.4) * len * 0.5, y + Math.sin(a + 0.4) * len * 0.5, x2, y2); c.stroke();
    if (depth <= 0) return;
    const n = 2 + (r() > 0.6 ? 1 : 0);
    for (let i = 0; i < n; i++) branch(x2, y2, a + (r() - 0.5) * 1.3, len * (0.55 + r() * 0.2), w * 0.62, depth - 1);
  };
  drawTrunk(c, 60, 146, 96, 7, 4);
  branch(60, 98, -Math.PI / 2 + (r() - 0.5) * 0.3, 34, 6, 4);
}

function drawRock(c: Ctx, v: number, moss = true): void {
  const r = rng(400 + v);
  const pts: number[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = 0.75 + r() * 0.3;
    pts.push(30 + Math.cos(a) * 24 * rad, 26 + Math.sin(a) * 14 * rad - (Math.sin(a) < 0 ? 6 : 0));
  }
  poly(c, pts, linear(c, 8, 8, 52, 40, [[0, "#9a9a9e"], [0.5, "#5a5a62"], [1, "#25252b"]]));
  poly(c, [16, 22, 28, 12, 40, 16, 30, 24], "rgba(220,220,230,0.18)");
  if (moss) for (let i = 0; i < 4; i++) ellipse(c, 16 + r() * 26, 14 + r() * 8, 3 + r() * 4, 1.5 + r() * 2, "rgba(70,110,55,0.75)");
  else for (let i = 0; i < 3; i++) ellipse(c, 16 + r() * 26, 16 + r() * 10, 2 + r() * 3, 1 + r() * 1.5, "rgba(10,10,14,0.45)");  // cracks
}

function drawBush(c: Ctx, v: number): void {
  const r = rng(500 + v);
  for (let i = 0; i < 9; i++) {
    const x = 12 + r() * 34, y = 16 + r() * 12, rr = 7 + r() * 6;
    ellipse(c, x, y, rr, rr * 0.8, radial(c, x - 3, y - 4, rr * 1.3, [[0, "#3c6438"], [0.6, "#1d3a1f"], [1, "#0b170c"]]));
  }
  if (v === 1) for (let i = 0; i < 5; i++) ellipse(c, 14 + r() * 30, 14 + r() * 12, 1.6, 1.6, "#a3243a");
}

function drawGrave(c: Ctx, v: number): void {
  c.save();
  c.translate(20, 48); c.rotate(v ? 0.08 : -0.05);
  const g = linear(c, -12, 0, 12, 0, [[0, "#8d8d96"], [1, "#3a3a42"]]);
  if (v === 0) {
    c.beginPath(); c.moveTo(-11, 0); c.lineTo(-11, -30); c.arc(0, -30, 11, Math.PI, 0); c.lineTo(11, 0); c.closePath();
    c.fillStyle = g; c.fill();
    c.strokeStyle = "rgba(20,20,26,0.8)"; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -34); c.lineTo(0, -18); c.moveTo(-5, -28); c.lineTo(5, -28); c.stroke();
    c.beginPath(); c.moveTo(6, -40); c.lineTo(2, -32); c.lineTo(5, -26); c.stroke();
  } else {
    c.fillStyle = g;
    c.fillRect(-3.5, -44, 7, 44); c.fillRect(-12, -34, 24, 7);
  }
  ellipse(c, -4, -2, 9, 3, "rgba(70,110,55,0.8)");
  c.restore();
}

function drawStump(c: Ctx): void {
  poly(c, [6, 16, 38, 16, 40, 28, 4, 28], linear(c, 4, 0, 40, 0, [[0, "#5a4632"], [1, "#1c140c"]]));
  ellipse(c, 22, 16, 16, 6, "#8a6c4a");
  c.strokeStyle = "rgba(60,40,20,0.8)"; c.lineWidth = 1;
  for (const rr of [4, 8, 12]) { c.beginPath(); c.ellipse(22, 16, rr, rr * 0.38, 0, 0, Math.PI * 2); c.stroke(); }
}

function drawMushrooms(c: Ctx): void {
  const caps: [number, number, number, number][] = [[12, 22, 7, 0x3fffd0], [25, 26, 5, 0xb05cff], [30, 18, 6, 0x3fffd0]];
  for (const [x, y, rr, hue] of caps) {
    c.fillStyle = radial(c, x, y - 2, rr * 3, [[0, col(hue, 1, 0.35)], [1, col(hue, 1, 0)]]);
    c.fillRect(x - rr * 3, y - rr * 3, rr * 6, rr * 6);
  }
  for (const [x, y, rr, hue] of caps) {
    c.fillStyle = "#d8d2c0"; c.fillRect(x - 1.5, y - 1, 3, rr + 4);
    c.beginPath(); c.ellipse(x, y - 1, rr, rr * 0.6, 0, Math.PI, 0); c.closePath();
    c.fillStyle = radial(c, x - 2, y - 4, rr * 1.4, [[0, col(hue, 1.5)], [0.6, col(hue)], [1, col(hue, 0.4)]]); c.fill();
  }
}

function drawTuft(c: Ctx, v: number): void {
  const r = rng(600 + v);
  c.lineCap = "round";
  for (let i = 0; i < 9; i++) {
    const x = 6 + r() * 20, h = 8 + r() * 12, lean = (r() - 0.5) * 8;
    c.strokeStyle = r() > 0.5 ? "rgba(70,105,55,0.95)" : "rgba(40,70,38,0.95)";
    c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(x, 21); c.quadraticCurveTo(x + lean * 0.3, 21 - h * 0.6, x + lean, 21 - h); c.stroke();
  }
}

function drawBones(c: Ctx): void {
  ellipse(c, 12, 10, 6, 5, "#cfc8b4");
  ellipse(c, 10, 9.5, 1.4, 1.4, "#1a1814"); ellipse(c, 14, 9.5, 1.4, 1.4, "#1a1814");
  c.strokeStyle = "#bfb8a4"; c.lineWidth = 2.2; c.lineCap = "round";
  c.beginPath(); c.moveTo(20, 14); c.lineTo(36, 8); c.moveTo(22, 6); c.lineTo(34, 16); c.stroke();
}

function drawFlowers(c: Ctx, v: number): void {
  const r = rng(700 + v);
  const hue = v ? 0x9f7bd6 : 0xd6d0e8;
  for (let i = 0; i < 6; i++) {
    const x = 4 + r() * 20, y = 4 + r() * 8;
    c.strokeStyle = "rgba(50,80,40,0.9)"; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 4); c.stroke();
    ellipse(c, x, y, 1.6, 1.4, col(hue));
  }
}

function drawPebbles(c: Ctx): void {
  const r = rng(800);
  for (let i = 0; i < 6; i++) ellipse(c, 4 + r() * 22, 4 + r() * 6, 1.5 + r() * 2.5, 1 + r() * 1.5, col(0x6a6a70, 0.8 + r() * 0.5));
}

// ── Camp ─────────────────────────────────────────────────────────────────

export const CAMP_ORIGIN: Record<string, [number, number]> = {
  tent: [0.5, 0.92], crate: [0.5, 0.86], barrel: [0.5, 0.92], logseat: [0.5, 0.7], banner: [0.5, 0.97],
};

function makeCamp(scene: Phaser.Scene): void {
  canvasTex(scene, "tent", 124, 96, (ctx, w, h) => outlined(ctx, w, h, (c) => {
    poly(c, [58, 14, 96, 4, 120, 70, 96, 88], linear(c, 58, 0, 120, 0, [[0, "#6a5a44"], [1, "#2e261c"]]));
    poly(c, [10, 88, 58, 14, 96, 88], linear(c, 10, 0, 96, 0, [[0, "#b29a72"], [0.6, "#8a7452"], [1, "#5a4a34"]]));
    poly(c, [44, 88, 58, 46, 72, 88], "#120d09");
    poly(c, [58, 46, 72, 88, 66, 88, 60, 56], "rgba(255,170,90,0.18)");
    c.strokeStyle = "rgba(40,30,20,0.6)"; c.lineWidth = 1;
    for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(58 - i * 10, 14 + i * 18.5); c.lineTo(58 + i * 9.5, 14 + i * 18.5); c.stroke(); }
    c.strokeStyle = "#3a2a18"; c.lineWidth = 2.5; c.beginPath(); c.moveTo(58, 14); c.lineTo(58, 6); c.stroke();
    c.strokeStyle = "rgba(200,180,140,0.6)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(58, 14); c.lineTo(2, 92); c.moveTo(96, 4); c.lineTo(122, 30); c.stroke();
  }));
  canvasTex(scene, "crate", 40, 40, (ctx, w, h) => outlined(ctx, w, h, (c) => {
    poly(c, [20, 6, 36, 13, 20, 20, 4, 13], "#a0784a");
    poly(c, [4, 13, 20, 20, 20, 36, 4, 29], "#6a4a2a");
    poly(c, [20, 20, 36, 13, 36, 29, 20, 36], "#4a3220");
    c.strokeStyle = "rgba(30,18,8,0.8)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(4, 21); c.lineTo(20, 28); c.lineTo(36, 21); c.moveTo(4, 13); c.lineTo(20, 36); c.moveTo(36, 13); c.lineTo(20, 36); c.stroke();
  }));
  canvasTex(scene, "barrel", 30, 40, (ctx, w, h) => outlined(ctx, w, h, (c) => {
    c.beginPath(); c.moveTo(4, 8); c.quadraticCurveTo(1, 21, 4, 34); c.lineTo(26, 34); c.quadraticCurveTo(29, 21, 26, 8); c.closePath();
    c.fillStyle = linear(c, 2, 0, 28, 0, [[0, "#8a5a32"], [0.5, "#6a4222"], [1, "#2e1c0e"]]); c.fill();
    for (const y of [12, 30]) { c.fillStyle = "#3a3a42"; c.fillRect(2, y, 26, 2.5); }
    ellipse(c, 15, 8, 11, 4, "#4a3018");
    ellipse(c, 15, 8, 8, 2.6, "#2a1a0c");
  }));
  canvasTex(scene, "logseat", 56, 26, (ctx, w, h) => outlined(ctx, w, h, (c) => {
    c.save(); c.translate(28, 13); c.rotate(-0.25);
    c.fillStyle = linear(c, 0, -7, 0, 7, [[0, "#7a5a3a"], [1, "#2e1e10"]]); rrect(c, -24, -7, 48, 14, 6); c.fill();
    ellipse(c, 22, 0, 4, 6.5, "#a8865a");
    c.strokeStyle = "rgba(60,40,20,0.8)"; c.beginPath(); c.ellipse(22, 0, 2, 3.5, 0, 0, Math.PI * 2); c.stroke();
    c.restore();
  }));
  canvasTex(scene, "banner", 40, 96, (ctx, w, h) => outlined(ctx, w, h, (c) => {
    c.fillStyle = "#3a2614"; c.fillRect(8, 6, 4, 88);
    ellipse(c, 10, 6, 3.5, 3.5, "#c9a04a");
    c.beginPath(); c.moveTo(12, 12); c.lineTo(36, 14); c.lineTo(34, 58); c.lineTo(24, 50); c.lineTo(13, 58); c.closePath();
    c.fillStyle = linear(c, 12, 0, 36, 0, [[0, "#8e1622"], [1, "#4a0a10"]]); c.fill();
    c.strokeStyle = "#c9a04a"; c.lineWidth = 1.2; c.stroke();
    poly(c, [24, 22, 29, 30, 24, 40, 19, 30], "#e3b95a");
  }));
}

// ── Effects ──────────────────────────────────────────────────────────────

function makeFx(scene: Phaser.Scene): void {
  canvasTex(scene, "light_mask", 256, 256, (c) => {
    c.fillStyle = radial(c, 128, 128, 128, [[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,0.85)"], [0.7, "rgba(255,255,255,0.3)"], [1, "rgba(255,255,255,0)"]]);
    c.fillRect(0, 0, 256, 256);
  });
  if (canvasTex(scene, "leaves", 30, 8, (c) => {
    const cols = ["#8a5a24", "#a8682a", "#4f6a2a"];
    cols.forEach((hex, i) => {
      ellipse(c, i * 10 + 5, 4, 4, 2.4, hex, 0.4);
      c.strokeStyle = "rgba(30,20,10,0.6)"; c.beginPath(); c.moveTo(i * 10 + 1.5, 5.5); c.lineTo(i * 10 + 8.5, 2.5); c.stroke();
    });
  })) {
    const t = scene.textures.get("leaves");
    for (let i = 0; i < 3; i++) t.add(i, 0, i * 10, 0, 10, 8);
  }
  canvasTex(scene, "shadow", 64, 32, (c) => {
    c.save(); c.scale(1, 0.5);
    c.fillStyle = radial(c, 32, 32, 32, [[0, "rgba(0,0,0,0.6)"], [0.6, "rgba(0,0,0,0.35)"], [1, "rgba(0,0,0,0)"]]);
    c.fillRect(0, 0, 64, 64); c.restore();
  });
  for (const [name, hex] of Object.entries(GLOW_COLORS)) {
    canvasTex(scene, `glow_${name}`, 64, 64, (c) => {
      c.fillStyle = radial(c, 32, 32, 32, [[0, col(hex, 1.2, 0.9)], [0.25, col(hex, 1, 0.5)], [1, col(hex, 1, 0)]]);
      c.fillRect(0, 0, 64, 64);
    });
    canvasTex(scene, `spark_${name}`, 16, 16, (c) => {
      c.fillStyle = radial(c, 8, 8, 8, [[0, "rgba(255,255,255,1)"], [0.3, col(hex, 1, 0.9)], [1, col(hex, 1, 0)]]);
      c.fillRect(0, 0, 16, 16);
    });
  }
  canvasTex(scene, "light_ray", 120, 360, (c) => {
    // a slanted beam: bright at the top, fading out toward the ground and the edges
    c.save();
    c.translate(60, 0);
    c.transform(1, 0, -0.32, 1, 0, 0);
    const g = c.createLinearGradient(0, 0, 0, 360);
    g.addColorStop(0, "rgba(200,220,255,0.55)");
    g.addColorStop(0.7, "rgba(170,200,255,0.18)");
    g.addColorStop(1, "rgba(170,200,255,0)");
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(-14, 0); c.lineTo(14, 0); c.lineTo(46, 360); c.lineTo(-46, 360);
    c.closePath();
    c.fill();
    c.restore();
  });
  canvasTex(scene, "smoke", 64, 64, (c) => {
    const r = rng(9);
    for (let i = 0; i < 6; i++) {
      const x = 20 + r() * 24, y = 20 + r() * 24;
      c.fillStyle = radial(c, x, y, 20, [[0, "rgba(60,55,65,0.45)"], [1, "rgba(60,55,65,0)"]]);
      c.fillRect(0, 0, 64, 64);
    }
  });
  canvasTex(scene, "fog", 256, 128, (c) => {
    const r = rng(21);
    for (let i = 0; i < 9; i++) {
      const x = 50 + r() * 156, y = 40 + r() * 48, rr = 40 + r() * 40;
      c.fillStyle = radial(c, x, y, rr, [[0, "rgba(170,180,210,0.35)"], [1, "rgba(170,180,210,0)"]]);
      c.fillRect(0, 0, 256, 128);
    }
  });
  canvasTex(scene, "slash_arc", 128, 128, (c) => {
    c.lineCap = "round";
    const steps = 28, a0 = -2.6, span = 3.4;
    for (let i = 0; i < steps; i++) {
      const t = i / steps, s = Math.sin(Math.PI * t);
      c.strokeStyle = `rgba(255,${200 + 55 * s | 0},${120 + 120 * s | 0},${0.95 * s})`;
      c.lineWidth = 2 + 11 * s * t;
      c.beginPath(); c.arc(64, 64, 48, a0 + span * t, a0 + span * (t + 1 / steps) + 0.02); c.stroke();
    }
  });
  for (const [name, hex] of Object.entries(GLOW_COLORS)) {
    canvasTex(scene, `ring_${name}`, 128, 128, (c) => {
      c.strokeStyle = col(hex, 1, 0.3); c.lineWidth = 12; c.beginPath(); c.arc(64, 64, 54, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = col(hex, 1.3, 0.95); c.lineWidth = 3; c.beginPath(); c.arc(64, 64, 54, 0, Math.PI * 2); c.stroke();
    });
  }
  const runeRing = (key: string, hex: number) => canvasTex(scene, key, 128, 128, (c) => {
    c.strokeStyle = col(hex, 1, 0.9); c.lineWidth = 2.5;
    c.beginPath(); c.arc(64, 64, 56, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1.2; c.beginPath(); c.arc(64, 64, 46, 0, Math.PI * 2); c.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.save(); c.translate(64 + Math.cos(a) * 51, 64 + Math.sin(a) * 51); c.rotate(a);
      c.fillStyle = col(hex, 1.2, 0.95);
      if (i % 3 === 0) c.fillRect(-1.5, -4, 3, 8); else c.fillRect(-1, -2, 2, 4);
      c.restore();
    }
    c.fillStyle = radial(c, 64, 64, 60, [[0.6, col(hex, 1, 0)], [0.9, col(hex, 1, 0.25)], [1, col(hex, 1, 0)]]);
    c.fillRect(0, 0, 128, 128);
  });
  runeRing("target_ring", 0xe0203a);
  runeRing("move_ring", 0xffc857);
  runeRing("aura_ring", 0xb0162a);
  canvasTex(scene, "fireball", 48, 48, (c) => {
    c.fillStyle = radial(c, 24, 24, 24, [[0, "rgba(255,255,220,1)"], [0.25, "rgba(255,200,80,1)"], [0.55, "rgba(255,90,20,0.7)"], [1, "rgba(200,30,0,0)"]]);
    c.fillRect(0, 0, 48, 48);
  });
  canvasTex(scene, "arrow", 44, 10, (c) => {
    c.fillStyle = radial(c, 22, 5, 22, [[0, "rgba(125,255,138,0.45)"], [1, "rgba(125,255,138,0)"]]); c.fillRect(0, 0, 44, 10);
    c.fillStyle = "#c8b48a"; c.fillRect(6, 4, 30, 2);
    poly(c, [36, 1.5, 43, 5, 36, 8.5], "#e8f0e8");
    poly(c, [2, 2, 9, 4, 9, 6, 2, 8], "#a33a2a");
  });
  canvasTex(scene, "bubble", 112, 112, (c) => {
    c.fillStyle = radial(c, 56, 56, 54, [[0, "rgba(80,140,255,0.05)"], [0.75, "rgba(90,160,255,0.18)"], [0.95, "rgba(140,200,255,0.75)"], [1, "rgba(140,200,255,0)"]]);
    c.fillRect(0, 0, 112, 112);
    ellipse(c, 40, 34, 12, 6, "rgba(255,255,255,0.25)", -0.6);
  });
  canvasTex(scene, "eye_glyph", 56, 32, (c) => {
    c.fillStyle = radial(c, 28, 16, 28, [[0, "rgba(255,200,87,0.5)"], [1, "rgba(255,200,87,0)"]]); c.fillRect(0, 0, 56, 32);
    c.strokeStyle = "#ffd77a"; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(6, 16); c.quadraticCurveTo(28, 0, 50, 16); c.quadraticCurveTo(28, 32, 6, 16); c.stroke();
    ellipse(c, 28, 16, 6, 6, "#ffd77a"); ellipse(c, 28, 16, 2.5, 2.5, "#3a2200");
  });
  canvasTex(scene, "scorch", 96, 48, (c) => {
    c.save(); c.scale(1, 0.5);
    c.fillStyle = radial(c, 48, 48, 48, [[0, "rgba(10,5,2,0.8)"], [0.6, "rgba(30,12,4,0.5)"], [1, "rgba(30,12,4,0)"]]);
    c.fillRect(0, 0, 96, 96); c.restore();
  });
  canvasTex(scene, "ice_shard", 12, 26, (c) => {
    poly(c, [6, 0, 11, 13, 6, 26, 1, 13], linear(c, 0, 0, 12, 0, [[0, "#ffffff"], [1, "#6fc6ff"]]));
  });
  canvasTex(scene, "streak", 64, 16, (c) => {
    c.fillStyle = linear(c, 0, 0, 64, 0, [[0, "rgba(255,240,180,0)"], [1, "rgba(255,240,180,0.9)"]]);
    c.beginPath(); c.moveTo(0, 8); c.lineTo(64, 2); c.lineTo(64, 14); c.closePath(); c.fill();
  });
}

// ── UI ───────────────────────────────────────────────────────────────────

function panel(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  rrect(c, x, y, w, h, r);
  c.fillStyle = linear(c, 0, y, 0, y + h, [[0, "rgba(28,24,36,0.94)"], [1, "rgba(10,8,14,0.94)"]]);
  c.fill();
  c.strokeStyle = "#6b5226"; c.lineWidth = 2; c.stroke();
  rrect(c, x + 3, y + 3, w - 6, h - 6, Math.max(1, r - 2));
  c.strokeStyle = "rgba(214,170,90,0.35)"; c.lineWidth = 1; c.stroke();
}

function makeUi(scene: Phaser.Scene): void {
  const bar = (key: string, top: number, mid: number, bot: number) => canvasTex(scene, key, 220, 16, (c) => {
    c.fillStyle = linear(c, 0, 0, 0, 16, [[0, col(top)], [0.45, col(mid)], [1, col(bot)]]);
    c.fillRect(0, 0, 220, 16);
    c.fillStyle = "rgba(255,255,255,0.22)"; c.fillRect(0, 2, 220, 3);
    for (let x = 0; x < 220; x += 22) { c.fillStyle = "rgba(0,0,0,0.18)"; c.fillRect(x, 0, 1, 16); }
  });
  bar("bar_hp", 0xff5a5a, 0xb3141f, 0x4a0409);
  bar("bar_mp", 0x6aa8ff, 0x1f4fc4, 0x0a1a4a);
  bar("bar_trail", 0xffe2a0, 0xd9a040, 0x6a4010);
  bar("bar_enemy", 0xff7a3a, 0xa8261a, 0x400806);

  canvasTex(scene, "hud_player_frame", 300, 92, (c) => {
    panel(c, 46, 14, 248, 66, 8);
    c.beginPath(); c.arc(46, 46, 40, 0, Math.PI * 2);
    c.fillStyle = "#0b0910"; c.fill();
    c.strokeStyle = linear(c, 6, 6, 86, 86, [[0, "#f3d48a"], [0.5, "#8a6420"], [1, "#f3d48a"]]);
    c.lineWidth = 4; c.stroke();
    c.strokeStyle = "rgba(0,0,0,0.8)"; c.lineWidth = 1.5; c.beginPath(); c.arc(46, 46, 36, 0, Math.PI * 2); c.stroke();
  });
  canvasTex(scene, "hud_target_frame", 260, 56, (c) => panel(c, 2, 2, 256, 52, 8));
  canvasTex(scene, "hud_slot", 60, 60, (c) => {
    rrect(c, 2, 2, 56, 56, 7);
    c.fillStyle = "#0b0910"; c.fill();
    c.strokeStyle = linear(c, 0, 0, 60, 60, [[0, "#f3d48a"], [0.5, "#6b5226"], [1, "#c9a04a"]]);
    c.lineWidth = 2.5; c.stroke();
  });
  canvasTex(scene, "hud_skillbar", 300, 84, (c) => {
    panel(c, 4, 10, 292, 70, 12);
    poly(c, [150, 0, 162, 10, 150, 18, 138, 10], "#c9a04a", "#3a2a10", 1);
  });
  canvasTex(scene, "hud_minimap", 156, 156, (c) => {
    c.beginPath(); c.arc(78, 78, 72, 0, Math.PI * 2);
    c.fillStyle = "rgba(10,14,12,0.85)"; c.fill();
    c.strokeStyle = linear(c, 0, 0, 156, 156, [[0, "#f3d48a"], [0.5, "#6b5226"], [1, "#c9a04a"]]);
    c.lineWidth = 4; c.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
      poly(c, [78 + Math.cos(a) * 80, 78 + Math.sin(a) * 80, 78 + Math.cos(a + 0.12) * 70, 78 + Math.sin(a + 0.12) * 70, 78 + Math.cos(a - 0.12) * 70, 78 + Math.sin(a - 0.12) * 70], "#c9a04a");
    }
  });
  canvasTex(scene, "hud_button", 200, 44, (c) => {
    rrect(c, 2, 2, 196, 40, 6);
    c.fillStyle = linear(c, 0, 0, 0, 44, [[0, "#3a2a14"], [1, "#160e06"]]); c.fill();
    c.strokeStyle = "#c9a04a"; c.lineWidth = 2; c.stroke();
    c.fillStyle = "rgba(255,230,170,0.12)"; c.fillRect(6, 5, 188, 12);
  });
  canvasTex(scene, "vignette", 512, 512, (c) => {
    c.fillStyle = radial(c, 256, 256, 362, [[0, "rgba(0,0,0,0)"], [0.5, "rgba(0,0,0,0)"], [0.8, "rgba(2,2,6,0.55)"], [1, "rgba(2,2,6,0.92)"]]);
    c.fillRect(0, 0, 512, 512);
  });
  canvasTex(scene, "vignette_red", 512, 512, (c) => {
    c.fillStyle = radial(c, 256, 256, 362, [[0, "rgba(150,0,10,0)"], [0.55, "rgba(150,0,10,0)"], [1, "rgba(170,0,12,0.85)"]]);
    c.fillRect(0, 0, 512, 512);
  });
  canvasTex(scene, "card", 220, 300, (c) => {
    panel(c, 4, 4, 212, 292, 12);
    c.fillStyle = radial(c, 110, 120, 110, [[0, "rgba(90,60,120,0.25)"], [1, "rgba(0,0,0,0)"]]);
    c.fillRect(0, 0, 220, 300);
  });
  canvasTex(scene, "card_glow", 260, 340, (c) => {
    rrect(c, 20, 20, 220, 300, 14);
    c.shadowColor = "rgba(255,200,87,0.9)"; c.shadowBlur = 22;
    c.strokeStyle = "rgba(255,210,120,0.95)"; c.lineWidth = 3; c.stroke();
  });
  canvasTex(scene, "login_bg", 1280, 720, drawLoginBg);
}

function drawLoginBg(c: Ctx, w: number, h: number): void {
  c.fillStyle = linear(c, 0, 0, 0, h, [[0, "#0a0b18"], [0.55, "#151226"], [1, "#050407"]]);
  c.fillRect(0, 0, w, h);
  const r = rng(77);
  for (let i = 0; i < 160; i++) {
    c.fillStyle = `rgba(220,225,255,${0.2 + r() * 0.6})`;
    c.fillRect(r() * w, r() * h * 0.55, r() > 0.9 ? 2 : 1, r() > 0.9 ? 2 : 1);
  }
  c.fillStyle = radial(c, w * 0.72, h * 0.22, 220, [[0, "rgba(220,225,255,0.35)"], [0.2, "rgba(160,170,230,0.15)"], [1, "rgba(0,0,0,0)"]]);
  c.fillRect(0, 0, w, h);
  ellipse(c, w * 0.72, h * 0.22, 46, 46, radial(c, w * 0.72 - 12, h * 0.22 - 12, 60, [[0, "#f4f1e6"], [1, "#9a98b8"]]));
  const ridge = (baseY: number, amp: number, color: string, seed: number, step: number) => {
    const rr = rng(seed);
    c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x <= w; x += step) {
      const tree = rr() > 0.35;
      const y = baseY + Math.sin(x * 0.004 + seed) * amp;
      if (tree) {
        const th = 30 + rr() * 60;
        c.lineTo(x, y); c.lineTo(x + step / 2, y - th); c.lineTo(x + step, y);
      } else c.lineTo(x + step, y);
    }
    c.lineTo(w, h); c.closePath(); c.fillStyle = color; c.fill();
  };
  ridge(h * 0.62, 26, "#14121f", 3, 22);
  c.fillStyle = linear(c, 0, h * 0.55, 0, h * 0.8, [[0, "rgba(120,110,160,0)"], [0.5, "rgba(120,110,160,0.12)"], [1, "rgba(120,110,160,0)"]]);
  c.fillRect(0, 0, w, h);
  ridge(h * 0.74, 20, "#0c0a12", 8, 30);
  ridge(h * 0.88, 14, "#060508", 13, 40);
}

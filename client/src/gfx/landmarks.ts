/**
 * Art of the hidden places (server/discovery.py): small shrines with a glowing rune and one giant landmark per region
 * (the dead mother tree, the skull gate, the great crystal, the sunken tower, the frozen waterfall, the stone dragon,
 * the bleeding heart, the broken clock tower and the floating monolith). Painted on canvas the first time a map needs
 * them, like every other prop.
 */
import Phaser from "phaser";
import { canvasTex, col, ellipse, glowDot, linear, outlined, poly, radial, rng, rrect, type Ctx } from "./draw";
import { GLOW_COLORS } from "./textures";

/** Feet anchor of each look (originX, originY). */
export const PLACE_ORIGIN: Record<string, [number, number]> = {
  shrine: [0.5, 0.9], lm_forest: [0.5, 0.95], lm_crypt: [0.5, 0.93], lm_mine: [0.5, 0.92], lm_swamp: [0.5, 0.9],
  lm_frost: [0.5, 0.9], lm_ash: [0.5, 0.86], lm_crimson: [0.5, 0.92], lm_ghost: [0.5, 0.95], lm_void: [0.5, 0.97],
};
/** Landmarks that hover and bob instead of standing on the ground. */
export const FLOATING = new Set(["lm_void"]);

const SIZE: Record<string, [number, number]> = {
  lm_forest: [400, 430], lm_crypt: [300, 280], lm_mine: [250, 330], lm_swamp: [250, 380], lm_frost: [360, 330],
  lm_ash: [430, 270], lm_crimson: [250, 340], lm_ghost: [240, 410], lm_void: [200, 360],
};

const PAINT: Record<string, (c: Ctx, w: number, h: number) => void> = {
  lm_forest: motherTree,
  lm_crypt: skullGate,
  lm_mine: (c, w, h) => crystals(c, w, h, ["#e8ffff", "#5fd8ff", "#1a4a7a"], 0x5fd8ff, "#4a4a52"),
  lm_crimson: (c, w, h) => crystals(c, w, h, ["#ffd0d0", "#e0203a", "#4a0610"], 0xe0203a, "#3a2428"),
  lm_swamp: (c, w, h) => tower(c, w, h, "swamp"),
  lm_ghost: (c, w, h) => tower(c, w, h, "ghost"),
  lm_frost: frozenFalls,
  lm_ash: stoneDragon,
  lm_void: monolith,
};

/** The texture key for a place's look (creating it the first time), or "" when the look draws nothing. */
export function placeTexture(scene: Phaser.Scene, look: string, glow: string): string {
  if (!look) return "";
  if (look === "shrine") {
    const key = `shrine_${glow}`;
    canvasTex(scene, key, 70, 96, (ctx) => outlined(ctx, 70, 96, (c) => shrine(c, GLOW_COLORS[glow] ?? GLOW_COLORS.gold), "rgba(6,5,8,0.88)", 1.3));
    return key;
  }
  const paint = PAINT[look];
  if (!paint) return look; // an ordinary prop (statue, coffin, well...) already made by textures.ts / themeProps.ts
  const [w, h] = SIZE[look];
  canvasTex(scene, look, w, h, (ctx) => outlined(ctx, w, h, (c) => paint(c, w, h), "rgba(6,5,8,0.9)", 1.6));
  return look;
}

/** The floating star over a place not found yet. */
export function ensurePlaceMark(scene: Phaser.Scene): void {
  canvasTex(scene, "mark_place", 40, 40, (c) => {
    c.fillStyle = radial(c, 20, 20, 20, [[0, "rgba(255,226,140,0.75)"], [0.5, "rgba(255,200,90,0.25)"], [1, "rgba(255,200,90,0)"]]);
    c.fillRect(0, 0, 40, 40);
    const star = (r1: number, r2: number, fill: string) => {
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? r2 : r1;
        c.lineTo(20 + Math.cos(a) * r, 20 + Math.sin(a) * r);
      }
      c.closePath(); c.fillStyle = fill; c.fill();
    };
    star(15, 4.5, "#3a2400");
    star(13, 3.5, "#ffd23c");
    star(6, 2, "#fff6c8");
  });
}

// ── shrine ─────────────────────────────────────────────────────────────

function shrine(c: Ctx, glow: number): void {
  // two stone steps (isometric) and a standing stone with a carved rune
  poly(c, [6, 78, 35, 64, 64, 78, 35, 92], "#5a5660");
  poly(c, [6, 78, 35, 92, 35, 96, 6, 82], "#3a3640"); poly(c, [35, 92, 64, 78, 64, 82, 35, 96], "#26232b");
  poly(c, [14, 74, 35, 64, 56, 74, 35, 84], "#6e6a74");
  const stone = linear(c, 22, 0, 48, 0, [[0, "#9a96a0"], [0.55, "#6a6670"], [1, "#3a3640"]]);
  c.beginPath(); c.moveTo(23, 76); c.lineTo(22, 26); c.quadraticCurveTo(35, 10, 48, 26); c.lineTo(47, 76); c.closePath();
  c.fillStyle = stone; c.fill();
  c.strokeStyle = "rgba(30,28,36,0.6)"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(41, 30); c.lineTo(44, 44); c.moveTo(27, 60); c.lineTo(30, 70); c.stroke();
  // the rune
  c.fillStyle = radial(c, 35, 46, 22, [[0, col(glow, 1.2, 0.55)], [1, col(glow, 1, 0)]]);
  c.fillRect(13, 24, 44, 44);
  c.strokeStyle = col(glow, 1.5); c.lineWidth = 2.2; c.lineCap = "round";
  c.beginPath(); c.moveTo(35, 32); c.lineTo(35, 60); c.moveTo(28, 40); c.lineTo(42, 52); c.moveTo(42, 40); c.lineTo(28, 52); c.stroke();
  c.lineCap = "butt";
  // candles and moss
  for (const [x, y] of [[13, 77], [57, 77]]) {
    c.fillStyle = "#d8ceb0"; c.fillRect(x - 2, y - 9, 4, 9);
    glowDot(c, x, y - 11, 1.6, 0xffb36b);
  }
  ellipse(c, 30, 75, 8, 2.5, "rgba(70,110,55,0.55)");
}

// ── the dead mother tree (forest) ──────────────────────────────────────

function motherTree(c: Ctx, w: number, h: number): void {
  const r = rng(11);
  const bx = w / 2, by = h - 22;
  c.lineCap = "round";
  // roots spreading over the ground
  for (let i = -4; i <= 4; i++) {
    if (i === 0) continue;
    c.strokeStyle = i < 0 ? "#3a2c20" : "#22180f";
    c.lineWidth = 15 - Math.abs(i) * 2;
    c.beginPath();
    c.moveTo(bx + i * 7, by - 34);
    c.quadraticCurveTo(bx + i * 22, by - 10, bx + i * 36 + (r() - 0.5) * 14, by + 6 - Math.abs(i) * 2);
    c.stroke();
  }
  // branches (behind the trunk's top)
  const tips: [number, number][] = [];
  const bark = (x: number) => linear(c, x - 20, 0, x + 20, 0, [[0, "#4a3a2c"], [1, "#1a120c"]]);
  const branch = (x: number, y: number, a: number, len: number, lw: number, depth: number) => {
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    const bend = (r() - 0.5) * len * 0.35;
    c.strokeStyle = bark(x); c.lineWidth = lw;
    c.beginPath(); c.moveTo(x, y);
    c.quadraticCurveTo((x + ex) / 2 + Math.cos(a + Math.PI / 2) * bend, (y + ey) / 2 + Math.sin(a + Math.PI / 2) * bend, ex, ey);
    c.stroke();
    if (depth <= 0) { tips.push([ex, ey]); return; }
    const n = depth > 2 ? 2 : 2 + (r() < 0.4 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const spread = (k / Math.max(1, n - 1) - 0.5) * (0.9 + r() * 0.4);
      branch(ex, ey, a + spread + (r() - 0.5) * 0.2, len * (0.66 + r() * 0.1), lw * 0.62, depth - 1);
    }
  };
  const top = by - 175;
  branch(bx - 6, top + 10, -Math.PI / 2 - 0.55, 78, 20, 4);
  branch(bx + 6, top + 6, -Math.PI / 2 + 0.5, 80, 20, 4);
  branch(bx, top, -Math.PI / 2 + 0.05, 70, 18, 4);
  branch(bx - 12, top + 60, -Math.PI - 0.25, 62, 13, 3);
  branch(bx + 12, top + 52, -0.15, 60, 13, 3);
  // the trunk
  c.beginPath();
  c.moveTo(bx - 40, by);
  c.bezierCurveTo(bx - 26, by - 50, bx - 30, by - 120, bx - 20, top);
  c.lineTo(bx + 18, top);
  c.bezierCurveTo(bx + 28, by - 120, bx + 24, by - 50, bx + 42, by);
  c.closePath();
  c.fillStyle = linear(c, bx - 40, 0, bx + 42, 0, [[0, "#5e4c3a"], [0.45, "#3a2c20"], [1, "#160f0a"]]);
  c.fill();
  c.strokeStyle = "rgba(15,10,6,0.55)"; c.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    const x = bx - 28 + i * 7 + (r() - 0.5) * 4;
    c.beginPath(); c.moveTo(x, by - 6); c.quadraticCurveTo(x + (r() - 0.5) * 10, by - 90, x * 0.85 + bx * 0.15, top + 10); c.stroke();
  }
  // the glowing hollow
  ellipse(c, bx + 4, by - 78, 11, 19, "#0a0806");
  glowDot(c, bx + 4, by - 76, 3, 0x7dff8a);
  // hanging moss from the branch tips
  c.lineWidth = 1.6;
  for (const [x, y] of tips) {
    if (r() < 0.45) continue;
    c.strokeStyle = "rgba(90,120,60,0.7)";
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 3, y + 14, x - 1, y + 18 + r() * 22); c.stroke();
  }
  c.lineCap = "butt";
}

// ── the skull gate (crypt) ─────────────────────────────────────────────

function skullGate(c: Ctx, w: number, h: number): void {
  const cx = w / 2, by = h - 18;
  // platform
  poly(c, [20, by - 20, cx, by - 58, w - 20, by - 20, cx, by + 14], "#3a3842");
  poly(c, [20, by - 20, cx, by + 14, cx, by + 18, 20, by - 16], "#24222a");
  poly(c, [cx, by + 14, w - 20, by - 20, w - 20, by - 16, cx, by + 18], "#16151a");
  // the dark doorway
  c.fillStyle = radial(c, cx, by - 70, 80, [[0, "rgba(90,30,120,0.85)"], [0.5, "#120a18"], [1, "#050308"]]);
  rrect(c, cx - 58, by - 150, 116, 130, 10); c.fill();
  // pillars
  const stone = (x: number) => linear(c, x, 0, x + 46, 0, [[0, "#8a8692"], [0.5, "#5a5662"], [1, "#2a2830"]]);
  for (const x of [cx - 104, cx + 58]) {
    c.fillStyle = stone(x); c.fillRect(x, by - 168, 46, 150);
    c.fillStyle = "#6a6672"; c.fillRect(x - 6, by - 30, 58, 12); c.fillRect(x - 6, by - 172, 58, 10);
    c.strokeStyle = "rgba(20,18,24,0.6)"; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x + 12, by - 140); c.lineTo(x + 20, by - 110); c.lineTo(x + 14, by - 90); c.stroke();
  }
  // the skull on top
  const bone = linear(c, cx - 90, 0, cx + 90, 0, [[0, "#d8d0c0"], [0.55, "#a49c8c"], [1, "#5a544a"]]);
  ellipse(c, cx, by - 210, 92, 64, bone);
  poly(c, [cx - 70, by - 190, cx + 70, by - 190, cx + 52, by - 150, cx - 52, by - 150], bone);
  for (const s of [-1, 1]) {
    ellipse(c, cx + s * 36, by - 205, 22, 18, "#0a060c");
    glowDot(c, cx + s * 36, by - 203, 5, 0xb05cff);
  }
  poly(c, [cx, by - 188, cx - 9, by - 170, cx + 9, by - 170], "#140c16");
  c.fillStyle = "#e8e0d0";
  for (let i = -4; i <= 4; i++) { rrect(c, cx + i * 11 - 4, by - 162, 8, 14, 2); c.fill(); }
  c.strokeStyle = "rgba(40,30,30,0.6)"; c.lineWidth = 2;
  c.beginPath(); c.moveTo(cx - 20, by - 268); c.lineTo(cx - 8, by - 244); c.lineTo(cx - 16, by - 230); c.stroke();
}

// ── crystal clusters (mine, crimson abyss) ─────────────────────────────

function crystals(c: Ctx, w: number, h: number, [hi, mid, lo]: [string, string, string], glow: number, rock: string): void {
  const cx = w / 2, by = h - 26;
  // rubble at the foot
  ellipse(c, cx, by + 4, 104, 26, rock);
  for (const [x, y, rx] of [[-80, 0, 22], [70, 4, 26], [-30, 12, 18], [40, -6, 20]]) ellipse(c, cx + x, by + y, rx, rx * 0.55, linear(c, 0, by - 10, 0, by + 14, [[0, "#6a6670"], [1, "#2a2830"]]));
  c.fillStyle = radial(c, cx, by - 120, 150, [[0, col(glow, 1.2, 0.45)], [1, col(glow, 1, 0)]]);
  c.fillRect(0, 0, w, h);
  // prisms: x offset, height, width, lean
  const prisms: [number, number, number, number][] = [
    [-62, 120, 30, -0.35], [58, 140, 32, 0.3], [-28, 200, 40, -0.12], [30, 175, 36, 0.14], [0, 270, 52, 0.02], [-82, 70, 22, -0.6], [84, 80, 24, 0.55],
  ];
  for (const [ox, ph, pw, lean] of prisms) {
    const x = cx + ox, tx = x + lean * ph;
    const g = linear(c, x - pw / 2, 0, x + pw / 2, 0, [[0, hi], [0.45, mid], [1, lo]]);
    poly(c, [x - pw / 2, by, x + pw / 2, by, tx + pw / 2, by - ph, tx, by - ph - pw * 0.9, tx - pw / 2, by - ph], g);
    c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x - pw * 0.15, by - 6); c.lineTo(tx - pw * 0.15, by - ph); c.lineTo(tx, by - ph - pw * 0.9); c.stroke();
  }
  glowDot(c, cx, by - 150, 9, glow);
}

// ── towers (sunken tower in the swamp, broken clock tower of Eldmoor) ──

function tower(c: Ctx, w: number, h: number, kind: "swamp" | "ghost"): void {
  const cx = w / 2, by = h - 34;
  if (kind === "swamp") {
    c.save();
    c.translate(cx, by); c.rotate(0.13); c.translate(-cx, -by);
    // round body
    c.fillStyle = linear(c, cx - 48, 0, cx + 48, 0, [[0, "#6a6a58"], [0.4, "#4a4a3c"], [1, "#1e1e16"]]);
    c.fillRect(cx - 48, by - 250, 96, 250);
    c.strokeStyle = "rgba(20,20,14,0.5)"; c.lineWidth = 1.2;
    for (let y = by - 240; y < by; y += 18) {
      c.beginPath(); c.moveTo(cx - 48, y); c.lineTo(cx + 48, y); c.stroke();
    }
    ellipse(c, cx - 20, by - 120, 18, 30, "rgba(60,90,40,0.5)");
    // broken roof
    poly(c, [cx - 62, by - 250, cx + 62, by - 250, cx + 20, by - 318, cx + 4, by - 300, cx - 8, by - 330], linear(c, cx - 60, 0, cx + 60, 0, [[0, "#3a4a3a"], [1, "#141c14"]]));
    // the window with light inside
    c.fillStyle = "#0a0c08"; rrect(c, cx - 12, by - 196, 24, 38, 11); c.fill();
    c.fillStyle = radial(c, cx, by - 178, 22, [[0, "rgba(160,255,140,0.95)"], [1, "rgba(80,200,90,0)"]]);
    c.fillRect(cx - 22, by - 200, 44, 44);
    c.fillStyle = "#0a0c08"; rrect(c, cx - 8, by - 90, 16, 26, 7); c.fill();
    c.restore();
    // murky water around the foot, reeds
    ellipse(c, cx, by + 6, 112, 30, linear(c, 0, by - 20, 0, by + 30, [[0, "#3a4a32"], [1, "#16200f"]]));
    c.strokeStyle = "rgba(140,170,120,0.45)"; c.lineWidth = 1.5;
    for (const rx of [70, 92]) { c.beginPath(); c.ellipse(cx, by + 6, rx, rx * 0.26, 0, 0, Math.PI * 2); c.stroke(); }
    c.strokeStyle = "#4a5a2a"; c.lineWidth = 2.5; c.lineCap = "round";
    for (const [x, hh] of [[-96, 34], [-88, 46], [-80, 30], [86, 40], [96, 30]]) {
      c.beginPath(); c.moveTo(cx + x, by + 8); c.quadraticCurveTo(cx + x - 4, by - hh / 2, cx + x + 3, by - hh); c.stroke();
    }
    c.lineCap = "butt";
    return;
  }
  // Eldmoor: square tower, two faces, broken top, the clock stopped
  const s = 46, top = by - 300;
  poly(c, [cx - s, by - 18, cx, by, cx, top + 30, cx - s, top + 12], linear(c, cx - s, 0, cx, 0, [[0, "#9aa49c"], [1, "#6a746c"]]));
  poly(c, [cx, by, cx + s, by - 18, cx + s, top + 4, cx, top + 30], linear(c, cx, 0, cx + s, 0, [[0, "#4a524c"], [1, "#2a302c"]]));
  // jagged broken top
  poly(c, [cx - s, top + 12, cx - 30, top - 26, cx - 16, top + 2, cx - 4, top - 44, cx, top + 30], "#8a948c");
  poly(c, [cx, top + 30, cx + 10, top - 10, cx + 26, top + 10, cx + s, top - 18, cx + s, top + 4], "#3a423c");
  // stones
  c.strokeStyle = "rgba(20,24,22,0.4)"; c.lineWidth = 1;
  for (let y = 26; y < 280; y += 22) {
    c.beginPath(); c.moveTo(cx - s, by - 18 - y); c.lineTo(cx, by - y); c.lineTo(cx + s, by - 18 - y); c.stroke();
  }
  // the clock on the left face
  const kx = cx - s / 2, ky = by - 190;
  ellipse(c, kx, ky, 18, 21, "#e8e0c8");
  ellipse(c, kx, ky, 14, 17, "#c8c0a8");
  c.strokeStyle = "#2a2418"; c.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    c.beginPath(); c.moveTo(kx + Math.cos(a) * 11, ky + Math.sin(a) * 13); c.lineTo(kx + Math.cos(a) * 14, ky + Math.sin(a) * 16.5); c.stroke();
  }
  c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(kx, ky); c.lineTo(kx - 1, ky - 12); c.moveTo(kx, ky); c.lineTo(kx + 8, ky + 4); c.stroke();
  // windows with the souls' light
  for (const [x, y] of [[cx - s / 2, by - 110], [cx + s / 2, by - 140], [cx + s / 2, by - 240]]) {
    c.fillStyle = "#0a0e0c"; rrect(c, x - 7, y - 14, 14, 26, 6); c.fill();
    glowDot(c, x, y, 2.5, 0x9fe8ff);
  }
  // rubble
  for (const [x, y, r] of [[-70, -4, 14], [-56, 8, 10], [62, -2, 12], [76, 8, 9]]) ellipse(c, cx + x, by + y, r, r * 0.6, "#5a625c");
}

// ── the frozen waterfall (frost peaks) ─────────────────────────────────

function frozenFalls(c: Ctx, w: number, h: number): void {
  const r = rng(5);
  const cx = w / 2, by = h - 30;
  // the cliff
  const rock = linear(c, 0, 20, w, 0, [[0, "#7a8494"], [0.5, "#4a5262"], [1, "#22262e"]]);
  poly(c, [6, by, 22, by - 50, 12, by - 96, 30, 150, 24, 120, 60, 70, 110, 40, 150, 52, 200, 30, 250, 48, 300, 70, 336, 130,
    326, 170, 346, by - 90, 334, by - 40, w - 8, by], rock);
  // rock layers and cracks, so the cliff does not read as a box
  c.strokeStyle = "rgba(20,24,32,0.45)"; c.lineWidth = 2;
  for (const [x0, y0, x1, y1] of [[24, 170, 110, 150], [30, 230, 120, 214], [250, 140, 336, 170], [246, 210, 340, 236], [60, 100, 100, 92]]) {
    c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2, y0 + 10, x1, y1); c.stroke();
  }
  poly(c, [276, by, 300, by - 70, 318, by - 20, 330, by], "rgba(255,255,255,0.08)");
  // snow on the top
  poly(c, [24, 120, 60, 70, 110, 40, 150, 52, 200, 30, 250, 48, 300, 70, 336, 130, 300, 92, 250, 66, 200, 50, 150, 70, 110, 58, 60, 90], "#e8f2ff");
  // the frozen fall
  const fx0 = cx - 54, fx1 = cx + 54;
  for (let x = fx0; x < fx1; x += 9) {
    const top = 48 + r() * 14, len = by - top - 12 - r() * 10;
    c.fillStyle = linear(c, x, 0, x + 9, 0, [[0, "#f4fdff"], [0.5, "#a8e4ff"], [1, "#5ab0e0"]]);
    rrect(c, x, top, 9.5, len, 4.5); c.fill();
  }
  c.strokeStyle = "rgba(255,255,255,0.7)"; c.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const x = fx0 + 8 + r() * (fx1 - fx0 - 16);
    c.beginPath(); c.moveTo(x, 60); c.lineTo(x + (r() - 0.5) * 6, by - 30); c.stroke();
  }
  // icicles along the lip
  for (let x = fx0 - 20; x < fx1 + 20; x += 7) {
    const l = 10 + r() * 22;
    poly(c, [x, 52, x + 6, 52, x + 3, 52 + l], "#d8f4ff");
  }
  // the ice pool
  ellipse(c, cx, by, 120, 28, linear(c, 0, by - 28, 0, by + 28, [[0, "#c8ecff"], [1, "#6aa8d0"]]));
  c.strokeStyle = "rgba(60,110,150,0.6)"; c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(cx - 70, by - 4); c.lineTo(cx - 30, by + 8); c.lineTo(cx + 10, by - 6); c.lineTo(cx + 60, by + 10); c.stroke();
  glowDot(c, cx, by - 120, 6, 0xbfefff);
}

// ── the stone dragon (ash lands) ───────────────────────────────────────

function stoneDragon(c: Ctx, w: number, h: number): void {
  const by = h - 38;
  const bone = (x0: number, x1: number) => linear(c, x0, 0, x1, 0, [[0, "#9a9286"], [0.5, "#6a6458"], [1, "#2e2a26"]]);
  c.lineCap = "round";
  // a wing bone sweeping up behind
  c.strokeStyle = bone(30, 200); c.lineWidth = 9;
  c.beginPath(); c.moveTo(150, by - 40); c.quadraticCurveTo(90, by - 190, 30, by - 210); c.stroke();
  c.lineWidth = 4;
  for (const [x, y] of [[60, by - 200], [90, by - 175], [120, by - 130]]) {
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 10, y + 50, x + 30, y + 90); c.stroke();
  }
  // the spine, from the tail (left) to the neck (right)
  const spine: [number, number][] = [];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    spine.push([22 + t * 300, by - 10 - Math.sin(t * Math.PI) * 60 - t * 20]);
  }
  // ribs: arches over the spine
  for (let i = 8; i <= 18; i++) {
    const [x, y] = spine[i];
    const tall = 48 + Math.sin(((i - 8) / 10) * Math.PI) * 44;
    c.strokeStyle = bone(x - 20, x + 20); c.lineWidth = 6;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x - 30, y - tall * 0.2, x - 18, by + 4); c.stroke();
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 26, y - tall * 0.3, x + 20, by + 2); c.stroke();
  }
  for (const [x, y] of spine) ellipse(c, x, y, 8, 6, bone(x - 8, x + 8));
  // the skull, lying on its side
  const sx = 340, sy = by - 46;
  poly(c, [sx - 40, sy - 26, sx + 10, sy - 40, sx + 70, sy - 10, sx + 80, sy + 12, sx + 20, sy + 26, sx - 36, sy + 22], bone(sx - 40, sx + 80));
  poly(c, [sx - 20, sy + 18, sx + 76, sy + 16, sx + 60, sy + 40, sx - 10, sy + 40], bone(sx - 20, sx + 76));
  c.fillStyle = "#e0d8c8";
  for (let i = 0; i < 8; i++) poly(c, [sx - 6 + i * 10, sy + 18, sx + 2 + i * 10, sy + 18, sx - 2 + i * 10, sy + 28], "#d8d0c0");
  // horns
  c.strokeStyle = bone(sx - 70, sx); c.lineWidth = 10;
  c.beginPath(); c.moveTo(sx - 20, sy - 26); c.quadraticCurveTo(sx - 60, sy - 70, sx - 94, sy - 60); c.stroke();
  c.lineWidth = 7;
  c.beginPath(); c.moveTo(sx, sy - 34); c.quadraticCurveTo(sx - 20, sy - 84, sx - 50, sy - 96); c.stroke();
  ellipse(c, sx + 14, sy - 12, 12, 9, "#0e0a08");
  glowDot(c, sx + 14, sy - 11, 3.4, 0xff7a1a);
  c.lineCap = "butt";
  // embers in the ground
  for (const [x, y] of [[120, by + 6], [230, by + 12], [300, by + 4]]) glowDot(c, x, y, 2, 0xff7a1a);
}

// ── the floating monolith (void citadel) ───────────────────────────────

function monolith(c: Ctx, w: number, h: number): void {
  const cx = w / 2, bottom = h - 70, top = 24;
  const stone = linear(c, cx - 40, 0, cx + 40, 0, [[0, "#4a3e5e"], [0.5, "#2a2238"], [1, "#100c18"]]);
  poly(c, [cx - 38, bottom, cx + 38, bottom, cx + 30, top + 40, cx, top, cx - 30, top + 40], stone);
  poly(c, [cx - 38, bottom, cx - 30, top + 40, cx, top, cx - 4, top + 40, cx - 8, bottom], "rgba(255,255,255,0.08)");
  // runes
  c.strokeStyle = "#d090ff"; c.lineWidth = 2.2; c.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const y = top + 70 + i * 34;
    c.beginPath(); c.moveTo(cx - 10, y); c.lineTo(cx + 10, y + 8); c.moveTo(cx, y - 6); c.lineTo(cx, y + 16); c.stroke();
  }
  c.lineCap = "butt";
  c.fillStyle = radial(c, cx, top + 150, 120, [[0, "rgba(176,92,255,0.35)"], [1, "rgba(176,92,255,0)"]]);
  c.fillRect(0, 0, w, h);
  // broken pieces floating under it
  for (const [x, y, s] of [[-36, 26, 12], [30, 38, 9], [-6, 52, 7]]) {
    poly(c, [cx + x - s, bottom + y, cx + x, bottom + y - s, cx + x + s, bottom + y, cx + x, bottom + y + s * 0.7], "#2a2238");
  }
  glowDot(c, cx, top + 120, 5, 0xb05cff);
}

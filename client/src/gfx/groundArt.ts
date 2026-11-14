/**
 * Ground art painted into the map chunks (once per chunk, so it costs nothing while playing):
 *  • groundPattern(kind): a tileable grey texture per ground kind (grass, dirt, stone…), laid over the
 *    tile colours with "soft-light" so it adds grain and light without changing the colour;
 *  • decal textures (fallen leaves, puddles, cracks, moss, embers…) and decalFor(), which picks the
 *    ones that fit each map theme and ground kind.
 */
import Phaser from "phaser";
import { canvasTex, ellipse, rng, type Ctx } from "./draw";

const PATTERN_SIZE = 96;
const patterns = new Map<string, HTMLCanvasElement>();

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  return [cv, cv.getContext("2d")!];
}

const grey = (v: number, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;

/** Draws `paint` 9 times (wrapped) so shapes crossing the border repeat seamlessly. */
function wrapped(c: CanvasRenderingContext2D, s: number, paint: (ox: number, oy: number) => void): void {
  for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) paint(ox, oy);
}

const PAINT: Record<string, (c: CanvasRenderingContext2D, s: number) => void> = {
  grass(c, s) {
    const r = rng(11);
    for (let i = 0; i < 26; i++) {
      const x = r() * s, y = r() * s, rad = 6 + r() * 14, v = 110 + r() * 40;
      wrapped(c, s, (ox, oy) => { c.fillStyle = grey(v, 0.35); c.beginPath(); c.arc(x + ox, y + oy, rad, 0, Math.PI * 2); c.fill(); });
    }
    for (let i = 0; i < 420; i++) {
      const x = r() * s, y = r() * s, len = 2 + r() * 4, v = r() < 0.5 ? 70 + r() * 40 : 170 + r() * 50;
      c.strokeStyle = grey(v, 0.7);
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 2, y - len); c.stroke();
    }
  },
  dirt(c, s) {
    const r = rng(23);
    for (let i = 0; i < 30; i++) {
      const x = r() * s, y = r() * s, rad = 4 + r() * 12, v = 95 + r() * 60;
      wrapped(c, s, (ox, oy) => { c.fillStyle = grey(v, 0.4); c.beginPath(); c.arc(x + ox, y + oy, rad, 0, Math.PI * 2); c.fill(); });
    }
    for (let i = 0; i < 260; i++) { c.fillStyle = grey(r() < 0.6 ? 60 : 200, 0.6); c.fillRect(r() * s, r() * s, 1, 1); }
    for (let i = 0; i < 14; i++) {
      const x = r() * s, y = r() * s, rad = 1 + r() * 2;
      c.fillStyle = grey(190, 0.7); c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill();
      c.fillStyle = grey(60, 0.5); c.beginPath(); c.arc(x + 0.8, y + 0.8, rad, 0, Math.PI * 2); c.fill();
    }
  },
  stone(c, s) {
    const r = rng(37);
    // flagstones: jittered grid cells with dark joints and a light top edge
    const n = 4, cell = s / n;
    for (let gx = 0; gx < n; gx++) {
      for (let gy = 0; gy < n; gy++) {
        const v = 110 + r() * 50;
        const x = gx * cell + 2 + r() * 2, y = gy * cell + 2 + r() * 2, w = cell - 4 - r() * 3, h = cell - 4 - r() * 3;
        c.fillStyle = grey(v, 0.55); c.fillRect(x, y, w, h);
        c.fillStyle = grey(200, 0.35); c.fillRect(x, y, w, 1.5);
        c.fillStyle = grey(50, 0.45); c.fillRect(x, y + h - 1.5, w, 1.5);
      }
    }
    for (let i = 0; i < 200; i++) { c.fillStyle = grey(r() < 0.5 ? 70 : 180, 0.45); c.fillRect(r() * s, r() * s, 1, 1); }
  },
  sand(c, s) {
    const r = rng(41);
    for (let i = 0; i < 900; i++) { c.fillStyle = grey(r() < 0.5 ? 85 : 185, 0.5); c.fillRect(r() * s, r() * s, 1, 1); }
    for (let i = 0; i < 10; i++) {
      const y = r() * s;
      c.strokeStyle = grey(165, 0.35); c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(s * 0.3, y - 4, s * 0.6, y + 4, s, y); c.stroke();
    }
  },
  snow(c, s) {
    const r = rng(53);
    for (let i = 0; i < 22; i++) {
      const x = r() * s, y = r() * s, rad = 8 + r() * 16, v = r() < 0.5 ? 105 : 175;
      wrapped(c, s, (ox, oy) => { c.fillStyle = grey(v, 0.3); c.beginPath(); c.arc(x + ox, y + oy, rad, 0, Math.PI * 2); c.fill(); });
    }
    for (let i = 0; i < 120; i++) { c.fillStyle = grey(230, 0.8); c.fillRect(r() * s, r() * s, 1, 1); }
  },
  ice(c, s) {
    const r = rng(61);
    for (let i = 0; i < 18; i++) {
      const x = r() * s, y = r() * s, len = 10 + r() * 30;
      c.strokeStyle = grey(r() < 0.6 ? 215 : 80, 0.45); c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y + len * 0.3); c.stroke();
    }
  },
  water(c, s) {
    const r = rng(67);
    for (let i = 0; i < 16; i++) {
      const x = r() * s, y = r() * s, w = 6 + r() * 12;
      c.strokeStyle = grey(r() < 0.5 ? 200 : 70, 0.4); c.lineWidth = 1;
      c.beginPath(); c.moveTo(x - w, y); c.quadraticCurveTo(x, y - 2, x + w, y); c.stroke();
    }
  },
};

/** A repeating grey texture for a ground kind, squashed to the isometric plane; null for kinds with none. */
export function groundPattern(c: CanvasRenderingContext2D, kind: string): CanvasPattern | null {
  const paint = PAINT[kind];
  if (!paint) return null;
  let cv = patterns.get(kind);
  if (!cv) {
    const [canvas, pc] = makeCanvas(PATTERN_SIZE, PATTERN_SIZE);
    pc.fillStyle = grey(128);
    pc.fillRect(0, 0, PATTERN_SIZE, PATTERN_SIZE);
    paint(pc, PATTERN_SIZE);
    patterns.set(kind, canvas);
    cv = canvas;
  }
  const pat = c.createPattern(cv, "repeat");
  pat?.setTransform(new DOMMatrix().scale(1, 0.55));
  return pat;
}

// ── decals ─────────────────────────────────────────────────────────────

export const DECALS = {
  leaves: ["decal_leaves_0", "decal_leaves_1", "decal_leaves_2"],
  twigs: ["decal_twigs_0"],
  puddle: ["decal_puddle_0", "decal_puddle_1"],
  moss: ["decal_moss_0", "decal_moss_1"],
  crack: ["decal_crack_0", "decal_crack_1"],
  ember: ["decal_ember_0", "decal_ember_1"],
  blood: ["decal_blood_0", "decal_blood_1"],
  drift: ["decal_drift_0", "decal_drift_1"],
  voidcrack: ["decal_voidcrack_0"],
  ash: ["decal_ash_0"],
  ecto: ["decal_ecto_0"],
};

function crackPath(c: Ctx, r: () => number, x: number, y: number, len: number, depth: number): void {
  let px = x, py = y, a = r() * Math.PI * 2;
  c.moveTo(px, py);
  for (let i = 0; i < 4; i++) {
    a += (r() - 0.5) * 1.2;
    px += Math.cos(a) * len / 4;
    py += Math.sin(a) * len / 8;
    c.lineTo(px, py);
    if (depth > 0 && r() < 0.4) { const sx = px, sy = py; crackPath(c, r, sx, sy, len * 0.5, depth - 1); c.moveTo(px, py); }
  }
}

export function ensureDecals(scene: Phaser.Scene): void {
  if (scene.textures.exists("decal_leaves_0")) return;
  const leafColors = [["#8a5a1e", "#b8782a", "#5a3a14"], ["#7a3018", "#a8481e", "#c87a2a"], ["#5a6a1e", "#8a8a2a", "#3a4a14"]];
  DECALS.leaves.forEach((key, v) => canvasTex(scene, key, 48, 24, (c) => {
    const r = rng(300 + v);
    for (let i = 0; i < 7; i++) {
      const x = 8 + r() * 32, y = 5 + r() * 14;
      ellipse(c, x, y, 3 + r() * 2, 1.4 + r(), leafColors[v][i % 3], r() * Math.PI);
    }
  }));
  canvasTex(scene, "decal_twigs_0", 40, 18, (c) => {
    const r = rng(311);
    c.strokeStyle = "#3a2a18"; c.lineWidth = 1.4; c.lineCap = "round";
    for (let i = 0; i < 4; i++) { const x = 6 + r() * 26, y = 4 + r() * 10; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 6 + r() * 6, y + (r() - 0.5) * 4); c.stroke(); }
  });
  DECALS.puddle.forEach((key, v) => canvasTex(scene, key, 64, 28, (c) => {
    ellipse(c, 32, 14, 26 - v * 6, 10 - v * 2, "rgba(20,32,36,0.75)");
    ellipse(c, 32, 14, 22 - v * 6, 8 - v * 2, "rgba(40,70,80,0.55)");
    ellipse(c, 26, 11, 9 - v * 2, 2, "rgba(170,220,230,0.35)", -0.1);
  }));
  DECALS.moss.forEach((key, v) => canvasTex(scene, key, 56, 26, (c) => {
    const r = rng(320 + v);
    for (let i = 0; i < 9; i++) ellipse(c, 10 + r() * 36, 6 + r() * 14, 3 + r() * 6, 2 + r() * 3, `rgba(${60 + r() * 30},${100 + r() * 40},${40 + r() * 20},0.55)`);
  }));
  const crackTex = (key: string, seed: number, stroke: string, glow?: string) => canvasTex(scene, key, 64, 32, (c) => {
    const r = rng(seed);
    c.beginPath();
    crackPath(c, r, 32, 16, 40, 1);
    if (glow) { c.strokeStyle = glow; c.lineWidth = 4; c.stroke(); }
    c.strokeStyle = stroke; c.lineWidth = glow ? 1.6 : 1.2; c.stroke();
  });
  crackTex("decal_crack_0", 331, "rgba(10,10,14,0.7)");
  crackTex("decal_crack_1", 332, "rgba(10,10,14,0.7)");
  crackTex("decal_ember_0", 341, "#ffb050", "rgba(255,90,20,0.35)");
  crackTex("decal_ember_1", 342, "#ff8a2a", "rgba(255,70,10,0.35)");
  crackTex("decal_voidcrack_0", 351, "#e0b0ff", "rgba(170,80,255,0.4)");
  DECALS.blood.forEach((key, v) => canvasTex(scene, key, 48, 22, (c) => {
    const r = rng(360 + v);
    ellipse(c, 24, 11, 14 - v * 3, 6 - v, "rgba(90,8,16,0.7)");
    for (let i = 0; i < 6; i++) ellipse(c, 8 + r() * 32, 4 + r() * 14, 1 + r() * 2, 0.8 + r(), "rgba(120,10,20,0.7)");
  }));
  DECALS.drift.forEach((key, v) => canvasTex(scene, key, 64, 24, (c) => {
    ellipse(c, 32, 13, 28 - v * 6, 8 - v * 2, "rgba(245,250,255,0.55)");
    ellipse(c, 28, 11, 18 - v * 4, 4, "rgba(255,255,255,0.6)");
  }));
  canvasTex(scene, "decal_ash_0", 56, 24, (c) => {
    const r = rng(371);
    for (let i = 0; i < 10; i++) ellipse(c, 8 + r() * 40, 5 + r() * 14, 3 + r() * 6, 1.5 + r() * 2, `rgba(${30 + r() * 20},${28 + r() * 15},${26 + r() * 10},0.5)`);
  });
  canvasTex(scene, "decal_ecto_0", 52, 24, (c) => {
    ellipse(c, 26, 12, 20, 7, "rgba(90,255,170,0.18)");
    ellipse(c, 26, 12, 11, 4, "rgba(150,255,200,0.3)");
  });
}

/** Which decal (if any) lies on a tile of this kind in this map theme; h is a stable random in [0, 1). */
export function decalFor(theme: string, kind: string, h: number): string[] | null {
  const soft = kind === "grass" || kind === "dirt" || kind === "sand" || kind === "snow";
  switch (theme) {
    case "forest":
      if (kind === "grass") return h < 0.07 ? DECALS.leaves : h < 0.09 ? DECALS.twigs : h < 0.11 ? DECALS.moss : null;
      if (kind === "dirt") return h < 0.05 ? DECALS.puddle : h < 0.09 ? DECALS.leaves : null;
      return null;
    case "town":
      if (kind === "stone") return h < 0.06 ? DECALS.crack : h < 0.08 ? DECALS.leaves : null;
      if (kind === "grass") return h < 0.06 ? DECALS.leaves : null;
      return null;
    case "swamp":
      if (soft) return h < 0.08 ? DECALS.moss : h < 0.13 ? DECALS.puddle : null;
      return null;
    case "crypt":
    case "mine":
      if (kind === "stone" || kind === "dirt") return h < 0.08 ? DECALS.crack : h < 0.1 ? DECALS.moss : null;
      return null;
    case "frost":
      if (kind === "snow") return h < 0.08 ? DECALS.drift : null;
      if (kind === "stone") return h < 0.06 ? DECALS.crack : null;
      return null;
    case "ash":
      if (soft || kind === "stone") return h < 0.06 ? DECALS.ember : h < 0.12 ? DECALS.ash : h < 0.15 ? DECALS.crack : null;
      return null;
    case "crimson":
      if (soft || kind === "stone") return h < 0.06 ? DECALS.blood : h < 0.1 ? DECALS.crack : null;
      return null;
    case "ghost":
      if (soft || kind === "stone") return h < 0.06 ? DECALS.crack : h < 0.1 ? DECALS.moss : h < 0.12 ? DECALS.ecto : null;
      return null;
    case "void":
      if (soft || kind === "stone") return h < 0.06 ? DECALS.voidcrack : h < 0.1 ? DECALS.crack : null;
      return null;
    default:
      return null;
  }
}

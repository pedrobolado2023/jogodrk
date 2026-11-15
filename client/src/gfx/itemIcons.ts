/**
 * Item icons painted on canvas (48×48, texture key `item_<icon>`), in the same style as the skill icons.
 * The rarity frame is drawn by the UI, not baked in, so one icon serves every rarity.
 */
import Phaser from "phaser";
import { canvasTex, ellipse, linear, poly, radial, rrect, type Ctx } from "./draw";

type Painter = (c: Ctx) => void;

const steel = (c: Ctx) => linear(c, 0, 0, 48, 48, [[0, "#f4f6fa"], [0.5, "#9aa4b4"], [1, "#4a5260"]]);
const wood = (c: Ctx) => linear(c, 0, 0, 48, 48, [[0, "#a87a4a"], [1, "#5a3a1e"]]);
const gold = (c: Ctx) => linear(c, 0, 0, 48, 48, [[0, "#ffe9a0"], [0.6, "#d9a040"], [1, "#8a5a1a"]]);

function line(c: Ctx, w: number, color: string | CanvasGradient, pts: number[]): void {
  c.strokeStyle = color;
  c.lineWidth = w;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.stroke();
}

function potion(color: string, glow: string, big: boolean): Painter {
  return (c) => {
    const r = big ? 13 : 10, cy = big ? 30 : 32;
    rrect(c, 20, cy - r - 12, 8, 9, 2);
    c.fillStyle = "#c9b48a"; c.fill();
    rrect(c, 18.5, cy - r - 14, 11, 4, 2);
    c.fillStyle = "#6a4a2a"; c.fill();
    c.beginPath(); c.arc(24, cy, r, 0, Math.PI * 2);
    c.fillStyle = radial(c, 21, cy - 3, r + 2, [[0, glow], [0.6, color], [1, "#120810"]]); c.fill();
    c.lineWidth = 1.5; c.strokeStyle = "rgba(255,255,255,0.35)"; c.stroke();
    ellipse(c, 20, cy - r * 0.45, r * 0.3, r * 0.18, "rgba(255,255,255,0.55)", -0.5);
  };
}

/** A chunk of rock with ore crystals of the given colours. */
function ore(light: string, dark: string): Painter {
  return (c) => {
    poly(c, [8, 34, 14, 18, 30, 12, 42, 22, 40, 38, 24, 42], linear(c, 0, 10, 0, 44, [[0, "#6a6058"], [1, "#2a2420"]]), "#141210", 1.2);
    const shard = (x: number, y: number, w: number, h: number) => poly(c, [x - w, y, x, y - h, x + w, y], linear(c, x - w, 0, x + w, 0, [[0, light], [1, dark]]), "rgba(0,0,0,0.5)", 1);
    shard(20, 30, 5, 14);
    shard(30, 28, 5, 17);
    shard(36, 34, 4, 10);
  };
}

/** A cut gem stone; the tier adds facets. */
function stone(light: string, dark: string, tier: number): Painter {
  return (c) => {
    poly(c, [24, 6, 40, 18, 34, 40, 14, 40, 8, 18], linear(c, 0, 0, 48, 48, [[0, light], [1, dark]]), "rgba(0,0,0,0.6)", 1.4);
    poly(c, [24, 6, 32, 18, 16, 18], "rgba(255,255,255,0.45)");
    for (let i = 0; i < tier; i++) line(c, 1.2, "rgba(255,255,255,0.5)", [16 + i * 6, 24, 20 + i * 6, 36]);
  };
}

/** Pants seen from the front: a belt and two legs; `detail` paints the material on top. */
function legs(fill: (c: Ctx) => CanvasGradient | string, edge: string, detail: Painter): Painter {
  return (c) => {
    poly(c, [12, 9, 36, 9, 38, 22, 36, 44, 26, 44, 24, 24, 22, 44, 12, 44, 10, 22], fill(c), edge, 1.3);
    rrect(c, 11, 7, 26, 5, 2); c.fillStyle = "#2a1a0c"; c.fill();
    detail(c);
  };
}

/** A boot seen from the side; `detail` paints the material on top. */
function boot(fill: (c: Ctx) => CanvasGradient | string, edge: string, detail: Painter): Painter {
  return (c) => {
    poly(c, [15, 6, 30, 6, 30, 28, 40, 32, 43, 40, 42, 43, 12, 43, 13, 28], fill(c), edge, 1.3);
    rrect(c, 11, 40, 33, 4, 1.5); c.fillStyle = "#1a120a"; c.fill();
    detail(c);
  };
}

const silk = (c: Ctx) => linear(c, 0, 0, 0, 48, [[0, "#6a4ab0"], [1, "#24124a"]]);
const hide = (c: Ctx) => linear(c, 0, 0, 48, 48, [[0, "#9a6a3a"], [1, "#3e2412"]]);

const PAINTERS: Record<string, Painter> = {
  // gem shop
  paw: (c) => {
    ellipse(c, 24, 31, 10, 9, "#c8a070");
    for (const [x, y] of [[13, 19], [20, 13], [28, 13], [35, 19]]) ellipse(c, x, y, 4.5, 5.5, "#c8a070");
  },
  boost_exp: (c) => {
    // a green rising arrow over a glowing orb
    c.beginPath(); c.arc(24, 28, 14, 0, Math.PI * 2);
    c.fillStyle = radial(c, 22, 24, 16, [[0, "#eaffd8"], [0.5, "#5ac83a"], [1, "#12400a"]]); c.fill();
    poly(c, [24, 6, 34, 18, 28, 18, 28, 32, 20, 32, 20, 18, 14, 18], "#f4ffe0", "#1a4a0a", 1.4);
  },
  boost_gold: (c) => {
    c.beginPath(); c.arc(24, 28, 14, 0, Math.PI * 2);
    c.fillStyle = radial(c, 22, 24, 16, [[0, "#fff6d0"], [0.5, "#e0a030"], [1, "#4a2a06"]]); c.fill();
    poly(c, [24, 6, 34, 18, 28, 18, 28, 32, 20, 32, 20, 18, 14, 18], "#fff0b0", "#5a3a08", 1.4);
  },
  quest_skip: (c) => {
    // a scroll with a seal
    rrect(c, 10, 8, 28, 32, 3); c.fillStyle = linear(c, 0, 0, 0, 48, [[0, "#f4e4c0"], [1, "#c8a874"]]); c.fill();
    c.strokeStyle = "#6a4a20"; c.lineWidth = 1.2; c.stroke();
    for (let i = 0; i < 4; i++) line(c, 1.2, "#8a6a3a", [15, 15 + i * 5, 33, 15 + i * 5]);
    c.beginPath(); c.arc(32, 36, 7, 0, Math.PI * 2); c.fillStyle = "#b01a1a"; c.fill();
    line(c, 2, "#ffd0a0", [29, 36, 31, 39, 36, 33]);
  },
  soon: (c) => {
    c.beginPath(); c.arc(24, 24, 16, 0, Math.PI * 2); c.lineWidth = 3; c.strokeStyle = "#8a9aaa"; c.stroke();
    line(c, 3, "#8a9aaa", [24, 14, 24, 25, 31, 29]);
  },
  gem: (c) => {
    poly(c, [24, 6, 40, 18, 24, 44, 8, 18], linear(c, 0, 0, 48, 48, [[0, "#d8f4ff"], [0.45, "#4ab0ff"], [1, "#12306a"]]), "#0a1a3a", 1.4);
    poly(c, [8, 18, 40, 18, 24, 44], "rgba(10,40,100,0.35)");
    poly(c, [16, 18, 24, 6, 32, 18, 24, 26], "rgba(255,255,255,0.45)");
    line(c, 1, "rgba(255,255,255,0.6)", [8, 18, 40, 18]);
  },
  shop_pass: (c) => {
    // a golden ticket with a star
    poly(c, [6, 12, 42, 12, 42, 20, 38, 24, 42, 28, 42, 36, 6, 36, 6, 28, 10, 24, 6, 20], linear(c, 0, 0, 48, 48, [[0, "#ffe9a0"], [1, "#b0701a"]]), "#4a2a08", 1.4);
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4 : 9; pts.push(24 + Math.cos(a) * r, 24 + Math.sin(a) * r); }
    poly(c, pts, "#7a1a10", "#3a0a04", 1);
  },
  // season pass rewards
  pass_gold: (c) => {
    for (const [x, y] of [[18, 30], [30, 30], [24, 20]]) {
      ellipse(c, x, y + 3, 10, 7, "#6a4a10");
      ellipse(c, x, y, 10, 7, gold(c));
      ellipse(c, x, y, 6, 4, "rgba(255,250,210,0.45)");
    }
  },
  pass_title: (c) => {
    // a banner with ribbon tails
    poly(c, [6, 16, 42, 16, 38, 24, 42, 32, 6, 32, 10, 24], linear(c, 0, 0, 0, 48, [[0, "#ffd77a"], [1, "#a0601a"]]), "#4a2a08", 1.4);
    poly(c, [12, 19, 36, 19, 36, 29, 12, 29], "#5a1a14");
    for (let i = 0; i < 4; i++) line(c, 1.4, "#ffe9a8", [15 + i * 6, 24, 18 + i * 6, 24]);
    c.beginPath(); c.arc(24, 10, 4, 0, Math.PI * 2); c.fillStyle = gold(c); c.fill();
  },
  pass_aura: (c) => {
    // a glowing ring seen from above, tinted by the UI with the aura colour
    c.beginPath(); c.ellipse(24, 30, 18, 8, 0, 0, Math.PI * 2);
    c.fillStyle = radial(c, 24, 30, 20, [[0, "rgba(255,255,255,0.55)"], [0.7, "rgba(255,255,255,0.18)"], [1, "rgba(255,255,255,0)"]]); c.fill();
    c.lineWidth = 2.5; c.strokeStyle = "#ffffff"; c.stroke();
    for (const [x, y, r] of [[16, 18, 2.2], [28, 12, 1.8], [33, 20, 2], [21, 8, 1.4]]) {
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = "#ffffff"; c.fill();
    }
  },
  legs_plate: legs(steel, "#262a32", (c) => {
    ellipse(c, 17, 29, 5, 4, steel(c)); ellipse(c, 31, 29, 5, 4, steel(c));
    line(c, 1.2, "rgba(20,22,28,0.7)", [12, 36, 22, 36]); line(c, 1.2, "rgba(20,22,28,0.7)", [26, 36, 36, 36]);
    rrect(c, 21, 7, 6, 5, 1); c.fillStyle = gold(c); c.fill();
  }),
  legs_robe: legs(silk, "#140a28", (c) => {
    line(c, 1.5, gold(c), [13, 42, 21, 42]); line(c, 1.5, gold(c), [27, 42, 35, 42]);
    line(c, 1, "rgba(255,220,140,0.6)", [17, 14, 17, 40]); line(c, 1, "rgba(255,220,140,0.6)", [31, 14, 31, 40]);
  }),
  legs_leather: legs(hide, "#20120a", (c) => {
    for (let i = 0; i < 4; i++) { line(c, 1.2, "#c8a070", [13, 18 + i * 6, 15, 18 + i * 6]); line(c, 1.2, "#c8a070", [33, 18 + i * 6, 35, 18 + i * 6]); }
    rrect(c, 14, 26, 7, 6, 1.5); c.fillStyle = "#5a3a1e"; c.fill();
  }),
  boots_plate: boot(steel, "#262a32", (c) => {
    line(c, 1.3, "rgba(20,22,28,0.7)", [15, 14, 30, 14]); line(c, 1.3, "rgba(20,22,28,0.7)", [14, 22, 30, 22]);
    line(c, 1.3, "rgba(20,22,28,0.7)", [30, 30, 38, 34]);
    ellipse(c, 22, 30, 4, 3, gold(c));
  }),
  boots_robe: (c) => {
    // a sandal: sole, straps and a silk wrap around the ankle
    rrect(c, 9, 38, 34, 5, 2); c.fillStyle = "#5a3a1e"; c.fill();
    poly(c, [17, 8, 29, 8, 29, 26, 17, 26], silk(c), "#140a28", 1.2);
    for (const [x1, y1, x2, y2] of [[14, 38, 30, 28], [20, 38, 36, 32], [26, 38, 40, 36]]) line(c, 2.4, gold(c), [x1, y1, x2, y2]);
    line(c, 1.5, gold(c), [17, 12, 29, 12]);
  },
  boots_leather: boot(hide, "#20120a", (c) => {
    for (let i = 0; i < 4; i++) line(c, 1.3, "#e8d0a0", [24, 10 + i * 5, 30, 12 + i * 5]);
    rrect(c, 14, 6, 17, 4, 1.5); c.fillStyle = "#5a3a1e"; c.fill();
  }),
  sword: (c) => {
    poly(c, [24, 4, 28, 10, 27, 31, 21, 31, 20, 10], steel(c), "#2a2e36", 1);
    line(c, 1.2, "rgba(255,255,255,0.7)", [24, 8, 24, 29]);
    rrect(c, 13, 31, 22, 4, 2); c.fillStyle = gold(c); c.fill();
    rrect(c, 21.5, 35, 5, 8, 1.5); c.fillStyle = "#4a2a18"; c.fill();
    c.beginPath(); c.arc(24, 44.5, 2.6, 0, Math.PI * 2); c.fillStyle = gold(c); c.fill();
  },
  staff: (c) => {
    line(c, 4, wood(c), [14, 44, 31, 12]);
    line(c, 2, "#3a2210", [12, 46, 16, 41]);
    c.beginPath(); c.arc(33, 10, 7, 0, Math.PI * 2);
    c.fillStyle = radial(c, 31, 8, 9, [[0, "#ffffff"], [0.4, "#9ad8ff"], [1, "#2a4aa0"]]); c.fill();
    line(c, 2, gold(c), [27, 16, 30, 6]); line(c, 2, gold(c), [37, 14, 39, 5]);
  },
  bow: (c) => {
    c.strokeStyle = wood(c); c.lineWidth = 4; c.lineCap = "round";
    c.beginPath(); c.arc(8, 24, 22, -1.15, 1.15); c.stroke();
    line(c, 1, "#e8e0c8", [17, 4, 17, 44]);
    line(c, 2, "#c8b090", [6, 24, 40, 24]);
    poly(c, [40, 24, 34, 20.5, 34, 27.5], steel(c));
    poly(c, [8, 24, 4, 20, 6, 24, 4, 28], "#c84a3a");
  },
  plate: (c) => {
    poly(c, [12, 10, 20, 7, 28, 7, 36, 10, 39, 22, 34, 42, 14, 42, 9, 22], steel(c), "#262a32", 1.4);
    line(c, 1.5, "rgba(20,22,28,0.8)", [24, 9, 24, 41]);
    line(c, 1.5, "rgba(20,22,28,0.6)", [12, 24, 36, 24]);
    ellipse(c, 10, 13, 6, 5, steel(c)); ellipse(c, 38, 13, 6, 5, steel(c));
  },
  robe: (c) => {
    poly(c, [17, 6, 31, 6, 34, 16, 40, 44, 8, 44, 14, 16], linear(c, 0, 0, 0, 48, [[0, "#6a4ab0"], [1, "#24124a"]]), "#140a28", 1.2);
    poly(c, [20, 6, 28, 6, 24, 18], "#120a20");
    line(c, 2, gold(c), [14, 30, 34, 30]);
    line(c, 1.5, gold(c), [24, 18, 24, 44]);
  },
  leather: (c) => {
    poly(c, [13, 8, 20, 6, 28, 6, 35, 8, 38, 20, 35, 42, 13, 42, 10, 20], linear(c, 0, 0, 48, 48, [[0, "#9a6a3a"], [1, "#3e2412"]]), "#20120a", 1.3);
    for (let i = 0; i < 4; i++) line(c, 1.4, "#c8a070", [19, 15 + i * 6, 29, 15 + i * 6]);
    line(c, 3, "#2a180c", [12, 32, 36, 32]);
  },
  ring: (c) => {
    c.beginPath(); c.arc(24, 28, 11, 0, Math.PI * 2); c.lineWidth = 5; c.strokeStyle = gold(c); c.stroke();
    poly(c, [24, 8, 30, 14, 24, 21, 18, 14], radial(c, 22, 12, 9, [[0, "#ffffff"], [0.5, "#ff6a6a"], [1, "#7a0a1a"]]), "#3a0a10", 1);
  },
  amulet: (c) => {
    c.beginPath(); c.moveTo(10, 6); c.quadraticCurveTo(24, 30, 38, 6); c.lineWidth = 2; c.strokeStyle = gold(c); c.stroke();
    poly(c, [24, 20, 34, 30, 24, 44, 14, 30], gold(c), "#5a3a10", 1.2);
    poly(c, [24, 25, 30, 31, 24, 39, 18, 31], radial(c, 23, 29, 8, [[0, "#ffffff"], [0.5, "#7affc0"], [1, "#0a5a3a"]]));
  },
  potion_hp_s: potion("#c0142a", "#ff9a9a", false),
  potion_hp_l: potion("#c0142a", "#ff9a9a", true),
  potion_mp_s: potion("#1a4ad0", "#9ad0ff", false),
  potion_mp_l: potion("#1a4ad0", "#9ad0ff", true),
  mat_pelt: (c) => {
    poly(c, [10, 14, 18, 8, 30, 9, 38, 14, 40, 30, 32, 40, 16, 40, 8, 30], linear(c, 0, 0, 48, 48, [[0, "#8a8a92"], [1, "#3a3a44"]]), "#1a1a20", 1.2);
    for (let i = 0; i < 6; i++) line(c, 1, "rgba(220,220,230,0.35)", [14 + i * 4, 14, 12 + i * 4, 36]);
  },
  mat_ear: (c) => {
    c.beginPath(); c.moveTo(14, 40); c.quadraticCurveTo(8, 18, 36, 6); c.quadraticCurveTo(34, 28, 24, 40); c.closePath();
    c.fillStyle = linear(c, 0, 0, 48, 48, [[0, "#9ad06a"], [1, "#3a6a1a"]]); c.fill();
    c.strokeStyle = "#1a3a0a"; c.lineWidth = 1.2; c.stroke();
    line(c, 2, "#5a3a1a", [16, 36, 30, 14]);
  },
  mat_bark: (c) => {
    poly(c, [12, 6, 34, 8, 38, 40, 14, 42], linear(c, 0, 0, 48, 0, [[0, "#5a3a1a"], [0.5, "#8a6a3a"], [1, "#3a240e"]]), "#1e1208", 1.2);
    for (let i = 0; i < 3; i++) line(c, 1.5, "#2a1a0a", [18 + i * 6, 10, 20 + i * 6, 40]);
    ellipse(c, 26, 22, 4, 6, "rgba(120,255,140,0.5)");
  },
  pickaxe: (c) => {
    line(c, 4, wood(c), [14, 42, 32, 14]);
    c.beginPath(); c.moveTo(14, 12); c.quadraticCurveTo(30, 2, 44, 18); c.lineTo(40, 20); c.quadraticCurveTo(30, 10, 18, 16); c.closePath();
    c.fillStyle = steel(c); c.fill(); c.strokeStyle = "#20242c"; c.lineWidth = 1.2; c.stroke();
  },
  ore_iron: ore("#c98a5c", "#6a3a22"),
  ore_silver: ore("#f4f8ff", "#8a96b0"),
  ore_gold: ore("#ffe88a", "#b07a14"),
  ore_arcane: ore("#e8c0ff", "#6a2adf"),
  stone_up_1: stone("#7ee07a", "#1e5a1a", 1),
  stone_up_2: stone("#6fb0ff", "#16346a", 2),
  stone_up_3: stone("#c08cff", "#3a1a6a", 3),
  stone_protect: (c) => {
    poly(c, [24, 6, 40, 12, 38, 30, 24, 42, 10, 30, 8, 12], linear(c, 0, 0, 0, 48, [[0, "#ffe9a0"], [1, "#a0601a"]]), "#4a2a08", 1.5);
    poly(c, [24, 12, 34, 16, 33, 28, 24, 36, 15, 28, 14, 16], radial(c, 24, 22, 14, [[0, "#ffffff"], [0.5, "#8ad8ff"], [1, "#1a4a8a"]]));
  },
  stone_refine: (c) => {
    c.beginPath(); c.arc(24, 26, 15, 0, Math.PI * 2);
    c.fillStyle = radial(c, 20, 20, 18, [[0, "#ffffff"], [0.35, "#ffb347"], [0.75, "#c0400a"], [1, "#3a0a02"]]); c.fill();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; line(c, 1.5, "rgba(255,240,200,0.8)", [24 + Math.cos(a) * 17, 26 + Math.sin(a) * 17, 24 + Math.cos(a) * 21, 26 + Math.sin(a) * 21]); }
  },
  stone_enchant: (c) => {
    // a gem split into the four elements: fire, ice, lightning, poison
    const parts: [number, string, string][] = [[0, "#ff8a3a", "#7a2008"], [1, "#8fd8ff", "#14467a"], [2, "#ffe36a", "#8a6a08"], [3, "#9dff6a", "#2a6a10"]];
    for (const [i, light, dark] of parts) {
      const a0 = (i / 4) * Math.PI * 2 - Math.PI / 2, a1 = a0 + Math.PI / 2;
      c.beginPath(); c.moveTo(24, 26); c.arc(24, 26, 15, a0, a1); c.closePath();
      c.fillStyle = radial(c, 24 + Math.cos(a0 + 0.8) * 7, 26 + Math.sin(a0 + 0.8) * 7, 12, [[0, light], [1, dark]]); c.fill();
    }
    c.beginPath(); c.arc(24, 26, 15, 0, Math.PI * 2); c.strokeStyle = "#2a1a08"; c.lineWidth = 1.5; c.stroke();
    c.beginPath(); c.arc(24, 26, 5, 0, Math.PI * 2); c.fillStyle = radial(c, 23, 25, 6, [[0, "#ffffff"], [1, "#d8c0ff"]]); c.fill();
  },
  mat_slime: (c) => {
    c.beginPath(); c.moveTo(8, 38); c.bezierCurveTo(6, 24, 16, 18, 22, 22); c.bezierCurveTo(26, 10, 40, 14, 38, 26);
    c.bezierCurveTo(44, 32, 42, 40, 34, 40); c.closePath();
    c.fillStyle = radial(c, 22, 26, 22, [[0, "#d8ff7a"], [0.5, "#5aa01a"], [1, "#1a3a0a"]]); c.fill();
    for (const [x, y, r] of [[18, 28, 3], [30, 24, 2.2], [27, 33, 1.8]]) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = "rgba(240,255,200,0.6)"; c.fill(); }
  },
  mat_fang: (c) => {
    c.beginPath(); c.moveTo(14, 8); c.quadraticCurveTo(34, 10, 36, 40); c.quadraticCurveTo(26, 30, 12, 14); c.closePath();
    c.fillStyle = linear(c, 0, 0, 48, 48, [[0, "#fffbe8"], [0.7, "#d8cca0"], [1, "#7a6a40"]]); c.fill();
    c.strokeStyle = "rgba(90,255,200,0.7)"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(18, 14); c.quadraticCurveTo(30, 18, 32, 34); c.stroke();
  },
  mat_frost_pelt: (c) => {
    c.beginPath(); c.moveTo(8, 14); c.quadraticCurveTo(24, 4, 40, 12); c.lineTo(42, 34); c.quadraticCurveTo(24, 46, 6, 36); c.closePath();
    c.fillStyle = linear(c, 0, 0, 48, 48, [[0, "#ffffff"], [0.6, "#c8d8ea"], [1, "#6a7e98"]]); c.fill();
    for (let i = 0; i < 4; i++) line(c, 1.2, "rgba(90,110,140,0.6)", [12 + i * 7, 16, 10 + i * 8, 34]);
  },
  mat_frozen_core: (c) => {
    poly(c, [24, 4, 38, 18, 34, 40, 14, 40, 10, 18], linear(c, 0, 0, 48, 48, [[0, "#ffffff"], [0.4, "#8ad8ff"], [1, "#1a4a8a"]]), "#d8f6ff", 1.2);
    c.beginPath(); c.arc(24, 24, 6, 0, Math.PI * 2);
    c.fillStyle = radial(c, 24, 24, 7, [[0, "#ffffff"], [1, "rgba(95,216,255,0.2)"]]); c.fill();
  },
  mat_tusk: (c) => {
    c.beginPath(); c.moveTo(10, 40); c.quadraticCurveTo(12, 12, 38, 6); c.quadraticCurveTo(24, 18, 20, 42); c.closePath();
    c.fillStyle = linear(c, 0, 0, 48, 48, [[0, "#fff8e0"], [0.6, "#d8c89a"], [1, "#6a5a3a"]]); c.fill();
    c.strokeStyle = "#3a2e1a"; c.lineWidth = 1.2; c.stroke();
    line(c, 3, "#5a4630", [9, 41, 21, 43]);
  },
  mat_ember: (c) => {
    poly(c, [24, 6, 36, 18, 32, 40, 16, 40, 12, 18], linear(c, 0, 0, 48, 48, [[0, "#fff0a0"], [0.4, "#ff8a1a"], [1, "#5a1404"]]), "#2a0a02", 1.2);
    c.beginPath(); c.arc(24, 26, 5, 0, Math.PI * 2); c.fillStyle = "rgba(255,240,180,0.85)"; c.fill();
  },
  mat_blood: (c) => {
    c.beginPath(); c.moveTo(24, 6); c.bezierCurveTo(34, 20, 38, 28, 38, 32); c.arc(24, 32, 14, 0, Math.PI); c.bezierCurveTo(10, 28, 14, 20, 24, 6);
    c.fillStyle = radial(c, 20, 28, 18, [[0, "#ff6a6a"], [0.5, "#a00c1c"], [1, "#3a0208"]]); c.fill();
    ellipse(c, 19, 28, 3, 5, "rgba(255,220,220,0.55)", -0.3);
  },
  mat_ecto: (c) => {
    c.beginPath(); c.moveTo(14, 40); c.bezierCurveTo(6, 26, 16, 8, 26, 8); c.bezierCurveTo(38, 8, 42, 24, 34, 40);
    c.quadraticCurveTo(29, 34, 24, 40); c.quadraticCurveTo(19, 34, 14, 40);
    c.fillStyle = radial(c, 24, 20, 22, [[0, "#eafff0"], [0.5, "#7affb0"], [1, "rgba(30,120,70,0.6)"]]); c.fill();
    for (const x of [20, 29]) { c.beginPath(); c.arc(x, 20, 2.5, 0, Math.PI * 2); c.fillStyle = "#103a20"; c.fill(); }
  },
  mat_void: (c) => {
    poly(c, [24, 4, 34, 20, 28, 44, 18, 30, 12, 16], linear(c, 0, 0, 48, 48, [[0, "#f0d8ff"], [0.4, "#9a4aff"], [1, "#1a0640"]]), "#e0c0ff", 1);
    c.strokeStyle = "rgba(255,255,255,0.7)"; c.lineWidth = 1; c.beginPath(); c.moveTo(24, 8); c.lineTo(22, 38); c.stroke();
  },
  mat_bone: (c) => {
    line(c, 6, "#e8e0c8", [14, 36, 34, 12]);
    for (const [x, y] of [[11, 37], [15, 40], [33, 9], [37, 13]]) { c.beginPath(); c.arc(x, y, 4.5, 0, Math.PI * 2); c.fillStyle = "#f4ecd8"; c.fill(); }
    line(c, 1, "rgba(80,70,50,0.6)", [17, 33, 31, 15]);
  },
};

export function ensureItemIcons(scene: Phaser.Scene): void {
  for (const [key, paint] of Object.entries(PAINTERS)) {
    canvasTex(scene, `item_${key}`, 48, 48, (c) => {
      c.save();
      c.shadowColor = "rgba(0,0,0,0.85)";
      c.shadowBlur = 4;
      c.shadowOffsetY = 1;
      paint(c);
      c.restore();
    });
  }
}

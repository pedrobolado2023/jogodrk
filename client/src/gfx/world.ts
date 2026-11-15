import Phaser from "phaser";
import { col, fbm, hash2, mixHex, radial } from "./draw";
import { CAMP_ORIGIN, PROP_KEYS, propOrigin } from "./textures";
import { FROST_PROPS, THEME_ORIGIN } from "./themeProps";
import { decalFor, ensureDecals, groundPattern } from "./groundArt";
import { gfx } from "./quality";
import { worldToScreen, TILE_W, TILE_H } from "../utils/isometric";
import type { MapInfo } from "../data/meta";

const CHUNK = 16;
const PAD = 4;
const GROUND_DEPTH = -1_000_000;
/** Ground look: how far neighbouring ground colours blend, and how strong the grain textures are. */
const BLEND_BLUR = 7;
const BLEND_MARGIN = 24;
const TEXTURE_STRENGTH = 0.85;

export interface LightSource {
  x: number;
  y: number;
  r: number;
  a: number;
  flicker: number;
}

type Kind = "grass" | "dirt" | "stone" | "sand" | "void" | "water" | "snow" | "ice";

interface PropSpec {
  key: string;
  wx: number;
  wy: number;
  scale: number;
  flip: boolean;
}

/** A looping pixel effect placed in the world (fires, candles), started by the scene. */
export interface FireSpec {
  fx: string;
  wx: number;
  wy: number;
  scale: number;
  light: number;
}

interface Theme {
  darkness: number;
  ground(tx: number, ty: number): { color: number; kind: Kind };
  patch?(tx: number, ty: number, pass: number): [number, number, number] | null;
  prop(tx: number, ty: number): PropSpec | null;
  statics: [string, number, number, number, boolean][];
  fires: FireSpec[];
  lamps: [number, number][];
  minimap(tx: number, ty: number): number;
}

function pick<T>(arr: T[], h: number): T {
  return arr[Math.floor(h * arr.length) % arr.length];
}

const jitter = (tx: number, ty: number) => ({
  wx: tx + (hash2(tx, ty, 7) - 0.5) * 0.6,
  wy: ty + (hash2(tx, ty, 8) - 0.5) * 0.6,
  scale: 0.85 + hash2(tx, ty, 9) * 0.35,
  flip: hash2(tx, ty, 10) > 0.5,
});

function edgeFade(c: number, tx: number, ty: number, size: number, w = 5): number {
  const edge = Math.min(tx, ty, size - 1 - tx, size - 1 - ty);
  return edge < w ? mixHex(0x06070b, c, Math.max(0, edge) / w) : c;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// ── Forest ─────────────────────────────────────────────────────────────

/** The starting camp beside the forest entrance, in tile coordinates. */
export const CAMP = {
  center: [20.6, 42.2] as [number, number],
  fire: [20.5, 42.5] as [number, number],
  braziers: [[23.6, 46.6], [18.6, 46.2]] as [number, number][],
  props: [
    ["tent", 17.4, 40.6, 1, false], ["tent", 20.2, 38.9, 0.9, true],
    ["logseat", 19.3, 43.8, 1, false], ["logseat", 21.8, 41.4, 1, true],
    ["crate", 24.0, 40.6, 1, false], ["crate", 24.6, 41.3, 0.9, false], ["barrel", 23.3, 39.9, 1, false],
    ["banner", 17.8, 44.4, 1, false],
  ] as [string, number, number, number, boolean][],
};

function forestTheme(info: MapInfo): Theme {
  const size = info.size;
  const tileInfo = (tx: number, ty: number) => {
    const moist = fbm(tx * 0.07, ty * 0.07, 11);
    const p = fbm(tx * 0.02, ty * 0.02, 23);
    const path = Math.max(0, Math.min(1, 1 - Math.abs(p - 0.5) / 0.04));
    const forest = fbm(tx * 0.045 + 50, ty * 0.045 + 50, 37);
    let clear = 0;
    for (const [cx, cy, r] of info.clearings) {
      const d = Math.hypot(tx - cx, ty - cy);
      if (d < r) clear = Math.max(clear, 1 - d / r);
    }
    return { moist, path, forest, clear };
  };
  return {
    darkness: 0.5,
    statics: CAMP.props,
    fires: [
      { fx: "fire/campfire", wx: CAMP.fire[0], wy: CAMP.fire[1], scale: 1.1, light: 300 },
      ...CAMP.braziers.map(([x, y]) => ({ fx: "fire/brazier", wx: x, wy: y, scale: 0.7, light: 190 })),
    ],
    lamps: [],
    ground(tx, ty) {
      const inf = tileInfo(tx, ty);
      let c = mixHex(0x17251a, 0x24381f, Math.min(1, Math.max(0, (inf.moist - 0.3) * 2)));
      if (inf.forest > 0.52) c = mixHex(c, 0x0f1a12, Math.min(1, (inf.forest - 0.52) * 4));
      const j = (hash2(tx, ty, 3) - 0.5) * 0.12;
      c = mixHex(c, j > 0 ? 0x3a4a30 : 0x050805, Math.abs(j));
      return { color: edgeFade(c, tx, ty, size), kind: inf.path > 0.4 ? "dirt" : "grass" };
    },
    patch(tx, ty, pass) {
      const inf = tileInfo(tx, ty);
      if (pass === 0 && inf.moist > 0.62 && hash2(tx, ty, 41) < 0.5) return [0x2f4a26, 0.45, 34];
      if (pass === 1 && Math.hypot(tx - CAMP.center[0], ty - CAMP.center[1]) < 4) return [0x332a1c, 0.7, 34];
      if (pass === 1 && inf.moist < 0.34 && hash2(tx, ty, 42) < 0.6) return [0x2e281c, 0.6, 32];
      if (pass === 2 && inf.path > 0.05) return [0x3b3124, Math.min(0.95, inf.path * 1.4), 30];
      return null;
    },
    prop(tx, ty) {
      if (Math.hypot(tx - CAMP.center[0], ty - CAMP.center[1]) < 5.5) return null;
      for (const p of info.portals) if (Math.hypot(tx - p.x, ty - p.y) < 2.5) return null;
      const inf = tileInfo(tx, ty);
      if (inf.path > 0.25) return null;
      const h = hash2(tx, ty, 99), h2 = hash2(tx, ty, 5);
      const open = 1 - inf.clear;
      const treeChance = (inf.forest > 0.56 ? 0.17 : inf.forest > 0.48 ? 0.05 : 0.01) * open * open;
      if (h < treeChance) {
        const key = inf.forest > 0.5
          ? (h2 < 0.55 ? pick(PROP_KEYS.pine, h2 * 7) : pick(PROP_KEYS.oak, h2 * 5))
          : (h2 < 0.6 ? pick(PROP_KEYS.dead, h2 * 3) : pick(PROP_KEYS.oak, h2 * 5));
        return { key, ...jitter(tx, ty) };
      }
      let acc = treeChance;
      const table: [number, string[]][] = [
        [0.012 * open, PROP_KEYS.rock], [(inf.forest > 0.5 ? 0.04 : 0.015) * open, PROP_KEYS.bush],
        [inf.forest < 0.45 ? 0.005 : 0, PROP_KEYS.grave], [0.005 * open, PROP_KEYS.stump],
        [inf.forest > 0.5 ? 0.012 : 0.002, PROP_KEYS.mushroom],
      ];
      for (const [p, keys] of table) {
        acc += p;
        if (h < acc) return { key: pick(keys, h2 * 3), ...jitter(tx, ty), scale: 0.8 + hash2(tx, ty, 9) * 0.4 };
      }
      return null;
    },
    minimap(tx, ty) {
      const inf = tileInfo(tx, ty);
      let c = inf.forest > 0.56 ? 0x173a20 : inf.forest > 0.48 ? 0x24502c : 0x36623a;
      if (inf.moist < 0.34) c = mixHex(c, 0x5a4a30, 0.5);
      if (inf.path > 0.3) c = mixHex(c, 0x9a7c50, Math.min(1, inf.path));
      return edgeFade(c, tx, ty, size, 3);
    },
  };
}

// ── Town ───────────────────────────────────────────────────────────────

function townTheme(info: MapInfo): Theme {
  const size = info.size, cx = 20, cy = 21;
  const road = (tx: number, ty: number) => Math.min(...info.portals.map((p) => segDist(tx, ty, cx, cy, p.x, p.y)));
  const plaza = (tx: number, ty: number) => Math.hypot(tx - cx, ty - cy) < 7.5;
  const statics: Theme["statics"] = [
    ["house_0", 10.5, 13.0, 1, false], ["house_1", 30.0, 12.5, 1, true], ["house_1", 9.5, 30.5, 0.95, false],
    ["house_0", 30.5, 30.5, 1, true], ["statue", 20, 21.5, 1, false], ["well", 25.8, 24.5, 1, false],
    ["stall", 25.5, 17.8, 0.9, false], ["fence", 15.5, 33.5, 1, false], ["fence", 24.5, 33.5, 1, true],
    ["banner", 18.4, 6.4, 1, false], ["banner", 21.6, 6.4, 1, true],
  ];
  const lamps: [number, number][] = [[14, 15.5], [26, 15.5], [14, 27], [26, 27], [32, 21.5], [8, 21.5]];
  for (const [x, y] of lamps) statics.push(["lamppost", x, y, 1, false]);
  return {
    darkness: 0.36,
    statics,
    fires: [
      { fx: "fire/brazier", wx: 18.2, wy: 5.2, scale: 0.6, light: 170 },
      { fx: "fire/brazier", wx: 21.8, wy: 5.2, scale: 0.6, light: 170 },
    ],
    lamps,
    ground(tx, ty) {
      const j = (hash2(tx, ty, 3) - 0.5) * 0.14;
      if (plaza(tx, ty)) return { color: mixHex(0x4a4650, j > 0 ? 0x6a6670 : 0x2a2830, Math.abs(j) * 2), kind: "stone" };
      if (road(tx, ty) < 1.4) return { color: mixHex(0x4a3e30, 0x2a2218, Math.abs(j) * 2), kind: "stone" };
      return { color: edgeFade(mixHex(0x1e3020, j > 0 ? 0x34482c : 0x0a120a, Math.abs(j)), tx, ty, size, 4), kind: "grass" };
    },
    patch(tx, ty, pass) {
      if (pass === 0 && !plaza(tx, ty) && road(tx, ty) > 2 && hash2(tx, ty, 44) < 0.15) return [0x2f4a26, 0.45, 30];
      return null;
    },
    prop(tx, ty) {
      const d = Math.hypot(tx - cx, ty - cy);
      if (d < 15 || road(tx, ty) < 3) return null;
      const h = hash2(tx, ty, 99);
      if (h < 0.22) return { key: pick(h < 0.12 ? PROP_KEYS.pine : PROP_KEYS.oak, hash2(tx, ty, 5) * 5), ...jitter(tx, ty) };
      if (h < 0.26) return { key: pick(PROP_KEYS.bush, h * 9), ...jitter(tx, ty) };
      return null;
    },
    minimap(tx, ty) {
      if (plaza(tx, ty)) return 0x7a7680;
      if (road(tx, ty) < 1.4) return 0x9a7c50;
      return edgeFade(0x36623a, tx, ty, size, 3);
    },
  };
}

// ── Crypt ──────────────────────────────────────────────────────────────

function cryptTheme(info: MapInfo): Theme {
  const size = info.size;
  const halls: [number, number, number][] = [[17, 30, 7.5], [43, 30, 7.5], [30, 12, 9.5]];
  const inside = (tx: number, ty: number) =>
    (tx >= 25 && tx <= 35 && ty >= 4 && ty <= 58) || halls.some(([hx, hy, r]) => Math.hypot(tx - hx, ty - hy) < r) ||
    (Math.abs(ty - 30) < 2.2 && tx > 10 && tx < 50);
  const statics: Theme["statics"] = [];
  for (let y = 22; y <= 54; y += 6) statics.push(["pillar", 24.6, y, 1, false], ["pillar", 35.4, y, 1, true]);
  statics.push(["coffin", 14, 27, 1, false], ["coffin", 16, 33.5, 1, true], ["coffin", 46, 27, 1, true], ["coffin", 44, 33.5, 1, false]);
  statics.push(["pillar_broken", 20, 25, 1, false], ["pillar_broken", 40, 35, 1, true], ["bonepile", 31, 47, 1, false]);
  const fires: FireSpec[] = [
    [23.5, 8], [36.5, 8], [23.5, 16.5], [36.5, 16.5],
  ].map(([x, y]) => ({ fx: "fire/brazier", wx: x, wy: y, scale: 0.65, light: 220 }));
  for (const [x, y] of [[12, 30], [48, 30], [27, 40], [33, 50], [27, 28], [33, 34]] as [number, number][]) {
    fires.push({ fx: "fire/candle", wx: x, wy: y, scale: 0.8, light: 130 });
  }
  return {
    darkness: 0.68,
    statics,
    fires,
    lamps: [],
    ground(tx, ty) {
      if (!inside(tx, ty)) return { color: 0x07070a, kind: "void" };
      const j = (hash2(tx, ty, 3) - 0.5) * 0.16;
      const boss = Math.hypot(tx - 30, ty - 12) < 9.5;
      return { color: mixHex(boss ? 0x2e2434 : 0x2a2a32, j > 0 ? 0x4a4a56 : 0x101016, Math.abs(j) * 2), kind: "stone" };
    },
    patch(tx, ty, pass) {
      if (pass === 0 && inside(tx, ty) && hash2(tx, ty, 45) < 0.08) return [0x1a3020, 0.35, 26];
      if (pass === 1 && Math.hypot(tx - 30, ty - 12) < 3.5) return [0x5a1e6e, 0.18, 36];
      return null;
    },
    prop(tx, ty) {
      if (!inside(tx, ty) || Math.abs(tx - 30) < 3) return null;
      const h = hash2(tx, ty, 99);
      if (h < 0.025) return { key: "bonepile", ...jitter(tx, ty) };
      if (h < 0.04) return { key: pick(PROP_KEYS.bones, h), ...jitter(tx, ty) };
      if (h < 0.046) return { key: pick(PROP_KEYS.grave, h * 50), ...jitter(tx, ty) };
      return null;
    },
    minimap(tx, ty) {
      return inside(tx, ty) ? (Math.hypot(tx - 30, ty - 12) < 9.5 ? 0x5a3a6a : 0x5a5a66) : 0x050508;
    },
  };
}

// ── Swamp ──────────────────────────────────────────────────────────────

/** Witch's lair at the far end of the swamp, and the causeway that leads there from the entrance. */
const SWAMP_LAIR: [number, number] = [103, 60];
const SWAMP_ROAD: [number, number][] = [[5, 60], [20, 58], [34, 50], [46, 62], [58, 58], [70, 48], [84, 58], [96, 60]];

function swampTheme(info: MapInfo): Theme {
  const size = info.size;
  const [lx, ly] = SWAMP_LAIR;
  const roadDist = (tx: number, ty: number) => {
    let d = Infinity;
    for (let i = 1; i < SWAMP_ROAD.length; i++) {
      const [ax, ay] = SWAMP_ROAD[i - 1], [bx, by] = SWAMP_ROAD[i];
      d = Math.min(d, segDist(tx, ty, ax, ay, bx, by));
    }
    return d;
  };
  const tileInfo = (tx: number, ty: number) => {
    const wet = fbm(tx * 0.06, ty * 0.06, 71);
    const road = roadDist(tx, ty);
    const lair = Math.hypot(tx - lx, ty - ly);
    let clear = 0;
    for (const [cx, cy, r] of info.clearings) {
      const d = Math.hypot(tx - cx, ty - cy);
      if (d < r) clear = Math.max(clear, 1 - d / r);
    }
    const water = wet > 0.58 && road > 2.4 && clear < 0.3 && lair > 12;
    return { wet, road, lair, clear, water };
  };
  const statics: Theme["statics"] = [
    ["tent", 12.2, 55.6, 0.9, false], ["crate", 15.2, 56.4, 1, false], ["barrel", 15.8, 57.2, 0.9, true],
    ["banner", 8.6, 56.4, 1, false], ["logseat", 11.4, 62.8, 1, true],
  ];
  for (let i = 0; i < 10; i++) {
    if (i === 5) continue; // the gap the causeway enters through
    const a = Math.PI + (i / 10) * Math.PI * 2;
    statics.push([i % 3 === 0 ? "pillar" : "pillar_broken", lx + Math.cos(a) * 9, ly + Math.sin(a) * 9, 0.95, i % 2 === 0]);
  }
  statics.push(["bonepile", lx + 3, ly - 4, 1, false], ["bonepile", lx - 4, ly + 3.5, 0.9, true],
    ["coffin", lx + 5.5, ly + 2, 1, true], ["coffin", lx + 1, ly + 6, 1, false]);
  const fires: FireSpec[] = [
    { fx: "fire/campfire", wx: 12.6, wy: 59.2, scale: 1, light: 280 },
    { fx: "fire/brazier", wx: lx - 9.5, wy: ly - 2.4, scale: 0.7, light: 230 },
    { fx: "fire/brazier", wx: lx - 9.5, wy: ly + 2.4, scale: 0.7, light: 230 },
  ];
  for (const [dx, dy] of [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, -5], [5, 0]] as [number, number][]) {
    fires.push({ fx: "fire/candle", wx: lx + dx, wy: ly + dy, scale: 0.8, light: 120 });
  }
  return {
    darkness: 0.55,
    statics,
    fires,
    lamps: [],
    ground(tx, ty) {
      const inf = tileInfo(tx, ty);
      const j = (hash2(tx, ty, 3) - 0.5) * 0.14;
      if (inf.lair < 10.5) {
        return { color: mixHex(0x2a2430, j > 0 ? 0x443a4c : 0x120e16, Math.abs(j) * 2), kind: "stone" };
      }
      if (inf.water) {
        const deep = Math.min(1, (inf.wet - 0.58) * 6);
        return { color: edgeFade(mixHex(mixHex(0x24504a, 0x11302e, deep), 0x3a6a5e, Math.abs(j)), tx, ty, size), kind: "water" };
      }
      let c = mixHex(0x1e2316, 0x2b2c1a, Math.min(1, Math.max(0, (inf.wet - 0.3) * 2.5)));
      c = mixHex(c, j > 0 ? 0x3a3a24 : 0x080a06, Math.abs(j));
      return { color: edgeFade(c, tx, ty, size), kind: inf.road < 1.6 ? "dirt" : "grass" };
    },
    patch(tx, ty, pass) {
      const inf = tileInfo(tx, ty);
      // algae and toxic glow along the water's edge
      if (pass === 0 && !inf.water && inf.wet > 0.52 && inf.lair > 11 && hash2(tx, ty, 47) < 0.45) return [0x3c5a14, 0.38, 34];
      if (pass === 1 && inf.water && hash2(tx, ty, 48) < 0.12) return [0x6affb0, 0.14, 40];
      if (pass === 1 && inf.road < 1.6) return [0x3a3020, 0.7, 30];
      if (pass === 2 && inf.lair < 5) return [0x5a1e6e, 0.22, 40];
      return null;
    },
    prop(tx, ty) {
      for (const p of info.portals) if (Math.hypot(tx - p.x, ty - p.y) < 2.5) return null;
      const inf = tileInfo(tx, ty);
      if (inf.road < 2 || inf.lair < 11 || Math.hypot(tx - 12, ty - 59) < 6) return null;
      const h = hash2(tx, ty, 99), h2 = hash2(tx, ty, 5);
      const open = 1 - inf.clear;
      if (inf.water) return h < 0.025 ? { key: pick(PROP_KEYS.dead, h2 * 3), ...jitter(tx, ty), scale: 0.7 + h2 * 0.3 } : null;
      const table: [number, string[]][] = [
        [0.09 * open * open, PROP_KEYS.dead], [0.02 * open, PROP_KEYS.oak], [0.03 * open, PROP_KEYS.bush],
        [0.025, PROP_KEYS.mushroom], [0.01 * open, PROP_KEYS.stump], [0.006, PROP_KEYS.grave], [0.008, PROP_KEYS.rock],
      ];
      let acc = 0;
      for (const [p, keys] of table) {
        acc += p;
        if (h < acc) return { key: pick(keys, h2 * 3), ...jitter(tx, ty) };
      }
      return null;
    },
    minimap(tx, ty) {
      const inf = tileInfo(tx, ty);
      if (inf.lair < 10.5) return 0x4a3a56;
      if (inf.water) return 0x2a5a52;
      if (inf.road < 1.6) return 0x7a6a48;
      return edgeFade(inf.wet > 0.5 ? 0x34402a : 0x3e4428, tx, ty, size, 3);
    },
  };
}

// ── Mine ───────────────────────────────────────────────────────────────

/** Main shaft of the mine (row y = MINE_SHAFT_Y); every chamber (map clearing) has a corridor down to it. */
const MINE_SHAFT_Y = 35;

function mineTheme(info: MapInfo): Theme {
  const size = info.size;
  const chambers = info.clearings;
  const inChamber = (tx: number, ty: number) => chambers.some(([cx, cy, r]) => Math.hypot(tx - cx, ty - cy) < r);
  const inShaft = (tx: number, ty: number) => Math.abs(ty - MINE_SHAFT_Y) < 2.6 && tx > 1.5 && tx < size - 3;
  const inCorridor = (tx: number, ty: number) => chambers.some(([cx, cy]) =>
    Math.abs(tx - cx) < 1.9 && ty >= Math.min(cy, MINE_SHAFT_Y) && ty <= Math.max(cy, MINE_SHAFT_Y));
  const inside = (tx: number, ty: number) => inShaft(tx, ty) || inChamber(tx, ty) || inCorridor(tx, ty);
  const statics: Theme["statics"] = [
    ["crate", 6.5, 32.4, 1, false], ["crate", 7.4, 31.8, 0.9, true], ["barrel", 5.6, 37.8, 1, false],
    ["barrel", 6.4, 38.2, 0.9, true], ["banner", 4.2, 32.6, 1, false],
  ];
  for (let x = 14; x < size - 6; x += 12) statics.push(["pillar_broken", x, MINE_SHAFT_Y - 2.3, 0.75, x % 24 === 2]);
  const fires: FireSpec[] = [];
  for (let x = 8; x < size - 4; x += 10) fires.push({ fx: "fire/brazier", wx: x, wy: MINE_SHAFT_Y + 2.2, scale: 0.55, light: 200 });
  for (const [cx, cy] of chambers) fires.push({ fx: "fire/candle", wx: cx + 1.5, wy: cy - 1.5, scale: 0.8, light: 150 });
  return {
    darkness: 0.66,
    statics,
    fires,
    lamps: [],
    ground(tx, ty) {
      if (!inside(tx, ty)) {
        const j = hash2(tx, ty, 5) * 0.4;
        return { color: mixHex(0x0b0a09, 0x1a1714, j), kind: "void" };
      }
      const j = (hash2(tx, ty, 3) - 0.5) * 0.16;
      const deep = Math.min(1, tx / size); // the rock gets darker and bluer towards the deep end
      const base = mixHex(0x3a332b, 0x2a2a34, deep);
      return { color: mixHex(base, j > 0 ? 0x564c40 : 0x16130f, Math.abs(j) * 2), kind: inChamber(tx, ty) ? "stone" : "dirt" };
    },
    patch(tx, ty, pass) {
      if (!inside(tx, ty)) return null;
      if (pass === 0 && hash2(tx, ty, 49) < 0.1) return [0x221c16, 0.5, 30];
      if (pass === 1 && inShaft(tx, ty) && Math.abs(ty - MINE_SHAFT_Y) < 0.6) return [0x4a3a28, 0.55, 22]; // cart track dust
      return null;
    },
    prop(tx, ty) {
      for (const p of info.portals) if (Math.hypot(tx - p.x, ty - p.y) < 2.5) return null;
      if (!inside(tx, ty) || inShaft(tx, ty) && Math.abs(ty - MINE_SHAFT_Y) < 1.6) return null;
      const edge = !inside(tx + 1, ty) || !inside(tx - 1, ty) || !inside(tx, ty + 1) || !inside(tx, ty - 1);
      const h = hash2(tx, ty, 99);
      if (edge && h < 0.22) return { key: pick(PROP_KEYS.rock, hash2(tx, ty, 5) * 3), ...jitter(tx, ty), scale: 0.6 + h };
      return null;
    },
    minimap(tx, ty) {
      if (!inside(tx, ty)) return 0x060606;
      return inChamber(tx, ty) ? 0x6a6056 : 0x4e463e;
    },
  };
}

// ── Arena ──────────────────────────────────────────────────────────────

function arenaTheme(info: MapInfo): Theme {
  const size = info.size, cx = 15, cy = 15;
  const d = (tx: number, ty: number) => Math.hypot(tx - cx, ty - cy);
  const statics: Theme["statics"] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    if (i === 3) continue;
    statics.push([i % 3 === 0 ? "pillar" : "pillar_broken", cx + Math.cos(a) * 12.6, cy + Math.sin(a) * 12.6, 0.9, i % 2 === 0]);
  }
  statics.push(["rack", 6.5, 9, 1, false], ["rack", 23.5, 9, 1, true], ["banner", 11.5, 3.2, 1, false], ["banner", 18.5, 3.2, 1, true]);
  return {
    darkness: 0.4,
    statics,
    fires: [[cx - 9, cy - 9], [cx + 9, cy - 9], [cx - 9, cy + 9], [cx + 9, cy + 9]].map(([x, y]) =>
      ({ fx: "fire/brazier", wx: x, wy: y, scale: 0.65, light: 230 })),
    lamps: [],
    ground(tx, ty) {
      const r = d(tx, ty), j = (hash2(tx, ty, 3) - 0.5) * 0.14;
      if (r < 11) return { color: mixHex(0x8a6e48, j > 0 ? 0xa88a5c : 0x5a4630, Math.abs(j) * 2), kind: "sand" };
      if (r < 13.8 || (Math.abs(tx - cx) < 2 && ty > cy)) return { color: mixHex(0x4a4650, j > 0 ? 0x6a6670 : 0x2a2830, Math.abs(j) * 2), kind: "stone" };
      return { color: edgeFade(0x14121a, tx, ty, size, 3), kind: "void" };
    },
    patch(tx, ty, pass) {
      if (pass === 0 && d(tx, ty) < 10 && hash2(tx, ty, 46) < 0.1) return [0x5a1414, 0.3, 24];
      return null;
    },
    prop() {
      return null;
    },
    minimap(tx, ty) {
      const r = d(tx, ty);
      return r < 11 ? 0xa88a5c : r < 13.8 ? 0x6a6670 : 0x0a0a0e;
    },
  };
}

// ── Frozen peaks ───────────────────────────────────────────────────────

/** The Lich's citadel at the far end of the peaks, and the trail that climbs there from the entrance. */
const FROST_CITADEL: [number, number] = [114, 65];
const FROST_ROAD: [number, number][] = [[4, 65], [18, 64], [32, 56], [44, 64], [56, 60], [68, 70], [82, 62], [96, 66], [104, 65]];

function frostTheme(info: MapInfo): Theme {
  const size = info.size;
  const [cx, cy] = FROST_CITADEL;
  const roadDist = (tx: number, ty: number) => {
    let d = Infinity;
    for (let i = 1; i < FROST_ROAD.length; i++) {
      const [ax, ay] = FROST_ROAD[i - 1], [bx, by] = FROST_ROAD[i];
      d = Math.min(d, segDist(tx, ty, ax, ay, bx, by));
    }
    return d;
  };
  const tileInfo = (tx: number, ty: number) => {
    const drift = fbm(tx * 0.05, ty * 0.05, 83);
    const lake = fbm(tx * 0.035 + 20, ty * 0.035 + 20, 89);
    const road = roadDist(tx, ty);
    const keep = Math.hypot(tx - cx, ty - cy);
    let clear = 0;
    for (const [x, y, r] of info.clearings) {
      const d = Math.hypot(tx - x, ty - y);
      if (d < r) clear = Math.max(clear, 1 - d / r);
    }
    const ice = lake > 0.62 && road > 2.6 && clear < 0.2 && keep > 14;
    const rocky = !ice && drift > 0.64 && road > 2;
    return { drift, lake, road, keep, clear, ice, rocky };
  };
  const statics: Theme["statics"] = [
    ["tent", 12.4, 60.6, 0.9, false], ["crate", 15.4, 61.4, 1, false], ["barrel", 16, 62.2, 0.9, true],
    ["banner", 8.8, 61.2, 1, false], ["logseat", 11.6, 67.8, 1, true],
  ];
  // the citadel: a ring of ice-bitten pillars around a courtyard, with frozen statues of its victims
  for (let i = 0; i < 12; i++) {
    if (i === 6) continue; // the gate the trail enters through
    const a = Math.PI + (i / 12) * Math.PI * 2;
    statics.push([i % 3 === 0 ? "pillar" : i % 3 === 1 ? "pillar_broken" : FROST_PROPS.crystal[i % 2], cx + Math.cos(a) * 10.5,
      cy + Math.sin(a) * 10.5, 1, i % 2 === 0]);
  }
  statics.push(["statue", cx + 4, cy - 5, 0.9, false], ["statue", cx + 4, cy + 5, 0.9, true],
    [FROST_PROPS.crystal[0], cx + 7, cy, 1.2, false], ["bonepile", cx - 3, cy - 4, 1, false], ["bonepile", cx - 2, cy + 4.5, 0.9, true]);
  // ruins of the old watch posts where the sentinels stand guard
  for (const [x, y] of [[54, 38], [56, 92]] as [number, number][]) {
    statics.push(["pillar_broken", x - 4, y - 3, 1, false], ["pillar", x + 4, y - 3.5, 0.95, true], ["pillar_broken", x + 3, y + 4, 0.9, false],
      ["coffin", x - 2, y + 3, 1, true]);
  }
  const fires: FireSpec[] = [
    { fx: "fire/campfire", wx: 12.8, wy: 64.2, scale: 1, light: 300 },
    { fx: "fire/brazier", wx: cx - 11, wy: cy - 2.6, scale: 0.75, light: 240 },
    { fx: "fire/brazier", wx: cx - 11, wy: cy + 2.6, scale: 0.75, light: 240 },
  ];
  for (const [dx, dy] of [[-4, -4], [-4, 4], [0, -6], [0, 6], [6, -3], [6, 3]] as [number, number][]) {
    fires.push({ fx: "fire/candle", wx: cx + dx, wy: cy + dy, scale: 0.8, light: 120 });
  }
  return {
    darkness: 0.46,
    statics,
    fires,
    lamps: [],
    ground(tx, ty) {
      const inf = tileInfo(tx, ty);
      const j = (hash2(tx, ty, 3) - 0.5) * 0.12;
      if (inf.keep < 12.5) {
        return { color: mixHex(0x5a6474, j > 0 ? 0x8a94a4 : 0x2a303a, Math.abs(j) * 2), kind: "stone" };
      }
      if (inf.ice) {
        const deep = Math.min(1, (inf.lake - 0.62) * 5);
        return { color: edgeFade(mixHex(mixHex(0x8ac4dc, 0x4a86a8, deep), 0xd0f0ff, Math.abs(j) * 1.5), tx, ty, size), kind: "ice" };
      }
      if (inf.rocky) return { color: edgeFade(mixHex(0x5e6672, j > 0 ? 0x7a8290 : 0x30343c, Math.abs(j) * 2), tx, ty, size), kind: "stone" };
      let c = mixHex(0xa8b4c6, 0xcdd8e6, Math.min(1, Math.max(0, (inf.drift - 0.3) * 2.2)));
      c = mixHex(c, j > 0 ? 0xeef4ff : 0x6a7890, Math.abs(j));
      if (inf.road < 1.7) c = mixHex(c, 0x7a7468, 0.55);
      return { color: edgeFade(c, tx, ty, size), kind: inf.road < 1.7 ? "dirt" : "snow" };
    },
    patch(tx, ty, pass) {
      const inf = tileInfo(tx, ty);
      // blue shadows in the drifts, frost glinting on the lakes and a cold glow around the citadel
      if (pass === 0 && !inf.ice && inf.drift < 0.36 && hash2(tx, ty, 57) < 0.4) return [0x5a6a8a, 0.3, 36];
      if (pass === 1 && inf.ice && hash2(tx, ty, 58) < 0.1) return [0xe8ffff, 0.22, 34];
      if (pass === 1 && inf.road < 1.7) return [0x5a5248, 0.45, 28];
      if (pass === 2 && inf.keep < 6) return [0x5fd8ff, 0.2, 44];
      return null;
    },
    prop(tx, ty) {
      for (const p of info.portals) if (Math.hypot(tx - p.x, ty - p.y) < 2.5) return null;
      const inf = tileInfo(tx, ty);
      if (inf.road < 2 || inf.keep < 13 || inf.ice || Math.hypot(tx - 12, ty - 64) < 6) return null;
      const h = hash2(tx, ty, 99), h2 = hash2(tx, ty, 5);
      const open = 1 - inf.clear;
      const table: [number, string[]][] = [
        [(inf.rocky ? 0.03 : 0.11) * open * open, FROST_PROPS.pine], [0.012 * open, PROP_KEYS.dead],
        [inf.rocky ? 0.05 : 0.012, FROST_PROPS.rock], [inf.lake > 0.56 ? 0.03 : 0.006, FROST_PROPS.crystal], [0.004, PROP_KEYS.grave],
      ];
      let acc = 0;
      for (const [p, keys] of table) {
        acc += p;
        if (h < acc) return { key: pick(keys, h2 * 3), ...jitter(tx, ty) };
      }
      return null;
    },
    minimap(tx, ty) {
      const inf = tileInfo(tx, ty);
      if (inf.keep < 12.5) return 0x6a7a96;
      if (inf.ice) return 0x6ab0d0;
      if (inf.road < 1.7) return 0x8a8070;
      if (inf.rocky) return 0x5a626e;
      return edgeFade(inf.drift > 0.5 ? 0xc8d4e2 : 0xa8b6c8, tx, ty, size, 3);
    },
  };
}

// ── Chapter IV-VII regions ─────────────────────────────────────────────
// Same layout as the frozen peaks (camp in the west, trail east to the boss's lair), dressed per region.

interface RegionStyle {
  darkness: number;
  ground: [number, number];      // low / high colour of the open ground
  path: number;                  // the trail
  rock: number;                  // bare rocky patches
  pool: number;                  // pools (lava, blood, ectoplasm, void) — flat, no props
  poolKind: Kind;
  poolGlow: [number, number];    // glow colour / alpha painted over the pools
  lair: [number, number];        // lair floor colours
  lairGlow: number;
  ring: string[];                // what stands around the lair
  props: (rocky: boolean, open: number) => [number, string[]][];
  extra?: (statics: Theme["statics"]) => void;
  fires: "brazier" | "candle";
}

const REGION_STYLE: Record<string, RegionStyle> = {
  ash: {
    darkness: 0.5, ground: [0x2e2a28, 0x46403a], path: 0x5a4632, rock: 0x3a3634, pool: 0xc0400e, poolKind: "stone",
    poolGlow: [0xff6a1a, 0.35], lair: [0x2a2220, 0x4a3a32], lairGlow: 0xff5a1a, ring: ["pillar_broken", "pillar"], fires: "brazier",
    props: (rocky, open) => [[0.05 * open * open, PROP_KEYS.dead], [rocky ? 0.05 : 0.015, PROP_KEYS.rockBare], [0.006, PROP_KEYS.bones],
      [0.004, PROP_KEYS.grave]],
  },
  crimson: {
    darkness: 0.56, ground: [0x2a1618, 0x3e2022], path: 0x4a2a22, rock: 0x3a2428, pool: 0x6a0a14, poolKind: "water",
    poolGlow: [0xc0102a, 0.22], lair: [0x2a1418, 0x4a2028], lairGlow: 0xe0203a, ring: ["pillar", "statue"], fires: "candle",
    props: (rocky, open) => [[0.07 * open * open, PROP_KEYS.dead], [0.02, PROP_KEYS.mushroom], [0.01, PROP_KEYS.bones],
      [rocky ? 0.04 : 0.01, PROP_KEYS.rockBare], [0.006, PROP_KEYS.grave]],
  },
  ghost: {
    darkness: 0.56, ground: [0x1e2622, 0x2c3630], path: 0x4a4a44, rock: 0x3a403c, pool: 0x1a3a2e, poolKind: "water",
    poolGlow: [0x7affb0, 0.16], lair: [0x2a302c, 0x4a524c], lairGlow: 0x7affb0, ring: ["pillar", "pillar_broken", "statue"], fires: "candle",
    props: (rocky, open) => [[0.05 * open * open, PROP_KEYS.dead], [0.02 * open, PROP_KEYS.pine], [0.012, PROP_KEYS.grave],
      [rocky ? 0.04 : 0.01, PROP_KEYS.rockBare], [0.006, PROP_KEYS.bones]],
    extra: (statics) => {
      // the ruined city: broken columns and statues all over the old streets
      for (let i = 0; i < 28; i++) {
        const x = 20 + ((i * 37) % 86), y = 22 + ((i * 53) % 88);
        if (Math.hypot(x - 114, y - 65) < 14 || Math.hypot(x - 12, y - 64) < 8) continue;
        statics.push([i % 4 === 0 ? "statue" : i % 2 ? "pillar_broken" : "pillar", x, y, 0.9 + (i % 3) * 0.05, i % 2 === 0]);
      }
    },
  },
  void: {
    darkness: 0.6, ground: [0x16121e, 0x221a2e], path: 0x3a3048, rock: 0x2a2236, pool: 0x0a0610, poolKind: "void",
    poolGlow: [0xb05cff, 0.2], lair: [0x1e1828, 0x3a2e4a], lairGlow: 0xb05cff, ring: ["pillar", FROST_PROPS.crystal[0]], fires: "candle",
    props: (rocky, open) => [[0.03 * open, FROST_PROPS.crystal], [rocky ? 0.05 : 0.015, PROP_KEYS.rockBare], [0.02 * open * open, PROP_KEYS.dead]],
  },
};

function regionTheme(info: MapInfo, st: RegionStyle): Theme {
  const size = info.size;
  const [cx, cy] = FROST_CITADEL;
  const roadDist = (tx: number, ty: number) => {
    let d = Infinity;
    for (let i = 1; i < FROST_ROAD.length; i++) {
      const [ax, ay] = FROST_ROAD[i - 1], [bx, by] = FROST_ROAD[i];
      d = Math.min(d, segDist(tx, ty, ax, ay, bx, by));
    }
    return Math.min(d, segDist(tx, ty, 96, 66, 110, 30)); // the branch to the way onward
  };
  const tileInfo = (tx: number, ty: number) => {
    const n1 = fbm(tx * 0.05, ty * 0.05, 131);
    const n2 = fbm(tx * 0.04 + 30, ty * 0.04 + 30, 137);
    const road = roadDist(tx, ty);
    const keep = Math.hypot(tx - cx, ty - cy);
    let clear = 0;
    for (const [x, y, r] of info.clearings) {
      const d = Math.hypot(tx - x, ty - y);
      if (d < r) clear = Math.max(clear, 1 - d / r);
    }
    const pool = n2 > 0.63 && road > 2.6 && clear < 0.2 && keep > 14;
    const rocky = !pool && n1 > 0.64 && road > 2;
    return { n1, road, keep, clear, pool, rocky };
  };
  const statics: Theme["statics"] = [
    ["tent", 12.4, 60.6, 0.9, false], ["crate", 15.4, 61.4, 1, false], ["barrel", 16, 62.2, 0.9, true],
    ["banner", 8.8, 61.2, 1, false], ["logseat", 11.6, 67.8, 1, true],
  ];
  for (let i = 0; i < 12; i++) {
    if (i === 6) continue;
    const a = Math.PI + (i / 12) * Math.PI * 2;
    statics.push([st.ring[i % st.ring.length], cx + Math.cos(a) * 10.5, cy + Math.sin(a) * 10.5, 1, i % 2 === 0]);
  }
  statics.push(["bonepile", cx - 3, cy - 4, 1, false], ["bonepile", cx - 2, cy + 4.5, 0.9, true], ["coffin", cx + 5, cy + 2, 1, true]);
  st.extra?.(statics);
  const fires: FireSpec[] = [
    { fx: "fire/campfire", wx: 12.8, wy: 64.2, scale: 1, light: 300 },
    { fx: "fire/brazier", wx: cx - 11, wy: cy - 2.6, scale: 0.75, light: 240 },
    { fx: "fire/brazier", wx: cx - 11, wy: cy + 2.6, scale: 0.75, light: 240 },
  ];
  for (const [dx, dy] of [[-4, -4], [-4, 4], [0, -6], [0, 6], [6, -3], [6, 3]] as [number, number][]) {
    fires.push(st.fires === "brazier" ? { fx: "fire/brazier", wx: cx + dx, wy: cy + dy, scale: 0.55, light: 160 }
      : { fx: "fire/candle", wx: cx + dx, wy: cy + dy, scale: 0.8, light: 120 });
  }
  return {
    darkness: st.darkness,
    statics,
    fires,
    lamps: [],
    ground(tx, ty) {
      const inf = tileInfo(tx, ty);
      const j = (hash2(tx, ty, 3) - 0.5) * 0.14;
      if (inf.keep < 12.5) return { color: mixHex(st.lair[0], j > 0 ? st.lair[1] : 0x08060a, Math.abs(j) * 2), kind: "stone" };
      if (inf.pool) return { color: edgeFade(mixHex(st.pool, 0x000000, Math.abs(j)), tx, ty, size), kind: st.poolKind };
      if (inf.rocky) return { color: edgeFade(mixHex(st.rock, j > 0 ? 0x5a5a5a : 0x080808, Math.abs(j)), tx, ty, size), kind: "stone" };
      let c = mixHex(st.ground[0], st.ground[1], Math.min(1, Math.max(0, (inf.n1 - 0.3) * 2.2)));
      c = mixHex(c, j > 0 ? 0x606060 : 0x050505, Math.abs(j) * 0.6);
      if (inf.road < 1.7) c = mixHex(c, st.path, 0.7);
      return { color: edgeFade(c, tx, ty, size), kind: inf.road < 1.7 ? "dirt" : "sand" };
    },
    patch(tx, ty, pass) {
      const inf = tileInfo(tx, ty);
      if (pass === 1 && inf.pool && hash2(tx, ty, 58) < 0.25) return [st.poolGlow[0], st.poolGlow[1], 40];
      if (pass === 1 && inf.road < 1.7) return [st.path, 0.4, 28];
      if (pass === 2 && inf.keep < 6) return [st.lairGlow, 0.2, 44];
      return null;
    },
    prop(tx, ty) {
      for (const p of info.portals) if (Math.hypot(tx - p.x, ty - p.y) < 2.5) return null;
      const inf = tileInfo(tx, ty);
      if (inf.road < 2 || inf.keep < 13 || inf.pool || Math.hypot(tx - 12, ty - 64) < 6) return null;
      const h = hash2(tx, ty, 99), h2 = hash2(tx, ty, 5);
      let acc = 0;
      for (const [p, keys] of st.props(inf.rocky, 1 - inf.clear)) {
        acc += p;
        if (h < acc) return { key: pick(keys, h2 * 3), ...jitter(tx, ty) };
      }
      return null;
    },
    minimap(tx, ty) {
      const inf = tileInfo(tx, ty);
      if (inf.keep < 12.5) return mixHex(st.lair[1], 0xffffff, 0.2);
      if (inf.pool) return mixHex(st.pool, st.poolGlow[0], 0.4);
      if (inf.road < 1.7) return mixHex(st.path, 0xffffff, 0.25);
      return edgeFade(mixHex(inf.rocky ? st.rock : st.ground[1], 0xffffff, 0.12), tx, ty, size, 3);
    },
  };
}

export function themeFor(info: MapInfo): Theme {
  switch (info.theme) {
    case "town": return townTheme(info);
    case "crypt": return cryptTheme(info);
    case "arena": return arenaTheme(info);
    case "swamp": return swampTheme(info);
    case "mine": return mineTheme(info);
    case "frost": return frostTheme(info);
    case "ash": case "crimson": case "ghost": case "void": return regionTheme(info, REGION_STYLE[info.theme]);
    default: return forestTheme(info);
  }
}

/** One pixel per tile overview of a map, for the minimap. */
export function terrainMapTexture(scene: Phaser.Scene, info: MapInfo): string {
  const key = `terrain_${info.map_id}`;
  if (scene.textures.exists(key)) return key;
  const theme = themeFor(info);
  const n = info.size;
  const tex = scene.textures.createCanvas(key, n, n)!;
  const img = tex.context.createImageData(n, n);
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const c = theme.minimap(tx, ty);
      const i = (ty * n + tx) * 4;
      img.data[i] = (c >> 16) & 255; img.data[i + 1] = (c >> 8) & 255; img.data[i + 2] = c & 255; img.data[i + 3] = 255;
    }
  }
  tex.context.putImageData(img, 0, 0);
  for (const p of info.portals) {
    tex.context.fillStyle = p.locked ? "#6a6670" : "#c684ff";
    tex.context.beginPath(); tex.context.arc(p.x, p.y, Math.max(1.2, n / 60), 0, Math.PI * 2); tex.context.fill();
  }
  tex.refresh();
  return key;
}

interface PropObj {
  img: Phaser.GameObjects.Image;
  glow?: Phaser.GameObjects.Image;
  shadow?: Phaser.GameObjects.Image;
  tall: boolean;
}

export class WorldRenderer {
  readonly theme: Theme;
  readonly size: number;
  private chunks = new Map<string, Phaser.GameObjects.Image>();
  private pending: [number, number][] = [];
  private props = new Map<string, PropObj | null>();
  private tall: PropObj[] = [];
  private center = { x: -999, y: -999 };
  private glows: PropObj[] = [];
  private staticLights: LightSource[] = [];
  private owned: Phaser.GameObjects.GameObject[] = [];

  constructor(private scene: Phaser.Scene, private info: MapInfo) {
    ensureDecals(scene);
    this.theme = themeFor(info);
    this.size = info.size;
    for (const [key, wx, wy, scale, flip] of this.theme.statics) {
      const { sx, sy } = worldToScreen(wx, wy);
      const [ox, oy] = THEME_ORIGIN[key] ?? CAMP_ORIGIN[key] ?? [0.5, 0.9];
      const img = scene.add.image(sx, sy, key).setOrigin(ox, oy).setScale(scale).setFlipX(flip).setDepth(sy);
      this.owned.push(img);
      if (key.startsWith("house") || key === "statue" || key === "pillar") this.tall.push({ img, tall: true });
    }
    for (const f of this.theme.fires) {
      const { sx, sy } = worldToScreen(f.wx, f.wy);
      this.staticLights.push({ x: sx, y: sy - 18, r: f.light, a: 1, flicker: 0.12 });
    }
    for (const [x, y] of this.theme.lamps) {
      const { sx, sy } = worldToScreen(x, y);
      this.staticLights.push({ x: sx, y: sy - 60, r: 150, a: 0.85, flicker: 0.04 });
      this.owned.push(scene.add.image(sx, sy - 68, "glow_warm").setBlendMode(Phaser.BlendModes.ADD).setScale(0.9).setAlpha(0.45).setDepth(sy + 1));
    }
  }

  lights(): LightSource[] {
    const out = [...this.staticLights];
    for (const g of this.glows) out.push({ x: g.img.x, y: g.img.y - 8, r: 70 * g.img.scaleX, a: 0.55, flicker: 0.04 });
    return out;
  }

  update(wx: number, wy: number, radius: number, immediate = false): void {
    const ctx = Math.round(wx), cty = Math.round(wy);
    if (immediate || Math.abs(ctx - this.center.x) > 3 || Math.abs(cty - this.center.y) > 3) {
      this.center = { x: ctx, y: cty };
      this.refreshChunks(ctx, cty, radius);
      this.refreshProps(ctx, cty, radius);
    }
    const budget = immediate ? Infinity : 1;
    for (let i = 0; i < budget && this.pending.length; i++) {
      const [cx, cy] = this.pending.shift()!;
      const key = `${cx}_${cy}`;
      if (!this.chunks.has(key)) this.chunks.set(key, this.renderChunk(cx, cy));
    }
  }

  /** Sway trees and fade anything tall standing in front of the given screen position. */
  updateOcclusion(sx: number, sy: number, time: number): void {
    for (const p of this.tall) {
      const img = p.img;
      if (img.texture.key.startsWith("tree")) {
        img.rotation = Math.sin(time * 0.0011 + img.x * 0.013 + img.y * 0.007) * 0.016 + Math.sin(time * 0.0031 + img.x) * 0.004;
      }
      const behind = img.y > sy && img.y - img.displayHeight * 0.95 < sy - 10 && Math.abs(img.x - sx) < img.displayWidth * 0.38;
      img.alpha += ((behind ? 0.38 : 1) - img.alpha) * 0.15;
    }
  }

  /** Rest mode: free every painted ground chunk; update() paints them again around the hero on return. */
  dropChunks(): void {
    for (const [key, img] of this.chunks) {
      img.destroy();
      this.scene.textures.remove(`chunk_${this.info.map_id}_${key}`);
    }
    this.chunks.clear();
    this.pending = [];
  }

  destroy(): void {
    for (const [key, img] of this.chunks) {
      img.destroy();
      this.scene.textures.remove(`chunk_${this.info.map_id}_${key}`);
    }
    this.chunks.clear();
    this.pending = [];
    for (const obj of this.props.values()) this.removeProp(obj);
    this.props.clear();
    for (const o of this.owned) o.destroy();
    this.owned = [];
    this.tall = [];
    this.glows = [];
  }

  private refreshChunks(tx: number, ty: number, radius: number): void {
    const n = this.size;
    const c0x = Math.floor(Math.max(0, tx - radius) / CHUNK), c1x = Math.floor(Math.min(n - 1, tx + radius) / CHUNK);
    const c0y = Math.floor(Math.max(0, ty - radius) / CHUNK), c1y = Math.floor(Math.min(n - 1, ty + radius) / CHUNK);
    const want = new Set<string>();
    const queue: [number, number, number][] = [];
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        const key = `${cx}_${cy}`;
        want.add(key);
        if (!this.chunks.has(key)) queue.push([cx, cy, Math.hypot(cx * CHUNK + CHUNK / 2 - tx, cy * CHUNK + CHUNK / 2 - ty)]);
      }
    }
    for (const [key, img] of this.chunks) {
      if (!want.has(key)) {
        img.destroy();
        this.scene.textures.remove(`chunk_${this.info.map_id}_${key}`);
        this.chunks.delete(key);
      }
    }
    queue.sort((a, b) => a[2] - b[2]);
    this.pending = queue.map(([cx, cy]) => [cx, cy]);
  }

  private renderChunk(cx: number, cy: number): Phaser.GameObjects.Image {
    const n = this.size, theme = this.theme;
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const left = (x0 - y0 - CHUNK) * (TILE_W / 2) - PAD;
    const top = (x0 + y0) * (TILE_H / 2) - TILE_H / 2 - PAD;
    const W = CHUNK * TILE_W + PAD * 2, H = CHUNK * TILE_H + PAD * 2;
    const key = `chunk_${this.info.map_id}_${cx}_${cy}`;
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const tex = this.scene.textures.createCanvas(key, W, H)!;
    const c = tex.getContext();
    c.translate(-left, -top);

    const T = worldToScreen(x0, y0), R = worldToScreen(x0 + CHUNK - 1, y0);
    const B = worldToScreen(x0 + CHUNK - 1, y0 + CHUNK - 1), L = worldToScreen(x0, y0 + CHUNK - 1);
    c.beginPath();
    c.moveTo(T.sx, T.sy - TILE_H / 2 - 2);
    c.lineTo(R.sx + TILE_W / 2 + 3, R.sy);
    c.lineTo(B.sx, B.sy + TILE_H / 2 + 2);
    c.lineTo(L.sx - TILE_W / 2 - 3, L.sy);
    c.closePath();
    c.clip();

    const inMap = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < n && ty < n;
    const cache = new Map<number, { color: number; kind: Kind }>();
    const ground = (tx: number, ty: number) => {
      const k = tx * 1000 + ty;
      let v = cache.get(k);
      if (!v) { v = theme.ground(tx, ty); cache.set(k, v); }
      return v;
    };
    const diamond = (sx: number, sy: number, grow: number) => {
      c.beginPath();
      c.moveTo(sx, sy - TILE_H / 2 - grow);
      c.lineTo(sx + TILE_W / 2 + grow * 1.5, sy);
      c.lineTo(sx, sy + TILE_H / 2 + grow);
      c.lineTo(sx - TILE_W / 2 - grow * 1.5, sy);
      c.closePath();
    };

    // base colours: painted on a bigger off-screen canvas and blurred, so grass melts into dirt, dirt into
    // stone… instead of meeting at hard diamond edges (the margin keeps the blur seamless between chunks)
    const M = BLEND_MARGIN;
    const base = document.createElement("canvas");
    base.width = W + M * 2;
    base.height = H + M * 2;
    const b = base.getContext("2d")!;
    b.translate(-left + M, -top + M);
    for (let tx = x0 - 3; tx <= x0 + CHUNK + 2; tx++) {
      for (let ty = y0 - 3; ty <= y0 + CHUNK + 2; ty++) {
        if (!inMap(tx, ty)) continue;
        const { sx, sy } = worldToScreen(tx, ty);
        b.beginPath();
        b.moveTo(sx, sy - TILE_H / 2 - 1);
        b.lineTo(sx + TILE_W / 2 + 1.5, sy);
        b.lineTo(sx, sy + TILE_H / 2 + 1);
        b.lineTo(sx - TILE_W / 2 - 1.5, sy);
        b.closePath();
        b.fillStyle = col(ground(tx, ty).color);
        b.fill();
      }
    }
    c.filter = gfx().blend ? `blur(${BLEND_BLUR}px)` : "none";
    c.drawImage(base, left - M, top - M);
    c.filter = "none";

    if (theme.patch) {
      const M = 3;
      for (let pass = 0; pass < 3; pass++) {
        for (let tx = x0 - M; tx < x0 + CHUNK + M; tx++) {
          for (let ty = y0 - M; ty < y0 + CHUNK + M; ty++) {
            if (!inMap(tx, ty)) continue;
            const p = theme.patch(tx, ty, pass);
            if (!p) continue;
            const [hex, a, r] = p;
            const { sx, sy } = worldToScreen(tx, ty);
            c.save();
            c.translate(sx, sy);
            c.scale(1, 0.5);
            c.fillStyle = radial(c, 0, 0, r, [[0, col(hex, 1, a)], [0.6, col(hex, 1, a * 0.7)], [1, col(hex, 1, 0)]]);
            c.fillRect(-r, -r, r * 2, r * 2);
            c.restore();
          }
        }
      }
    }

    const byKind = new Map<string, Path2D>();
    for (let tx = x0 - 1; tx <= x0 + CHUNK; tx++) {
      for (let ty = y0 - 1; ty <= y0 + CHUNK; ty++) {
        if (!inMap(tx, ty)) continue;
        const kind = ground(tx, ty).kind;
        let path = byKind.get(kind);
        if (!path) { path = new Path2D(); byKind.set(kind, path); }
        const { sx, sy } = worldToScreen(tx, ty);
        path.moveTo(sx, sy - TILE_H / 2 - 1);
        path.lineTo(sx + TILE_W / 2 + 1.5, sy);
        path.lineTo(sx, sy + TILE_H / 2 + 1);
        path.lineTo(sx - TILE_W / 2 - 1.5, sy);
        path.closePath();
      }
    }
    for (const [kind, path] of byKind) {
      const pat = groundPattern(c, kind);
      if (!pat) continue;
      c.save();
      c.clip(path);
      c.globalCompositeOperation = "soft-light";
      c.globalAlpha = TEXTURE_STRENGTH;
      c.fillStyle = pat;
      c.fillRect(left, top, W, H);
      c.restore();
    }

    const light = new Path2D(), dark = new Path2D(), seams = new Path2D(), specks = new Path2D(), ripples = new Path2D();
    const glints = new Path2D();
    for (let tx = x0 - 1; tx <= x0 + CHUNK; tx++) {
      for (let ty = y0 - 1; ty <= y0 + CHUNK; ty++) {
        if (!inMap(tx, ty)) continue;
        const kind = ground(tx, ty).kind;
        const { sx, sy } = worldToScreen(tx, ty);
        if (kind === "grass") {
          for (let i = 0; i < 8; i++) {
            const u = hash2(tx * 8 + i, ty, 51) - 0.5, v = hash2(tx, ty * 8 + i, 52) - 0.5;
            const px = sx + (u - v) * (TILE_W / 2), py = sy + (u + v) * (TILE_H / 2);
            const p = i % 2 ? light : dark;
            p.moveTo(px, py);
            p.lineTo(px + (hash2(i, tx, 54) - 0.5) * 2, py - 2 - hash2(tx + i, ty - i, 53) * 3);
          }
        } else if (kind === "stone") {
          seams.moveTo(sx, sy - TILE_H / 2);
          seams.lineTo(sx + TILE_W / 2, sy);
          seams.moveTo(sx, sy - TILE_H / 2);
          seams.lineTo(sx - TILE_W / 2, sy);
          if (hash2(tx, ty, 71) < 0.25) {
            const u = hash2(tx, ty, 72) - 0.5;
            seams.moveTo(sx + u * 20, sy - 6);
            seams.lineTo(sx + u * 20 + 6, sy);
            seams.lineTo(sx + u * 20 + 2, sy + 6);
          }
        } else if (kind === "water") {
          // a few flat ripples catching the light
          for (let i = 0; i < 2; i++) {
            if (hash2(tx * 3 + i, ty, 91) > 0.55) continue;
            const u = hash2(tx * 5 + i, ty, 92) - 0.5, v = hash2(tx, ty * 5 + i, 93) - 0.5;
            const px = sx + (u - v) * (TILE_W / 2) * 0.8, py = sy + (u + v) * (TILE_H / 2) * 0.8;
            const w = 4 + hash2(tx, ty, 94 + i) * 7;
            ripples.moveTo(px - w, py);
            ripples.quadraticCurveTo(px, py - 1.5, px + w, py);
          }
        } else if (kind === "snow") {
          // glints in the snow
          for (let i = 0; i < 5; i++) {
            if (hash2(tx * 5 + i, ty, 95) > 0.5) continue;
            const u = hash2(tx * 7 + i, ty, 96) - 0.5, v = hash2(tx, ty * 7 + i, 97) - 0.5;
            const px = sx + (u - v) * (TILE_W / 2), py = sy + (u + v) * (TILE_H / 2);
            glints.moveTo(px - 1, py);
            glints.lineTo(px + 1, py);
          }
        } else if (kind === "ice") {
          // long cracks and streaks in the frozen lake
          if (hash2(tx, ty, 98) < 0.35) {
            const u = hash2(tx, ty, 99) - 0.5;
            ripples.moveTo(sx + u * 24 - 10, sy - 3);
            ripples.lineTo(sx + u * 24, sy + 1);
            ripples.lineTo(sx + u * 24 + 12, sy - 1);
          }
        } else if (kind === "sand") {
          for (let i = 0; i < 6; i++) {
            const u = hash2(tx * 6 + i, ty, 81) - 0.5, v = hash2(tx, ty * 6 + i, 82) - 0.5;
            const px = sx + (u - v) * (TILE_W / 2), py = sy + (u + v) * (TILE_H / 2);
            specks.moveTo(px, py);
            specks.lineTo(px + 1.5, py);
          }
        }
      }
    }
    c.lineWidth = 1;
    c.strokeStyle = "rgba(90,125,70,0.35)"; c.stroke(light);
    c.strokeStyle = "rgba(5,12,6,0.45)"; c.stroke(dark);
    c.strokeStyle = "rgba(8,8,12,0.5)"; c.stroke(seams);
    c.strokeStyle = "rgba(40,28,14,0.45)"; c.stroke(specks);
    c.strokeStyle = this.info.theme === "frost" ? "rgba(235,250,255,0.45)" : "rgba(170,235,215,0.32)"; c.stroke(ripples);
    c.strokeStyle = "rgba(255,255,255,0.75)"; c.stroke(glints);

    for (let tx = x0 - 1; tx <= x0 + CHUNK; tx++) {
      for (let ty = y0 - 1; ty <= y0 + CHUNK; ty++) {
        if (!inMap(tx, ty)) continue;
        const decal = decalFor(this.info.theme, ground(tx, ty).kind, hash2(tx, ty, 65));
        if (!decal) continue;
        const img = this.scene.textures.get(pick(decal, hash2(tx, ty, 66))).getSourceImage() as HTMLCanvasElement;
        const { sx, sy } = worldToScreen(tx + (hash2(tx, ty, 67) - 0.5) * 0.5, ty + (hash2(tx, ty, 68) - 0.5) * 0.5);
        c.drawImage(img, sx - img.width / 2, sy - img.height / 2);
      }
    }

    for (let tx = x0 - 1; tx <= x0 + CHUNK; tx++) {
      for (let ty = y0 - 1; ty <= y0 + CHUNK; ty++) {
        if (!inMap(tx, ty)) continue;
        const kind = ground(tx, ty).kind;
        if (kind === "void" || kind === "sand" || kind === "water" || kind === "snow" || kind === "ice") continue;
        const h = hash2(tx, ty, 61);
        let keys: string[] | null = null;
        if (kind === "dirt" || kind === "stone") { if (h < 0.12) keys = PROP_KEYS.pebbles; }
        else if (h < 0.1) keys = PROP_KEYS.tuft;
        else if (h < 0.125) keys = PROP_KEYS.flowers;
        if (!keys) continue;
        const img = this.scene.textures.get(pick(keys, hash2(tx, ty, 62))).getSourceImage() as HTMLCanvasElement;
        const { sx, sy } = worldToScreen(tx + (hash2(tx, ty, 63) - 0.5) * 0.6, ty + (hash2(tx, ty, 64) - 0.5) * 0.6);
        c.drawImage(img, sx - img.width / 2, sy - img.height * 0.8);
      }
    }

    tex.refresh();
    return this.scene.add.image(left, top, key).setOrigin(0).setDepth(GROUND_DEPTH);
  }

  private refreshProps(cx: number, cy: number, R: number): void {
    for (const [key, obj] of this.props) {
      const [tx, ty] = key.split(",").map(Number);
      if (Math.abs(tx - cx) > R + 3 || Math.abs(ty - cy) > R + 3) {
        if (obj) {
          this.removeProp(obj);
          if (obj.tall) this.tall.splice(this.tall.indexOf(obj), 1);
          if (obj.glow) this.glows.splice(this.glows.indexOf(obj), 1);
        }
        this.props.delete(key);
      }
    }
    for (let tx = Math.max(0, cx - R); tx <= Math.min(this.size - 1, cx + R); tx++) {
      for (let ty = Math.max(0, cy - R); ty <= Math.min(this.size - 1, cy + R); ty++) {
        const key = `${tx},${ty}`;
        if (this.props.has(key)) continue;
        const spec = this.theme.prop(tx, ty);
        this.props.set(key, spec ? this.spawnProp(spec) : null);
      }
    }
  }

  private removeProp(obj: PropObj | null | undefined): void {
    if (!obj) return;
    this.scene.tweens.killTweensOf(obj.img);
    obj.img.destroy();
    obj.glow?.destroy();
    obj.shadow?.destroy();
  }

  /** Turns the trees' sway on or off for the props already on screen (graphics quality changed). */
  setSway(on: boolean): void {
    for (const obj of this.props.values()) {
      if (!obj?.tall) continue;
      const img = obj.img;
      this.scene.tweens.killTweensOf(img);
      // a killed tween can still apply once more this frame, so straighten the tree right after it
      this.scene.time.delayedCall(30, () => { if (img.active) img.setAngle(0); });
      if (on) this.sway(img);
    }
  }

  /** Trees lean gently with the wind, each at its own pace (one cheap tween per visible tree). */
  private sway(img: Phaser.GameObjects.Image): void {
    const k = hash2(Math.round(img.x), Math.round(img.y), 77);
    this.scene.tweens.add({
      targets: img, angle: { from: -0.9 - k * 0.8, to: 0.9 + k * 0.8 }, duration: 2200 + k * 1600,
      yoyo: true, repeat: -1, ease: "Sine.easeInOut", delay: k * 1500,
    });
  }

  private spawnProp(spec: PropSpec): PropObj {
    const { sx, sy } = worldToScreen(spec.wx, spec.wy);
    const [ox, oy] = THEME_ORIGIN[spec.key] ?? propOrigin(spec.key);
    const img = this.scene.add.image(sx, sy, spec.key).setOrigin(ox, oy).setScale(spec.scale).setFlipX(spec.flip).setDepth(sy);
    const tall = spec.key.startsWith("tree");
    const obj: PropObj = { img, tall };
    const look = gfx();
    if (look.shadows && !spec.key.startsWith("tuft") && !spec.key.startsWith("flowers") && !spec.key.startsWith("pebbles")) {
      // a soft contact shadow, a bit wider for trees
      const wide = (img.width * spec.scale) / 64 * (tall ? 0.75 : 0.9);
      obj.shadow = this.scene.add.image(sx + 4, sy + 1, "shadow").setScale(wide, wide * 0.42).setAlpha(tall ? 0.55 : 0.45)
        .setDepth(GROUND_DEPTH + 2);
    }
    if (tall && look.sway) this.sway(img);
    if (spec.key.startsWith("ice_crystal")) {
      obj.glow = this.scene.add.image(sx, sy - 10, "glow_ice").setScale(2, 1.1).setAlpha(0.3)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(GROUND_DEPTH + 1);
      this.glows.push(obj);
    }
    if (spec.key.startsWith("mushroom")) {
      obj.glow = this.scene.add.image(sx, sy - 6, "glow_teal").setScale(1.6, 0.9).setAlpha(0.35)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(GROUND_DEPTH + 1);
      this.glows.push(obj);
    }
    if (tall) this.tall.push(obj);
    return obj;
  }
}

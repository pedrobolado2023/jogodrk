/** Props for the town, crypt and arena themes, quest markers, boss telegraphs and generated skill icons. */
import Phaser from "phaser";
import { canvasTex, col, ellipse, glowDot, linear, outlined, poly, radial, rng, rrect, type Ctx } from "./draw";

export const THEME_ORIGIN: Record<string, [number, number]> = {
  house_0: [0.5, 0.92], house_1: [0.5, 0.92], well: [0.5, 0.86], lamppost: [0.5, 0.97], fence: [0.5, 0.8],
  stall: [0.5, 0.9], pillar: [0.5, 0.95], pillar_broken: [0.5, 0.92], coffin: [0.5, 0.75], bonepile: [0.5, 0.7],
  rack: [0.5, 0.92], statue: [0.5, 0.95], banner_pole: [0.5, 0.97],
  tree_snowpine_0: [0.5, 172 / 176], tree_snowpine_1: [0.5, 172 / 176], rock_snow_0: [0.5, 0.82], rock_snow_1: [0.5, 0.82],
  ice_crystal_0: [0.5, 0.92], ice_crystal_1: [0.5, 0.92],
};

/** Props of the frozen peaks (keys used by the frost theme in world.ts). */
export const FROST_PROPS = {
  pine: ["tree_snowpine_0", "tree_snowpine_1"],
  rock: ["rock_snow_0", "rock_snow_1"],
  crystal: ["ice_crystal_0", "ice_crystal_1"],
};

const hexNum = (h: string): number => parseInt(h.replace("#", ""), 16);

export function makeThemeProps(scene: Phaser.Scene): void {
  const o = (key: string, w: number, h: number, paint: (c: Ctx) => void) =>
    canvasTex(scene, key, w, h, (ctx) => outlined(ctx, w, h, paint, "rgba(6,5,8,0.88)", 1.3));
  o("house_0", 170, 150, (c) => house(c, 0x7a2a22, 0x9a8a6a));
  o("house_1", 170, 150, (c) => house(c, 0x2e3e5a, 0x8a8a7a));
  o("well", 70, 76, well);
  o("lamppost", 26, 86, lamppost);
  o("fence", 70, 34, fence);
  o("stall", 104, 92, stall);
  o("pillar", 44, 118, (c) => pillar(c, false));
  o("pillar_broken", 44, 70, (c) => pillar(c, true));
  o("coffin", 66, 44, coffin);
  o("bonepile", 54, 28, bonepile);
  o("rack", 60, 66, rack);
  o("statue", 70, 130, statue);
  FROST_PROPS.pine.forEach((k, i) => o(k, 96, 176, (c) => snowPine(c, i)));
  FROST_PROPS.rock.forEach((k, i) => o(k, 64, 46, (c) => snowRock(c, i)));
  FROST_PROPS.crystal.forEach((k, i) => o(k, 52, 84, (c) => iceCrystal(c, i)));
  canvasTex(scene, "portal_base", 128, 64, portalBase);
  canvasTex(scene, "mark_quest", 26, 36, (c) => marker(c, "!"));
  canvasTex(scene, "mark_ready", 26, 36, (c) => marker(c, "?"));
  canvasTex(scene, "warn_circle", 256, 128, (c) => {
    c.save(); c.scale(1, 0.5);
    c.fillStyle = radial(c, 128, 128, 126, [[0, "rgba(255,40,40,0.08)"], [0.8, "rgba(255,40,40,0.28)"], [1, "rgba(255,40,40,0)"]]);
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = "rgba(255,70,60,0.95)"; c.lineWidth = 6;
    c.beginPath(); c.arc(128, 128, 118, 0, Math.PI * 2); c.stroke();
    c.restore();
  });
}

function house(c: Ctx, roof: number, wall: number): void {
  // walls: left face (lit) and right face (shade)
  poly(c, [20, 70, 85, 102, 85, 140, 20, 108], linear(c, 20, 0, 85, 0, [[0, col(wall, 1.05)], [1, col(wall, 0.8)]]));
  poly(c, [85, 102, 150, 70, 150, 108, 85, 140], linear(c, 85, 0, 150, 0, [[0, col(wall, 0.62)], [1, col(wall, 0.45)]]));
  c.strokeStyle = "#3a2614"; c.lineWidth = 3;
  for (const [x1, y1, x2, y2] of [[20, 70, 20, 108], [85, 102, 85, 140], [150, 70, 150, 108], [20, 89, 85, 121], [85, 121, 150, 89]]) {
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }
  // stone base
  poly(c, [20, 104, 85, 136, 85, 142, 20, 110], "#4a4650"); poly(c, [85, 136, 150, 104, 150, 110, 85, 142], "#2e2b33");
  // door + windows with warm light
  poly(c, [44, 101, 60, 109, 60, 131, 44, 123], "#2a1a0e");
  poly(c, [46, 103, 58, 109, 58, 112, 46, 106], "#4a2c17");
  for (const [x, y] of [[100, 108], [126, 95]] as [number, number][]) {
    poly(c, [x, y, x + 12, y - 6, x + 12, y + 6, x, y + 12], "#ffc26a");
    c.fillStyle = radial(c, x + 6, y + 3, 16, [[0, "rgba(255,190,100,0.35)"], [1, "rgba(255,190,100,0)"]]);
    c.fillRect(x - 10, y - 13, 32, 32);
    c.strokeStyle = "#3a2614"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x + 6, y - 3); c.lineTo(x + 6, y + 9); c.stroke();
  }
  // roof
  poly(c, [10, 72, 85, 6, 160, 72, 85, 110], col(roof, 0.5));
  poly(c, [10, 72, 85, 6, 85, 40, 22, 78], linear(c, 10, 0, 85, 0, [[0, col(roof, 1.1)], [1, col(roof, 0.9)]]));
  poly(c, [85, 6, 160, 72, 150, 80, 85, 40], linear(c, 85, 0, 160, 0, [[0, col(roof, 0.65)], [1, col(roof, 0.45)]]));
  poly(c, [22, 78, 85, 40, 150, 80, 85, 108], linear(c, 0, 40, 0, 108, [[0, col(roof, 0.95)], [1, col(roof, 0.6)]]));
  c.strokeStyle = col(roof, 0.4, 0.8); c.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    c.beginPath(); c.moveTo(22 + (85 - 22) * t, 78 - 38 * t); c.lineTo(85 + 65 * t, 108 - 28 * t); c.stroke();
  }
  poly(c, [112, 30, 124, 24, 124, 50, 112, 56], "#5a4a48"); poly(c, [124, 24, 132, 28, 132, 54, 124, 50], "#3a302e");
}

function well(c: Ctx): void {
  ellipse(c, 35, 52, 24, 12, "#2a2830");
  c.fillStyle = linear(c, 11, 0, 59, 0, [[0, "#8a8690"], [1, "#3a3840"]]);
  c.fillRect(11, 52, 48, 16);
  ellipse(c, 35, 68, 24, 8, "#3a3840");
  ellipse(c, 35, 52, 24, 12, "#6a6670");
  ellipse(c, 35, 52, 18, 8, "#0c1018");
  c.strokeStyle = "rgba(40,38,44,0.8)"; c.lineWidth = 1;
  for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(14 + i * 11, 54); c.lineTo(14 + i * 11, 68); c.stroke(); }
  c.fillStyle = "#5a3a1e"; c.fillRect(13, 16, 4, 38); c.fillRect(53, 16, 4, 38);
  poly(c, [6, 22, 35, 4, 64, 22, 60, 26, 35, 10, 10, 26], "#6a2a22");
  c.strokeStyle = "#c8b48a"; c.lineWidth = 1; c.beginPath(); c.moveTo(35, 14); c.lineTo(35, 40); c.stroke();
  c.fillStyle = "#6a4a2a"; c.fillRect(30, 38, 10, 8);
}

function lamppost(c: Ctx): void {
  c.fillStyle = "#2a2a32"; c.fillRect(11, 18, 4, 64);
  ellipse(c, 13, 82, 7, 3, "#2a2a32");
  c.fillStyle = "#1a1a20"; c.fillRect(6, 8, 14, 3); c.fillRect(7, 22, 12, 2);
  poly(c, [7, 11, 19, 11, 17, 22, 9, 22], "#ffd38a");
  glowDot(c, 13, 16, 3.2, 0xffb36b);
}

function fence(c: Ctx): void {
  c.fillStyle = "#6a4a2a";
  for (let i = 0; i < 4; i++) { const x = 6 + i * 19, y = 4 + i * 6; c.fillRect(x, y, 4, 22); }
  c.strokeStyle = "#8a6038"; c.lineWidth = 3;
  c.beginPath(); c.moveTo(6, 10); c.lineTo(66, 28); c.moveTo(6, 18); c.lineTo(66, 36); c.stroke();
}

function stall(c: Ctx): void {
  poly(c, [10, 52, 52, 72, 52, 88, 10, 68], "#6a4a2a"); poly(c, [52, 72, 94, 52, 94, 68, 52, 88], "#4a321c");
  c.fillStyle = "#3a2614"; c.fillRect(10, 22, 3, 46); c.fillRect(91, 22, 3, 46); c.fillRect(50, 40, 3, 32);
  for (let i = 0; i < 6; i++) {
    const x0 = 6 + i * 15;
    poly(c, [x0, 26 + i * 0, x0 + 15, 26, x0 + 13, 40, x0 - 2, 40], i % 2 ? "#e8e2d6" : "#a01824");
  }
  poly(c, [4, 26, 52, 8, 100, 26, 52, 44], "#b8283a");
  c.fillStyle = "#c9a04a"; ellipse(c, 30, 58, 6, 3, "#e0a020"); ellipse(c, 70, 58, 6, 3, "#7cc048"); ellipse(c, 52, 64, 5, 2.5, "#d43a2a");
}

function pillar(c: Ctx, broken: boolean): void {
  const top = broken ? 18 : 14, bottom = broken ? 64 : 112;
  ellipse(c, 22, bottom, 18, 7, "#2a2830");
  c.fillStyle = linear(c, 8, 0, 36, 0, [[0, "#a8a4b0"], [0.4, "#6a6670"], [1, "#2a2830"]]);
  c.fillRect(9, top + 6, 26, bottom - top - 8);
  c.strokeStyle = "rgba(30,28,34,0.5)"; c.lineWidth = 1;
  for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(14 + i * 7, top + 8); c.lineTo(14 + i * 7, bottom - 4); c.stroke(); }
  if (broken) {
    poly(c, [9, top + 6, 16, top, 22, top + 8, 29, top + 2, 35, top + 6, 35, top + 10, 9, top + 10], "#8a8690");
  } else {
    rrect(c, 4, top, 36, 9, 2); c.fillStyle = "#8a8690"; c.fill();
    rrect(c, 6, bottom - 8, 32, 8, 2); c.fillStyle = "#5a5660"; c.fill();
  }
  ellipse(c, 13, bottom - 14, 5, 3, "rgba(70,110,55,0.75)");
  c.strokeStyle = "#1a181e"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(27, top + 30); c.lineTo(23, top + 40); c.lineTo(28, top + 48); c.stroke();
}

function snowPine(c: Ctx, v: number): void {
  const r = rng(700 + v);
  c.fillStyle = linear(c, 42, 0, 54, 0, [[0, "#4a3a2c"], [1, "#1a120c"]]);
  c.fillRect(44, 140, 8, 32);
  for (let t = 0; t < 5; t++) {
    const yb = 150 - t * 26, yt = yb - 46, hw = 40 - t * 7;
    const pts: number[] = [48, yt];
    for (let i = 0; i <= 7; i++) pts.push(48 + hw - (2 * hw * i) / 7, yb + (i % 2 ? -5 : 2) + r() * 2);
    poly(c, pts, linear(c, 48 - hw, 0, 48 + hw, 0, [[0, "#2a4a4e"], [0.45, "#173236"], [1, "#081416"]]));
    // snow resting on the top of each tier
    const cap: number[] = [48, yt - 1];
    for (let i = 0; i <= 6; i++) {
      const x = 48 + hw * 0.85 - (1.7 * hw * i) / 6;
      cap.push(x, yt + (yb - yt) * (0.42 + 0.25 * Math.abs(i - 3) / 3) + (i % 2 ? 3 : -1) + r() * 2);
    }
    poly(c, cap, linear(c, 48 - hw, yt, 48 + hw, yb, [[0, "#ffffff"], [0.6, "#d8e8f4"], [1, "#8aa6c0"]]));
  }
}

function snowRock(c: Ctx, v: number): void {
  const r = rng(760 + v);
  const pts: number[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, rad = 0.75 + r() * 0.3;
    pts.push(32 + Math.cos(a) * 26 * rad, 28 + Math.sin(a) * 15 * rad - (Math.sin(a) < 0 ? 6 : 0));
  }
  poly(c, pts, linear(c, 0, 8, 0, 44, [[0, "#7a8494"], [0.6, "#4a5260"], [1, "#22262e"]]));
  ellipse(c, 30, 16 + r() * 2, 20, 7, linear(c, 10, 10, 50, 22, [[0, "#ffffff"], [1, "#b8cce0"]]));
}

function iceCrystal(c: Ctx, v: number): void {
  const r = rng(780 + v);
  const shards: [number, number, number][] = v ? [[26, 8, 7], [14, 30, 5], [38, 26, 5]] : [[24, 4, 8], [36, 22, 6], [12, 34, 4], [30, 40, 4]];
  ellipse(c, 26, 78, 20, 6, "rgba(30,40,60,0.6)");
  for (const [x, top, w] of shards) {
    const lean = (r() - 0.5) * 8;
    poly(c, [x + lean, top, x + w, 74, x - w, 74],
      linear(c, x - w, 0, x + w, 0, [[0, "#e8ffff"], [0.45, "#8ad8ff"], [1, "#2a6a9a"]]), "rgba(200,245,255,0.8)", 1);
    c.strokeStyle = "rgba(255,255,255,0.7)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x + lean, top + 4); c.lineTo(x - w * 0.3, 70); c.stroke();
  }
}

function coffin(c: Ctx): void {
  poly(c, [6, 22, 26, 10, 60, 24, 40, 36], linear(c, 6, 0, 60, 0, [[0, "#5a3a22"], [1, "#2a1a0e"]]));
  poly(c, [6, 22, 40, 36, 40, 42, 6, 28], "#3a2414"); poly(c, [40, 36, 60, 24, 60, 30, 40, 42], "#22140a");
  c.strokeStyle = "#c9a04a"; c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(22, 20); c.lineTo(44, 29); c.moveTo(30, 18); c.lineTo(36, 30); c.stroke();
}

function bonepile(c: Ctx): void {
  const r = rng(91);
  for (let i = 0; i < 7; i++) {
    c.strokeStyle = "#d8d0bc"; c.lineWidth = 2.2; c.lineCap = "round";
    const x = 8 + r() * 36, y = 10 + r() * 12, a = r() * Math.PI;
    c.beginPath(); c.moveTo(x - Math.cos(a) * 7, y - Math.sin(a) * 3); c.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 3); c.stroke();
  }
  ellipse(c, 30, 12, 6, 5.5, "#e4dcc8");
  ellipse(c, 28, 12, 1.4, 1.5, "#0a0a0c"); ellipse(c, 32, 12, 1.4, 1.5, "#0a0a0c");
}

function rack(c: Ctx): void {
  c.fillStyle = "#5a3a1e"; c.fillRect(6, 20, 4, 42); c.fillRect(50, 20, 4, 42); c.fillRect(4, 24, 52, 3); c.fillRect(4, 48, 52, 3);
  for (let i = 0; i < 4; i++) {
    const x = 13 + i * 10;
    c.fillStyle = "#c4ccd6"; poly(c, [x, 4, x + 3, 10, x + 3, 50, x, 50], "#c4ccd6");
    c.fillStyle = "#3a2614"; c.fillRect(x - 2, 50, 7, 2.5); c.fillRect(x, 52, 3, 8);
  }
}

function statue(c: Ctx): void {
  poly(c, [8, 104, 35, 92, 62, 104, 35, 116], "#6a6670");
  poly(c, [8, 104, 35, 116, 35, 128, 8, 116], "#4a4650"); poly(c, [35, 116, 62, 104, 62, 116, 35, 128], "#2e2b33");
  const stone = linear(c, 18, 0, 52, 0, [[0, "#c8c4cc"], [0.5, "#8a8690"], [1, "#4a4650"]]);
  c.fillStyle = stone;
  rrect(c, 27, 70, 7, 30, 2); c.fill(); rrect(c, 36, 70, 7, 30, 2); c.fill();
  poly(c, [22, 40, 48, 40, 46, 72, 24, 72], stone);
  rrect(c, 15, 42, 7, 24, 3); c.fill(); rrect(c, 48, 32, 7, 18, 3); c.fill();
  poly(c, [50, 34, 53, 34, 54, 0, 51.5, -2, 49, 0], "#d8d4dc");
  rrect(c, 44, 33, 15, 3, 1); c.fill();
  ellipse(c, 35, 32, 8, 9, stone);
  ellipse(c, 35, 37, 6, 3, "rgba(70,110,55,0.6)");
}

function portalBase(c: Ctx): void {
  c.save(); c.scale(1, 0.5);
  c.fillStyle = radial(c, 64, 64, 62, [[0, "rgba(160,110,255,0.25)"], [0.7, "rgba(60,40,90,0.35)"], [1, "rgba(0,0,0,0)"]]);
  c.fillRect(0, 0, 128, 128);
  c.strokeStyle = "#5a5660"; c.lineWidth = 9; c.beginPath(); c.arc(64, 64, 52, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = "#8a8690"; c.lineWidth = 3; c.beginPath(); c.arc(64, 64, 55, 0, Math.PI * 2); c.stroke();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    c.fillStyle = "#c684ff";
    c.fillRect(64 + Math.cos(a) * 52 - 2, 64 + Math.sin(a) * 52 - 2, 4, 4);
  }
  c.restore();
}

function marker(c: Ctx, ch: string): void {
  c.fillStyle = radial(c, 13, 16, 14, [[0, "rgba(255,210,80,0.6)"], [1, "rgba(255,210,80,0)"]]);
  c.fillRect(0, 0, 26, 36);
  c.font = "bold 26px Georgia, serif";
  c.textAlign = "center";
  c.lineWidth = 4; c.strokeStyle = "#2a1800"; c.strokeText(ch, 13, 27);
  c.fillStyle = "#ffd23c"; c.fillText(ch, 13, 27);
}

// ── Skill icons ────────────────────────────────────────────────────────

export function ensureSkillIcons(scene: Phaser.Scene, defs: { id: string; icon: { g: string; c: string } }[]): void {
  for (const d of defs) {
    canvasTex(scene, `icon_${d.id}`, 48, 48, (c) => {
      const hex = hexNum(d.icon.c);
      c.fillStyle = radial(c, 24, 20, 34, [[0, col(hex, 0.42)], [1, col(hex, 0.08)]]);
      c.fillRect(0, 0, 48, 48);
      c.save();
      c.shadowColor = col(hex, 1, 0.9);
      c.shadowBlur = 8;
      glyph(c, d.icon.g, d.icon.c, hex);
      c.restore();
      c.fillStyle = linear(c, 0, 0, 0, 48, [[0, "rgba(255,255,255,0.14)"], [0.5, "rgba(255,255,255,0)"], [1, "rgba(0,0,0,0.4)"]]);
      c.fillRect(0, 0, 48, 48);
    });
  }
}

function glyph(c: Ctx, g: string, color: string, hex: number): void {
  const light = col(hex, 1.5), dark = col(hex, 0.55);
  c.lineCap = "round";
  c.lineJoin = "round";
  const stroke = (w: number, s: string, f: () => void) => { c.strokeStyle = s; c.lineWidth = w; c.beginPath(); f(); c.stroke(); };
  const arrowAt = (x1: number, y1: number, x2: number, y2: number, s = color) => {
    stroke(2.6, s, () => { c.moveTo(x1, y1); c.lineTo(x2, y2); });
    const a = Math.atan2(y2 - y1, x2 - x1);
    poly(c, [x2 + Math.cos(a) * 6, y2 + Math.sin(a) * 6, x2 + Math.cos(a + 2.4) * 6, y2 + Math.sin(a + 2.4) * 6,
      x2 + Math.cos(a - 2.4) * 6, y2 + Math.sin(a - 2.4) * 6], light);
  };
  switch (g) {
    case "slash": stroke(5, light, () => { c.moveTo(10, 38); c.quadraticCurveTo(22, 14, 40, 8); }); stroke(2, "#fff", () => { c.moveTo(14, 34); c.quadraticCurveTo(24, 16, 38, 10); }); break;
    case "spiral": for (let i = 0; i < 3; i++) stroke(4 - i, color, () => c.arc(24, 24, 7 + i * 6, i * 2.1, i * 2.1 + 3.8)); break;
    case "bolt": poly(c, [27, 5, 12, 27, 22, 27, 18, 43, 36, 19, 25, 19, 31, 5], light, dark, 1.2); break;
    case "drop": c.beginPath(); c.moveTo(24, 7); c.bezierCurveTo(33, 20, 36, 26, 34, 32); c.arc(24, 31, 10, 0.1, Math.PI - 0.1); c.bezierCurveTo(12, 26, 15, 20, 24, 7); c.fillStyle = color; c.fill(); break;
    case "crown": poly(c, [9, 34, 9, 15, 17, 24, 24, 11, 31, 24, 39, 15, 39, 34], light, dark, 1.4); break;
    case "fist": rrect(c, 12, 16, 24, 20, 6); c.fillStyle = color; c.fill(); for (let i = 0; i < 4; i++) stroke(1.2, dark, () => { c.moveTo(17 + i * 5, 16); c.lineTo(17 + i * 5, 24); }); stroke(3, light, () => { c.moveTo(6, 40); c.lineTo(14, 34); c.moveTo(42, 40); c.lineTo(34, 34); }); break;
    case "heart": c.beginPath(); c.moveTo(24, 40); c.bezierCurveTo(4, 26, 10, 8, 24, 17); c.bezierCurveTo(38, 8, 44, 26, 24, 40); c.fillStyle = color; c.fill(); break;
    case "blades": for (let i = 0; i < 3; i++) poly(c, [10 + i * 9, 40, 14 + i * 9, 40, 22 + i * 9, 8, 20 + i * 9, 8], i === 1 ? light : color); break;
    case "skull": ellipse(c, 24, 21, 12, 12, light); rrect(c, 17, 28, 14, 10, 3); c.fillStyle = light; c.fill(); ellipse(c, 19.5, 21, 3.5, 4, "#100a0a"); ellipse(c, 28.5, 21, 3.5, 4, "#100a0a"); break;
    case "storm": for (let i = 0; i < 4; i++) stroke(2.5, i % 2 ? light : color, () => c.arc(24, 24, 6 + i * 4.5, i, i + 4)); break;
    case "flame": c.beginPath(); c.moveTo(24, 6); c.bezierCurveTo(36, 18, 38, 30, 30, 38); c.quadraticCurveTo(24, 44, 18, 38); c.bezierCurveTo(10, 30, 14, 20, 20, 16); c.quadraticCurveTo(20, 24, 24, 26); c.quadraticCurveTo(22, 16, 24, 6); c.fillStyle = color; c.fill(); ellipse(c, 24, 33, 4, 5, "#fff4c4"); break;
    case "shard": poly(c, [24, 4, 32, 24, 24, 44, 16, 24], linear(c, 16, 0, 32, 0, [[0, "#ffffff"], [1, color]])); break;
    case "snow": for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; stroke(2, light, () => { c.moveTo(24, 24); c.lineTo(24 + Math.cos(a) * 16, 24 + Math.sin(a) * 16); }); } break;
    case "shield": c.beginPath(); c.moveTo(24, 6); c.lineTo(38, 12); c.quadraticCurveTo(38, 32, 24, 42); c.quadraticCurveTo(10, 32, 10, 12); c.closePath(); c.fillStyle = linear(c, 10, 6, 38, 42, [[0, light], [1, dark]]); c.fill(); break;
    case "comet": poly(c, [4, 8, 30, 24, 22, 34], col(hex, 1, 0.6)); glowDot(c, 30, 30, 6, hex); break;
    case "swirl": stroke(3.5, light, () => c.arc(24, 24, 13, 0.5, 5.2)); stroke(2.5, color, () => c.arc(24, 24, 7, 3.5, 8)); break;
    case "orbs": for (const [x, y] of [[14, 30], [24, 16], [34, 30]]) glowDot(c, x, y, 4, hex); break;
    case "ring": stroke(5, color, () => c.arc(24, 24, 14, 0, Math.PI * 2)); stroke(2, "#fff2b0", () => c.arc(24, 24, 14, 0, Math.PI * 2)); break;
    case "void": ellipse(c, 24, 24, 15, 15, dark); ellipse(c, 24, 24, 9, 9, "#05020a"); stroke(1.5, light, () => c.arc(24, 24, 15, 0, 4)); break;
    case "arrow": arrowAt(10, 38, 36, 12); break;
    case "pierce": arrowAt(6, 40, 38, 10); stroke(1.5, light, () => { c.moveTo(14, 18); c.lineTo(22, 28); c.moveTo(24, 10); c.lineTo(32, 20); }); break;
    case "moon": c.beginPath(); c.arc(26, 22, 13, 0.6, Math.PI * 2 - 0.6); c.arc(32, 22, 10, Math.PI * 2 - 0.9, 0.9, true); c.fillStyle = color; c.fill(); break;
    case "venom": c.beginPath(); c.moveTo(24, 8); c.bezierCurveTo(33, 21, 36, 27, 34, 32); c.arc(24, 31, 10, 0.1, Math.PI - 0.1); c.bezierCurveTo(12, 27, 15, 21, 24, 8); c.fillStyle = color; c.fill(); ellipse(c, 20, 24, 2, 2, "#e0ff8a"); ellipse(c, 27, 30, 1.5, 1.5, "#e0ff8a"); break;
    case "eye": stroke(2.5, color, () => { c.moveTo(6, 24); c.quadraticCurveTo(24, 8, 42, 24); c.quadraticCurveTo(24, 40, 6, 24); }); ellipse(c, 24, 24, 5, 5, light); ellipse(c, 24, 24, 2, 2, "#100a00"); break;
    case "rain": for (let i = 0; i < 5; i++) arrowAt(10 + i * 7, 6 + (i % 2) * 6, 6 + i * 7, 30 + (i % 2) * 6); break;
    case "thorn": for (let i = 0; i < 4; i++) poly(c, [8 + i * 10, 42, 13 + i * 10, 10 + (i % 2) * 8, 18 + i * 10, 42], i % 2 ? light : color); break;
    case "arrows": arrowAt(8, 32, 34, 8); arrowAt(14, 42, 40, 18); break;
    case "target": stroke(2.5, color, () => c.arc(24, 24, 15, 0, Math.PI * 2)); stroke(2.5, light, () => c.arc(24, 24, 8, 0, Math.PI * 2)); ellipse(c, 24, 24, 2.5, 2.5, "#fff"); break;
    case "wing": c.beginPath(); c.moveTo(8, 34); c.quadraticCurveTo(14, 10, 40, 8); c.quadraticCurveTo(30, 18, 34, 22); c.quadraticCurveTo(24, 24, 26, 30); c.quadraticCurveTo(16, 30, 8, 34); c.fillStyle = color; c.fill(); break;
    default: glowDot(c, 24, 24, 6, hex);
  }
}

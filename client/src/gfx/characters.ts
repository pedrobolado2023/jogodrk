/**
 * Detailed character art: the three heroes, town NPCs, the skeleton and the Death Knight boss.
 * Painted in 1x coordinates; textures.ts renders them at 2x with volume shading and an outline.
 * `p` is the walk pose: 0 idle, ±1 opposite steps.
 */
import { col, ellipse, glowDot, linear, poly, radial, rng, rrect, type Ctx } from "./draw";

type G = string | CanvasGradient;

function leg(c: Ctx, x: number, y: number, h: number, w: number, p: number, fill: G, boot: G, knee?: G): void {
  const lift = Math.max(0, p) * 3.5;
  const lx = x + p * 2;
  c.fillStyle = fill;
  rrect(c, lx, y, w, h - lift, 2.5);
  c.fill();
  if (knee) ellipse(c, lx + w / 2, y + (h - lift) * 0.45, w * 0.62, w * 0.5, knee);
  c.fillStyle = boot;
  rrect(c, lx - 1.2, y + h - lift - 9, w + 2.4, 10, 2.5);
  c.fill();
  c.fillStyle = "rgba(255,255,255,0.12)";
  c.fillRect(lx, y + h - lift - 8.5, w * 0.4, 1.5);
}

function cape(c: Ctx, cx: number, top: number, bottom: number, half: number, p: number, fill: G, trim?: string): void {
  const sway = -p * 3;
  c.beginPath();
  c.moveTo(cx - half * 0.55, top);
  c.quadraticCurveTo(cx - half * 1.25, (top + bottom) / 2, cx - half + sway, bottom);
  const n = 6;
  for (let i = 1; i <= n; i++) {
    const x = cx - half + (2 * half * i) / n + sway;
    c.lineTo(x - half / n, bottom + (i % 2 ? 4 : 0));
    c.lineTo(x, bottom - (i % 2 ? 0 : 2));
  }
  c.quadraticCurveTo(cx + half * 1.25, (top + bottom) / 2, cx + half * 0.55, top);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (trim) {
    c.strokeStyle = trim;
    c.lineWidth = 1;
    c.stroke();
  }
}

function rune(c: Ctx, x: number, y: number, hex: number, s = 1): void {
  c.fillStyle = col(hex, 1, 0.35);
  c.fillRect(x - 2.5 * s, y - 2.5 * s, 5 * s, 5 * s);
  c.fillStyle = col(hex, 1.5);
  c.fillRect(x - 0.6 * s, y - 2 * s, 1.2 * s, 4 * s);
  c.fillRect(x - 1.8 * s, y - 0.6 * s, 3.6 * s, 1.2 * s);
}

// ── Heroes ─────────────────────────────────────────────────────────────

export function drawBladeMaster(c: Ctx, p: number): void {
  const cx = 36;
  cape(c, cx, 40, 93, 17, p, linear(c, cx - 18, 0, cx + 18, 0, [[0, "#4a0910"], [0.45, "#8e1622"], [1, "#2e050a"]]), "#c9a04a");
  const steel = linear(c, cx - 12, 0, cx + 12, 0, [[0, "#dfe6ee"], [0.4, "#8d97a3"], [1, "#3a3f47"]]);
  leg(c, cx - 9.5, 64, 29, 7.5, p, steel, "#25211d", "#c8d0d8");
  leg(c, cx + 2, 64, 29, 7.5, -p, steel, "#25211d", "#aab3bc");
  // fauld plates
  for (let i = 0; i < 3; i++) {
    poly(c, [cx - 12 + i, 60 + i * 3.5, cx + 12 - i, 60 + i * 3.5, cx + 11 - i, 64 + i * 3.5, cx - 11 + i, 64 + i * 3.5],
      linear(c, cx - 12, 0, cx + 12, 0, [[0, "#b8c1ca"], [1, "#4a5058"]]), "rgba(20,20,26,0.6)", 0.6);
  }
  // breastplate
  c.beginPath();
  c.moveTo(cx - 13, 40); c.lineTo(cx + 13, 40); c.lineTo(cx + 11, 58); c.quadraticCurveTo(cx, 63, cx - 11, 58); c.closePath();
  c.fillStyle = radial(c, cx - 5, 44, 22, [[0, "#f4f7fa"], [0.45, "#949eaa"], [1, "#363b42"]]);
  c.fill();
  c.strokeStyle = "rgba(255,255,255,0.5)"; c.lineWidth = 0.8;
  c.beginPath(); c.moveTo(cx, 41); c.lineTo(cx, 60); c.stroke();
  // tabard + sigil
  poly(c, [cx - 6, 47, cx + 6, 47, cx + 7, 80, cx, 85, cx - 7, 80], linear(c, cx - 7, 0, cx + 7, 0, [[0, "#c8283a"], [1, "#650c16"]]));
  c.strokeStyle = "#e3b95a"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(cx - 6, 47); c.lineTo(cx - 7, 80); c.lineTo(cx, 85); c.lineTo(cx + 7, 80); c.lineTo(cx + 6, 47); c.stroke();
  poly(c, [cx, 53, cx + 3.5, 58, cx, 66, cx - 3.5, 58], "#e3b95a");
  poly(c, [cx, 56, cx + 1.5, 58, cx, 62, cx - 1.5, 58], "#7a0e18");
  // belt, buckle, pouch
  c.fillStyle = "#3b2516"; c.fillRect(cx - 12, 58.5, 24, 4);
  c.fillStyle = "#f3cf6e"; rrect(c, cx - 2.5, 58, 5, 5, 1); c.fill();
  c.fillStyle = "#5a3820"; rrect(c, cx + 6, 61, 5, 6, 1.5); c.fill();
  // left arm + gauntlet
  c.fillStyle = linear(c, cx - 21, 0, cx - 14, 0, [[0, "#c3cbd4"], [1, "#4f555c"]]);
  rrect(c, cx - 21, 45 - p, 7, 19, 3); c.fill();
  ellipse(c, cx - 17.5, 65 - p, 5, 4.5, "#3e434a");
  // greatsword with runes
  const sx = cx + 18;
  c.fillStyle = linear(c, sx - 3.5, 0, sx + 3.5, 0, [[0, "#ffffff"], [0.45, "#c4ccd6"], [1, "#606a74"]]);
  c.beginPath(); c.moveTo(sx - 3.5, 58); c.lineTo(sx - 3.5, 10); c.lineTo(sx, 1); c.lineTo(sx + 3.5, 10); c.lineTo(sx + 3.5, 58); c.closePath(); c.fill();
  c.strokeStyle = "rgba(50,60,70,0.7)"; c.lineWidth = 0.8; c.beginPath(); c.moveTo(sx, 9); c.lineTo(sx, 54); c.stroke();
  for (let i = 0; i < 4; i++) rune(c, sx, 16 + i * 9, 0xff3a3a, 0.7);
  c.fillStyle = linear(c, 0, 56, 0, 62, [[0, "#ffe08a"], [1, "#8a6420"]]);
  rrect(c, sx - 10, 56, 20, 5.5, 2.5); c.fill();
  ellipse(c, sx - 10, 58.7, 2.4, 2.4, "#e0203a"); ellipse(c, sx + 10, 58.7, 2.4, 2.4, "#e0203a");
  c.fillStyle = "#4a2c17"; c.fillRect(sx - 1.8, 61.5, 3.6, 10);
  ellipse(c, sx, 73, 3.2, 3.2, "#e3b95a");
  // right arm gripping
  c.fillStyle = linear(c, cx + 12, 0, cx + 19, 0, [[0, "#aab2bb"], [1, "#4b5159"]]);
  rrect(c, cx + 12, 45 + p, 7, 17, 3); c.fill();
  ellipse(c, sx - 1, 63, 4.8, 4.2, "#3e434a");
  // pauldrons (layered, gold trim)
  for (const s of [-1, 1]) {
    const px = cx + s * 14.5;
    ellipse(c, px, 45, 9, 6.5, radial(c, px - 3, 41, 12, [[0, "#f1f4f7"], [0.5, "#8b949e"], [1, "#30353b"]]));
    ellipse(c, px, 42.5, 7, 4.8, radial(c, px - 2, 40, 9, [[0, "#ffffff"], [0.6, "#a5aeb8"], [1, "#4a5058"]]));
    c.strokeStyle = "#d9b45a"; c.lineWidth = 1.1;
    c.beginPath(); c.ellipse(px, 45.5, 8.2, 5.2, 0, 0.15, Math.PI - 0.15); c.stroke();
    poly(c, [px + s * 2, 38, px + s * 4, 31, px + s * 6, 38.5], "#c3cbd4", "rgba(20,20,26,0.7)", 0.6);
  }
  // great helm
  ellipse(c, cx, 30, 10.5, 11.5, radial(c, cx - 4, 24, 15, [[0, "#f6f8fa"], [0.5, "#8c959f"], [1, "#2a2e34"]]));
  c.fillStyle = "#e3b95a"; c.fillRect(cx - 10.3, 26, 20.6, 2);
  c.fillStyle = "#08080c"; rrect(c, cx - 7.5, 29.5, 15, 3.6, 1.5); c.fill();
  glowDot(c, cx - 3.6, 31.3, 1.1, 0xff2a2a);
  glowDot(c, cx + 3.6, 31.3, 1.1, 0xff2a2a);
  c.strokeStyle = "rgba(15,15,20,0.85)"; c.lineWidth = 0.8;
  for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(cx + i * 2, 35); c.lineTo(cx + i * 2, 39); c.stroke(); }
  // flowing plume
  c.beginPath(); c.moveTo(cx - 1, 19); c.bezierCurveTo(cx - 6, 5, cx - 18, 6, cx - 24 - p * 2, 16);
  c.bezierCurveTo(cx - 16, 12, cx - 10, 16, cx - 7, 24); c.closePath();
  c.fillStyle = linear(c, cx - 24, 10, cx, 22, [[0, "#4a0910"], [0.6, "#c22436"], [1, "#ff5a6a"]]); c.fill();
}

export function drawSorcerer(c: Ctx, p: number): void {
  const cx = 40;
  // staff
  const sx = 13;
  c.fillStyle = linear(c, sx - 2.2, 0, sx + 2.2, 0, [[0, "#8a6038"], [1, "#2e1d10"]]);
  c.beginPath(); c.moveTo(sx - 2, 92); c.quadraticCurveTo(sx - 3, 50, sx - 1.5, 17); c.lineTo(sx + 2, 17); c.quadraticCurveTo(sx + 1, 50, sx + 2.2, 92); c.closePath(); c.fill();
  c.strokeStyle = "#3a2614"; c.lineWidth = 2;
  for (const s of [-1, 1]) {
    c.beginPath(); c.moveTo(sx + s * 1.5, 19); c.quadraticCurveTo(sx + s * 8, 10, sx + s * 3, 3); c.stroke();
  }
  c.strokeStyle = "rgba(95,216,255,0.35)"; c.lineWidth = 1;
  c.beginPath(); c.ellipse(sx, 10, 10, 3.5, 0, 0, Math.PI * 2); c.stroke();
  glowDot(c, sx, 10, 5, 0x5fd8ff);
  // robe
  c.beginPath();
  c.moveTo(cx - 10, 42);
  c.quadraticCurveTo(cx - 17, 70, cx - 21 - p * 3, 93);
  c.quadraticCurveTo(cx - p * 2, 97, cx + 21 - p * 3, 93);
  c.quadraticCurveTo(cx + 17, 70, cx + 10, 42);
  c.closePath();
  c.fillStyle = linear(c, cx - 21, 0, cx + 21, 0, [[0, "#3a55c4"], [0.45, "#1d2a6e"], [1, "#090f30"]]);
  c.fill();
  // inner lining split
  poly(c, [cx - 3, 58, cx + 3, 58, cx + 6 - p, 95, cx - 6 - p, 95], linear(c, 0, 58, 0, 95, [[0, "#5a1f6e"], [1, "#2a0a38"]]));
  const r = rng(31);
  for (let i = 0; i < 26; i++) {
    const x = cx - 16 + r() * 32, y = 50 + r() * 42;
    if (Math.abs(x - cx) > 3) ellipse(c, x, y, 0.7, 0.7, "rgba(255,226,140,0.85)");
  }
  c.strokeStyle = "#e3c06a"; c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(cx - 20.5, 90); c.quadraticCurveTo(cx - p * 2, 94, cx + 20.5 - p * 3, 90); c.stroke();
  c.lineWidth = 0.8;
  c.beginPath(); c.moveTo(cx - 3, 58); c.lineTo(cx - 6 - p, 95); c.moveTo(cx + 3, 58); c.lineTo(cx + 6 - p, 95); c.stroke();
  // sash + talisman
  c.fillStyle = "#6a2a80"; c.fillRect(cx - 12, 56, 24, 4.5);
  c.strokeStyle = "#6a2a80"; c.lineWidth = 2; c.beginPath(); c.moveTo(cx + 7, 60); c.lineTo(cx + 9, 72); c.stroke();
  glowDot(c, cx + 9, 73.5, 1.6, 0xb05cff);
  // sleeves
  poly(c, [cx - 11, 44, cx - 18, 46, cx - 27, 66, cx - 16, 69, cx - 10, 55],
    linear(c, cx - 27, 0, cx - 10, 0, [[0, "#3a55c4"], [1, "#16205a"]]), "#e3c06a", 0.8);
  poly(c, [cx + 11, 44, cx + 18, 46, cx + 26, 58, cx + 17, 61, cx + 10, 54],
    linear(c, cx + 10, 0, cx + 26, 0, [[0, "#22307a"], [1, "#0b1236"]]), "#e3c06a", 0.8);
  ellipse(c, sx + 2.5, 62, 3.6, 3.6, "#d4b49a");
  ellipse(c, cx + 23, 58.5, 3.4, 3.2, "#d4b49a");
  glowDot(c, cx + 25, 54, 2.6, 0x9fd8ff);
  // mantle with high collar
  poly(c, [cx - 15, 42, cx + 15, 42, cx + 12, 50, cx, 53, cx - 12, 50], linear(c, 0, 40, 0, 53, [[0, "#1a1f48"], [1, "#0a0d24"]]), "#e3c06a", 0.8);
  poly(c, [cx - 11, 41, cx - 13, 30, cx - 6, 38], "#141838");
  poly(c, [cx + 11, 41, cx + 13, 30, cx + 6, 38], "#0c1028");
  // beard
  c.beginPath(); c.moveTo(cx - 6.5, 36); c.lineTo(cx + 6.5, 36); c.quadraticCurveTo(cx + 5, 50, cx, 58); c.quadraticCurveTo(cx - 5, 50, cx - 6.5, 36);
  c.fillStyle = linear(c, 0, 36, 0, 58, [[0, "#f2eee4"], [1, "#9a958c"]]); c.fill();
  c.strokeStyle = "rgba(120,115,105,0.6)"; c.lineWidth = 0.6;
  for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(cx + i * 2, 38); c.lineTo(cx + i * 1.2, 52); c.stroke(); }
  // face shadow + eyes
  ellipse(c, cx, 32, 7.5, 6, "#07070e");
  glowDot(c, cx - 3, 32, 1.2, 0x5fd8ff);
  glowDot(c, cx + 3, 32, 1.2, 0x5fd8ff);
  // hat
  ellipse(c, cx, 27, 16, 4.8, linear(c, cx - 16, 0, cx + 16, 0, [[0, "#3a55c4"], [1, "#0e1644"]]));
  c.beginPath(); c.moveTo(cx - 9.5, 26); c.quadraticCurveTo(cx - 4, 8, cx + 10 - p, -1); c.quadraticCurveTo(cx + 4, 12, cx + 9.5, 26); c.closePath();
  c.fillStyle = linear(c, cx - 9, 0, cx + 9, 0, [[0, "#4560cf"], [1, "#101a50"]]); c.fill();
  c.fillStyle = "#e3c06a"; c.fillRect(cx - 9.5, 22.5, 19, 2.6);
  c.beginPath(); c.arc(cx + 1, 15, 3, 0.6, Math.PI * 1.6); c.strokeStyle = "#ffe08a"; c.lineWidth = 1.2; c.stroke();
}

export function drawRanger(c: Ctx, p: number): void {
  const cx = 40;
  // long cloak with leaf hem
  cape(c, cx, 37, 91, 16, p, linear(c, cx - 18, 0, cx + 18, 0, [[0, "#35583a"], [0.5, "#1f3a22"], [1, "#0b170d"]]));
  // quiver
  c.save(); c.translate(cx + 10, 46); c.rotate(0.38);
  c.fillStyle = linear(c, -4.5, 0, 4.5, 0, [[0, "#9a6a3a"], [1, "#3d2614"]]); rrect(c, -4.5, -8, 9, 28, 2.5); c.fill();
  c.fillStyle = "#c9a04a"; c.fillRect(-4.5, -2, 9, 1.4); c.fillRect(-4.5, 14, 9, 1.4);
  for (let i = 0; i < 4; i++) {
    c.fillStyle = "#d8c8a0"; c.fillRect(-3 + i * 2.2, -13, 0.8, 6);
    poly(c, [-3.6 + i * 2.2, -13, -2.4 + i * 2.2, -18, -1.4 + i * 2.2, -13], i % 2 ? "#e8e2d6" : "#a33a2a");
  }
  c.restore();
  const leather = linear(c, cx - 10, 0, cx + 10, 0, [[0, "#6a4a2c"], [1, "#2a1c10"]]);
  leg(c, cx - 8.5, 64, 27, 6.5, p, leather, "#1a120a");
  leg(c, cx + 2, 64, 27, 6.5, -p, leather, "#1a120a");
  // jerkin with straps
  c.beginPath(); c.moveTo(cx - 11, 42); c.lineTo(cx + 11, 42); c.lineTo(cx + 10, 68); c.quadraticCurveTo(cx, 71, cx - 10, 68); c.closePath();
  c.fillStyle = radial(c, cx - 4, 48, 20, [[0, "#8a6a44"], [0.6, "#5a4028"], [1, "#2a1c10"]]); c.fill();
  c.strokeStyle = "#1b120a"; c.lineWidth = 2.6; c.beginPath(); c.moveTo(cx - 10, 44); c.lineTo(cx + 10, 64); c.stroke();
  c.fillStyle = "#c9a04a"; c.fillRect(cx - 1, 52, 3, 3);
  c.strokeStyle = "rgba(30,20,10,0.6)"; c.lineWidth = 0.6;
  for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(cx - 8, 47 + i * 5); c.lineTo(cx - 3, 47 + i * 5); c.stroke(); }
  c.fillStyle = "#2a1c10"; c.fillRect(cx - 10.5, 62, 21, 3.5);
  c.fillStyle = "#d9c07a"; c.fillRect(cx - 1.5, 61.5, 3, 4.5);
  // dagger on belt
  c.fillStyle = "#c4ccd6"; poly(c, [cx + 6, 64, cx + 8, 64, cx + 7.5, 74, cx + 6.5, 74], "#c4ccd6");
  c.fillStyle = "#3a2614"; c.fillRect(cx + 5, 61, 4, 3.5);
  // arms + bracers
  c.fillStyle = "#3d5a36"; rrect(c, cx - 18, 44 + p, 6.5, 18, 3); c.fill();
  c.fillStyle = "#24361f"; rrect(c, cx + 11, 44 - p, 6.5, 18, 3); c.fill();
  c.fillStyle = "#5a4028"; c.fillRect(cx - 18, 55 + p, 6.5, 5); c.fillRect(cx + 11, 55 - p, 6.5, 5);
  ellipse(c, cx + 14, 63 - p, 3.2, 3, "#3b2a1a");
  // longbow with carved tips + nocked arrow
  const bx = cx - 21;
  c.lineCap = "round";
  c.strokeStyle = linear(c, 0, 18, 0, 88, [[0, "#c08a4a"], [0.5, "#6a4220"], [1, "#c08a4a"]]);
  c.lineWidth = 3.2;
  c.beginPath(); c.moveTo(bx + 5, 18); c.quadraticCurveTo(bx - 11, 53, bx + 5, 88); c.stroke();
  c.strokeStyle = "#e3c06a"; c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(bx + 5, 18); c.lineTo(bx + 7, 15); c.moveTo(bx + 5, 88); c.lineTo(bx + 7, 91); c.stroke();
  c.strokeStyle = "rgba(230,230,220,0.9)"; c.lineWidth = 0.8;
  c.beginPath(); c.moveTo(bx + 5, 18); c.lineTo(bx + 5, 88); c.stroke();
  c.fillStyle = "#d8c8a0"; c.fillRect(bx - 4, 52.4, 14, 1.2);
  poly(c, [bx - 7, 53, bx - 3, 51, bx - 3, 55], "#e8f0e8");
  ellipse(c, bx + 3, 53, 3.2, 3.2, "#3b2a1a");
  // hood + scarf
  c.beginPath(); c.moveTo(cx - 12, 41); c.quadraticCurveTo(cx - 14, 21, cx - 2, 15); c.quadraticCurveTo(cx + 10, 13, cx + 13, 27);
  c.quadraticCurveTo(cx + 15, 36, cx + 12, 42); c.closePath();
  c.fillStyle = radial(c, cx - 5, 23, 24, [[0, "#5a8a50"], [0.6, "#284526"], [1, "#0e1a0f"]]); c.fill();
  c.strokeStyle = "rgba(140,190,120,0.4)"; c.lineWidth = 0.8;
  c.beginPath(); c.moveTo(cx - 10, 36); c.quadraticCurveTo(cx - 11, 22, cx - 2, 17); c.stroke();
  ellipse(c, cx, 31, 6.8, 6.2, "#060708");
  c.fillStyle = "#1d2a1c"; c.beginPath(); c.moveTo(cx - 7, 33); c.lineTo(cx + 7, 33); c.lineTo(cx + 5, 40); c.lineTo(cx - 5, 40); c.closePath(); c.fill();
  glowDot(c, cx - 2.7, 30.3, 0.9, 0xd8ffcf);
  glowDot(c, cx + 2.7, 30.3, 0.9, 0xd8ffcf);
}

// ── Town NPCs ──────────────────────────────────────────────────────────

export function drawElder(c: Ctx, p: number): void {
  const cx = 38;
  c.fillStyle = linear(c, 56, 0, 61, 0, [[0, "#8a6038"], [1, "#3a2614"]]);
  rrect(c, 56, 14, 4, 80, 2); c.fill();
  c.fillStyle = "#3a3a42"; rrect(c, 52.5, 10, 11, 9, 2); c.fill();
  glowDot(c, 58, 14.5, 2.6, 0xffb36b);
  c.beginPath(); c.moveTo(cx - 11, 40); c.quadraticCurveTo(cx - 17, 70, cx - 19 - p * 2, 93); c.lineTo(cx + 19 - p * 2, 93);
  c.quadraticCurveTo(cx + 17, 70, cx + 11, 40); c.closePath();
  c.fillStyle = linear(c, cx - 19, 0, cx + 19, 0, [[0, "#d8d2c4"], [0.5, "#9a948a"], [1, "#4a463e"]]); c.fill();
  c.fillStyle = "#6a4a2a"; c.fillRect(cx - 12, 58, 24, 4);
  c.fillStyle = "#c9a04a"; c.fillRect(cx - 1.5, 58, 3, 12);
  poly(c, [cx - 11, 43, cx - 17, 46, cx - 22, 64, cx - 14, 66, cx - 10, 54], "#bcb5a6");
  poly(c, [cx + 11, 43, cx + 17, 46, cx + 21, 60, cx + 14, 62, cx + 10, 54], "#8a8478");
  ellipse(c, cx + 19, 62, 3.4, 3.2, "#d8b89a");
  ellipse(c, cx, 29, 8, 9, radial(c, cx - 3, 25, 11, [[0, "#f0d2b4"], [1, "#a8806a"]]));
  c.beginPath(); c.moveTo(cx - 7, 31); c.lineTo(cx + 7, 31); c.quadraticCurveTo(cx + 6, 50, cx, 60); c.quadraticCurveTo(cx - 6, 50, cx - 7, 31);
  c.fillStyle = linear(c, 0, 31, 0, 60, [[0, "#ffffff"], [1, "#b8b4ac"]]); c.fill();
  ellipse(c, cx - 3, 28, 1.1, 1, "#20202a"); ellipse(c, cx + 3, 28, 1.1, 1, "#20202a");
  c.strokeStyle = "#e8e4dc"; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(cx - 5, 25.5); c.lineTo(cx - 1.5, 26); c.moveTo(cx + 5, 25.5); c.lineTo(cx + 1.5, 26); c.stroke();
}

export function drawHealer(c: Ctx, p: number): void {
  const cx = 38;
  c.beginPath(); c.moveTo(cx - 10, 40); c.quadraticCurveTo(cx - 16, 70, cx - 18 - p * 2, 93); c.lineTo(cx + 18 - p * 2, 93);
  c.quadraticCurveTo(cx + 16, 70, cx + 10, 40); c.closePath();
  c.fillStyle = linear(c, cx - 18, 0, cx + 18, 0, [[0, "#f6f4ee"], [0.5, "#c8c4ba"], [1, "#6a665e"]]); c.fill();
  c.strokeStyle = "#4fae5a"; c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(cx - 17.5, 90); c.lineTo(cx + 17.5 - p * 2, 90); c.moveTo(cx, 44); c.lineTo(cx, 92); c.stroke();
  poly(c, [cx - 2.5, 50, cx + 2.5, 50, cx + 2.5, 54, cx + 6, 54, cx + 6, 58, cx + 2.5, 58, cx + 2.5, 62, cx - 2.5, 62,
    cx - 2.5, 58, cx - 6, 58, cx - 6, 54, cx - 2.5, 54], "#3fb04f");
  poly(c, [cx - 10, 43, cx - 16, 46, cx - 20, 60, cx - 12, 62, cx - 9, 52], "#dedad0");
  poly(c, [cx + 10, 43, cx + 16, 46, cx + 20, 60, cx + 12, 62, cx + 9, 52], "#9a968c");
  glowDot(c, cx - 19, 58, 3.4, 0x7dff8a);
  ellipse(c, cx, 30, 7.5, 8, radial(c, cx - 3, 27, 10, [[0, "#f6d8bc"], [1, "#b08a70"]]));
  c.fillStyle = "#8a5a32";
  c.beginPath(); c.moveTo(cx - 8, 30); c.quadraticCurveTo(cx - 9, 18, cx, 19); c.quadraticCurveTo(cx + 9, 18, cx + 8, 30); c.quadraticCurveTo(cx, 23, cx - 8, 30); c.fill();
  c.fillRect(cx - 9, 30, 3, 16); c.fillRect(cx + 6, 30, 3, 16);
  c.beginPath(); c.moveTo(cx - 11, 32); c.quadraticCurveTo(cx - 12, 16, cx, 15); c.quadraticCurveTo(cx + 12, 16, cx + 11, 32);
  c.strokeStyle = "#e8e4dc"; c.lineWidth = 3; c.stroke();
  ellipse(c, cx - 2.8, 31, 1, 1, "#20202a"); ellipse(c, cx + 2.8, 31, 1, 1, "#20202a");
}

export function drawArenaMaster(c: Ctx, p: number): void {
  const cx = 38;
  cape(c, cx, 40, 90, 17, p, linear(c, cx - 18, 0, cx + 18, 0, [[0, "#6a5a48"], [1, "#2a2218"]]));
  leg(c, cx - 9, 64, 28, 7.5, p, "#4a3a2a", "#1e1610");
  leg(c, cx + 2, 64, 28, 7.5, -p, "#4a3a2a", "#1e1610");
  poly(c, [cx - 12, 41, cx + 12, 41, cx + 10, 66, cx - 10, 66], radial(c, cx - 4, 48, 22, [[0, "#c89878"], [1, "#6a4a38"]]));
  c.strokeStyle = "rgba(90,60,40,0.6)"; c.lineWidth = 0.8;
  c.beginPath(); c.moveTo(cx, 44); c.lineTo(cx, 60); c.moveTo(cx - 8, 50); c.quadraticCurveTo(cx - 4, 53, cx, 50); c.quadraticCurveTo(cx + 4, 53, cx + 8, 50); c.stroke();
  c.strokeStyle = "#3a2a18"; c.lineWidth = 3; c.beginPath(); c.moveTo(cx - 11, 42); c.lineTo(cx + 10, 64); c.stroke();
  c.fillStyle = "#3a2a18"; c.fillRect(cx - 11, 62, 22, 4.5);
  c.fillStyle = "#b8b0a0"; c.beginPath(); c.arc(cx, 64, 3, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#c89878"; rrect(c, cx - 21, 45, 8, 19, 3.5); c.fill(); rrect(c, cx + 13, 45, 8, 17, 3.5); c.fill();
  // great axe
  c.fillStyle = "#4a2c17"; c.fillRect(cx + 20, 10, 3.5, 78);
  c.beginPath(); c.moveTo(cx + 23, 14); c.quadraticCurveTo(cx + 38, 20, cx + 33, 36); c.lineTo(cx + 23, 30); c.closePath();
  c.fillStyle = linear(c, cx + 23, 0, cx + 36, 0, [[0, "#9aa3ad"], [1, "#e8eef4"]]); c.fill();
  // fur collar + horned helm
  for (let i = 0; i < 9; i++) ellipse(c, cx - 14 + i * 3.5, 42, 3.5, 3, i % 2 ? "#7a6a58" : "#5a4a38");
  ellipse(c, cx, 30, 9.5, 10.5, radial(c, cx - 3, 26, 13, [[0, "#dcd0b8"], [1, "#6a5a48"]]));
  ellipse(c, cx, 27, 10, 6, radial(c, cx - 3, 24, 12, [[0, "#c8ced6"], [1, "#4a5058"]]));
  for (const s of [-1, 1]) {
    c.beginPath(); c.moveTo(cx + s * 8, 25); c.quadraticCurveTo(cx + s * 18, 22, cx + s * 17, 10); c.quadraticCurveTo(cx + s * 13, 18, cx + s * 6, 21); c.closePath();
    c.fillStyle = "#e8dcc4"; c.fill();
  }
  ellipse(c, cx - 3.2, 31, 1.1, 1.1, "#141018"); ellipse(c, cx + 3.2, 31, 1.1, 1.1, "#141018");
  c.fillStyle = "#6a4a2a"; c.beginPath(); c.moveTo(cx - 6, 34); c.quadraticCurveTo(cx, 44, cx + 6, 34); c.fill();
}

// ── Undead ─────────────────────────────────────────────────────────────

export function drawSkeleton(c: Ctx, p: number): void {
  const cx = 32;
  const bone = "#e4dcc8", shade = "#9a917c";
  // legs (bones)
  for (const [x, s] of [[cx - 6, p], [cx + 3, -p]] as [number, number][]) {
    const lift = Math.max(0, s) * 3;
    c.strokeStyle = bone; c.lineWidth = 2.6; c.lineCap = "round";
    c.beginPath(); c.moveTo(x + 1.5, 60); c.lineTo(x + 1.5 + s * 2, 72 - lift); c.lineTo(x + 1.5 + s * 1.5, 84 - lift); c.stroke();
    ellipse(c, x + 1.5 + s * 2, 72 - lift, 2.2, 2, shade);
    ellipse(c, x + 3 + s * 1.5, 85 - lift, 3.5, 1.8, bone);
  }
  // pelvis + loincloth
  ellipse(c, cx, 59, 7, 3.5, bone);
  poly(c, [cx - 8, 58, cx + 8, 58, cx + 6, 70, cx + 1, 66, cx - 3, 71, cx - 7, 66], "#4a3a2a");
  // spine + ribs
  c.strokeStyle = bone; c.lineWidth = 2.4;
  c.beginPath(); c.moveTo(cx, 58); c.lineTo(cx, 36); c.stroke();
  c.lineWidth = 1.6;
  for (let i = 0; i < 4; i++) {
    const y = 40 + i * 4;
    c.beginPath(); c.ellipse(cx, y, 8 - i, 2.6, 0, Math.PI * 0.05, Math.PI * 0.95); c.stroke();
    c.beginPath(); c.ellipse(cx, y, 8 - i, 2.6, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
  }
  // shield arm
  c.beginPath(); c.moveTo(cx - 8, 38); c.lineTo(cx - 13, 48 + p); c.lineTo(cx - 12, 56 + p); c.stroke();
  ellipse(c, cx - 14, 52 + p, 9, 10, radial(c, cx - 17, 48, 13, [[0, "#8a6a4a"], [1, "#3a2a1a"]]));
  c.strokeStyle = "#5a5a62"; c.lineWidth = 1.6; c.beginPath(); c.ellipse(cx - 14, 52 + p, 9, 10, 0, 0, Math.PI * 2); c.stroke();
  ellipse(c, cx - 14, 52 + p, 2.4, 2.4, "#8a8a92");
  // sword arm + rusty sword
  c.strokeStyle = bone; c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(cx + 8, 38); c.lineTo(cx + 12, 47 - p); c.lineTo(cx + 15, 54 - p); c.stroke();
  poly(c, [cx + 14, 54 - p, cx + 17, 53 - p, cx + 27, 24 - p, cx + 25, 22 - p], linear(c, cx + 14, 54, cx + 27, 22, [[0, "#6a5040"], [0.5, "#a89888"], [1, "#d8d0c8"]]));
  c.fillStyle = "#3a2614"; c.fillRect(cx + 11.5, 53 - p, 8, 2.4);
  // skull
  ellipse(c, cx, 28, 8, 8.5, radial(c, cx - 3, 24, 11, [[0, "#fffaf0"], [0.7, bone], [1, shade]]));
  poly(c, [cx - 5, 33, cx + 5, 33, cx + 4, 38, cx - 4, 38], bone);
  ellipse(c, cx - 3.2, 28, 2.4, 2.6, "#08080c"); ellipse(c, cx + 3.2, 28, 2.4, 2.6, "#08080c");
  glowDot(c, cx - 3.2, 28.4, 0.9, 0x5fd8ff);
  glowDot(c, cx + 3.2, 28.4, 0.9, 0x5fd8ff);
  c.strokeStyle = "#3a352c"; c.lineWidth = 0.6;
  for (let i = -3; i <= 3; i++) { c.beginPath(); c.moveTo(cx + i * 1.3, 34); c.lineTo(cx + i * 1.3, 37.5); c.stroke(); }
}

export function drawDeathKnight(c: Ctx, p: number): void {
  const cx = 60;
  cape(c, cx, 52, 142, 30, p, linear(c, cx - 32, 0, cx + 32, 0, [[0, "#1a0d24"], [0.5, "#2e1440"], [1, "#0a0410"]]), "#5e3290");
  const armor = linear(c, cx - 22, 0, cx + 22, 0, [[0, "#5a5a6a"], [0.4, "#2a2a36"], [1, "#0c0c12"]]);
  leg(c, cx - 15, 100, 42, 12, p, armor, "#0a0a10", "#4a4a5a");
  leg(c, cx + 3, 100, 42, 12, -p, armor, "#0a0a10", "#3a3a4a");
  // torso
  c.beginPath(); c.moveTo(cx - 22, 54); c.lineTo(cx + 22, 54); c.lineTo(cx + 18, 92); c.quadraticCurveTo(cx, 100, cx - 18, 92); c.closePath();
  c.fillStyle = radial(c, cx - 8, 62, 40, [[0, "#6a6a7a"], [0.5, "#2a2a36"], [1, "#08080c"]]); c.fill();
  c.strokeStyle = "#9a48ec"; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(cx, 58); c.lineTo(cx, 92); c.moveTo(cx - 14, 68); c.lineTo(cx + 14, 68); c.moveTo(cx - 12, 80); c.lineTo(cx + 12, 80); c.stroke();
  glowDot(c, cx, 70, 3, 0xb05cff);
  // belt with skull buckle
  c.fillStyle = "#1a1a22"; c.fillRect(cx - 19, 90, 38, 6);
  ellipse(c, cx, 93, 4.5, 4, "#d8d0bc"); ellipse(c, cx - 1.5, 92.5, 1, 1, "#08080c"); ellipse(c, cx + 1.5, 92.5, 1, 1, "#08080c");
  // arms
  c.fillStyle = armor; rrect(c, cx - 33, 60, 11, 30, 5); c.fill(); rrect(c, cx + 22, 60, 11, 28, 5); c.fill();
  ellipse(c, cx - 27.5, 92, 7, 6, "#1a1a22"); ellipse(c, cx + 27.5, 90, 7, 6, "#1a1a22");
  // giant runed sword
  const sx = cx + 30;
  c.fillStyle = linear(c, sx - 6, 0, sx + 6, 0, [[0, "#3a3a4a"], [0.5, "#8a8aa0"], [1, "#1a1a26"]]);
  c.beginPath(); c.moveTo(sx - 6, 90); c.lineTo(sx - 6, 18); c.lineTo(sx, 4); c.lineTo(sx + 6, 18); c.lineTo(sx + 6, 90); c.closePath(); c.fill();
  for (let i = 0; i < 6; i++) rune(c, sx, 24 + i * 10, 0xb05cff, 1.1);
  c.fillStyle = "#1a1a22"; rrect(c, sx - 16, 88, 32, 7, 3); c.fill();
  poly(c, [sx - 16, 88, sx - 22, 82, sx - 14, 88], "#2a2a36"); poly(c, [sx + 16, 88, sx + 22, 82, sx + 14, 88], "#2a2a36");
  c.fillStyle = "#2a1a10"; c.fillRect(sx - 2.5, 95, 5, 16);
  // skull pauldrons
  for (const s of [-1, 1]) {
    const px = cx + s * 24;
    ellipse(c, px, 58, 14, 10, radial(c, px - 4, 53, 16, [[0, "#6a6a7a"], [0.6, "#2a2a36"], [1, "#08080c"]]));
    poly(c, [px + s * 4, 50, px + s * 12, 34, px + s * 10, 51], "#3a3a48");
    ellipse(c, px, 59, 5, 4.6, "#d8d0bc");
    ellipse(c, px - 1.8, 58.6, 1.2, 1.3, "#08080c"); ellipse(c, px + 1.8, 58.6, 1.2, 1.3, "#08080c");
  }
  // horned helm
  ellipse(c, cx, 40, 15, 16, radial(c, cx - 5, 33, 20, [[0, "#7a7a8a"], [0.5, "#2a2a36"], [1, "#06060a"]]));
  for (const s of [-1, 1]) {
    c.beginPath(); c.moveTo(cx + s * 11, 32); c.bezierCurveTo(cx + s * 26, 28, cx + s * 30, 14, cx + s * 22, 2);
    c.bezierCurveTo(cx + s * 22, 14, cx + s * 18, 22, cx + s * 8, 26); c.closePath();
    c.fillStyle = linear(c, cx, 30, cx + s * 26, 4, [[0, "#3a3a48"], [1, "#c8bca4"]]); c.fill();
  }
  c.fillStyle = "#04040a"; poly(c, [cx - 10, 40, cx + 10, 40, cx + 7, 45, cx - 7, 45], "#04040a");
  glowDot(c, cx - 4.5, 42, 1.8, 0xb05cff);
  glowDot(c, cx + 4.5, 42, 1.8, 0xb05cff);
  c.strokeStyle = "#04040a"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(cx, 46); c.lineTo(cx, 54); c.stroke();
}

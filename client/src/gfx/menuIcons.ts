import Phaser from "phaser";
import { canvasTex, ellipse, linear, makeCanvas, poly, radial, rrect, type Ctx } from "./draw";

/**
 * Big square icons for the window buttons at the top of the screen (Loja, Mapa, Guilda...): an ornate gold frame
 * with a coloured glow and a painted emblem. Drawn at 128 px and shown at about half size, so they stay crisp.
 */
export const MENU_ICON = 128;

/** Background glow colour of each icon, so the row reads at a glance. */
const TINT: Record<string, [string, string]> = {
  loja: ["#b8321c", "#3a0c06"],
  passe: ["#c98a12", "#3a2404"],
  mapa: ["#2f8a5a", "#08261a"],
  guilda: ["#2d5fc4", "#0a1838"],
  amigos: ["#c04a8e", "#36102a"],
  inventario: ["#8a5a2a", "#2a1608"],
  personagem: ["#6a7a92", "#161c26"],
  skills: ["#7a3cc8", "#1e0c3a"],
  auto: ["#2a9a8a", "#06282a"],
  chat: ["#3a8ac0", "#0a2234"],
  graficos: ["#7a7a7a", "#1c1c20"],
  montaria: ["#a8642a", "#2e1608"],
  boss: ["#d0201a", "#2a0404"],
};

const EMBLEM: Record<string, (c: Ctx) => void> = {
  loja: drawChest,
  passe: drawMedal,
  mapa: drawMap,
  guilda: drawShield,
  amigos: drawFriends,
  inventario: drawBag,
  personagem: drawHelmet,
  skills: drawBook,
  auto: drawSwords,
  chat: drawBubble,
  graficos: drawGear,
  montaria: drawHorseshoe,
  boss: drawSkull,
};

export function ensureMenuIcons(scene: Phaser.Scene): void {
  for (const id of Object.keys(EMBLEM)) {
    canvasTex(scene, `menu_icon_${id}`, MENU_ICON, MENU_ICON, (c) => drawIcon(c, id));
  }
  // soft light behind the hovered / active icon
  canvasTex(scene, "menu_icon_glow", MENU_ICON + 40, MENU_ICON + 40, (c) => {
    const m = (MENU_ICON + 40) / 2;
    c.fillStyle = radial(c, m, m, m, [[0, "rgba(255,214,120,0.75)"], [0.55, "rgba(255,180,70,0.35)"], [1, "rgba(255,160,40,0)"]]);
    c.fillRect(0, 0, MENU_ICON + 40, MENU_ICON + 40);
  });
}

function drawIcon(c: Ctx, id: string): void {
  const S = MENU_ICON;
  const [hi, lo] = TINT[id];
  // drop shadow
  c.save();
  c.shadowColor = "rgba(0,0,0,0.8)"; c.shadowBlur = 8; c.shadowOffsetY = 3;
  rrect(c, 10, 10, S - 20, S - 20, 18);
  c.fillStyle = "#000"; c.fill();
  c.restore();
  // coloured, glowing inside
  rrect(c, 12, 12, S - 24, S - 24, 16);
  c.fillStyle = radial(c, S / 2, S / 2 - 6, S * 0.52, [[0, hi], [0.65, lo], [1, "#050307"]]);
  c.fill();
  // fine rays behind the emblem
  c.save();
  rrect(c, 12, 12, S - 24, S - 24, 16); c.clip();
  c.globalAlpha = 0.16;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    poly(c, [S / 2, S / 2, S / 2 + Math.cos(a - 0.08) * 90, S / 2 + Math.sin(a - 0.08) * 90,
      S / 2 + Math.cos(a + 0.08) * 90, S / 2 + Math.sin(a + 0.08) * 90], "#fff3c8");
  }
  c.restore();
  // ornate gold frame: dark groove, thick bevel, fine light line
  const gold = linear(c, 0, 0, S, S, [[0, "#fff0b0"], [0.25, "#d6a548"], [0.5, "#6b4a18"], [0.75, "#e2b35a"], [1, "#7a5420"]]);
  rrect(c, 12, 12, S - 24, S - 24, 16);
  c.lineWidth = 8; c.strokeStyle = "#1a1006"; c.stroke();
  c.lineWidth = 5.5; c.strokeStyle = gold; c.stroke();
  rrect(c, 18, 18, S - 36, S - 36, 11);
  c.lineWidth = 1.5; c.strokeStyle = "rgba(255,236,170,0.55)"; c.stroke();
  // corner studs
  for (const [x, y] of [[16, 16], [S - 16, 16], [16, S - 16], [S - 16, S - 16]]) {
    poly(c, [x, y - 8, x + 8, y, x, y + 8, x - 8, y], linear(c, x - 8, y - 8, x + 8, y + 8, [[0, "#fff4c0"], [0.5, "#d19a3a"], [1, "#5a3a10"]]), "#1a1006", 1.5);
    ellipse(c, x, y, 2.4, 2.4, "#3a0c06");
  }
  // top crest
  poly(c, [S / 2, 2, S / 2 + 12, 13, S / 2, 20, S / 2 - 12, 13], linear(c, 0, 2, 0, 20, [[0, "#fff0b0"], [1, "#8a5c1c"]]), "#1a1006", 1.5);
  ellipse(c, S / 2, 12, 3.5, 3.5, radial(c, S / 2, 11, 4, [[0, "#ffd0d0"], [1, "#c0141c"]]));

  // the emblem, with a dark outline so it pops off the glow
  const [art, a] = makeCanvas(S, S);
  EMBLEM[id](a);
  const [sil, s] = makeCanvas(S, S);
  s.drawImage(art, 0, 0);
  s.globalCompositeOperation = "source-in";
  s.fillStyle = "rgba(8,5,3,0.95)"; s.fillRect(0, 0, S, S);
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    c.drawImage(sil, Math.cos(ang) * 2.5, Math.sin(ang) * 2.5);
  }
  c.save();
  c.shadowColor = "rgba(0,0,0,0.6)"; c.shadowBlur = 6; c.shadowOffsetY = 3;
  c.drawImage(art, 0, 0);
  c.restore();
  // glossy top light over the whole button
  c.save();
  rrect(c, 14, 14, S - 28, S - 28, 14); c.clip();
  c.fillStyle = linear(c, 0, 14, 0, 60, [[0, "rgba(255,255,255,0.22)"], [1, "rgba(255,255,255,0)"]]);
  c.fillRect(14, 14, S - 28, 46);
  c.restore();
}

// ── emblems (drawn in a 128 × 128 box, centre ~64,66) ─────────────────

const GOLD = (c: Ctx, y0: number, y1: number) => linear(c, 0, y0, 0, y1, [[0, "#fff3b8"], [0.45, "#e8b44a"], [1, "#8a5a16"]]);

function gem(c: Ctx, x: number, y: number, r: number, light: string, dark: string): void {
  poly(c, [x, y - r, x + r * 0.8, y, x, y + r, x - r * 0.8, y], linear(c, x - r, y - r, x + r, y + r, [[0, light], [1, dark]]), "#1a0a0a", 1);
  ellipse(c, x - r * 0.25, y - r * 0.35, r * 0.22, r * 0.16, "rgba(255,255,255,0.85)");
}

function drawChest(c: Ctx): void {
  // light spilling out of the lid
  c.fillStyle = radial(c, 64, 52, 40, [[0, "rgba(255,230,140,0.9)"], [1, "rgba(255,200,80,0)"]]);
  c.fillRect(20, 14, 88, 70);
  // lid
  c.beginPath(); c.moveTo(30, 58); c.quadraticCurveTo(64, 26, 98, 58); c.closePath();
  c.fillStyle = linear(c, 0, 34, 0, 58, [[0, "#a05a26"], [1, "#5a2c10"]]); c.fill();
  // body
  rrect(c, 30, 58, 68, 38, 4);
  c.fillStyle = linear(c, 0, 58, 0, 96, [[0, "#8a4a1e"], [1, "#4a220a"]]); c.fill();
  // gold bands
  for (const x of [38, 84]) {
    c.fillStyle = GOLD(c, 40, 96); c.fillRect(x, 42, 7, 54);
  }
  c.fillStyle = GOLD(c, 56, 62); c.fillRect(30, 56, 68, 5);
  // lock
  rrect(c, 58, 62, 12, 14, 3); c.fillStyle = GOLD(c, 62, 76); c.fill();
  ellipse(c, 64, 68, 2, 2.5, "#2a1404");
  // gems on top
  gem(c, 52, 46, 7, "#ff8a8a", "#a0101a");
  gem(c, 66, 40, 8, "#a8f0ff", "#1a68c0");
  gem(c, 78, 47, 6, "#b8ff9a", "#1a8a30");
}

function drawMedal(c: Ctx): void {
  // ribbons
  poly(c, [48, 30, 60, 30, 70, 64, 58, 68], linear(c, 0, 30, 0, 68, [[0, "#d02a2a"], [1, "#6a0a10"]]));
  poly(c, [80, 30, 68, 30, 58, 64, 70, 68], linear(c, 0, 30, 0, 68, [[0, "#2a5ad0"], [1, "#0a206a"]]));
  // disc
  ellipse(c, 64, 76, 26, 26, GOLD(c, 50, 102));
  ellipse(c, 64, 76, 20, 20, linear(c, 0, 56, 0, 96, [[0, "#c88a24"], [1, "#fff0a8"]]));
  // star
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 7 : 16;
    pts.push(64 + Math.cos(a) * r, 76 + Math.sin(a) * r);
  }
  poly(c, pts, linear(c, 0, 60, 0, 92, [[0, "#ffffff"], [1, "#ffd24a"]]), "#7a4a0a", 1.5);
}

function drawMap(c: Ctx): void {
  // parchment with rolled ends
  c.beginPath();
  c.moveTo(28, 38); c.lineTo(100, 34); c.lineTo(100, 92); c.lineTo(28, 96); c.closePath();
  c.fillStyle = linear(c, 28, 34, 100, 96, [[0, "#f6e6b8"], [0.5, "#e2c886"], [1, "#b8925a"]]); c.fill();
  for (const [x, y0, y1] of [[28, 38, 96], [100, 34, 92]] as const) {
    rrect(c, x - 6, y0 - 4, 12, y1 - y0 + 8, 6);
    c.fillStyle = linear(c, x - 6, 0, x + 6, 0, [[0, "#8a6232"], [0.5, "#f0d8a0"], [1, "#7a5226"]]); c.fill();
  }
  // land and sea
  c.fillStyle = "rgba(60,120,160,0.45)";
  c.beginPath(); c.ellipse(80, 50, 14, 9, 0.2, 0, Math.PI * 2); c.fill();
  c.fillStyle = "rgba(70,120,50,0.55)";
  c.beginPath(); c.ellipse(46, 76, 12, 10, -0.3, 0, Math.PI * 2); c.fill();
  // dotted path to the X
  c.strokeStyle = "#8a1a10"; c.lineWidth = 3; c.setLineDash([5, 5]);
  c.beginPath(); c.moveTo(42, 50); c.quadraticCurveTo(64, 92, 82, 74); c.stroke();
  c.setLineDash([]);
  c.lineWidth = 5; c.strokeStyle = "#c0141c"; c.lineCap = "round";
  c.beginPath(); c.moveTo(76, 68); c.lineTo(88, 80); c.moveTo(88, 68); c.lineTo(76, 80); c.stroke();
  c.lineCap = "butt";
}

function drawShield(c: Ctx): void {
  // crossed banners behind
  c.lineWidth = 4; c.strokeStyle = "#5a3a14";
  c.beginPath(); c.moveTo(30, 28); c.lineTo(98, 100); c.moveTo(98, 28); c.lineTo(30, 100); c.stroke();
  poly(c, [30, 28, 50, 32, 46, 46, 34, 44], "#c02020");
  poly(c, [98, 28, 78, 32, 82, 46, 94, 44], "#c02020");
  // shield
  c.beginPath();
  c.moveTo(64, 26); c.lineTo(94, 36); c.lineTo(92, 66); c.quadraticCurveTo(88, 90, 64, 104);
  c.quadraticCurveTo(40, 90, 36, 66); c.lineTo(34, 36); c.closePath();
  c.fillStyle = GOLD(c, 26, 104); c.fill();
  c.beginPath();
  c.moveTo(64, 33); c.lineTo(87, 41); c.lineTo(85, 66); c.quadraticCurveTo(82, 85, 64, 96);
  c.quadraticCurveTo(46, 85, 43, 66); c.lineTo(41, 41); c.closePath();
  c.fillStyle = linear(c, 0, 33, 0, 96, [[0, "#3a7ae8"], [1, "#0e2a70"]]); c.fill();
  // gold cross
  c.fillStyle = GOLD(c, 40, 92);
  c.fillRect(60, 40, 8, 50); c.fillRect(48, 54, 32, 8);
  gem(c, 64, 58, 6, "#ffb0b0", "#a0101a");
}

function drawFriends(c: Ctx): void {
  const person = (x: number, y: number, k: number, body: [number, string][], skin: string) => {
    c.beginPath();
    c.moveTo(x - 22 * k, y + 40 * k); c.quadraticCurveTo(x - 22 * k, y + 12 * k, x, y + 10 * k);
    c.quadraticCurveTo(x + 22 * k, y + 12 * k, x + 22 * k, y + 40 * k); c.closePath();
    c.fillStyle = linear(c, 0, y + 10 * k, 0, y + 40 * k, body); c.fill();
    ellipse(c, x, y - 4 * k, 12 * k, 13 * k, linear(c, 0, y - 17 * k, 0, y + 9 * k, [[0, "#ffe2c0"], [1, skin]]));
  };
  person(46, 50, 0.9, [[0, "#7a4ac0"], [1, "#2a1050"]], "#c08a60");
  person(80, 54, 1, [[0, "#c0402a"], [1, "#4a1008"]], "#b07a50");
  // little heart
  c.beginPath();
  const hx = 63, hy = 30;
  c.moveTo(hx, hy + 8); c.bezierCurveTo(hx - 12, hy, hx - 6, hy - 10, hx, hy - 3);
  c.bezierCurveTo(hx + 6, hy - 10, hx + 12, hy, hx, hy + 8);
  c.fillStyle = linear(c, 0, hy - 10, 0, hy + 8, [[0, "#ff9ab0"], [1, "#d0103a"]]); c.fill();
}

function drawBag(c: Ctx): void {
  // sack body
  c.beginPath();
  c.moveTo(50, 46); c.quadraticCurveTo(24, 66, 30, 90); c.quadraticCurveTo(36, 104, 64, 104);
  c.quadraticCurveTo(92, 104, 98, 90); c.quadraticCurveTo(104, 66, 78, 46); c.closePath();
  c.fillStyle = linear(c, 30, 46, 98, 104, [[0, "#b8783a"], [0.6, "#7a4618"], [1, "#4a2408"]]); c.fill();
  // neck and tie
  poly(c, [50, 46, 78, 46, 84, 30, 44, 30], linear(c, 0, 30, 0, 46, [[0, "#c88a48"], [1, "#7a4618"]]));
  c.fillStyle = GOLD(c, 42, 50); c.fillRect(46, 42, 36, 7);
  ellipse(c, 64, 45, 5, 5, "#c0141c");
  // stitched patch with a coin
  c.strokeStyle = "rgba(255,220,160,0.7)"; c.lineWidth = 1.5; c.setLineDash([3, 3]);
  rrect(c, 48, 64, 32, 26, 6); c.stroke(); c.setLineDash([]);
  ellipse(c, 64, 77, 8, 8, GOLD(c, 69, 85));
  ellipse(c, 64, 77, 4, 4, "rgba(120,70,10,0.6)");
}

function drawHelmet(c: Ctx): void {
  // plume
  c.beginPath(); c.moveTo(64, 34); c.quadraticCurveTo(70, 10, 96, 18); c.quadraticCurveTo(80, 24, 72, 38); c.closePath();
  c.fillStyle = linear(c, 64, 14, 96, 38, [[0, "#ff5a4a"], [1, "#8a0a10"]]); c.fill();
  // dome
  c.beginPath();
  c.moveTo(36, 84); c.quadraticCurveTo(34, 34, 64, 32); c.quadraticCurveTo(94, 34, 92, 84);
  c.lineTo(84, 100); c.lineTo(44, 100); c.closePath();
  c.fillStyle = linear(c, 36, 32, 92, 100, [[0, "#f4f8ff"], [0.4, "#9aa6b8"], [1, "#3a4252"]]); c.fill();
  // visor slit and breaths
  poly(c, [42, 62, 86, 62, 82, 70, 46, 70], "#0a0c12");
  c.fillStyle = "#0a0c12";
  for (let i = 0; i < 4; i++) c.fillRect(52 + i * 7, 78, 3, 12);
  // gold rim and crest line
  c.fillStyle = GOLD(c, 34, 100); c.fillRect(61, 32, 6, 30);
  c.strokeStyle = GOLD(c, 84, 102); c.lineWidth = 4;
  c.beginPath(); c.moveTo(38, 86); c.lineTo(44, 100); c.lineTo(84, 100); c.lineTo(90, 86); c.stroke();
}

function drawBook(c: Ctx): void {
  // magic glow
  c.fillStyle = radial(c, 64, 52, 38, [[0, "rgba(220,170,255,0.95)"], [1, "rgba(150,80,255,0)"]]);
  c.fillRect(20, 10, 88, 80);
  // open book
  c.beginPath(); c.moveTo(64, 56); c.quadraticCurveTo(44, 46, 24, 52); c.lineTo(24, 96); c.quadraticCurveTo(44, 90, 64, 100); c.closePath();
  c.fillStyle = linear(c, 24, 0, 64, 0, [[0, "#d8c49a"], [1, "#fff6dc"]]); c.fill();
  c.beginPath(); c.moveTo(64, 56); c.quadraticCurveTo(84, 46, 104, 52); c.lineTo(104, 96); c.quadraticCurveTo(84, 90, 64, 100); c.closePath();
  c.fillStyle = linear(c, 64, 0, 104, 0, [[0, "#fff6dc"], [1, "#d8c49a"]]); c.fill();
  // cover edge
  c.strokeStyle = "#5a1a6a"; c.lineWidth = 4;
  c.beginPath(); c.moveTo(22, 96); c.quadraticCurveTo(44, 92, 64, 102); c.quadraticCurveTo(84, 92, 106, 96); c.stroke();
  // text lines
  c.strokeStyle = "rgba(90,60,40,0.6)"; c.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    c.beginPath(); c.moveTo(30, 62 + i * 7); c.quadraticCurveTo(44, 58 + i * 7, 58, 64 + i * 7); c.stroke();
    c.beginPath(); c.moveTo(70, 64 + i * 7); c.quadraticCurveTo(84, 58 + i * 7, 98, 62 + i * 7); c.stroke();
  }
  // rune sparkle rising
  const star = (x: number, y: number, r: number) => {
    poly(c, [x, y - r, x + r * 0.25, y - r * 0.25, x + r, y, x + r * 0.25, y + r * 0.25, x, y + r, x - r * 0.25, y + r * 0.25, x - r, y, x - r * 0.25, y - r * 0.25], "#ffffff");
  };
  star(64, 34, 12); star(46, 40, 6); star(84, 30, 7);
}

function drawSwords(c: Ctx): void {
  const sword = (flip: number) => {
    c.save();
    c.translate(64, 64); c.rotate(flip * Math.PI / 4);
    // blade
    poly(c, [-5, 18, -5, -34, 0, -44, 5, -34, 5, 18], linear(c, -5, 0, 5, 0, [[0, "#ffffff"], [0.5, "#b8c4d8"], [1, "#5a6478"]]));
    // guard, grip, pommel
    rrect(c, -16, 16, 32, 7, 3); c.fillStyle = GOLD(c, 16, 23); c.fill();
    c.fillStyle = "#5a2a10"; c.fillRect(-3.5, 23, 7, 16);
    ellipse(c, 0, 42, 5.5, 5.5, GOLD(c, 37, 47));
    c.restore();
  };
  sword(-1); sword(1);
  // spark where they cross
  c.fillStyle = radial(c, 64, 52, 16, [[0, "rgba(255,255,220,1)"], [1, "rgba(255,200,80,0)"]]);
  c.fillRect(44, 32, 40, 40);
}

function drawBubble(c: Ctx): void {
  c.beginPath();
  c.moveTo(32, 40); c.quadraticCurveTo(32, 30, 44, 30); c.lineTo(88, 30); c.quadraticCurveTo(100, 30, 100, 42);
  c.lineTo(100, 72); c.quadraticCurveTo(100, 84, 88, 84); c.lineTo(58, 84); c.lineTo(40, 100); c.lineTo(44, 84);
  c.quadraticCurveTo(32, 84, 32, 72); c.closePath();
  c.fillStyle = linear(c, 0, 30, 0, 100, [[0, "#ffffff"], [1, "#a8c8e8"]]); c.fill();
  for (const x of [50, 66, 82]) ellipse(c, x, 57, 6, 6, linear(c, 0, 51, 0, 63, [[0, "#4aa0e8"], [1, "#0a3a80"]]));
}

function drawGear(c: Ctx): void {
  c.beginPath();
  const teeth = 9;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2, a2 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    const r = i % 2 ? 26 : 36;
    if (i === 0) c.moveTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    c.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    c.lineTo(64 + Math.cos(a2) * r, 64 + Math.sin(a2) * r);
  }
  c.closePath();
  c.fillStyle = linear(c, 28, 28, 100, 100, [[0, "#f0f4fa"], [0.5, "#8a96a8"], [1, "#3a4252"]]); c.fill();
  ellipse(c, 64, 64, 14, 14, "#14161c");
  ellipse(c, 64, 64, 9, 9, GOLD(c, 55, 73));
}

function drawHorseshoe(c: Ctx): void {
  c.lineCap = "round";
  c.strokeStyle = "#2a1a0a"; c.lineWidth = 22;
  c.beginPath(); c.arc(64, 60, 28, Math.PI * 0.85, Math.PI * 2.15); c.stroke();
  c.strokeStyle = GOLD(c, 28, 96); c.lineWidth = 16;
  c.beginPath(); c.arc(64, 60, 28, Math.PI * 0.85, Math.PI * 2.15); c.stroke();
  c.lineCap = "butt";
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * (0.95 + (i / 5) * 1.1);
    ellipse(c, 64 + Math.cos(a) * 28, 60 + Math.sin(a) * 28, 2.5, 2.5, "#3a2006");
  }
}

function drawSkull(c: Ctx): void {
  // fire behind
  c.fillStyle = radial(c, 64, 70, 46, [[0, "rgba(255,190,60,0.95)"], [0.5, "rgba(230,70,20,0.6)"], [1, "rgba(200,20,10,0)"]]);
  c.fillRect(14, 20, 100, 100);
  // horns
  const horn = (s: number) => {
    c.beginPath();
    c.moveTo(64 + s * 18, 46); c.quadraticCurveTo(64 + s * 44, 40, 64 + s * 42, 14);
    c.quadraticCurveTo(64 + s * 34, 34, 64 + s * 12, 36); c.closePath();
    c.fillStyle = linear(c, 0, 14, 0, 46, [[0, "#fff4d8"], [1, "#8a6a40"]]); c.fill();
  };
  horn(-1); horn(1);
  // skull
  c.beginPath();
  c.moveTo(64, 30); c.bezierCurveTo(90, 30, 96, 52, 92, 70); c.lineTo(84, 80); c.lineTo(82, 96); c.lineTo(46, 96);
  c.lineTo(44, 80); c.lineTo(36, 70); c.bezierCurveTo(32, 52, 38, 30, 64, 30); c.closePath();
  c.fillStyle = linear(c, 0, 30, 0, 96, [[0, "#ffffff"], [0.6, "#d8ccb8"], [1, "#8a7a62"]]); c.fill();
  // glowing eyes and nose
  for (const x of [52, 76]) {
    ellipse(c, x, 62, 9, 8, "#1a0404");
    ellipse(c, x, 63, 4, 3.5, radial(c, x, 63, 5, [[0, "#ffffa0"], [1, "#ff3010"]]));
  }
  poly(c, [64, 70, 69, 79, 59, 79], "#1a0404");
  // teeth
  c.fillStyle = "#1a0404";
  for (let i = 0; i < 5; i++) c.fillRect(50 + i * 6.5, 84, 2, 11);
}

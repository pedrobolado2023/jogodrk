/**
 * Ore veins of the mine: a boulder with crystals in the ore's colour (`vein_<kind>`), and the same
 * boulder without crystals once mined out (`vein_empty`).
 */
import Phaser from "phaser";
import { canvasTex, linear, poly, radial, type Ctx } from "./draw";

export const VEIN_INFO: Record<string, { name: string; light: string; dark: string; glow?: number }> = {
  iron: { name: "Veio de Ferro", light: "#c98a5c", dark: "#6a3a22" },
  silver: { name: "Veio de Prata", light: "#f4f8ff", dark: "#8a96b0" },
  gold: { name: "Veio de Ouro", light: "#ffe88a", dark: "#b07a14", glow: 0xffc857 },
  arcane: { name: "Veio de Cristal Arcano", light: "#e8c0ff", dark: "#6a2adf", glow: 0xb05cff },
};

export const VEIN_ORIGIN: [number, number] = [0.5, 0.86];

function boulder(c: Ctx, dim: boolean): void {
  poly(c, [6, 50, 10, 30, 22, 16, 40, 12, 56, 20, 66, 34, 64, 50, 46, 56, 20, 56],
    linear(c, 0, 10, 0, 58, [[0, dim ? "#3a3632" : "#5a544c"], [1, dim ? "#141210" : "#24201c"]]), "#0a0908", 1.5);
  poly(c, [22, 16, 40, 12, 56, 20, 44, 26, 28, 24], dim ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.1)");
  c.strokeStyle = "rgba(0,0,0,0.45)";
  c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(30, 26); c.lineTo(26, 40); c.moveTo(48, 28); c.lineTo(54, 44); c.stroke();
}

function crystals(c: Ctx, light: string, dark: string): void {
  const shard = (x: number, y: number, w: number, h: number, lean: number) =>
    poly(c, [x - w, y, x + lean, y - h, x + w, y], linear(c, x - w, 0, x + w, 0, [[0, light], [1, dark]]), "rgba(0,0,0,0.5)", 1);
  shard(24, 34, 5, 18, -2);
  shard(34, 30, 6, 24, 1);
  shard(45, 35, 5, 16, 3);
  shard(52, 42, 4, 11, 2);
  shard(16, 44, 4, 10, -1);
}

export function ensureVeinTextures(scene: Phaser.Scene): void {
  for (const [kind, v] of Object.entries(VEIN_INFO)) {
    canvasTex(scene, `vein_${kind}`, 72, 60, (c) => {
      if (v.glow) {
        c.fillStyle = radial(c, 36, 32, 34, [[0, v.glow === 0xb05cff ? "rgba(176,92,255,0.35)" : "rgba(255,200,87,0.3)"], [1, "rgba(0,0,0,0)"]]);
        c.fillRect(0, 0, 72, 60);
      }
      boulder(c, false);
      crystals(c, v.light, v.dark);
    });
  }
  canvasTex(scene, "vein_empty", 72, 60, (c) => boulder(c, true));
}

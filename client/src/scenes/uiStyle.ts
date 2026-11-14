import Phaser from "phaser";
import { FONT } from "../gfx/draw";

/** Shared look of the HUD windows. */
export const txt = (size: number, color: string, extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: FONT, fontSize: `${size}px`, color, stroke: "#000000", strokeThickness: 3, ...extra,
});

export function panel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r = 8, alpha = 0.92): void {
  g.fillStyle(0x0c0a12, alpha).fillRoundedRect(x, y, w, h, r);
  g.lineStyle(2, 0x6b5226, 1).strokeRoundedRect(x, y, w, h, r);
  g.lineStyle(1, 0xd6aa5a, 0.35).strokeRoundedRect(x + 3, y + 3, w - 6, h - 6, Math.max(1, r - 2));
}

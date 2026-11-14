/**
 * Isometric 2:1 projection utilities.
 * World coords (tile x,y) ↔ screen coords (pixel x,y).
 */

export const TILE_W = 64;
export const TILE_H = 32;

export function worldToScreen(wx: number, wy: number): { sx: number; sy: number } {
  return {
    sx: (wx - wy) * (TILE_W / 2),
    sy: (wx + wy) * (TILE_H / 2),
  };
}

export function screenToWorld(sx: number, sy: number): { wx: number; wy: number } {
  return {
    wx: (sx / (TILE_W / 2) + sy / (TILE_H / 2)) / 2,
    wy: (sy / (TILE_H / 2) - sx / (TILE_W / 2)) / 2,
  };
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

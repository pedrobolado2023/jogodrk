/**
 * Graphics quality (Baixa / Média / Alta), remembered in this browser. Decides which purely visual
 * extras run: blended ground, swaying trees, prop shadows, fog, light rays and how dense the floating
 * particles are. Gameplay never depends on it.
 */

export type Quality = "baixa" | "media" | "alta";

export const QUALITY_NAMES: Record<Quality, string> = { baixa: "Baixa", media: "Média", alta: "Alta" };
const ORDER: Quality[] = ["alta", "media", "baixa"];
const KEY = "gfx_quality";

let current: Quality = load();

function load(): Quality {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "baixa" || v === "media" || v === "alta") return v;
  } catch { /* storage blocked: use the default */ }
  return "alta";
}

export function quality(): Quality {
  return current;
}

/** Picks a level (and remembers it). */
export function setQuality(q: Quality): void {
  current = q;
  try { localStorage.setItem(KEY, current); } catch { /* not remembered, still applied now */ }
}

/** Next level in the cycle Alta → Média → Baixa → Alta; returns it. */
export function cycleQuality(): Quality {
  current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  try { localStorage.setItem(KEY, current); } catch { /* not remembered, still applied now */ }
  return current;
}

export interface GfxLook {
  blend: boolean; sway: boolean; shadows: boolean; fog: boolean; rays: boolean; particles: number;
  /** skill effects drawn at the same time (each one is redrawn pixel by pixel many times a second) */
  fxBudget: number;
  /** effect lights cut into the night at the same time (each one costs about 1 ms per frame) */
  fxLights: number;
  /** damage numbers on screen at the same time */
  numbers: number;
}

/** What each level turns on. */
export function gfx(): GfxLook {
  switch (current) {
    case "baixa": return { blend: false, sway: false, shadows: false, fog: false, rays: false, particles: 0.35, fxBudget: 5, fxLights: 2, numbers: 18 };
    case "media": return { blend: true, sway: true, shadows: true, fog: true, rays: false, particles: 0.7, fxBudget: 8, fxLights: 4, numbers: 28 };
    default: return { blend: true, sway: true, shadows: true, fog: true, rays: true, particles: 1, fxBudget: 11, fxLights: 6, numbers: 40 };
  }
}

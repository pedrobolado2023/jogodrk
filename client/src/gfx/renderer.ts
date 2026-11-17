/**
 * Which part of the computer draws the game: the graphics card (WebGL) or the processor (Canvas).
 * The choice is remembered in this browser ("gfx_gpu": "1" on, "0" off, nothing = automatic). Automatic uses the
 * graphics card when the browser offers a real (hardware) one, and turns it off by itself if the game runs badly
 * with it (some computers draw WebGL very slowly in some browsers).
 */
import Phaser from "phaser";

const KEY = "gfx_gpu";

export type GpuChoice = "auto" | "on" | "off";

export function gpuChoice(): GpuChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "1" ? "on" : v === "0" ? "off" : "auto";
  } catch {
    return "auto";
  }
}

export function setGpuChoice(c: GpuChoice): void {
  try {
    if (c === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, c === "on" ? "1" : "0");
  } catch { /* not remembered: the game keeps the current mode */ }
}

let support: boolean | null = null;

/** A hardware WebGL context is available (a software one would be slower than Canvas, so it does not count). */
export function webglSupported(): boolean {
  if (support !== null) return support;
  try {
    const c = document.createElement("canvas");
    const opts = { failIfMajorPerformanceCaveat: true } as WebGLContextAttributes;
    const gl = (c.getContext("webgl2", opts) ?? c.getContext("webgl", opts)) as WebGLRenderingContext | null;
    support = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    support = false;
  }
  return support;
}

/** The renderer to start the game with. */
export function rendererType(): number {
  return gpuChoice() !== "off" && webglSupported() ? Phaser.WEBGL : Phaser.CANVAS;
}

export function usingGpu(game: Phaser.Game): boolean {
  return game.renderer.type === Phaser.WEBGL;
}

/** Turns the graphics card off (or on) and restarts the page so the game starts in the other mode. */
export function switchGpu(c: GpuChoice): void {
  setGpuChoice(c);
  window.location.reload();
}

/**
 * Automatic mode: if the game is slow with the graphics card in the first seconds of play, go back to Canvas.
 * Only counts while the page is really on screen and focused (rest mode and hidden tabs slow every page down).
 */
let watching = false;

export function watchGpu(game: Phaser.Game, onSlow: () => void): void {
  if (watching || !usingGpu(game) || gpuChoice() !== "auto") return;
  watching = true;
  let frames = 0, time = 0, last = performance.now(), checks = 0;
  const startFrame = () => game.loop.frame;
  let f0 = startFrame();
  const id = window.setInterval(() => {
    const now = performance.now();
    const seen = document.visibilityState === "visible" && document.hasFocus() && game.canvas.style.visibility !== "hidden";
    if (seen) { frames += game.loop.frame - f0; time += now - last; }
    f0 = game.loop.frame; last = now;
    if (time < 6000) return;
    const fps = (frames * 1000) / time;
    frames = 0; time = 0; checks++;
    if (fps < SLOW_FPS) { window.clearInterval(id); onSlow(); }
    else if (checks >= 3) window.clearInterval(id); // fine for a while: keep it
  }, 1000);
}

/** Below this many frames per second with the graphics card, automatic mode goes back to Canvas. */
const SLOW_FPS = 20;

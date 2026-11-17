/**
 * Effects worker: runs on another processor core and does the expensive part of the skill effects — moving the
 * particles and painting every pixel of each frame. The game (pixelfx.ts) only receives the finished pixels and
 * shows them, so a big fight no longer stalls the core that runs the game.
 *
 * Messages in:  create {id, name, x, y, flip, angle, seed, palette?} · step {id, dt} · stop {id} · drop {id}
 * Messages out: {id, done: true}  or  {id, color: Uint8ClampedArray, light: Uint32Array | null}
 */
import { clearFrame, createFrame, createFx, type PfxFrame, type PfxInstance } from "pixelfx";
import { LIB } from "./pfxLib";

interface Job {
  fx: PfxInstance;
  frame: PfxFrame;
}

type In =
  | { op: "create"; id: number; name: string; x: number; y: number; flip: boolean; angle: number; seed: number; palette?: string[] }
  | { op: "step"; id: number; dt: number }
  | { op: "stop"; id: number }
  | { op: "drop"; id: number };

const jobs = new Map<number, Job>();
const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (ev: MessageEvent<In>) => {
  const m = ev.data;
  if (m.op === "create") {
    const mod = LIB[m.name];
    if (!mod) return;
    const [w, h] = mod.meta.size;
    const fx = createFx(mod, { x: m.x, y: m.y, flip: m.flip, angle: m.angle, seed: m.seed, ...(m.palette ? { palette: m.palette } : {}) });
    jobs.set(m.id, { fx, frame: createFrame(w, h) });
    return;
  }
  const job = jobs.get(m.id);
  if (m.op === "drop") { jobs.delete(m.id); return; }
  if (!job) {
    if (m.op === "step") post({ id: m.id, done: true });
    return;
  }
  if (m.op === "stop") { job.fx.stop(); return; }
  // step: advance the effect, paint the frame, send the pixels (moved, not copied)
  if (job.fx.done()) {
    jobs.delete(m.id);
    post({ id: m.id, done: true });
    return;
  }
  job.fx.update(m.dt);
  clearFrame(job.frame);
  job.fx.draw(job.frame);
  const color = new Uint8ClampedArray(job.frame.color.buffer.slice(0));
  const L = job.frame.light;
  let light: Uint32Array | null = null;
  for (let i = 0; i < L.length; i++) {
    const v = L[i] & 0xffffff;
    if (v) {
      if (!light) light = new Uint32Array(L.length);
      light[i] = v | 0xff000000;
    }
  }
  post({ id: m.id, color, light }, light ? [color.buffer, light.buffer] : [color.buffer]);
};

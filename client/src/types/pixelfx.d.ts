declare module "pixelfx" {
  export interface PfxFrame {
    w: number;
    h: number;
    ox: number;
    oy: number;
    color: Uint32Array;
    light: Uint32Array;
  }
  export interface PfxInstance {
    meta: PfxMeta;
    readonly t: number;
    update(dt: number): void;
    draw(frame: PfxFrame, layer?: "back" | "front"): void;
    stop(): void;
    done(): boolean;
  }
  export interface PfxMeta {
    name: string;
    size: [number, number];
    origin: [number, number];
    duration: number;
    loop: boolean;
  }
  export interface PfxModule {
    meta: PfxMeta;
  }
  export function createFrame(w: number, h: number, ox?: number, oy?: number): PfxFrame;
  export function clearFrame(f: PfxFrame): PfxFrame;
  export function createFx(mod: PfxModule, o?: Record<string, unknown>): PfxInstance;
  export function composite(f: PfxFrame, out: Uint8ClampedArray, bg?: number | null, lightK?: number): Uint8ClampedArray;
  export const PAL: Record<string, string[]>;
}

declare module "pixelfx/fx/*" {
  import type { PfxMeta } from "pixelfx";
  export const meta: PfxMeta;
}

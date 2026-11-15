import Phaser from "phaser";
import { isResting } from "../ui/restMode";
import { PAL, clearFrame, composite, createFrame, createFx, type PfxFrame, type PfxInstance, type PfxModule } from "pixelfx";
import * as swordSlash from "pixelfx/fx/melee/sword-slash";
import * as spinSlash from "pixelfx/fx/melee/spin-slash";
import * as heavyCleave from "pixelfx/fx/melee/heavy-cleave";
import * as clawSwipe from "pixelfx/fx/melee/claw-swipe";
import * as critHit from "pixelfx/fx/impacts/crit-hit";
import * as hitSpark from "pixelfx/fx/impacts/hit-spark";
import * as groundSlam from "pixelfx/fx/impacts/ground-slam";
import * as stunned from "pixelfx/fx/status/stunned";
import * as frozen from "pixelfx/fx/status/frozen";
import * as slowed from "pixelfx/fx/status/slowed";
import * as bleeding from "pixelfx/fx/status/bleeding";
import * as poisoned from "pixelfx/fx/status/poisoned";
import * as burning from "pixelfx/fx/status/burning";
import * as rage from "pixelfx/fx/status/rage";
import * as fireball from "pixelfx/fx/fire/fireball";
import * as meteor from "pixelfx/fx/fire/meteor";
import * as fireRing from "pixelfx/fx/fire/fire-ring";
import * as campfire from "pixelfx/fx/fire/campfire";
import * as brazier from "pixelfx/fx/fire/brazier";
import * as candle from "pixelfx/fx/fire/candle";
import * as iceLance from "pixelfx/fx/ice/ice-lance";
import * as frostNova from "pixelfx/fx/ice/frost-nova";
import * as zapHit from "pixelfx/fx/lightning/zap-hit";
import * as blinkOut from "pixelfx/fx/arcane/blink-out";
import * as blinkIn from "pixelfx/fx/arcane/blink-in";
import * as starFall from "pixelfx/fx/arcane/star-fall";
import * as portal from "pixelfx/fx/arcane/portal";
import * as blackHole from "pixelfx/fx/shadow/black-hole";
import * as shadowTendrils from "pixelfx/fx/shadow/shadow-tendrils";
import * as darkExplosion from "pixelfx/fx/shadow/dark-explosion";
import * as poisonCloud from "pixelfx/fx/nature/poison-cloud";
import * as rootSnare from "pixelfx/fx/nature/root-snare";
import * as divineShield from "pixelfx/fx/holy/divine-shield";
import * as blessing from "pixelfx/fx/holy/blessing";
import * as holyPillar from "pixelfx/fx/holy/holy-pillar";
import * as heal from "pixelfx/fx/holy/heal";
import * as arrow from "pixelfx/fx/projectiles/arrow";
import * as energyDisc from "pixelfx/fx/projectiles/energy-disc";
import * as magicMissile from "pixelfx/fx/projectiles/magic-missile";
import * as smallExplosion from "pixelfx/fx/explosions/small-explosion";
import * as soulRise from "pixelfx/fx/spawn/soul-rise";
import * as summonRise from "pixelfx/fx/spawn/summon-rise";
import * as respawnBeam from "pixelfx/fx/spawn/respawn-beam";

// pixelfx (MIT) by Patch — https://github.com/patch-gg/pixelfx
const LIB: Record<string, PfxModule> = {
  "melee/sword-slash": swordSlash, "melee/spin-slash": spinSlash, "melee/heavy-cleave": heavyCleave,
  "melee/claw-swipe": clawSwipe, "impacts/crit-hit": critHit, "impacts/hit-spark": hitSpark,
  "impacts/ground-slam": groundSlam, "status/stunned": stunned, "status/frozen": frozen, "status/slowed": slowed,
  "status/bleeding": bleeding, "status/poisoned": poisoned, "status/burning": burning, "status/rage": rage,
  "fire/fireball": fireball, "fire/meteor": meteor, "fire/fire-ring": fireRing, "fire/campfire": campfire,
  "fire/brazier": brazier, "fire/candle": candle, "ice/ice-lance": iceLance, "ice/frost-nova": frostNova,
  "lightning/zap-hit": zapHit, "arcane/blink-out": blinkOut, "arcane/blink-in": blinkIn, "arcane/star-fall": starFall,
  "arcane/portal": portal, "shadow/black-hole": blackHole, "shadow/shadow-tendrils": shadowTendrils,
  "shadow/dark-explosion": darkExplosion, "nature/poison-cloud": poisonCloud, "nature/root-snare": rootSnare,
  "holy/divine-shield": divineShield, "holy/blessing": blessing, "holy/holy-pillar": holyPillar, "holy/heal": heal,
  "projectiles/arrow": arrow, "projectiles/energy-disc": energyDisc, "projectiles/magic-missile": magicMissile,
  "explosions/small-explosion": smallExplosion, "spawn/soul-rise": soulRise, "spawn/summon-rise": summonRise,
  "spawn/respawn-beam": respawnBeam,
};

// Every other effect of the library (244 in all), so skills can use any of them by "category/name".
const ALL_FX = import.meta.glob("/node_modules/pixelfx/src/fx/*/*.js", { eager: true }) as Record<string, PfxModule>;
for (const [path, mod] of Object.entries(ALL_FX)) {
  const m = path.match(/\/fx\/([^/]+)\/([^/]+)\.js$/);
  const impl = mod as { create?: unknown; draw?: unknown; meta?: unknown };
  if (!m || m[2].startsWith("_") || !impl.meta || !(impl.create || impl.draw)) continue;
  const key = `${m[1]}/${m[2]}`;
  if (!LIB[key]) LIB[key] = mod;
}

export const hasFx = (name: string): boolean => name in LIB;
export const palette = (name?: string): string[] | undefined => (name ? PAL[name] : undefined);

export interface PlayOpts {
  scale?: number;
  depth?: number;
  flip?: boolean;
  angle?: number;
  palette?: string[];
  follow?: { x: number; y: number; depth?: number; active?: boolean };
  dx?: number;
  dy?: number;
  /** Seconds before the effect is told to stop (loops then fade out). */
  life?: number;
  /** Part of the map (portal glows, fires): still made while the game rests, everything else is skipped. */
  keep?: boolean;
  /** Play a looping effect only once (one cycle, then fade) instead of forever: skill casts and hits. */
  once?: boolean;
  speed?: number;
  /** Radius in world px of the light this effect casts into the night, 0 for none. */
  glow?: number;
  fps?: number;
}

export interface PfxHandle {
  readonly x: number;
  readonly y: number;
  readonly glow: number;
  readonly alive: boolean;
  setPosition(x: number, y: number): void;
  setRotation(r: number): void;
  stop(): void;
}

interface Surface {
  key: string;
  size: string;
  frame: PfxFrame;
  ctex: Phaser.Textures.CanvasTexture;
  ltex: Phaser.Textures.CanvasTexture;
  cdata: ImageData;
  ldata: ImageData;
  lview: Uint32Array;
}

interface Live extends PfxHandle {
  name: string;
  opts: PlayOpts;
  age: number;
  dead: boolean;
  objects: Phaser.GameObjects.Components.Transform[];
  // live-rendered effects
  fx?: PfxInstance;
  surf?: Surface;
  color?: Phaser.GameObjects.Image;
  light?: Phaser.GameObjects.Image;
  pending: number;
  step: number;
  // baked loops
  sprite?: Phaser.GameObjects.Sprite;
  fading?: boolean;
}

let uid = 0;
const BAKE_FPS = 12;
/** At most this many animation steps of an effect are simulated in one frame. */
const MAX_CATCHUP = 2;

export class PixelFx {
  private live: Live[] = [];
  private pool = new Map<string, Surface[]>();

  constructor(private scene: Phaser.Scene) {}

  get active(): readonly PfxHandle[] {
    return this.live;
  }

  count(name: string): number {
    let n = 0;
    for (const l of this.live) if (l.name === name && !l.dead) n++;
    return n;
  }

  /** Allocate render surfaces up front: creating a CanvasTexture reads its pixels back, which stalls the GPU. */
  warm(names: string[], copies = 1): void {
    const made: Surface[] = [];
    for (const n of names) {
      const mod = LIB[n];
      if (mod && !mod.meta.loop) for (let i = 0; i < copies; i++) made.push(this.acquire(...mod.meta.size));
    }
    for (const s of made) this.release(s);
  }

  /**
   * Record a looping effect once into a sprite sheet + animation, so playing it later costs nothing per frame.
   * Loops (fires, portals, auras, status marks) are the effects that stay on screen the longest.
   */
  bake(name: string, pal?: string[]): string | null {
    const mod = LIB[name];
    if (!mod || !mod.meta.loop) return null;
    const key = `bake_${name}_${pal ? pal.join("") : ""}`;
    if (this.scene.anims.exists(key)) return key;
    const [w, h] = mod.meta.size;
    const [ox, oy] = mod.meta.origin;
    const D = mod.meta.duration;
    const n = Math.max(4, Math.round(D * BAKE_FPS));
    const cols = Math.max(1, Math.min(n, Math.floor(4096 / w)));
    const rows = Math.ceil(n / cols);
    const fx = createFx(mod, { x: ox, y: oy, seed: 7, ...(pal ? { palette: pal } : {}) });
    fx.update(D);
    const frame = createFrame(w, h);
    const tex = this.scene.textures.createCanvas(key, cols * w, rows * h)!;
    const img = tex.context.createImageData(w, h);
    for (let i = 0; i < n; i++) {
      fx.update(D / n);
      clearFrame(frame);
      fx.draw(frame);
      composite(frame, img.data, null);
      const fx0 = (i % cols) * w, fy0 = Math.floor(i / cols) * h;
      tex.context.putImageData(img, fx0, fy0);
      tex.add(i, 0, fx0, fy0, w, h);
    }
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    tex.refresh();
    this.scene.anims.create({
      key, frames: Array.from({ length: n }, (_, i) => ({ key, frame: i })), frameRate: n / D, repeat: -1,
    });
    return key;
  }

  play(name: string, x: number, y: number, opts: PlayOpts = {}): PfxHandle {
    const mod = LIB[name];
    if (!mod) return this.dummy(x, y);
    // resting (tab hidden): nobody sees them, and piled up they froze the game on return; only map effects start
    if (isResting() && !opts.keep) return this.dummy(x, y);
    if (opts.once && mod.meta.loop && opts.life === undefined) opts = { ...opts, life: Math.max(0.8, Math.min(2, mod.meta.duration ?? 1)) };
    return mod.meta.loop ? this.playBaked(name, mod, x, y, opts) : this.playLive(name, mod, x, y, opts);
  }

  update(dt: number): void {
    const v = this.scene.cameras.main.worldView;
    for (const l of this.live) {
      if (l.dead) continue;
      l.age += dt;
      if (l.opts.follow) {
        const f = l.opts.follow;
        if (f.active === false) { this.end(l); continue; }
        l.setPosition(f.x + (l.opts.dx ?? 0), f.y + (l.opts.dy ?? 0));
        if (f.depth !== undefined) for (const o of l.objects) (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(f.depth + 1);
      }
      if (l.opts.life !== undefined && l.age > l.opts.life) this.end(l);
      if (l.sprite || l.dead) continue;
      if (l.fx!.done()) { this.destroy(l); continue; }
      // never simulate more than a few steps per frame: after a slow frame, catching up on the whole gap made the
      // next frame slower still, until the game froze (long boss fights, many effects at once)
      l.pending = Math.min(l.pending + dt * (l.opts.speed ?? 1), l.step * MAX_CATCHUP);
      if (l.pending < l.step) continue;
      l.fx!.update(l.pending);
      l.pending = 0;
      if (this.onScreen(l, v)) this.draw(l);
    }
    if (this.live.some((l) => l.dead)) this.live = this.live.filter((l) => !l.dead);
  }

  clear(): void {
    for (const l of this.live) this.destroy(l);
    this.live = [];
  }

  // ── internals ───────────────────────────────────────────────────────

  private playBaked(name: string, mod: PfxModule, x: number, y: number, opts: PlayOpts): PfxHandle {
    const key = this.bake(name, opts.palette)!;
    const [w, h] = mod.meta.size;
    const [ox, oy] = mod.meta.origin;
    const sprite = this.scene.add.sprite(x, y, key, 0).setOrigin(ox / w, oy / h).setScale(opts.scale ?? 1)
      .setFlipX(!!opts.flip).setDepth(opts.depth ?? y + 2);
    sprite.play({ key, startFrame: Math.floor(Math.random() * 4) });
    const self = this.handle(name, opts, [sprite]);
    self.sprite = sprite;
    sprite.setAlpha(0);
    this.scene.tweens.add({ targets: sprite, alpha: 1, duration: 200 });
    this.live.push(self);
    return self;
  }

  private playLive(name: string, mod: PfxModule, x: number, y: number, opts: PlayOpts): PfxHandle {
    const [w, h] = mod.meta.size;
    const [ox, oy] = mod.meta.origin;
    const surf = this.acquire(w, h);
    const fx = createFx(mod, {
      x: ox, y: oy, flip: !!opts.flip, angle: opts.angle ?? 0, seed: (Math.random() * 1e6) | 0,
      ...(opts.palette ? { palette: opts.palette } : {}),
    });
    const scale = opts.scale ?? 1;
    const depth = opts.depth ?? y + 2;
    const color = this.scene.add.image(x, y, `${surf.key}_c`).setOrigin(ox / w, oy / h).setScale(scale).setDepth(depth);
    const light = this.scene.add.image(x, y, `${surf.key}_l`).setOrigin(ox / w, oy / h).setScale(scale).setDepth(depth + 0.5)
      .setBlendMode(Phaser.BlendModes.ADD);
    const self = this.handle(name, opts, [color, light]);
    const fps = opts.fps ?? Math.min(24, (mod.meta as { fps?: number }).fps ?? 30);
    Object.assign(self, { fx, surf, color, light, step: 1 / fps, pending: Math.random() / fps });
    this.live.push(self);
    this.draw(self);
    return self;
  }

  private handle(name: string, opts: PlayOpts, objects: Phaser.GameObjects.Components.Transform[]): Live {
    const first = objects[0];
    const self: Live = {
      name, opts, age: 0, dead: false, objects, pending: 0, step: 1,
      get x() { return first.x; },
      get y() { return first.y; },
      get glow() { return opts.glow ?? 0; },
      get alive() { return !self.dead; },
      setPosition: (nx: number, ny: number) => {
        for (const o of objects) o.setPosition(nx, ny);
        if (opts.depth === undefined && !opts.follow) {
          for (const o of objects) (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(ny + 2);
        }
      },
      setRotation: (r: number) => { for (const o of objects) o.setRotation(r); },
      stop: () => this.end(self),
    };
    return self;
  }

  private dummy(x: number, y: number): PfxHandle {
    return { x, y, glow: 0, alive: false, setPosition() {}, setRotation() {}, stop() {} };
  }

  private end(l: Live): void {
    if (l.dead) return;
    if (l.sprite) {
      if (l.fading) return;
      l.fading = true;
      this.scene.tweens.add({ targets: l.sprite, alpha: 0, duration: 300, onComplete: () => this.destroy(l) });
    } else {
      l.fx!.stop();
    }
  }

  private acquire(w: number, h: number): Surface {
    const size = `${w}x${h}`;
    const free = this.pool.get(size);
    if (free?.length) return free.pop()!;
    const key = `pfx_${uid++}`;
    const ctex = this.scene.textures.createCanvas(`${key}_c`, w, h)!;
    const ltex = this.scene.textures.createCanvas(`${key}_l`, w, h)!;
    ctex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    ltex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    const cdata = ctex.context.createImageData(w, h);
    const ldata = ltex.context.createImageData(w, h);
    return { key, size, frame: createFrame(w, h), ctex, ltex, cdata, ldata, lview: new Uint32Array(ldata.data.buffer) };
  }

  private release(s: Surface): void {
    s.ctex.context.clearRect(0, 0, s.frame.w, s.frame.h);
    s.ltex.context.clearRect(0, 0, s.frame.w, s.frame.h);
    const list = this.pool.get(s.size) ?? [];
    list.push(s);
    this.pool.set(s.size, list);
  }

  private onScreen(l: Live, v: Phaser.Geom.Rectangle): boolean {
    const c = l.color!;
    const { w, h } = l.surf!.frame;
    const sc = Math.abs(c.scaleX);
    const x0 = c.x - w * sc * c.originX, y0 = c.y - h * sc * c.originY;
    return x0 < v.right && x0 + w * sc > v.x && y0 < v.bottom && y0 + h * sc > v.y;
  }

  private draw(l: Live): void {
    const { frame, ctex, ltex, cdata, ldata, lview } = l.surf!;
    clearFrame(frame);
    l.fx!.draw(frame);
    cdata.data.set(new Uint8ClampedArray(frame.color.buffer));
    ctex.context.putImageData(cdata, 0, 0);
    const L = frame.light;
    let any = false;
    for (let i = 0; i < L.length; i++) {
      const v = L[i] & 0xffffff;
      lview[i] = v ? v | 0xff000000 : 0;
      if (v) any = true;
    }
    l.light!.setVisible(any);
    if (any) ltex.context.putImageData(ldata, 0, 0);
  }

  private destroy(l: Live): void {
    if (l.dead) return;
    l.dead = true;
    for (const o of l.objects) (o as unknown as Phaser.GameObjects.GameObject).destroy();
    if (l.surf) this.release(l.surf);
  }
}

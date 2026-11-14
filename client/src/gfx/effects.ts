import Phaser from "phaser";

export const FX_DEPTH = 900_000;
export const DECAL_DEPTH = -999_000;

type Preset = "sparks" | "embers" | "blood" | "smoke" | "shards" | "wisps" | "dust";

const PRESETS: Record<Preset, (tex: string) => Phaser.Types.GameObjects.Particles.ParticleEmitterConfig> = {
  sparks: () => ({ speed: { min: 60, max: 240 }, lifespan: { min: 250, max: 550 }, scale: { start: 0.9, end: 0 }, gravityY: 260, blendMode: "ADD" }),
  embers: () => ({ speed: { min: 8, max: 40 }, lifespan: { min: 700, max: 1500 }, scale: { start: 0.7, end: 0 }, gravityY: -70, blendMode: "ADD" }),
  blood: () => ({ speed: { min: 40, max: 150 }, lifespan: { min: 300, max: 600 }, scale: { start: 0.8, end: 0.2 }, gravityY: 420 }),
  smoke: () => ({ speed: { min: 8, max: 40 }, lifespan: { min: 800, max: 1400 }, scale: { start: 0.5, end: 1.7 }, alpha: { start: 0.75, end: 0 } }),
  shards: () => ({ speed: { min: 120, max: 260 }, lifespan: { min: 350, max: 650 }, scale: { start: 1, end: 0.3 }, rotate: { min: 0, max: 360 }, alpha: { start: 1, end: 0 } }),
  wisps: () => ({ speed: { min: 5, max: 25 }, lifespan: { min: 1000, max: 1800 }, scale: { start: 0.9, end: 0 }, gravityY: -45, blendMode: "ADD" }),
  dust: () => ({ speed: { min: 15, max: 55 }, lifespan: { min: 300, max: 600 }, scale: { start: 0.35, end: 0.9 }, alpha: { start: 0.5, end: 0 } }),
};

const TEXTURE: Record<Preset, (color: string) => string> = {
  sparks: (c) => `spark_${c}`,
  embers: (c) => `spark_${c}`,
  blood: () => "spark_blood",
  smoke: () => "smoke",
  shards: () => "ice_shard",
  wisps: (c) => `spark_${c}`,
  dust: () => "smoke",
};

export class Fx {
  private emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();

  constructor(private scene: Phaser.Scene) {}

  burst(preset: Preset, color: string, x: number, y: number, count: number): void {
    const tex = TEXTURE[preset](color);
    const key = `${preset}:${tex}`;
    let em = this.emitters.get(key);
    if (!em) {
      em = this.scene.add.particles(0, 0, tex, { ...PRESETS[preset](tex), emitting: false });
      em.setDepth(FX_DEPTH);
      this.emitters.set(key, em);
    }
    em.explode(count, x, y);
  }

  /** Flat ground ring that expands and fades (drawn squashed to sit on the iso plane). */
  ring(x: number, y: number, color: string, from: number, to: number, duration: number, onGround = true): void {
    const img = this.scene.add.image(x, y, `ring_${color}`).setBlendMode(Phaser.BlendModes.ADD)
      .setScale(from, from * 0.5).setDepth(onGround ? DECAL_DEPTH + 10 : FX_DEPTH);
    this.scene.tweens.add({
      targets: img, scaleX: to, scaleY: to * 0.5, alpha: 0, duration, ease: "Cubic.easeOut",
      onComplete: () => img.destroy(),
    });
  }

  /** Called for every flash so the scene can light up the night around it. */
  onFlash?: (x: number, y: number, radius: number, duration: number) => void;

  flash(x: number, y: number, color: string, scale: number, duration: number, alpha = 0.9): void {
    this.onFlash?.(x, y, scale * 55, duration);
    const img = this.scene.add.image(x, y, `glow_${color}`).setBlendMode(Phaser.BlendModes.ADD)
      .setScale(scale * 0.4).setAlpha(alpha).setDepth(FX_DEPTH);
    this.scene.tweens.add({ targets: img, scale, alpha: 0, duration, ease: "Quad.easeOut", onComplete: () => img.destroy() });
  }

  decal(x: number, y: number, key: string, scale: number, life: number): void {
    const img = this.scene.add.image(x, y, key).setScale(scale).setDepth(DECAL_DEPTH);
    this.scene.tweens.add({ targets: img, alpha: 0, delay: life * 0.6, duration: life * 0.4, onComplete: () => img.destroy() });
  }

  shake(intensity = 0.004, duration = 120): void {
    this.scene.cameras.main.shake(duration, intensity);
  }
}

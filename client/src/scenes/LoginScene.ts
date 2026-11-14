import Phaser from "phaser";
import { ensureTextures, UNIT_ORIGIN, UNIT_RES } from "../gfx/textures";
import { FONT } from "../gfx/draw";
import { API, CLASS_INFO, META, classSkills, loadMeta } from "../data/meta";
import { SHEETS, animKey, hasSheet, loadSheets, portraitFromSheet, requestSheet } from "../gfx/sprites3d";
import { ensureSkillIcons } from "../gfx/themeProps";

/**
 * Hero selection and creation: the chosen class stands large on a glowing pedestal (its own 3D figure, which can
 * be turned around), with the class list on the left, its attributes, difficulty and signature skills on the right,
 * and the name field with the create button below. A saved hero shows a "continue" card.
 * Everything is laid out on a 1280×720 board scaled to the window.
 */

const CLASSES = ["blade_master", "grand_sorcerer", "night_ranger"];
const SAVE_KEY = "df_hero";
const BOARD_W = 1280;
const BOARD_H = 720;
const HERO_H = 300;  // the hero's height on the board, in px

/** Attribute bars (0-10), difficulty (1-3), range and glow colour of each class. */
const CLASS_SHEET: Record<string, { bars: [string, number][]; difficulty: number; range: string; glow: string; hex: number }> = {
  blade_master: { bars: [["Força", 9], ["Agilidade", 4], ["Inteligência", 2], ["Vitalidade", 9]], difficulty: 1, range: "Corpo a corpo",
    glow: "red", hex: 0xe0485a },
  grand_sorcerer: { bars: [["Força", 2], ["Agilidade", 4], ["Inteligência", 10], ["Vitalidade", 4]], difficulty: 3, range: "Longa distância",
    glow: "cyan", hex: 0x6f8cff },
  night_ranger: { bars: [["Força", 4], ["Agilidade", 10], ["Inteligência", 3], ["Vitalidade", 5]], difficulty: 2, range: "Longa distância",
    glow: "green", hex: 0x7ddc6a },
};
const DIFFICULTY = ["", "Fácil", "Médio", "Difícil"];

interface Saved { id: string; name: string; cls: string }

const txt = (size: number, color: string, extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: FONT, fontSize: `${size}px`, color, stroke: "#000000", strokeThickness: Math.max(2, Math.round(size / 6)), ...extra,
});

export class LoginScene extends Phaser.Scene {
  private bg!: Phaser.GameObjects.Image;
  private shade!: Phaser.GameObjects.Graphics;
  private board!: Phaser.GameObjects.Container;
  private statusText!: Phaser.GameObjects.Text;
  private nameInput?: HTMLInputElement;
  private selectedClass = "blade_master";
  private dir = 2;
  private busy = false;
  private saved: Saved | null = null;
  private savedInfo: { name: string; level: number; map: string } | null = null;
  private ready = false;
  // parts redrawn when the class changes
  private stage?: Phaser.GameObjects.Container;
  private infoPanel?: Phaser.GameObjects.Container;
  private classList?: Phaser.GameObjects.Container;
  private hero?: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  private createBtn?: Phaser.GameObjects.Container;
  private continueCard?: Phaser.GameObjects.Container;

  constructor() {
    super({ key: "LoginScene" });
  }

  create(): void {
    ensureTextures(this);
    this.cameras.main.setBackgroundColor("#050407");
    this.bg = this.add.image(0, 0, "login_bg");
    this.shade = this.add.graphics();
    // embers rising and slow drifting fog
    this.add.particles(0, 0, "spark_orange", {
      x: { onEmit: () => Phaser.Math.Between(0, this.scale.width) }, y: { onEmit: () => this.scale.height + 10 },
      lifespan: { min: 5000, max: 9000 }, speedY: { min: -50, max: -15 }, speedX: { min: -14, max: 14 },
      scale: { start: 0.5, end: 0 }, alpha: { start: 0.9, end: 0 }, frequency: 70, blendMode: "ADD",
    });
    if (this.textures.exists("smoke")) {
      this.add.particles(0, 0, "smoke", {
        x: { onEmit: () => Phaser.Math.Between(-100, this.scale.width + 100) }, y: { onEmit: () => this.scale.height * Phaser.Math.FloatBetween(0.55, 1) },
        lifespan: 12000, speedX: { min: -12, max: 12 }, scale: { start: 3, end: 5 }, alpha: { start: 0.14, end: 0 }, frequency: 900,
      });
    }
    this.board = this.add.container(0, 0);
    this.statusText = this.add.text(0, 0, "Conectando ao servidor…", txt(13, "#c9b98a", { align: "center" })).setOrigin(0.5);

    this.nameInput = document.createElement("input");
    Object.assign(this.nameInput, { maxLength: 16, placeholder: "Nome do seu herói", spellcheck: false });
    Object.assign(this.nameInput.style, {
      position: "fixed", padding: "0 14px", boxSizing: "border-box", font: `18px ${FONT}`, textAlign: "center", letterSpacing: "1px",
      color: "#f3e3b8", background: "rgba(12,9,16,0.92)", border: "2px solid #8a6a30", borderRadius: "8px", outline: "none",
      zIndex: "10", boxShadow: "0 0 18px rgba(214,170,90,0.25)",
    });
    document.body.appendChild(this.nameInput);
    this.nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") void this.createHero(); });
    this.events.once("shutdown", () => this.nameInput?.remove());

    this.buildStatic();
    this.layout();
    this.scale.on("resize", this.layout, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.layout, this));
    void this.boot();
  }

  update(time: number): void {
    this.placeNameInput();
    if (this.hero && !(this.hero instanceof Phaser.GameObjects.Sprite)) this.hero.y = -6 + Math.sin(time * 0.002) * 2;
  }

  // ── data ─────────────────────────────────────────────────────────────

  private async boot(): Promise<void> {
    try {
      await loadMeta();
      await loadSheets();
    } catch {
      this.statusText.setText("Não foi possível falar com o servidor.\nVerifique se ele está ligado e recarregue a página.").setColor("#ff6666");
      return;
    }
    ensureSkillIcons(this, [...META.skills, ...META.passives]);
    this.ready = true;
    this.statusText.setText("");
    this.drawClass();
    // the three heroes' 3D figures: the chosen one first
    for (const id of [this.selectedClass, ...CLASSES.filter((c) => c !== this.selectedClass)]) {
      void requestSheet(this, `unit_${id}`).then((ok) => {
        if (!ok) return;
        if (id === this.selectedClass) this.drawStage(true);
        this.drawClassList();
      });
    }
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      this.saved = raw ? JSON.parse(raw) : null;
    } catch {
      this.saved = null;
    }
    if (!this.saved) return;
    try {
      const res = await fetch(`${API}/characters/${this.saved.id}`);
      if (!res.ok) throw new Error();
      const c = await res.json();
      this.savedInfo = { name: c.name, level: c.level, map: c.map };
      this.drawContinue();
    } catch {
      this.saved = null;
    }
  }

  // ── drawing ──────────────────────────────────────────────────────────

  /** Title and the frames that never change. */
  private buildStatic(): void {
    const title = this.add.text(0, -318, "DARK FANTASY", txt(56, "#c8202e", { fontStyle: "bold", strokeThickness: 7 })).setOrigin(0.5);
    title.setShadow(0, 0, "#ff2a3a", 22, true, true).setPadding(40, 26, 40, 26);
    const sub = this.add.text(0, -272, "As Crônicas de Ravencrest", txt(18, "#c8b48a")).setOrigin(0.5);
    const line = this.add.graphics();
    line.lineStyle(1, 0xd6aa5a, 0.5).lineBetween(-180, -254, 180, -254);
    line.fillStyle(0xd6aa5a, 0.9).fillCircle(0, -254, 3);
    const pick = this.add.text(-470, -222, "ESCOLHA SUA CLASSE", txt(13, "#d6b878", { fontStyle: "bold" })).setOrigin(0.5);
    this.board.add([title, sub, line, pick]);
    this.tweens.add({ targets: title, alpha: { from: 0.85, to: 1 }, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    // the create button
    const bg = this.add.image(0, 0, "hud_button").setScale(1.5, 1.4);
    const glow = this.add.image(0, 0, "glow_gold").setBlendMode(Phaser.BlendModes.ADD).setScale(4.4, 1.2).setAlpha(0.25);
    const label = this.add.text(0, 0, "CRIAR HERÓI", txt(22, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5);
    this.createBtn = this.add.container(0, 318, [glow, bg, label]).setSize(300, 62).setInteractive({ useHandCursor: true });
    this.createBtn.on("pointerover", () => { bg.setAlpha(0.85); glow.setAlpha(0.45); });
    this.createBtn.on("pointerout", () => { bg.setAlpha(1); glow.setAlpha(0.25); });
    this.createBtn.on("pointerdown", () => void this.createHero());
    this.tweens.add({ targets: glow, alpha: { from: 0.18, to: 0.42 }, duration: 1300, yoyo: true, repeat: -1 });
    this.board.add(this.createBtn);
  }

  private drawClass(): void {
    this.drawClassList();
    this.drawStage(false);
    this.drawInfo();
  }

  /** Left column: the three classes, the chosen one lit. */
  private drawClassList(): void {
    this.classList?.destroy();
    const items: Phaser.GameObjects.GameObject[] = [];
    CLASSES.forEach((id, i) => {
      const info = CLASS_INFO[id];
      const cs = CLASS_SHEET[id];
      const on = id === this.selectedClass;
      const y = -170 + i * 108;
      const g = this.add.graphics();
      g.fillStyle(on ? 0x1e1610 : 0x0e0b12, on ? 0.95 : 0.85).fillRoundedRect(-150, y - 44, 300, 88, 10);
      g.lineStyle(on ? 2 : 1, on ? cs.hex : 0x4a3c24, on ? 1 : 0.9).strokeRoundedRect(-150, y - 44, 300, 88, 10);
      if (on) g.fillStyle(cs.hex, 0.9).fillRect(-150, y - 30, 4, 60);
      const portraitKey = portraitFromSheet(this, `unit_${id}`) ?? `portrait_${id}`;
      const ring = this.add.image(-104, y, `glow_${cs.glow}`).setBlendMode(Phaser.BlendModes.ADD).setScale(1.3).setAlpha(on ? 0.7 : 0.25);
      const portrait = this.textures.exists(portraitKey) ? this.add.image(-104, y, portraitKey).setScale(0.86) : this.add.rectangle(-104, y, 60, 60, 0x222222);
      const name = this.add.text(-60, y - 22, info.name, txt(17, on ? info.color : "#c8bca0", { fontStyle: "bold" }));
      const role = this.add.text(-60, y + 2, info.role, txt(11, on ? "#e8dcc0" : "#8a7c62"));
      const diff = this.add.text(-60, y + 20, `${"◆".repeat(cs.difficulty)}${"◇".repeat(3 - cs.difficulty)}  ${DIFFICULTY[cs.difficulty]}`,
        txt(10, on ? "#ffd77a" : "#6a6050"));
      const zone = this.add.zone(-150, y - 44, 300, 88).setOrigin(0).setInteractive({ useHandCursor: true });
      zone.on("pointerdown", () => this.select(id));
      zone.on("pointerover", () => { if (!on) g.setAlpha(0.8); });
      zone.on("pointerout", () => g.setAlpha(1));
      items.push(g, ring, portrait, name, role, diff, zone);
    });
    this.classList = this.add.container(-470, 0, items);
    this.board.add(this.classList);
  }

  /** Centre: the hero on a glowing pedestal, with arrows to turn him around. */
  private drawStage(intro: boolean): void {
    this.stage?.destroy();
    const cs = CLASS_SHEET[this.selectedClass];
    const items: Phaser.GameObjects.GameObject[] = [];
    const foot = 150;
    const beam = this.add.image(0, foot - 210, "light_ray").setBlendMode(Phaser.BlendModes.ADD).setScale(1.6, 1.25).setAlpha(0.22);
    const aura = this.add.image(0, foot - 110, `glow_${cs.glow}`).setBlendMode(Phaser.BlendModes.ADD).setScale(5.2, 6).setAlpha(0.18);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.55).fillEllipse(0, foot + 6, 260, 64);
    g.fillStyle(0x1a1420, 1).fillEllipse(0, foot, 240, 56);
    g.lineStyle(3, cs.hex, 0.85).strokeEllipse(0, foot, 240, 56);
    g.lineStyle(1, 0xd6aa5a, 0.6).strokeEllipse(0, foot, 200, 44);
    g.lineStyle(1, cs.hex, 0.35).strokeEllipse(0, foot, 280, 70);
    const ringGlow = this.add.image(0, foot, `ring_${cs.glow}`).setBlendMode(Phaser.BlendModes.ADD).setScale(1.7, 0.42).setAlpha(0.6);
    const sparks = this.add.particles(0, foot, `spark_${cs.glow}`, {
      x: { min: -110, max: 110 }, y: { min: -10, max: 10 }, lifespan: 1600, speedY: { min: -60, max: -25 },
      scale: { start: 0.5, end: 0 }, alpha: { start: 0.9, end: 0 }, frequency: 90, blendMode: "ADD",
    });
    items.push(beam, aura, g, ringGlow, sparks);
    this.tweens.add({ targets: ringGlow, alpha: { from: 0.35, to: 0.8 }, duration: 1400, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: aura, alpha: { from: 0.12, to: 0.26 }, duration: 2000, yoyo: true, repeat: -1 });
    // the hero: the 3D figure when loaded, the drawing meanwhile
    const key = `unit_${this.selectedClass}`;
    if (hasSheet(key)) {
      const info = SHEETS[key];
      const spr = this.add.sprite(0, foot, `${key}:idle`, this.dir * info.anims.idle.frames).setOrigin(0.5, info.originY)
        .setScale((HERO_H * info.scale) / (info.height * 44));
      const idle = animKey(key, "idle", this.dir);
      // a short show when the class is picked: attack (or cast), then back to idle
      const show = info.anims.attack ? "attack" : info.anims.cast ? "cast" : "";
      if (intro && show && this.anims.exists(animKey(key, show, this.dir))) {
        spr.play(animKey(key, show, this.dir));
        spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => { if (this.anims.exists(idle)) spr.play(idle); });
      } else if (this.anims.exists(idle)) {
        spr.play(idle);
      }
      this.hero = spr;
    } else {
      const [ox, oy] = UNIT_ORIGIN[key] ?? [0.5, 0.95];
      this.hero = this.add.image(0, foot, key).setOrigin(ox, oy).setScale(2.4 / UNIT_RES);
    }
    items.push(this.hero);
    // turn the hero around
    const arrow = (label: string, x: number, step: number) => {
      const b = this.add.text(x, foot + 2, label, txt(26, "#d6b878", { fontStyle: "bold" })).setOrigin(0.5).setInteractive({ useHandCursor: true });
      b.on("pointerover", () => b.setColor("#ffe9a8")).on("pointerout", () => b.setColor("#d6b878"));
      b.on("pointerdown", () => { this.dir = (this.dir + step + 8) % 8; this.drawStage(false); });
      items.push(b);
    };
    arrow("◀", -150, -1);
    arrow("▶", 150, 1);
    items.push(this.add.text(0, foot + 44, "Gire o herói", txt(10, "#7a6c52")).setOrigin(0.5));
    this.stage = this.add.container(0, 0, items);
    this.board.addAt(this.stage, 1);
    if (intro) {
      this.hero.setAlpha(0);
      this.tweens.add({ targets: this.hero, alpha: 1, duration: 300 });
    }
  }

  /** Right column: name, role, story, attribute bars, range and the signature skills. */
  private drawInfo(): void {
    this.infoPanel?.destroy();
    const id = this.selectedClass;
    const info = CLASS_INFO[id];
    const cs = CLASS_SHEET[id];
    const items: Phaser.GameObjects.GameObject[] = [];
    const W = 330, H = 470, x0 = -W / 2, y0 = -H / 2 - 10;
    const g = this.add.graphics();
    g.fillStyle(0x0c0910, 0.9).fillRoundedRect(x0, y0, W, H, 12);
    g.lineStyle(2, 0x6b5226, 1).strokeRoundedRect(x0, y0, W, H, 12);
    g.lineStyle(1, 0xd6aa5a, 0.3).strokeRoundedRect(x0 + 4, y0 + 4, W - 8, H - 8, 9);
    g.fillStyle(cs.hex, 0.85).fillRect(x0 + 24, y0 + 74, 60, 2);
    items.push(g);
    items.push(this.add.text(x0 + 24, y0 + 20, info.name.toUpperCase(), txt(22, info.color, { fontStyle: "bold" })));
    items.push(this.add.text(x0 + 24, y0 + 50, `${info.role}  ·  ${cs.range}`, txt(11, "#c8bca0")));
    items.push(this.add.text(x0 + 24, y0 + 86, info.lore, txt(12, "#e8dcc0", { wordWrap: { width: W - 48 }, lineSpacing: 4, fontStyle: "italic" })));
    // attributes
    let y = y0 + 140;
    items.push(this.add.text(x0 + 24, y, "ATRIBUTOS", txt(11, "#d6b878", { fontStyle: "bold" })));
    y += 24;
    for (const [label, v] of cs.bars) {
      items.push(this.add.text(x0 + 24, y, label, txt(11, "#c8bca0")));
      const bar = this.add.graphics();
      bar.fillStyle(0x1a1410, 1).fillRoundedRect(x0 + 124, y + 3, 170, 9, 4);
      bar.fillStyle(cs.hex, 1).fillRoundedRect(x0 + 124, y + 3, 17 * v, 9, 4);
      bar.lineStyle(1, 0x4a3c24, 1).strokeRoundedRect(x0 + 124, y + 3, 170, 9, 4);
      items.push(bar);
      y += 22;
    }
    items.push(this.add.text(x0 + 24, y + 4, `Dificuldade: ${"◆".repeat(cs.difficulty)}${"◇".repeat(3 - cs.difficulty)} ${DIFFICULTY[cs.difficulty]}`,
      txt(11, "#ffd77a")));
    // signature skills (the first ones of the class), with a tip on hover
    y += 38;
    items.push(this.add.text(x0 + 24, y, "HABILIDADES", txt(11, "#d6b878", { fontStyle: "bold" })));
    y += 22;
    const skills = this.ready ? classSkills(id).slice(0, 4) : [];
    const tip = this.add.text(x0 + 24, y + 112, "Passe o mouse numa habilidade.", txt(10, "#8a7c62", { wordWrap: { width: W - 48 }, lineSpacing: 3 }));
    skills.forEach((s, i) => {
      const sx = x0 + 24 + i * 72;
      const frame = this.add.graphics();
      frame.fillStyle(0x15111c, 1).fillRoundedRect(sx, y, 56, 56, 8);
      frame.lineStyle(2, cs.hex, 0.9).strokeRoundedRect(sx, y, 56, 56, 8);
      const icon = this.textures.exists(`icon_${s.id}`) ? this.add.image(sx + 28, y + 28, `icon_${s.id}`).setScale(1.05) : this.add.rectangle(sx + 28, y + 28, 44, 44, 0x333333);
      const name = this.add.text(sx + 28, y + 62, s.name, txt(9, "#c8bca0", { align: "center", wordWrap: { width: 70 } })).setOrigin(0.5, 0);
      const zone = this.add.zone(sx, y, 56, 56).setOrigin(0).setInteractive({ useHandCursor: true });
      zone.on("pointerover", () => tip.setText(`${s.name}: ${s.desc}`).setColor("#e8dcc0"));
      zone.on("pointerout", () => tip.setText("Passe o mouse numa habilidade.").setColor("#8a7c62"));
      items.push(frame, icon, name, zone);
    });
    items.push(tip);
    this.infoPanel = this.add.container(470, 0, items);
    this.board.add(this.infoPanel);
  }

  /** A saved hero: a card to jump straight back in. */
  private drawContinue(): void {
    this.continueCard?.destroy();
    const s = this.saved, c = this.savedInfo;
    if (!s || !c) return;
    const cs = CLASS_SHEET[s.cls] ?? CLASS_SHEET.blade_master;
    const g = this.add.graphics();
    g.fillStyle(0x0e1a0c, 0.92).fillRoundedRect(-150, -36, 300, 72, 10);
    g.lineStyle(2, 0x6fbf5a, 0.9).strokeRoundedRect(-150, -36, 300, 72, 10);
    const pk = portraitFromSheet(this, `unit_${s.cls}`) ?? `portrait_${s.cls}`;
    const ring = this.add.image(-112, 0, `glow_${cs.glow}`).setBlendMode(Phaser.BlendModes.ADD).setScale(1.1).setAlpha(0.5);
    const portrait = this.textures.exists(pk) ? this.add.image(-112, 0, pk).setScale(0.72) : this.add.rectangle(-112, 0, 50, 50, 0x222222);
    const t1 = this.add.text(-70, -24, "CONTINUAR", txt(11, "#9dff8a", { fontStyle: "bold" }));
    const t2 = this.add.text(-70, -8, `${c.name} · Nv ${c.level}`, txt(16, "#f3e3b8", { fontStyle: "bold" }));
    const t3 = this.add.text(-70, 14, META.maps?.[c.map]?.name ?? c.map, txt(10, "#a8987a"));
    this.continueCard = this.add.container(470, 312, [g, ring, portrait, t1, t2, t3]).setSize(300, 72).setInteractive({ useHandCursor: true });
    this.continueCard.on("pointerover", () => g.setAlpha(0.8)).on("pointerout", () => g.setAlpha(1));
    this.continueCard.on("pointerdown", () => this.saved && this.enter(this.saved.id, this.saved.cls));
    this.board.add(this.continueCard);
  }

  private select(id: string): void {
    if (id === this.selectedClass) return;
    this.selectedClass = id;
    this.dir = 2;
    this.drawClassList();
    this.drawInfo();
    this.drawStage(true);
    if (!hasSheet(`unit_${id}`)) void requestSheet(this, `unit_${id}`).then((ok) => { if (ok && this.selectedClass === id) this.drawStage(true); });
  }

  private layout(): void {
    const w = this.scale.width, h = this.scale.height;
    this.bg.setPosition(w / 2, h / 2).setScale(Math.max(w / 1280, h / 720));
    // darker edges and bottom, so the hero and the panels stand out
    this.shade.clear();
    this.shade.fillStyle(0x000000, 0.35).fillRect(0, 0, w, h);
    const s = Math.min(w / BOARD_W, h / BOARD_H);
    this.board.setPosition(w / 2, h / 2).setScale(s);
    this.statusText.setPosition(w / 2, h / 2 + 344 * s);
    this.placeNameInput();
  }

  private inputSig = "";

  /**
   * The name field is an HTML input over the canvas: put it on the board's centre line, right above the create
   * button and as wide as it. Positions go through the canvas's real size on the page (the canvas may be scaled
   * by CSS), and the whole box (padding and border included) is centred. Called every frame: cheap, and it
   * follows the canvas if the page moves it.
   */
  private placeNameInput(): void {
    if (!this.nameInput) return;
    const w = this.scale.width, h = this.scale.height;
    const s = Math.min(w / BOARD_W, h / BOARD_H);
    const rect = this.game.canvas.getBoundingClientRect();
    const kx = rect.width / w, ky = rect.height / h;  // game px → page px
    const bw = 300 * s * kx, bh = 46 * s * ky;
    const cx = rect.left + (w / 2) * kx;
    const bottom = rect.top + (h / 2 + 276 * s) * ky;  // a small gap above the create button (its top edge is at y 287)
    const sig = [bw, bh, cx, bottom].map((v) => Math.round(v)).join("|");
    if (sig === this.inputSig) return;
    this.inputSig = sig;
    Object.assign(this.nameInput.style, {
      width: `${bw}px`, height: `${bh}px`, fontSize: `${Math.max(12, 18 * s * ky)}px`,
      left: `${cx - bw / 2}px`, top: `${bottom - bh}px`,
    });
  }

  // ── actions ──────────────────────────────────────────────────────────

  private async createHero(): Promise<void> {
    if (this.busy || !this.ready) return;
    const name = (this.nameInput?.value ?? "").trim();
    if (name.length < 3) { this.statusText.setText("Digite um nome com pelo menos 3 letras").setColor("#ff6666"); this.nameInput?.focus(); return; }
    this.busy = true;
    this.statusText.setText("Forjando seu destino…").setColor("#c9b98a");
    try {
      const username = `u_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
      const reg = await fetch(`${API}/auth/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email: `${username}@dev.local`, password: crypto.randomUUID() }),
      });
      if (!reg.ok) throw new Error("Falha no registro");
      const { user_id } = await reg.json();
      const res = await fetch(`${API}/characters`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id, name, char_class: this.selectedClass }),
      });
      if (!res.ok) throw new Error((await res.json()).detail ?? "Falha ao criar herói");
      const c = await res.json();
      localStorage.setItem(SAVE_KEY, JSON.stringify({ id: c.character_id, name: c.name, cls: this.selectedClass }));
      this.enter(c.character_id, this.selectedClass);
    } catch (err) {
      this.busy = false;
      this.statusText.setText(`${err instanceof Error ? err.message : err}`).setColor("#ff4444");
    }
  }

  enter(charId: string, cls: string): void {
    this.busy = true;
    this.nameInput?.remove();
    // the hero's own 3D sheets load during the fade, so it never appears as the flat drawing
    const hero = requestSheet(this, `unit_${cls}`);
    this.statusText.setText("Carregando herói…").setColor("#c9b98a");
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      void hero.then(() => {
        this.scene.start("GameScene", { charId, charClass: cls });
        this.scene.launch("HUDScene", { charClass: cls });
      });
    });
  }
}

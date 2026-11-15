import Phaser from "phaser";
import { authHeaders, getToken, setToken } from "../network/session";
import { ensureTextures, UNIT_ORIGIN, UNIT_RES } from "../gfx/textures";
import { FONT } from "../gfx/draw";
import { API, CLASS_INFO, META, classSkills, loadMeta } from "../data/meta";
import { SHEETS, animKey, hasSheet, loadSheets, portraitFromSheet, requestSheet } from "../gfx/sprites3d";
import { ensureSkillIcons } from "../gfx/themeProps";
import { isTouch } from "../ui/device";

/**
 * Hero selection and creation: the chosen class stands large on a glowing pedestal (its own 3D figure, which can
 * be turned around), with the class list on the left, its attributes, difficulty and signature skills on the right,
 * and the name field with the create button below. Accounts open their own hero cards first.
 * Everything is laid out on a 1280×720 board scaled to the window.
 */

const CLASSES = ["blade_master", "grand_sorcerer", "night_ranger"];
const SAVE_KEY = "df_hero";
const LAST_KEY = "df_last_hero";
const MAX_HEROES = 4;
const BOARD_W = 1280;
const BOARD_H = 720;
const HERO_H = 300;  // the hero's height on the board, in px
// the account screen is shorter than the board (title to "Criar conta"), so short screens (phones) show it bigger
const ACCOUNT_H = 650;
const ACCOUNT_SHIFT = 26;

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

interface AccountHero { character_id: string; name: string; class: string; level: number; map: string }

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
  private mode: "account" | "heroes" | "create" = "account";
  private accountPanel?: Phaser.GameObjects.Container;
  private accountInputs: HTMLInputElement[] = [];
  private accountTab: "login" | "register" = "login";
  private characters: AccountHero[] = [];
  private accountName = "";
  private ready = false;
  // parts redrawn when the class changes
  private stage?: Phaser.GameObjects.Container;
  private infoPanel?: Phaser.GameObjects.Container;
  private classList?: Phaser.GameObjects.Container;
  private hero?: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  private createBtn?: Phaser.GameObjects.Container;
  private sideHeroes?: Phaser.GameObjects.Container;
  private pick = -1;


  constructor() {
    super({ key: "LoginScene" });
  }

  create(): void {
    this.busy = false;
    this.ready = false;
    this.inputSig = "";
    this.accountPanel = undefined;
    this.mode = "account";
    this.pick = -1;
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
    this.board.setVisible(false);
    this.nameInput.style.display = "none";
    this.events.once("shutdown", () => this.clearAccountInputs());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && this.mode === "heroes" && this.characters[this.pick]) this.play(this.characters[this.pick]);
    };
    window.addEventListener("keydown", onKey);
    this.events.once("shutdown", () => window.removeEventListener("keydown", onKey));
    this.layout();
    this.scale.on("resize", this.layout, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.layout, this));
    void this.boot();
  }

  update(time: number): void {
    this.placeNameInput();
    this.placeAccountInputs();
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
        if (!ok || !this.scene.isActive()) return;
        if (id === this.selectedClass) this.drawStage(true);
        this.drawClassList();
        if (this.mode === "account") this.drawSideHeroes();
        else if (this.mode === "heroes") this.showHeroes();
      });
    }
    if (getToken()) {
      try {
        await this.loadAccount();
        void this.paymentReturn();
        return;
      } catch (err) {
        this.statusText.setText(err instanceof Error ? err.message : "Não foi possível carregar sua conta.").setColor("#ff6666");
      }
    }
    this.showAccount();
  }

  /** Back from Mercado Pago (?pagamento=…&ref=…): tell the player how the payment went (the server delivers it). */
  private async paymentReturn(): Promise<void> {
    const q = new URLSearchParams(location.search);
    const ref = q.get("ref");
    if (!q.get("pagamento") || !ref) return;
    history.replaceState(null, "", location.pathname);
    this.statusText.setText("Conferindo seu pagamento…").setColor("#c9b98a");
    try {
      const r = await this.api(`/pay/check/${encodeURIComponent(ref)}`);
      this.statusText.setText(r.message).setColor(r.status === "approved" ? "#9dff8a" : r.status === "rejected" ? "#ff8a7a" : "#ffd77a");
    } catch (err) {
      this.statusText.setText(err instanceof Error ? err.message : "Não foi possível conferir o pagamento.").setColor("#ff8a7a");
    }
  }

  private async api(path: string, body?: unknown): Promise<any> {
    const response = await fetch(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => { throw new Error("Não foi possível conectar ao servidor. Tente novamente."); });
    const data = await response.json().catch(() => { throw new Error("O servidor não respondeu como esperado. Tente novamente."); });
    if (!response.ok) {
      if (response.status === 401 && path === "/auth/me") setToken("");
      throw new Error(typeof data.detail === "string" ? data.detail : "Confira os dados e tente novamente.");
    }
    return data;
  }

  private async loadAccount(): Promise<void> {
    const data = await this.api("/auth/me");
    this.accountName = data.user.username;
    this.characters = data.characters;
    const legacy = localStorage.getItem(SAVE_KEY);
    if (legacy) {
      try {
        const old = JSON.parse(legacy);
        if (old.id) await this.api("/auth/claim", { character_id: old.id });
      } catch { /* old heroes may already belong to an account */ }
      finally { localStorage.removeItem(SAVE_KEY); }
      this.characters = await this.api("/characters");
    }
    if (this.scene.isActive()) this.showHeroes();
  }

  private clearAccountInputs(): void {
    this.accountInputs.forEach((input) => input.remove());
    this.accountInputs = [];
  }

  private panel(): Phaser.GameObjects.Container {
    this.clearAccountInputs();
    this.accountPanel?.destroy();
    this.sideHeroes = undefined;
    this.board.setVisible(false);
    if (this.nameInput) this.nameInput.style.display = "none";
    const title = this.add.text(0, -300, "DARK FANTASY", txt(56, "#c8202e", { fontStyle: "bold", strokeThickness: 7 })).setOrigin(0.5);
    title.setShadow(0, 0, "#ff2a3a", 22, true, true).setPadding(40, 26, 40, 26);
    this.tweens.add({ targets: title, alpha: { from: 0.85, to: 1 }, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    const sub = this.add.text(0, -254, "As Crônicas de Ravencrest", txt(18, "#c8b48a")).setOrigin(0.5);
    const line = this.add.graphics();
    line.lineStyle(1, 0xd6aa5a, 0.5).lineBetween(-180, -236, 180, -236);
    line.fillStyle(0xd6aa5a, 0.9).fillCircle(0, -236, 3);
    this.accountPanel = this.add.container(0, 0, [title, sub, line]);
    this.layout();
    return this.accountPanel;
  }

  /** A dark panel with a gold double border and small diamonds on the corners. */
  private frame(x: number, y: number, w: number, h: number, edge = 0xd6aa5a, alpha = 0.94): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.45).fillRoundedRect(x + 6, y + 8, w, h, 12);
    g.fillStyle(0x0c0910, alpha).fillRoundedRect(x, y, w, h, 12);
    g.fillGradientStyle(0x22182a, 0x22182a, 0x0c0910, 0x0c0910, 0.9, 0.9, 0, 0).fillRect(x + 3, y + 3, w - 6, Math.min(120, h / 3));
    g.lineStyle(2, edge, 0.9).strokeRoundedRect(x, y, w, h, 12);
    g.lineStyle(1, 0xd6aa5a, 0.25).strokeRoundedRect(x + 6, y + 6, w - 12, h - 12, 8);
    g.fillStyle(edge, 1);
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [x + w / 2, y]]) {
      g.fillTriangle(cx, cy - 7, cx + 7, cy, cx, cy + 7).fillTriangle(cx, cy - 7, cx - 7, cy, cx, cy + 7);
    }
    return g;
  }

  /** The big gold button of the game (the same as "Criar herói"), gently glowing. */
  private goldButton(x: number, y: number, label: string, w: number, h: number, size: number, action: () => void): Phaser.GameObjects.Container {
    const glow = this.add.image(0, 0, "glow_gold").setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(w * 1.4, h * 1.9).setAlpha(0.25);
    const bg = this.add.image(0, 0, "hud_button").setDisplaySize(w, h);
    const text = this.add.text(0, 0, label, txt(size, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5);
    const c = this.add.container(x, y, [glow, bg, text]).setSize(w, h).setInteractive({ useHandCursor: true });
    c.on("pointerover", () => { bg.setAlpha(0.85); text.setColor("#fff1c4"); glow.setAlpha(0.5); });
    c.on("pointerout", () => { bg.setAlpha(1); text.setColor("#ffd77a"); glow.setAlpha(0.25); });
    c.on("pointerdown", () => { if (!this.busy) action(); });
    this.tweens.add({ targets: glow, alpha: { from: 0.18, to: 0.42 }, duration: 1300, yoyo: true, repeat: -1 });
    return c;
  }

  /** A hero's 3D figure standing at (x, foot), `height` px tall, looking towards `dir` (0 right, 2 front, 4 left). */
  private heroFigure(cls: string, x: number, foot: number, height: number, dir: number): Phaser.GameObjects.Sprite | Phaser.GameObjects.Image {
    const key = `unit_${cls}`;
    if (hasSheet(key)) {
      const info = SHEETS[key];
      const spr = this.add.sprite(x, foot, `${key}:idle`, dir * info.anims.idle.frames).setOrigin(0.5, info.originY)
        .setScale((height * info.scale) / (info.height * 44));
      const idle = animKey(key, "idle", dir);
      if (this.anims.exists(idle)) spr.play({ key: idle, startFrame: Phaser.Math.Between(0, info.anims.idle.frames - 1) });
      return spr;
    }
    const [ox, oy] = UNIT_ORIGIN[key] ?? [0.5, 0.95];
    return this.add.image(x, foot, key).setOrigin(ox, oy).setScale(((2.4 / UNIT_RES) * height) / HERO_H);
  }

  /** A small glowing pedestal under a hero. */
  private pedestal(x: number, foot: number, w: number, cls: string): Phaser.GameObjects.GameObject[] {
    const cs = CLASS_SHEET[cls] ?? CLASS_SHEET.blade_master;
    const aura = this.add.image(x, foot - w * 0.45, `glow_${cs.glow}`).setBlendMode(Phaser.BlendModes.ADD).setScale(w / 46, w / 40).setAlpha(0.16);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.55).fillEllipse(x, foot + 4, w * 1.08, w * 0.27);
    g.fillStyle(0x1a1420, 1).fillEllipse(x, foot, w, w * 0.23);
    g.lineStyle(2, cs.hex, 0.85).strokeEllipse(x, foot, w, w * 0.23);
    g.lineStyle(1, 0xd6aa5a, 0.55).strokeEllipse(x, foot, w * 0.8, w * 0.18);
    const ring = this.add.image(x, foot, `ring_${cs.glow}`).setBlendMode(Phaser.BlendModes.ADD).setScale(w / 140, w / 570).setAlpha(0.6);
    this.tweens.add({ targets: ring, alpha: { from: 0.3, to: 0.75 }, duration: 1400, yoyo: true, repeat: -1 });
    return [aura, g, ring];
  }

  // ── account: sign in / create an account ────────────────────────────

  private showAccount(): void {
    this.mode = "account";
    const panel = this.panel();
    const login = this.accountTab === "login";
    panel.add(this.frame(-250, -200, 500, 450));
    const tab = (label: string, x: number, on: boolean, to: "login" | "register") => {
      const t = this.add.text(x, -156, label, txt(20, on ? "#ffd77a" : "#7a6c52", { fontStyle: "bold" })).setOrigin(0.5);
      if (!on) {
        t.setInteractive({ useHandCursor: true }).on("pointerdown", () => { if (!this.busy) { this.accountTab = to; this.showAccount(); } });
        t.on("pointerover", () => t.setColor("#c8b48a")).on("pointerout", () => t.setColor("#7a6c52"));
      }
      panel.add(t);
    };
    tab("ENTRAR", -112, login, "login");
    tab("CRIAR CONTA", 112, !login, "register");
    const bar = this.add.graphics();
    bar.lineStyle(1, 0x4a3c24, 1).lineBetween(-220, -128, 220, -128);
    bar.fillStyle(0xffd77a, 1).fillRect(login ? -212 : 12, -130, 200, 3);
    const barGlow = this.add.image(login ? -112 : 112, -129, "glow_gold").setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(240, 26).setAlpha(0.5);
    panel.add([bar, barGlow]);
    panel.add(this.add.text(0, -104, login ? "Bem-vindo de volta, aventureiro." : "Crie sua conta e comece a jornada.",
      txt(14, "#c8b48a", { fontStyle: "italic" })).setOrigin(0.5));
    panel.add(this.add.text(-200, -82, "USUÁRIO", txt(12, "#d6b878", { fontStyle: "bold" })));
    panel.add(this.add.text(-200, 4, "SENHA", txt(12, "#d6b878", { fontStyle: "bold" })));
    if (!login) {
      panel.add(this.add.text(200, -80, "3 a 20 letras, números ou _", txt(10, "#7a6c52")).setOrigin(1, 0));
      panel.add(this.add.text(200, 6, "8 ou mais caracteres", txt(10, "#7a6c52")).setOrigin(1, 0));
    }
    for (const [type, placeholder] of [["text", "Seu usuário"], ["password", "Sua senha"]]) {
      const input = document.createElement("input");
      input.type = type;
      input.placeholder = placeholder;
      input.setAttribute("aria-label", placeholder);
      input.autocomplete = type === "text" ? "username" : login ? "current-password" : "new-password";
      input.spellcheck = false;
      if (type === "text") input.maxLength = 20;
      const rest = "inset 0 2px 8px rgba(0,0,0,0.8)";
      Object.assign(input.style, {
        position: "fixed", boxSizing: "border-box", padding: "0 16px", color: "#f3e3b8", fontFamily: FONT, letterSpacing: "1px",
        background: "rgba(8,6,12,0.96)", border: "1px solid #6b5226", borderRadius: "8px", outline: "none", zIndex: "10",
        boxShadow: rest, transition: "border-color .15s, box-shadow .15s",
      });
      input.addEventListener("focus", () => Object.assign(input.style, { borderColor: "#d6aa5a", boxShadow: `${rest}, 0 0 14px rgba(214,170,90,0.35)` }));
      input.addEventListener("blur", () => Object.assign(input.style, { borderColor: "#6b5226", boxShadow: rest }));
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") void this.submitAccount(); });
      document.body.appendChild(input);
      this.accountInputs.push(input);
    }
    panel.add(this.goldButton(0, 132, login ? "ENTRAR" : "CRIAR CONTA", 320, 60, 22, () => void this.submitAccount()));
    const swap = this.add.text(0, 204, login ? "Novo por aqui?  Criar conta" : "Já tem conta?  Entrar", txt(14, "#a8946a")).setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    swap.on("pointerover", () => swap.setColor("#ffd77a")).on("pointerout", () => swap.setColor("#a8946a"));
    swap.on("pointerdown", () => { if (!this.busy) { this.accountTab = login ? "register" : "login"; this.showAccount(); } });
    panel.add(swap);
    this.drawSideHeroes();
    this.placeAccountInputs();
    if (!isTouch()) this.accountInputs[0].focus(); // on phones a tap opens the keyboard, not the screen itself
  }

  /** Two heroes guard the account panel, one on each side, looking at it. */
  private drawSideHeroes(): void {
    if (!this.accountPanel || this.mode !== "account") return;
    this.sideHeroes?.destroy();
    const items: Phaser.GameObjects.GameObject[] = [];
    for (const [cls, x, dir] of [["blade_master", -470, 1], ["night_ranger", 470, 3]] as [string, number, number][]) {
      items.push(...this.pedestal(x, 230, 220, cls));
      items.push(this.heroFigure(cls, x, 230, 330, dir));
    }
    this.sideHeroes = this.add.container(0, 0, items);
    this.accountPanel.addAt(this.sideHeroes, 0);
  }

  private placeAccountInputs(): void {
    const w = this.scale.width, h = this.scale.height;
    const s = Math.min(w / BOARD_W, h / BOARD_H);
    const rect = this.game.canvas.getBoundingClientRect();
    const kx = rect.width / w, ky = rect.height / h;
    const sa = this.accountScale();
    this.accountInputs.forEach((input, i) => Object.assign(input.style, {
      left: `${rect.left + (w / 2 - 200 * sa) * kx}px`, top: `${rect.top + (h / 2 + (ACCOUNT_SHIFT - 60 + i * 86) * sa) * ky}px`,
      width: `${400 * sa * kx}px`, height: `${48 * sa * ky}px`, fontSize: `${Math.max(isTouch() ? 16 : 12, 18 * sa * ky)}px`,
    }));
  }

  private async submitAccount(): Promise<void> {
    if (this.busy || this.mode !== "account") return;
    this.busy = true;
    this.statusText.setText("Conectando…").setColor("#c9b98a");
    try {
      const data = await this.api(`/auth/${this.accountTab}`, { username: this.accountInputs[0].value.trim(), password: this.accountInputs[1].value });
      setToken(data.token);
      await this.loadAccount();
      this.statusText.setText("");
      void this.paymentReturn();
    } catch (err) {
      this.statusText.setText(err instanceof Error ? err.message : "Não foi possível conectar ao servidor.").setColor("#ff6666");
    } finally { this.busy = false; }
  }

  // ── your heroes: four slots, each hero standing on its pedestal ─────

  private showHeroes(): void {
    this.mode = "heroes";
    const panel = this.panel();
    if (this.pick < 0) {
      let last: string | null = null;
      try { last = localStorage.getItem(LAST_KEY); } catch { /* private mode */ }
      this.pick = Math.max(0, this.characters.findIndex((c) => c.character_id === last));
    }
    this.pick = Math.min(this.pick, Math.max(0, this.characters.length - 1));
    panel.add(this.add.text(0, -206, "ESCOLHA SEU HERÓI", txt(16, "#d6b878", { fontStyle: "bold" })).setOrigin(0.5));
    const acct = this.add.text(-600, -330, `Conta: ${this.accountName}`, txt(13, "#a8946a")).setOrigin(0, 0.5);
    const logout = this.add.text(-600, -306, "Sair da conta", txt(13, "#c8b48a")).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    logout.on("pointerover", () => logout.setColor("#ff8a7a")).on("pointerout", () => logout.setColor("#c8b48a"));
    logout.on("pointerdown", () => { if (this.busy) return; setToken(""); this.characters = []; this.pick = -1; this.showAccount(); });
    panel.add([acct, logout]);
    const W = 236, H = 380, GAP = 22, top = -180;
    for (let i = 0; i < MAX_HEROES; i++) {
      const x = (i - (MAX_HEROES - 1) / 2) * (W + GAP);
      const hero = this.characters[i];
      if (!hero) {
        const can = i === this.characters.length;
        panel.add(this.frame(x - W / 2, top, W, H, can ? 0x8a6a30 : 0x3a3024, 0.6));
        if (can) {
          const plus = this.add.text(x, top + H / 2 - 30, "+", txt(64, "#d6b878")).setOrigin(0.5);
          const lbl = this.add.text(x, top + H / 2 + 30, "NOVO HERÓI", txt(17, "#d6b878", { fontStyle: "bold" })).setOrigin(0.5);
          const hint = this.add.text(x, top + H / 2 + 56, "Comece uma nova lenda", txt(11, "#7a6c52")).setOrigin(0.5);
          const zone = this.add.zone(x - W / 2, top, W, H).setOrigin(0).setInteractive({ useHandCursor: true });
          zone.on("pointerover", () => { plus.setColor("#ffe9a8"); lbl.setColor("#ffe9a8"); });
          zone.on("pointerout", () => { plus.setColor("#d6b878"); lbl.setColor("#d6b878"); });
          zone.on("pointerdown", () => { if (!this.busy) this.openCreate(); });
          this.tweens.add({ targets: plus, alpha: { from: 0.6, to: 1 }, duration: 1200, yoyo: true, repeat: -1 });
          panel.add([plus, lbl, hint, zone]);
        } else {
          panel.add(this.add.text(x, top + H / 2, "Espaço livre", txt(13, "#4a4034")).setOrigin(0.5));
        }
        continue;
      }
      const on = i === this.pick;
      const info = CLASS_INFO[hero.class] ?? { name: hero.class, color: "#f3e3b8" };
      const cs = CLASS_SHEET[hero.class] ?? CLASS_SHEET.blade_master;
      panel.add(this.frame(x - W / 2, top, W, H, on ? cs.hex : 0x6b5226, on ? 0.97 : 0.85));
      const foot = top + 250;
      panel.add(this.pedestal(x, foot, 170, hero.class));
      const fig = this.heroFigure(hero.class, x, foot, on ? 245 : 225, 2).setAlpha(on ? 1 : 0.75);
      panel.add(fig);
      if (on) {
        panel.add(this.add.particles(x, foot, `spark_${cs.glow}`, {
          x: { min: -70, max: 70 }, y: { min: -6, max: 6 }, lifespan: 1500, speedY: { min: -50, max: -20 },
          scale: { start: 0.4, end: 0 }, alpha: { start: 0.9, end: 0 }, frequency: 120, blendMode: "ADD",
        }));
      }
      const plate = this.add.graphics();
      plate.fillStyle(0x000000, 0.5).fillRoundedRect(x - W / 2 + 14, top + 282, W - 28, 84, 8);
      plate.lineStyle(1, on ? cs.hex : 0x4a3c24, 0.8).strokeRoundedRect(x - W / 2 + 14, top + 282, W - 28, 84, 8);
      panel.add(plate);
      panel.add(this.add.text(x, top + 300, hero.name, txt(20, on ? "#ffe9a8" : "#e8dcc0", { fontStyle: "bold" })).setOrigin(0.5));
      panel.add(this.add.text(x, top + 325, `Nível ${hero.level}  ·  ${info.name}`, txt(12, info.color)).setOrigin(0.5));
      panel.add(this.add.text(x, top + 347, META.maps?.[hero.map]?.name ?? hero.map, txt(11, "#a8946a", { fontStyle: "italic" })).setOrigin(0.5));
      const zone = this.add.zone(x - W / 2, top, W, H).setOrigin(0).setInteractive({ useHandCursor: true });
      zone.on("pointerdown", () => {
        if (this.busy) return;
        if (on) this.play(hero);
        else { this.pick = i; this.showHeroes(); }
      });
      if (!on) zone.on("pointerover", () => fig.setAlpha(0.95)).on("pointerout", () => fig.setAlpha(0.75));
      panel.add(zone);
    }
    const chosen = this.characters[this.pick];
    if (chosen) {
      panel.add(this.goldButton(0, 262, "JOGAR", 340, 64, 26, () => this.play(chosen)));
      panel.add(this.add.text(0, 306, "Clique num herói para escolher  ·  Enter para jogar", txt(11, "#7a6c52")).setOrigin(0.5));
    } else {
      panel.add(this.goldButton(0, 262, "CRIAR MEU HERÓI", 340, 64, 22, () => this.openCreate()));
    }
  }

  private play(hero: AccountHero): void {
    try { localStorage.setItem(LAST_KEY, hero.character_id); } catch { /* private mode */ }
    this.enter(hero.character_id, hero.class);
  }

  private openCreate(): void {
    if (this.characters.length >= MAX_HEROES) return;
    this.mode = "create";
    this.accountPanel?.destroy();
    this.accountPanel = undefined;
    this.sideHeroes = undefined;
    this.board.setVisible(true);
    if (this.nameInput) this.nameInput.style.display = "block";
    this.statusText.setText("");
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
    const back = this.add.text(-470, 312, "Voltar aos heróis", txt(16, "#d6b878")).setOrigin(0.5).setInteractive({ useHandCursor: true });
    back.on("pointerdown", () => { if (!this.busy) { this.pick = -1; this.showHeroes(); } });
    this.board.add(back);
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
    const acct = this.mode === "account";
    const sa = acct ? this.accountScale() : s;
    this.accountPanel?.setPosition(w / 2, h / 2 + (acct ? ACCOUNT_SHIFT * sa : 0)).setScale(sa);
    this.placeAccountInputs();
    this.statusText.setPosition(w / 2, acct ? h / 2 + (ACCOUNT_SHIFT + 272) * sa : h / 2 + 344 * s);
    this.placeNameInput();
  }

  private accountScale(): number {
    return Math.min(this.scale.width / BOARD_W, this.scale.height / ACCOUNT_H);
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
      width: `${bw}px`, height: `${bh}px`, fontSize: `${Math.max(isTouch() ? 16 : 12, 18 * s * ky)}px`,
      left: `${cx - bw / 2}px`, top: `${bottom - bh}px`,
    });
  }

  // ── actions ──────────────────────────────────────────────────────────

  private async createHero(): Promise<void> {
    if (this.busy || !this.ready || this.mode !== "create") return;
    const name = (this.nameInput?.value ?? "").trim();
    if (name.length < 3) { this.statusText.setText("Digite um nome com pelo menos 3 letras").setColor("#ff6666"); this.nameInput?.focus(); return; }
    this.busy = true;
    this.statusText.setText("Forjando seu destino…").setColor("#c9b98a");
    try {
      const c = await this.api("/characters", { name, char_class: this.selectedClass });
      this.busy = false;
      this.enter(c.character_id, this.selectedClass);
    } catch (err) {
      this.busy = false;
      this.statusText.setText(`${err instanceof Error ? err.message : err}`).setColor("#ff4444");
    }
  }

  enter(charId: string, cls: string): void {
    if (this.busy) return;
    this.busy = true;
    this.clearAccountInputs();
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

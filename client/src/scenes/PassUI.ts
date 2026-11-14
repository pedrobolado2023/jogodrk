/**
 * Season pass window (key P): level and XP, the free and Premium reward tracks (10 levels a page), claiming,
 * and how pass XP is earned. The server decides everything; this only shows the `season` message.
 */
import Phaser from "phaser";
import { META, fmtBig, type PassReward, type SeasonState } from "../data/meta";
import { GLOW_COLORS } from "../gfx/textures";
import { panel, txt } from "./uiStyle";

type Obj = Phaser.GameObjects.GameObject;

const W = 760;
const H = 452;
const PER_PAGE = 10;
const COL = 64;
const CELL = 50;

export class PassUI {
  private root?: Phaser.GameObjects.Container;
  private tip?: Phaser.GameObjects.Container;
  private state: SeasonState | null = null;
  private page = -1;          // -1: pick the page with something to claim (or the current level) on open

  constructor(private scene: Phaser.Scene, private send: (m: Record<string, unknown>) => void, private openShop: () => void = () => undefined) {}

  get isOpen(): boolean {
    return !!this.root;
  }

  set(st: SeasonState): void {
    this.state = st;
    if (this.root) this.draw();
  }

  toggle(): void {
    if (this.root) this.close();
    else { this.page = -1; this.draw(); }
  }

  close(): void {
    this.root?.destroy();
    this.root = undefined;
    this.hideTip();
  }

  private claimable(st: SeasonState, track: "free" | "prem", level: number): boolean {
    return level <= st.level && (track === "free" || st.premium) && !st[track].includes(level);
  }

  private draw(): void {
    this.root?.destroy();
    this.hideTip();
    const meta = META.season;
    const st = this.state;
    const objs: Obj[] = [];
    const g = this.scene.add.graphics();
    panel(g, -W / 2, -H / 2, W, H, 12, 0.97);
    const blocker = this.scene.add.zone(-W / 2, -H / 2, W, H).setOrigin(0).setInteractive();
    objs.push(blocker, g);
    const close = this.scene.add.text(W / 2 - 16, -H / 2 + 10, "✕", txt(16, "#e8dcc0")).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => this.close());
    objs.push(close);
    if (!meta || !st) {
      objs.push(this.scene.add.text(0, 0, "Carregando o passe…", txt(12, "#a8987a")).setOrigin(0.5));
      this.mount(objs);
      return;
    }
    const pages = Math.ceil(meta.max / PER_PAGE);
    if (this.page < 0) {
      const first = meta.track.find((r) => this.claimable(st, "free", r.level) || this.claimable(st, "prem", r.level));
      this.page = Math.floor(((first?.level ?? Math.max(1, st.level)) - 1) / PER_PAGE);
    }
    this.page = Phaser.Math.Clamp(this.page, 0, pages - 1);

    // header: season, days left, level badge, XP bar, Premium
    objs.push(this.scene.add.text(0, -H / 2 + 12, "PASSE DE TEMPORADA", txt(16, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5, 0));
    objs.push(this.scene.add.text(0, -H / 2 + 34, `${st.name} · termina em ${st.days_left} dia${st.days_left === 1 ? "" : "s"}`,
      txt(10, "#c8a878")).setOrigin(0.5, 0));
    const hx = -W / 2 + 24, hy = -H / 2 + 58;
    const badge = this.scene.add.graphics();
    badge.fillStyle(0x2a1e0c, 1).fillCircle(hx + 26, hy + 24, 26).lineStyle(2, 0xd6aa5a, 1).strokeCircle(hx + 26, hy + 24, 26);
    objs.push(badge, this.scene.add.text(hx + 26, hy + 24, `${st.level}`, txt(20, "#ffe9a8", { fontStyle: "bold" })).setOrigin(0.5),
      this.scene.add.text(hx + 26, hy + 52, "NÍVEL", txt(8, "#a8987a")).setOrigin(0.5, 0));
    const bx = hx + 66, bw = 330;
    const done = st.level >= st.max;
    const frac = done ? 1 : st.xp_in / st.xp_per;
    const bar = this.scene.add.graphics();
    bar.fillStyle(0x15110c, 1).fillRoundedRect(bx, hy + 14, bw, 14, 6);
    bar.fillStyle(0xd6aa5a, 1).fillRoundedRect(bx, hy + 14, Math.max(8, bw * frac), 14, 6);
    bar.lineStyle(1, 0x6b5226, 1).strokeRoundedRect(bx, hy + 14, bw, 14, 6);
    objs.push(bar,
      this.scene.add.text(bx, hy - 2, done ? `Nível máximo (${st.max})!` : `Nível ${st.level} de ${st.max}`, txt(11, "#e8dcc0", { fontStyle: "bold" })),
      this.scene.add.text(bx + bw, hy - 2, done ? "" : `${st.xp_in} / ${st.xp_per} XP`, txt(10, "#ffd77a")).setOrigin(1, 0),
      this.scene.add.text(bx, hy + 34, `XP de monstros hoje: ${st.kill_xp_today} / ${st.kill_cap}`,
        txt(9, st.kill_xp_today >= st.kill_cap ? "#ff9a7a" : "#a8987a")));
    const px = W / 2 - 24;
    if (st.premium) {
      objs.push(this.scene.add.text(px, hy + 6, "★ PASSE PREMIUM ATIVO", txt(13, "#ffd77a", { fontStyle: "bold" })).setOrigin(1, 0),
        this.scene.add.text(px, hy + 26, "Todas as recompensas visuais liberadas.", txt(9, "#c8bca0")).setOrigin(1, 0));
    } else {
      const price = META.shop?.offers.find((o) => o.kind === "premium_pass")?.price;
      const buy = this.scene.add.text(px, hy + 2, `★ Liberar Premium${price ? ` (${price} gemas)` : ""}`, txt(12, "#ffd77a", {
        fontStyle: "bold", backgroundColor: "#3a2e14", padding: { x: 8, y: 4 },
      })).setOrigin(1, 0).setInteractive({ useHandCursor: true });
      buy.on("pointerdown", () => { this.close(); this.openShop(); });
      objs.push(buy,
      this.scene.add.text(px, hy + 30, "Só visual: 4 títulos e 4 auras exclusivos.\nNenhuma vantagem de poder.", txt(9, "#a8987a", { align: "right" })).setOrigin(1, 0));
    }

    // the track
    const tx = -W / 2 + 104, ty = -H / 2 + 138;
    const rowFree = ty + 26, rowPrem = rowFree + CELL + 22;
    objs.push(this.scene.add.text(-W / 2 + 20, rowFree + CELL / 2, "GRÁTIS", txt(11, "#c8e8a8", { fontStyle: "bold" })).setOrigin(0, 0.5),
      this.scene.add.text(-W / 2 + 20, rowPrem + CELL / 2, "PREMIUM ★", txt(11, "#ffd77a", { fontStyle: "bold" })).setOrigin(0, 0.5));
    const levels = meta.track.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE);
    // progress line through the level numbers
    const line = this.scene.add.graphics();
    const lx0 = tx + CELL / 2, lx1 = tx + (levels.length - 1) * COL + CELL / 2;
    const reachedCols = levels.filter((r) => r.level <= st.level).length;
    line.fillStyle(0x2a2216, 1).fillRect(lx0, ty + 8, lx1 - lx0, 4);
    if (reachedCols > 0) line.fillStyle(0xd6aa5a, 1).fillRect(lx0, ty + 8, (reachedCols - 1) * COL + (reachedCols < levels.length ? COL / 2 : 0), 4);
    objs.push(line);
    levels.forEach((row, i) => {
      const x = tx + i * COL;
      const reached = row.level <= st.level;
      const dot = this.scene.add.graphics();
      dot.fillStyle(reached ? 0xd6aa5a : 0x2a2216, 1).fillCircle(x + CELL / 2, ty + 10, 11);
      dot.lineStyle(1, reached ? 0xffe9a8 : 0x4a3c24, 1).strokeCircle(x + CELL / 2, ty + 10, 11);
      objs.push(dot, this.scene.add.text(x + CELL / 2, ty + 10, `${row.level}`, txt(10, reached ? "#1a1208" : "#8a7c62", {
        fontStyle: "bold", stroke: reached ? "#ffe9a8" : "#000000", strokeThickness: reached ? 1 : 3,
      })).setOrigin(0.5));
      this.rewardCell(objs, x, rowFree, row.free, "free", row.level, st);
      this.rewardCell(objs, x, rowPrem, row.prem, "prem", row.level, st);
    });

    // pages
    const navY = rowPrem + CELL + 18;
    const nav = (label: string, to: number, ok: boolean, x: number) => {
      const t = this.scene.add.text(x, navY, label, txt(14, ok ? "#ffd77a" : "#4a4030", { fontStyle: "bold" })).setOrigin(0.5, 0);
      if (ok) t.setInteractive({ useHandCursor: true }).on("pointerdown", () => { this.page = to; this.draw(); });
      objs.push(t);
    };
    const mid = tx + ((PER_PAGE - 1) * COL + CELL) / 2;
    nav("◀", this.page - 1, this.page > 0, mid - 90);
    objs.push(this.scene.add.text(mid, navY + 2, `Níveis ${levels[0].level}–${levels[levels.length - 1].level}`, txt(11, "#c8bca0")).setOrigin(0.5, 0));
    nav("▶", this.page + 1, this.page < pages - 1, mid + 90);

    // claim everything + how to earn XP
    const ready = meta.track.reduce((n, r) => n + (this.claimable(st, "free", r.level) ? 1 : 0) + (this.claimable(st, "prem", r.level) ? 1 : 0), 0);
    const by = H / 2 - 92;
    const all = this.scene.add.text(W / 2 - 24, by, ready ? `Pegar tudo (${ready})` : "Nada para pegar", txt(12, ready ? "#9dff8a" : "#6a6050", {
      fontStyle: "bold", backgroundColor: ready ? "#1e2a12" : "#141210", padding: { x: 12, y: 6 },
    })).setOrigin(1, 0);
    if (ready) all.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.send({ type: "pass_claim_all" }));
    objs.push(all);
    objs.push(this.scene.add.text(-W / 2 + 20, by, "COMO GANHAR XP DO PASSE", txt(10, "#d6b878", { fontStyle: "bold" })));
    meta.sources.forEach((s, i) => {
      objs.push(this.scene.add.text(-W / 2 + 20 + (i % 2) * 300, by + 18 + Math.floor(i / 2) * 16, `• ${s}`, txt(9, "#c8bca0")));
    });
    objs.push(this.scene.add.text(0, H / 2 - 20, "Os visuais (títulos e auras) ficam com você para sempre, mesmo depois da temporada.",
      txt(9, "#8a7c62")).setOrigin(0.5, 0));
    this.mount(objs);
  }

  private mount(objs: Obj[]): void {
    const s = this.scene.scale;
    this.root = this.scene.add.container(s.width / 2, s.height / 2, objs).setDepth(82)
      .setScale(Math.min(1, (s.width - 16) / W, (s.height - 100) / H));
  }

  private rewardCell(objs: Obj[], x: number, y: number, rewards: PassReward[], track: "free" | "prem", level: number, st: SeasonState): void {
    const reached = level <= st.level;
    const taken = st[track].includes(level);
    const locked = track === "prem" && !st.premium;
    const ready = this.claimable(st, track, level);
    const r = rewards[0];
    const g = this.scene.add.graphics();
    const prem = track === "prem";
    g.fillStyle(prem ? 0x1c1408 : 0x10140c, 0.95).fillRoundedRect(x, y, CELL, CELL, 6);
    g.lineStyle(ready ? 2 : 1, ready ? 0xffd77a : prem ? 0x6b5226 : 0x3a4a2a, 1).strokeRoundedRect(x, y, CELL, CELL, 6);
    objs.push(g);
    if (ready) {
      const glow = this.scene.add.graphics();
      glow.fillStyle(0xffd77a, 0.14).fillRoundedRect(x + 2, y + 2, CELL - 4, CELL - 4, 5);
      objs.push(glow);
      this.scene.tweens.add({ targets: glow, alpha: { from: 0.4, to: 1 }, duration: 700, yoyo: true, repeat: -1 });
    }
    const icon = this.iconOf(r);
    const img = this.scene.add.image(x + CELL / 2, y + CELL / 2 - 2, icon.key).setScale((CELL - 12) / 48);
    if (icon.tint !== undefined) img.setTint(icon.tint);
    if (taken || (!reached && !ready)) img.setAlpha(taken ? 0.35 : 0.55);
    objs.push(img);
    const label = this.amount(r) + (rewards.length > 1 ? " +" : "");
    if (label) objs.push(this.scene.add.text(x + CELL - 3, y + CELL - 2, label, txt(9, "#ffffff", { fontStyle: "bold" })).setOrigin(1, 1));
    if (taken) objs.push(this.scene.add.text(x + CELL / 2, y + CELL / 2, "✔", txt(20, "#7aff7a", { fontStyle: "bold" })).setOrigin(0.5));
    else if (locked) {
      // a small padlock
      const lk = this.scene.add.graphics();
      lk.lineStyle(2, 0xd6c08a, 1).beginPath().arc(x + CELL - 10, y + 10, 4, Math.PI, 0).strokePath();
      lk.fillStyle(0xd6c08a, 1).fillRoundedRect(x + CELL - 16, y + 10, 12, 9, 2);
      objs.push(lk);
    }
    if (ready) objs.push(this.scene.add.text(x + CELL / 2, y + CELL + 2, "PEGAR", txt(8, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5, 0));
    const zone = this.scene.add.zone(x, y, CELL, CELL).setOrigin(0).setInteractive({ useHandCursor: ready });
    zone.on("pointerover", (p: Phaser.Input.Pointer) => this.showTip(rewards, track, level, st, p));
    zone.on("pointerout", () => this.hideTip());
    if (ready) zone.on("pointerdown", () => { this.hideTip(); this.send({ type: "pass_claim", track, level }); });
    objs.push(zone);
  }

  private iconOf(r: PassReward): { key: string; tint?: number } {
    if ("gold" in r) return { key: "item_pass_gold" };
    if ("item" in r) return { key: `item_${META.items[r.item]?.icon ?? "pass_gold"}` };
    if ("title" in r) return { key: "item_pass_title" };
    const aura = META.auras?.find((a) => a.id === r.aura);
    return { key: "item_pass_aura", tint: GLOW_COLORS[aura?.color ?? "gold"] };
  }

  private amount(r: PassReward): string {
    if ("gold" in r) return fmtBig(r.gold);
    if ("item" in r) return r.qty > 1 ? `${r.qty}` : "";
    return "";
  }

  private describe(r: PassReward): { t: string; c: string } {
    if ("gold" in r) return { t: `${fmtBig(r.gold)} de ouro`, c: "#ffd77a" };
    if ("item" in r) {
      const it = META.items[r.item];
      return { t: `${r.qty}× ${it?.name ?? r.item}`, c: META.rarity[it?.rarity ?? "comum"]?.color ?? "#e8dcc0" };
    }
    if ("title" in r) {
      const tt = META.titles.find((t) => t.id === r.title);
      return { t: `Título «${tt?.name ?? r.title}»`, c: tt?.color ?? "#ffd77a" };
    }
    const a = META.auras?.find((x) => x.id === r.aura);
    return { t: `${a?.name ?? r.aura} (em volta do herói)`, c: "#ffd77a" };
  }

  private showTip(rewards: PassReward[], track: "free" | "prem", level: number, st: SeasonState, p: Phaser.Input.Pointer): void {
    this.hideTip();
    const lines = rewards.map((r) => this.describe(r));
    const status = st[track].includes(level) ? { t: "Já pego.", c: "#7aff7a" }
      : track === "prem" && !st.premium ? { t: "Precisa do Passe Premium.", c: "#bfa77a" }
      : level > st.level ? { t: `Chegue ao nível ${level} do passe.`, c: "#a8987a" } : { t: "Clique para pegar!", c: "#9dff8a" };
    const head = this.scene.add.text(10, 8, `Nível ${level} · ${track === "free" ? "Grátis" : "Premium"}`, txt(12, "#e8dcc0", { fontStyle: "bold" }));
    const body = [...lines, status].map((l, i) => this.scene.add.text(10, 30 + i * 16, l.t, txt(10, l.c)));
    const w = Math.max(head.width, ...body.map((b) => b.width)) + 20, h = 38 + body.length * 16;
    const g = this.scene.add.graphics();
    panel(g, 0, 0, w, h, 6, 0.97);
    const sw = this.scene.scale.width, sh = this.scene.scale.height;
    const x = p.x + 14 + w > sw ? p.x - w - 10 : p.x + 14, y = Math.min(p.y + 14, sh - h - 4);
    this.tip = this.scene.add.container(x, y, [g, head, ...body]).setDepth(96);
  }

  private hideTip(): void {
    this.tip?.destroy();
    this.tip = undefined;
  }
}

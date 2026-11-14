/**
 * Gem shop window (key L): auras, titles and the season pass Premium, paid with gems. Only looks — the shop never
 * sells power. Gem packs for real money are shown as "coming soon". The server checks every purchase.
 */
import Phaser from "phaser";
import { isTouch } from "../ui/device";
import { META, fmtBig, type HeroState, type SeasonState, type ShopOffer } from "../data/meta";
import { GLOW_COLORS } from "../gfx/textures";
import { SHEETS, animKey, hasSheet, requestSheet } from "../gfx/sprites3d";
import { panel, txt } from "./uiStyle";

type Obj = Phaser.GameObjects.GameObject;
type Tab = "destaques" | "visuais" | "mascotes" | "montarias" | "bonus" | "passe" | "embreve" | "gemas";

const W = 720;
const H = 512;
const CARD_W = 160;
const CARD_H = 168;
const GAP = 12;

export class ShopUI {
  private root?: Phaser.GameObjects.Container;
  private hero: HeroState | null = null;
  private season: SeasonState | null = null;
  private tab: Tab = "destaques";
  /** page of the current tab (8 cards a page) */
  private page = 0;
  private confirm = "";

  constructor(private scene: Phaser.Scene, private send: (m: Record<string, unknown>) => void) {}

  get isOpen(): boolean {
    return !!this.root;
  }

  setHero(h: HeroState): void {
    const changed = h.gems !== this.hero?.gems || JSON.stringify(h.cosmetics) !== JSON.stringify(this.hero?.cosmetics);
    this.hero = h;
    if (changed && this.root) { this.confirm = ""; this.draw(); }
  }

  setSeason(st: SeasonState): void {
    const changed = st.premium !== this.season?.premium;
    this.season = st;
    if (changed && this.root) this.draw();
  }

  toggle(tab?: Tab): void {
    if (this.root && !tab) { this.close(); return; }
    if (tab) this.tab = tab;
    this.confirm = "";
    this.draw();
  }

  close(): void {
    this.root?.destroy();
    this.root = undefined;
  }

  private owned(o: ShopOffer): boolean {
    const c = this.hero?.cosmetics;
    if (o.kind === "aura") return !!c?.auras.includes(o.ref ?? "");
    if (o.kind === "title") return !!c?.titles.includes(o.ref ?? "");
    return !!this.season?.premium;
  }

  private draw(): void {
    this.root?.destroy();
    const shop = META.shop;
    const gems = this.hero?.gems ?? 0;
    const objs: Obj[] = [];
    const g = this.scene.add.graphics();
    panel(g, -W / 2, -H / 2, W, H, 12, 0.97);
    objs.push(this.scene.add.zone(-W / 2, -H / 2, W, H).setOrigin(0).setInteractive(), g);
    const close = this.scene.add.text(W / 2 - 16, -H / 2 + 10, "✕", txt(16, "#e8dcc0")).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => this.close());
    objs.push(close,
      this.scene.add.text(0, -H / 2 + 12, "LOJA DE RAVENCREST", txt(16, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5, 0),
      this.scene.add.text(0, -H / 2 + 34, "Visual e tempo: nada aqui deixa seu herói mais forte.", txt(10, "#9dd8a0")).setOrigin(0.5, 0));
    // balance
    objs.push(this.scene.add.image(-W / 2 + 34, -H / 2 + 26, "item_gem").setScale(0.55),
      this.scene.add.text(-W / 2 + 50, -H / 2 + 18, `${fmtBig(gems)}`, txt(15, "#8ad8ff", { fontStyle: "bold" })),
      this.scene.add.text(-W / 2 + 50, -H / 2 + 36, shop?.currency ?? "Gemas", txt(9, "#a8987a")));
    // tabs
    const tabs: [Tab, string][] = [["destaques", "Destaques"], ["visuais", "Visuais"], ["mascotes", "Mascotes"], ["montarias", "Montarias"],
      ["bonus", "Bônus"], ["passe", "Passe/Missões"], ["embreve", "Em breve"], ["gemas", "◆ Gemas"]];
    tabs.forEach(([id, label], i) => {
      const on = this.tab === id;
      const t = this.scene.add.text(-W / 2 + 14 + i * 87, -H / 2 + 62, label, txt(9, on ? "#ffd77a" : "#a8987a", {
        backgroundColor: on ? "#2e2414" : "#15110c", padding: { x: 2, y: 5 }, fontStyle: on ? "bold" : "normal", fixedWidth: 84, align: "center",
      })).setInteractive({ useHandCursor: true });
      t.on("pointerdown", () => { this.tab = id; this.page = 0; this.confirm = ""; this.draw(); });
      objs.push(t);
    });
    const top = -H / 2 + 100;
    if (!shop) {
      objs.push(this.scene.add.text(0, 0, "Carregando a loja…", txt(12, "#a8987a")).setOrigin(0.5));
    } else if (this.tab === "gemas") {
      this.drawPacks(objs, top);
    } else if (this.tab === "embreve") {
      this.drawSoon(objs, top);
    } else {
      // Visuais: every aura and title (some also show in Destaques)
      const offers = shop.offers.filter((o) => (this.tab === "visuais" ? o.kind === "aura" || o.kind === "title" : o.tab === this.tab));
      const perRow = 4, perPage = 8;
      const pages = Math.max(1, Math.ceil(offers.length / perPage));
      this.page = Math.min(this.page, pages - 1);
      const shown = offers.slice(this.page * perPage, (this.page + 1) * perPage);
      if (pages > 1) {
        const ny = top + 2 * (CARD_H + GAP) + 4;
        const nav = (label: string, to: number, ok: boolean, x: number) => {
          const b = this.scene.add.text(x, ny, label, txt(15, ok ? "#ffd77a" : "#4a4030", { fontStyle: "bold" })).setOrigin(0.5, 0);
          if (ok) b.setInteractive({ useHandCursor: true }).on("pointerdown", () => { this.page = to; this.confirm = ""; this.draw(); });
          objs.push(b);
        };
        nav("◀", this.page - 1, this.page > 0, -70);
        objs.push(this.scene.add.text(0, ny + 2, `Página ${this.page + 1} de ${pages}  ·  ${offers.length} itens`, txt(11, "#c8bca0")).setOrigin(0.5, 0));
        nav("▶", this.page + 1, this.page < pages - 1, 70);
      }
      shown.forEach((o, i) => {
        // every row is centred, also a short last one
        const inRow = Math.min(perRow, shown.length - Math.floor(i / perRow) * perRow);
        const rowW = inRow * CARD_W + (inRow - 1) * GAP;
        const x = -rowW / 2 + (i % perRow) * (CARD_W + GAP), y = top + Math.floor(i / perRow) * (CARD_H + GAP);
        this.card(objs, x, y, o, gems);
      });
    }
    const s = this.scene.scale;
    this.root = this.scene.add.container(s.width / 2, s.height / 2, objs).setDepth(82)
      .setScale(Math.min(1, (s.width - 16) / W, (s.height - (isTouch() ? 12 : 100)) / H));
  }

  private card(objs: Obj[], x: number, y: number, o: ShopOffer, gems: number): void {
    const owned = this.owned(o);
    const g = this.scene.add.graphics();
    const prem = o.kind === "premium_pass";
    g.fillStyle(prem ? 0x1e160a : 0x120e18, 0.97).fillRoundedRect(x, y, CARD_W, CARD_H, 8);
    g.lineStyle(prem ? 2 : 1, prem ? 0xd6aa5a : 0x5a4a30, 1).strokeRoundedRect(x, y, CARD_W, CARD_H, 8);
    objs.push(g);
    // the look: a glowing stage for auras, a banner for titles, the ticket for the pass
    const cx = x + CARD_W / 2;
    if (o.kind === "aura") {
      const aura = META.auras?.find((a) => a.id === o.ref);
      const color = GLOW_COLORS[aura?.color ?? "gold"];
      const glow = this.scene.add.image(cx, y + 46, `glow_${aura?.color ?? "gold"}`).setBlendMode(Phaser.BlendModes.ADD).setScale(1.8, 0.8).setAlpha(0.6);
      const ring = this.scene.add.image(cx, y + 46, `ring_${aura?.color ?? "gold"}`).setBlendMode(Phaser.BlendModes.ADD).setScale(0.42, 0.18);
      objs.push(glow, ring, this.scene.add.image(cx, y + 36, "item_pass_aura").setScale(0.9).setTint(color));
      this.scene.tweens.add({ targets: glow, alpha: { from: 0.35, to: 0.75 }, duration: 1200, yoyo: true, repeat: -1 });
    } else if (o.kind === "title") {
      const t = META.titles.find((tt) => tt.id === o.ref);
      objs.push(this.scene.add.image(cx, y + 30, "item_pass_title").setScale(0.75),
        this.scene.add.text(cx, y + 58, `« ${t?.name ?? ""} »`, txt(11, t?.color ?? "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5));
    } else if (o.kind === "pet" || o.kind === "mount") {
      // the mascot / horse itself, breathing in its idle pose (its 3D sheet loads the first time the card shows)
      const def = (o.kind === "pet" ? META.pets : META.mounts)?.find((p) => p.id === o.ref);
      const sheet = def?.sheet ?? "";
      const stage = this.scene.add.graphics();
      stage.fillStyle(0x2a2238, 0.6).fillEllipse(cx, y + 66, 92, 18);
      objs.push(stage);
      if (sheet && hasSheet(sheet)) {
        const info = SHEETS[sheet];
        // three-quarter view (row 1): animals seen head-on look thin
        const fig = this.scene.add.sprite(cx, y + 66, `${sheet}:idle`, 1 * info.anims.idle.frames).setOrigin(0.5, info.originY)
          // about 54 px tall, but never wider than the card (the dragons have long tails)
          .setScale(Math.min(info.scale * 1.6, 54 / (info.height * (44 / info.scale)), (CARD_W * 1.05) / info.size));
        const anim = animKey(sheet, "idle", 1);
        if (this.scene.anims.exists(anim)) fig.play(anim);
        objs.push(fig);
      } else {
        objs.push(this.scene.add.image(cx, y + 40, "item_paw").setScale(1));
        if (sheet) void requestSheet(this.scene, sheet).then((ok) => { if (ok && this.root && (this.tab === "mascotes" || this.tab === "montarias")) this.draw(); });
      }
    } else if (o.kind === "boost") {
      objs.push(this.scene.add.image(cx, y + 38, o.ref === "gold" ? "item_boost_gold" : "item_boost_exp").setScale(1.1));
    } else if (o.kind === "quest_skip") {
      objs.push(this.scene.add.image(cx, y + 38, "item_quest_skip").setScale(1.1));
    } else {
      objs.push(this.scene.add.image(cx, y + 38, "item_shop_pass").setScale(1.1));
      if (o.kind === "pass_level") objs.push(this.scene.add.text(cx + 22, y + 52, `+${o.levels}`, txt(14, "#ffe9a8", { fontStyle: "bold" })).setOrigin(0.5));
    }
    objs.push(this.scene.add.text(cx, y + 76, o.kind === "title" ? "Título" : o.name, txt(11, prem ? "#ffd77a" : "#f3e3b8", {
      fontStyle: "bold", align: "center", wordWrap: { width: CARD_W - 16 },
    })).setOrigin(0.5, 0));
    objs.push(this.scene.add.text(cx, y + 96, o.desc, txt(8, "#a8987a", { align: "center", wordWrap: { width: CARD_W - 18 } })).setOrigin(0.5, 0));
    // price + button
    const by = y + CARD_H - 30;
    const price = o.price + (o.price_step ?? 0) * (this.hero?.story?.q ?? 0);
    const blocked = this.blocked(o);
    if (o.kind === "boost") {
      const left = this.hero?.boosts?.[o.ref ?? ""] ?? 0;
      if (left > 0) objs.push(this.scene.add.text(x + CARD_W - 6, y + 6, `Ativo · ${Math.ceil(left / 60)} min`, txt(9, "#9dff8a", {
        fontStyle: "bold", backgroundColor: "#16240e", padding: { x: 5, y: 2 },
      })).setOrigin(1, 0));
    }
    if (blocked) {
      objs.push(this.scene.add.text(cx, by + 4, blocked, txt(9, "#8a7c62", { align: "center" })).setOrigin(0.5, 0));
      return;
    }
    if (owned) {
      objs.push(this.scene.add.text(cx, by + 4, o.kind === "premium_pass" ? "✔ Ativo" : "✔ Já é seu", txt(11, "#7aff7a", { fontStyle: "bold" })).setOrigin(0.5, 0));
      return;
    }
    const afford = gems >= price;
    const confirming = this.confirm === o.id;
    objs.push(this.scene.add.image(x + 18, by + 11, "item_gem").setScale(0.34),
      this.scene.add.text(x + 30, by + 3, fmtBig(price), txt(12, afford ? "#8ad8ff" : "#ff8a7a", { fontStyle: "bold" })));
    const label = !afford ? `Faltam ${fmtBig(price - gems)}` : confirming ? "Confirmar?" : "Comprar";
    const b = this.scene.add.text(x + CARD_W - 10, by + 1, label, txt(10, !afford ? "#6a6050" : confirming ? "#ffd77a" : "#9dff8a", {
      fontStyle: "bold", backgroundColor: !afford ? "#141210" : confirming ? "#3a2e14" : "#1e2a12", padding: { x: 7, y: 4 },
    })).setOrigin(1, 0);
    if (afford) {
      b.setInteractive({ useHandCursor: true });
      b.on("pointerdown", () => {
        if (this.confirm === o.id) { this.confirm = ""; this.send({ type: "shop_buy", id: o.id }); }
        else { this.confirm = o.id; this.draw(); }
      });
    }
    objs.push(b);
  }

  /** Why an offer cannot be bought right now (the server checks the same), or "" when it can. */
  private blocked(o: ShopOffer): string {
    if (o.kind === "pass_level" && this.season) {
      const left = this.season.max - this.season.level;
      if (left <= 0) return "Passe no nível máximo";
      if ((o.levels ?? 1) > left) return `Faltam só ${left} nível(is)`;
    }
    if (o.kind === "quest_skip") {
      const st = this.hero?.story;
      if (!st || st.st !== "active") return "Nenhuma missão da\nhistória em andamento";
    }
    return "";
  }

  /** What is coming later (skins, pets, mounts). */
  private drawSoon(objs: Obj[], top: number): void {
    const soon = META.shop?.soon ?? [];
    const rowW = soon.length * CARD_W + (soon.length - 1) * GAP;
    soon.forEach((s, i) => {
      const x = -rowW / 2 + i * (CARD_W + GAP), y = top;
      const g = this.scene.add.graphics();
      g.fillStyle(0x10121a, 0.97).fillRoundedRect(x, y, CARD_W, CARD_H, 8).lineStyle(1, 0x3a4a5a, 1).strokeRoundedRect(x, y, CARD_W, CARD_H, 8);
      objs.push(g, this.scene.add.image(x + CARD_W / 2, y + 40, "item_soon").setScale(1.1),
        this.scene.add.text(x + CARD_W / 2, y + 76, s.name, txt(11, "#c8d8e8", { fontStyle: "bold", align: "center", wordWrap: { width: CARD_W - 16 } })).setOrigin(0.5, 0),
        this.scene.add.text(x + CARD_W / 2, y + 98, s.desc, txt(8, "#8a9aaa", { align: "center", wordWrap: { width: CARD_W - 18 } })).setOrigin(0.5, 0),
        this.scene.add.text(x + CARD_W / 2, y + CARD_H - 28, "Em breve", txt(10, "#6a7a8a", { fontStyle: "bold", backgroundColor: "#121820", padding: { x: 10, y: 3 } })).setOrigin(0.5, 0));
    });
    objs.push(this.scene.add.text(0, top + CARD_H + 24, "Skins, mascotes e montarias também serão só visuais: nenhum deles muda os atributos.",
      txt(10, "#a8987a")).setOrigin(0.5, 0));
  }

  /** Gem packs for real money: not sold yet, shown so the design is clear. */
  private drawPacks(objs: Obj[], top: number): void {
    const packs = META.shop?.packs ?? [];
    const w = 150, gap = 14, rowW = packs.length * w + (packs.length - 1) * gap;
    packs.forEach((p, i) => {
      const x = -rowW / 2 + i * (w + gap), y = top + 10;
      const g = this.scene.add.graphics();
      g.fillStyle(0x0e1420, 0.97).fillRoundedRect(x, y, w, 190, 8).lineStyle(1, 0x3a5a7a, 1).strokeRoundedRect(x, y, w, 190, 8);
      objs.push(g);
      for (let k = 0; k <= Math.min(i, 3); k++) objs.push(this.scene.add.image(x + w / 2 - (Math.min(i, 3) * 9) / 2 + k * 9, y + 50 - k * 4, "item_gem").setScale(0.9 + i * 0.08));
      objs.push(this.scene.add.text(x + w / 2, y + 96, `${fmtBig(p.gems)} gemas`, txt(13, "#8ad8ff", { fontStyle: "bold" })).setOrigin(0.5, 0));
      if (p.bonus) objs.push(this.scene.add.text(x + w / 2, y + 116, `+${fmtBig(p.bonus)} de bônus`, txt(10, "#ffd77a")).setOrigin(0.5, 0));
      objs.push(this.scene.add.text(x + w / 2, y + 156, "Em breve", txt(11, "#6a7a8a", {
        fontStyle: "bold", backgroundColor: "#121820", padding: { x: 12, y: 4 },
      })).setOrigin(0.5, 0));
    });
    objs.push(this.scene.add.text(0, top + 222, "A compra de gemas com dinheiro real chega em breve.\nAs gemas compram só visuais e o Passe Premium — nunca força.",
      txt(10, "#a8987a", { align: "center", lineSpacing: 4 })).setOrigin(0.5, 0));
  }
}

/**
 * Gem shop window (key L): auras, titles and the season pass Premium, paid with gems. Only looks — the shop never
 * sells power. Gems, the Premium pass and VIP are bought with real money on Mercado Pago (Pix or card): the
 * player goes to Mercado Pago's page and comes back to the game. The server checks every purchase.
 */
import Phaser from "phaser";
import { isTouch } from "../ui/device";
import { API, META, fmtBig, type HeroState, type SeasonState, type ShopOffer } from "../data/meta";
import { authHeaders } from "../network/session";
import { GLOW_COLORS } from "../gfx/textures";
import { SHEETS, shopThumb, type Grade } from "../gfx/sprites3d";
import { panel, txt } from "./uiStyle";

type Obj = Phaser.GameObjects.GameObject;
type Tab = "destaques" | "visuais" | "skins" | "mascotes" | "montarias" | "bonus" | "passe" | "embreve" | "gemas" | "vip";

interface PayCatalog { enabled: boolean; products: Record<string, { kind: string; price: number; title: string; gems?: number; tier?: number }> }
interface VipInfo { level: number; last_level: number; days_left: number }
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const W = 720;
const H_FULL = 512;
/** the gems and VIP tabs are shorter: a smaller window shows them bigger (phones) */
const H_SHORT: Partial<Record<Tab, number>> = { gemas: 436, vip: 446 };
/** prices shown if the price list could not be loaded (the server checks the real price anyway) */
const FALLBACK: Record<string, { kind: string; price: number; title: string }> = {
  pass_premium: { kind: "pass", price: 19.9, title: "Passe de Temporada Premium" },
  vip_1: { kind: "vip", price: 10, title: "VIP 1 (30 dias)" }, vip_3: { kind: "vip", price: 25, title: "VIP 3 (30 dias)" },
  vip_7: { kind: "vip", price: 60, title: "VIP 7 (30 dias)" },
};
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
  /** real-money purchase waiting for "go to Mercado Pago" */
  private payConfirm = "";
  private payMsg = "";
  private catalog: PayCatalog | null = null;
  private vipInfo: VipInfo | null = null;

  constructor(private scene: Phaser.Scene, private send: (m: Record<string, unknown>) => void) {}

  private get H(): number {
    return H_SHORT[this.tab] ?? H_FULL;
  }

  /** A real-money product: from the server's price list, or the shown price while it loads. */
  private product(id: string): { kind: string; price: number; title: string } | undefined {
    const p = this.catalog?.products[id];
    if (p) return p;
    const pack = META.shop?.packs.find((x) => x.id === id);
    return pack ? { kind: "gems", price: pack.price, title: `${fmtBig(pack.gems)} Gemas` } : FALLBACK[id];
  }

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
    this.payConfirm = this.payMsg = "";
    this.draw();
    void this.loadPay();
  }

  /** Prices and whether purchases are open, and the account's VIP (asked each time the shop opens). */
  private async loadPay(): Promise<void> {
    try {
      // separately: a VIP lookup that fails must not hide the prices
      const [cat, v] = await Promise.allSettled([
        fetch(`${API}/pay/catalog`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${API}/pay/vip`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (cat.status === "fulfilled" && cat.value) this.catalog = cat.value;
      if (v.status === "fulfilled") this.vipInfo = v.value;
      if (this.root) this.draw();
    } catch { /* the shop still works with gems */ }
  }

  /** Sends the player to Mercado Pago to pay (Pix or card); they come back to the game when done. */
  private async buyReal(product: string): Promise<void> {
    const charId = (this.scene.scene.get("GameScene") as unknown as { charId: string }).charId;
    this.payMsg = "Abrindo o Mercado Pago…";
    this.draw();
    try {
      const r = await fetch(`${API}/pay/checkout`, {
        method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ product, character_id: charId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.url) throw new Error(typeof data.detail === "string" ? data.detail : "Não foi possível abrir o pagamento.");
      window.location.href = data.url;
    } catch (e) {
      this.payConfirm = "";
      this.payMsg = e instanceof Error ? e.message : "Não foi possível abrir o pagamento.";
      if (this.root) this.draw();
    }
  }

  /** A price button for a real-money product; the first tap asks to confirm. */
  private payButton(objs: Obj[], x: number, y: number, product: string, w: number): void {
    const p = this.product(product);
    // closed only when the server says so; while the price list loads, the price shows (the server checks the purchase)
    if (!p || this.catalog?.enabled === false) {
      objs.push(this.scene.add.text(x, y, "Em breve", txt(11, "#6a7a8a", { fontStyle: "bold", backgroundColor: "#121820", padding: { x: 12, y: 5 } })).setOrigin(0.5, 0));
      return;
    }
    const b = this.scene.add.text(x, y, brl(p.price), txt(13, "#fff1c4", {
      fontStyle: "bold", backgroundColor: "#2e5a1e", padding: { x: 12, y: 6 }, fixedWidth: w, align: "center",
    })).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    b.on("pointerover", () => b.setBackgroundColor("#3c7426")).on("pointerout", () => b.setBackgroundColor("#2e5a1e"));
    b.on("pointerdown", () => { this.payConfirm = product; this.payMsg = ""; this.draw(); });
    objs.push(b);
  }

  /** "You are going to Mercado Pago" box over the shop. */
  private drawPayConfirm(objs: Obj[]): void {
    const p = this.product(this.payConfirm);
    if (!p) return;
    const hero = this.hero?.name ?? "seu herói";
    const g = this.scene.add.graphics();
    g.fillStyle(0x000000, 0.7).fillRect(-W / 2, -this.H / 2, W, this.H);
    panel(g, -230, -110, 460, 220, 12, 0.99);
    objs.push(this.scene.add.zone(-W / 2, -this.H / 2, W, this.H).setOrigin(0).setInteractive(), g);
    const who = p.kind === "vip" ? "Vale para todos os heróis da sua conta por 30 dias." : `Vai para o herói ${hero}.`;
    objs.push(this.scene.add.text(0, -92, p.title, txt(17, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5, 0),
      this.scene.add.text(0, -62, `${brl(p.price)} · Pix ou cartão`, txt(14, "#9dff8a", { fontStyle: "bold" })).setOrigin(0.5, 0),
      this.scene.add.text(0, -32, `${who}\nVocê vai para a página segura do Mercado Pago e volta ao jogo quando terminar.`,
        txt(11, "#e8dcc0", { align: "center", wordWrap: { width: 420 }, lineSpacing: 4 })).setOrigin(0.5, 0));
    const go = this.scene.add.text(70, 60, "Ir para o pagamento", txt(13, "#fff1c4", { fontStyle: "bold", backgroundColor: "#2e5a1e", padding: { x: 14, y: 8 } }))
      .setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    go.on("pointerdown", () => void this.buyReal(this.payConfirm));
    const no = this.scene.add.text(-110, 60, "Cancelar", txt(13, "#c8bca0", { backgroundColor: "#1a140c", padding: { x: 14, y: 8 } }))
      .setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    no.on("pointerdown", () => { this.payConfirm = ""; this.draw(); });
    objs.push(go, no);
  }

  close(): void {
    this.root?.destroy();
    this.root = undefined;
  }

  /** Same rule as the server (shop.owned): each look by its own list; boosts, pass levels and quest skips can be
   *  bought again. (Before, every offer that was not an aura or a title showed as owned once the pass was Premium.) */
  private owned(o: ShopOffer): boolean {
    const c = this.hero?.cosmetics;
    const ref = o.ref ?? "";
    switch (o.kind) {
      case "aura": return !!c?.auras.includes(ref);
      case "title": return !!c?.titles.includes(ref);
      case "pet": return !!c?.pets?.includes(ref);
      case "mount": return !!c?.mounts?.includes(ref);
      case "skin": return !!c?.skins?.includes(ref);
      case "premium_pass": return !!this.season?.premium;
      default: return false;
    }
  }

  /** Pictures arrive one by one: redraw once for a burst of them, not once per picture. */
  private redrawTimer?: Phaser.Time.TimerEvent;
  private redrawSoon(): void {
    if (this.redrawTimer) return;
    this.redrawTimer = this.scene.time.delayedCall(120, () => { this.redrawTimer = undefined; if (this.root) this.draw(); });
  }

  private draw(): void {
    this.root?.destroy();
    const shop = META.shop;
    const gems = this.hero?.gems ?? 0;
    const objs: Obj[] = [];
    const g = this.scene.add.graphics();
    panel(g, -W / 2, -this.H / 2, W, this.H, 12, 0.97);
    objs.push(this.scene.add.zone(-W / 2, -this.H / 2, W, this.H).setOrigin(0).setInteractive(), g);
    const close = this.scene.add.text(W / 2 - 16, -this.H / 2 + 10, "✕", txt(16, "#e8dcc0")).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => this.close());
    objs.push(close,
      this.scene.add.text(0, -this.H / 2 + 12, "LOJA DE RAVENCREST", txt(16, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5, 0),
      this.scene.add.text(0, -this.H / 2 + 34, "Visual e tempo: nada aqui deixa seu herói mais forte.", txt(10, "#9dd8a0")).setOrigin(0.5, 0));
    // balance
    objs.push(this.scene.add.image(-W / 2 + 34, -this.H / 2 + 26, "item_gem").setScale(0.55),
      this.scene.add.text(-W / 2 + 50, -this.H / 2 + 18, `${fmtBig(gems)}`, txt(15, "#8ad8ff", { fontStyle: "bold" })),
      this.scene.add.text(-W / 2 + 50, -this.H / 2 + 36, shop?.currency ?? "Gemas", txt(9, "#a8987a")));
    // tabs
    const tabs: [Tab, string][] = [["destaques", "Destaques"], ["visuais", "Visuais"], ["skins", "Skins"], ["mascotes", "Mascotes"], ["montarias", "Montarias"],
      ["bonus", "Bônus"], ["passe", "Passe/Missões"], ["embreve", "Em breve"], ["gemas", "◆ Gemas"], ["vip", "★ VIP"]];
    tabs.forEach(([id, label], i) => {
      const on = this.tab === id;
      const tw = (W - 24) / tabs.length;
      const t = this.scene.add.text(-W / 2 + 12 + i * tw, -this.H / 2 + 62, label, txt(9, on ? "#ffd77a" : id === "vip" || id === "gemas" ? "#ffcf6a" : "#a8987a", {
        backgroundColor: on ? "#2e2414" : "#15110c", padding: { x: 2, y: 5 }, fontStyle: on ? "bold" : "normal", fixedWidth: tw - 2, align: "center",
      })).setInteractive({ useHandCursor: true });
      t.on("pointerdown", () => { this.tab = id; this.page = 0; this.confirm = ""; this.draw(); });
      objs.push(t);
    });
    const top = -this.H / 2 + 100;
    if (!shop) {
      objs.push(this.scene.add.text(0, 0, "Carregando a loja…", txt(12, "#a8987a")).setOrigin(0.5));
    } else if (this.tab === "gemas") {
      this.drawPacks(objs, top);
    } else if (this.tab === "vip") {
      this.drawVip(objs, top);
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
    if (this.payMsg) objs.push(this.scene.add.text(0, this.H / 2 - 26, this.payMsg, txt(11, "#ffd77a", { align: "center" })).setOrigin(0.5, 0));
    if (this.payConfirm) this.drawPayConfirm(objs);
    const s = this.scene.scale;
    this.root = this.scene.add.container(s.width / 2, s.height / 2, objs).setDepth(82)
      .setScale(Math.min(1, (s.width - 16) / W, (s.height - (isTouch() ? 12 : 100)) / this.H));
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
    } else if (o.kind === "skin" || o.kind === "pet" || o.kind === "mount") {
      // a still picture: one frame of the idle sheet (the player's own hero for skins, recoloured when it is a colour
      // skin); only that image is downloaded, never the walking or fighting animations
      const cls = (this.hero?.cls ?? "blade_master");
      let key = "", grade: Grade | undefined, as: string | undefined, tall = 54;
      if (o.kind === "skin") {
        const def = META.skins?.find((s) => s.id === o.ref);
        key = def?.sheet ? `${def.sheet}_${cls}` : `unit_${cls}`;
        grade = def?.sheet ? undefined : def?.grade;
        as = `${key}~${o.ref}`;
        tall = 62;
      } else {
        key = (o.kind === "pet" ? META.pets : META.mounts)?.find((p) => p.id === o.ref)?.sheet ?? "";
      }
      const stage = this.scene.add.graphics();
      stage.fillStyle(0x2a2238, 0.6).fillEllipse(cx, y + 66, 92, 18);
      objs.push(stage);
      const tex = `thumb:${as ?? key}`;
      const info = SHEETS[key];
      if (info && this.scene.textures.exists(tex)) {
        objs.push(this.scene.add.image(cx, y + 66, tex).setOrigin(0.5, info.originY)
          // about 54 px tall (heroes 62), but never wider than the card (the dragons have long tails)
          .setScale(Math.min(info.scale * 1.6, tall / (info.height * (44 / info.scale)), (CARD_W * 1.05) / info.size)));
      } else {
        objs.push(this.scene.add.image(cx, y + 40, "item_paw").setScale(1));
        if (info) {
          const tab = this.tab;
          void shopThumb(this.scene, key, grade, as).then((k) => { if (k && this.root && this.tab === tab) this.redrawSoon(); });
        }
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

  /** Gem packs for real money, and the Premium pass for money. */
  private drawPacks(objs: Obj[], top: number): void {
    const packs = META.shop?.packs ?? [];
    const w = 124, gap = 12, rowW = packs.length * w + (packs.length - 1) * gap;
    packs.forEach((p, i) => {
      const x = -rowW / 2 + i * (w + gap), y = top + 6;
      const g = this.scene.add.graphics();
      g.fillStyle(0x0e1420, 0.97).fillRoundedRect(x, y, w, 186, 8).lineStyle(i === 2 ? 2 : 1, i === 2 ? 0xd6aa5a : 0x3a5a7a, 1).strokeRoundedRect(x, y, w, 186, 8);
      objs.push(g);
      const n = Math.min(i, 4);
      for (let k = 0; k <= n; k++) objs.push(this.scene.add.image(x + w / 2 - (n * 9) / 2 + k * 9, y + 46 - k * 4, "item_gem").setScale(0.85 + i * 0.07));
      objs.push(this.scene.add.text(x + w / 2, y + 88, `${fmtBig(p.gems)}`, txt(17, "#8ad8ff", { fontStyle: "bold" })).setOrigin(0.5, 0),
        this.scene.add.text(x + w / 2, y + 110, "gemas", txt(10, "#8ad8ff")).setOrigin(0.5, 0));
      if (p.bonus) objs.push(this.scene.add.text(x + w / 2, y + 126, `inclui +${fmtBig(p.bonus)} de bônus`, txt(9, "#ffd77a")).setOrigin(0.5, 0));
      if (i === 2) objs.push(this.scene.add.text(x + w / 2, y - 9, "MAIS VENDIDO", txt(9, "#1a1206", { fontStyle: "bold", backgroundColor: "#ffd77a", padding: { x: 6, y: 2 } })).setOrigin(0.5, 0));
      this.payButton(objs, x + w / 2, y + 148, p.id, w - 20);
    });
    // the Premium pass, also for money
    const py = top + 214;
    const g = this.scene.add.graphics();
    g.fillStyle(0x1e160a, 0.97).fillRoundedRect(-rowW / 2, py, rowW, 70, 8).lineStyle(2, 0xd6aa5a, 1).strokeRoundedRect(-rowW / 2, py, rowW, 70, 8);
    objs.push(g, this.scene.add.image(-rowW / 2 + 40, py + 35, "item_shop_pass").setScale(0.9),
      this.scene.add.text(-rowW / 2 + 76, py + 14, "PASSE DE TEMPORADA PREMIUM", txt(13, "#ffd77a", { fontStyle: "bold" })),
      this.scene.add.text(-rowW / 2 + 76, py + 36, "Libera a trilha Premium: títulos e auras exclusivos.\nTambém dá para comprar com 950 gemas na aba Destaques.",
        txt(9, "#e8dcc0", { lineSpacing: 2 })));
    if (this.season?.premium) objs.push(this.scene.add.text(rowW / 2 - 80, py + 26, "✔ Ativo", txt(13, "#7aff7a", { fontStyle: "bold" })).setOrigin(0.5, 0));
    else this.payButton(objs, rowW / 2 - 80, py + 20, "pass_premium", 130);
    objs.push(this.scene.add.text(0, py + 82, "Pagamento seguro pelo Mercado Pago: Pix ou cartão. As gemas compram só visuais e tempo — nunca força.",
      txt(9, "#a8987a", { align: "center" })).setOrigin(0.5, 0));
  }

  /** VIP: 3 ways in (1, 3, 7), 30 days, up one level each renewal; only comfort and looks. */
  private drawVip(objs: Obj[], top: number): void {
    const v = this.vipInfo;
    const status = v && v.level > 0 ? `Você é VIP ${v.level} · faltam ${v.days_left} dia(s). Renovando agora, sobe para VIP ${Math.min(7, v.level + 1)}.`
      : v && v.last_level > 0 ? `Seu VIP ${v.last_level} acabou. Compre de novo para voltar.` : "Você ainda não é VIP.";
    objs.push(this.scene.add.text(0, top - 4, status, txt(12, v && v.level > 0 ? "#9dff8a" : "#e8dcc0", { fontStyle: "bold" })).setOrigin(0.5, 0));
    const tiers: [string, number, number][] = [["vip_1", 1, 0x8a6a30], ["vip_3", 3, 0xd6aa5a], ["vip_7", 7, 0xff7a18]];
    const auraOf: Record<number, string> = { 3: "Aura VIP Dourada", 5: "Aura VIP Real", 7: "Aura VIP Suprema" };
    const w = 206, gap = 16, rowW = 3 * w + 2 * gap;
    tiers.forEach(([id, lv, color], i) => {
      const x = -rowW / 2 + i * (w + gap), y = top + 24;
      const g = this.scene.add.graphics();
      g.fillStyle(0x1a1208, 0.97).fillRoundedRect(x, y, w, 270, 10).lineStyle(lv === 7 ? 3 : 2, color, 1).strokeRoundedRect(x, y, w, 270, 10);
      objs.push(g);
      const glow = this.scene.add.image(x + w / 2, y + 36, "glow_gold").setBlendMode(Phaser.BlendModes.ADD).setScale(2.2, 1).setAlpha(0.3 + lv * 0.05);
      objs.push(glow, this.scene.add.text(x + w / 2, y + 16, `VIP ${lv}`, txt(28, lv === 7 ? "#ffb070" : "#ffd77a", { fontStyle: "bold", strokeThickness: 4 })).setOrigin(0.5, 0));
      this.scene.tweens.add({ targets: glow, alpha: { from: 0.2, to: 0.5 }, duration: 1400 + i * 200, yoyo: true, repeat: -1 });
      const auras = [3, 5, 7].filter((n) => lv >= n).map((n) => auraOf[n]);
      const lines = [`+${lv * 5}% de EXP e ouro`, `${lv * 10} gemas por dia`, `+${lv * 10} espaços na bolsa`, `Título «VIP ${lv}»`, ...auras];
      objs.push(this.scene.add.text(x + 16, y + 62, lines.map((l) => `✦ ${l}`).join("\n"), txt(10, "#f3e3b8", { lineSpacing: 3 })));
      objs.push(this.scene.add.text(x + w / 2, y + 196, "30 dias · todos os seus heróis", txt(9, "#a8987a")).setOrigin(0.5, 0));
      this.payButton(objs, x + w / 2, y + 222, id, w - 30);
    });
    objs.push(this.scene.add.text(0, top + 304, "Renovando antes de acabar, seu VIP sobe 1 nível (até VIP 7). Benefícios só de conforto e visual — nenhum dá força.",
      txt(9, "#a8987a", { align: "center" })).setOrigin(0.5, 0));
  }
}

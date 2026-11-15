/**
 * Inventory window (equipment + bag) and, next to it, either the shop of the NPC the hero is talking to
 * or the smith's forge (craft stones, upgrade +0→+15, refine). Every change goes to the server and the
 * window is redrawn from the `inventory` message it sends back — the client never edits the inventory.
 */
import Phaser from "phaser";
import { isTouch } from "../ui/device";
import {
  CLASS_INFO, META, PERCENT_STATS, SLOT_NAMES, critText, fmtBig, pieceName, pieceStats, refLines, statLines,
  type BagEntry, type GearPiece, type GearSlot, type HeroState, type InventoryState, type ShopMsg,
} from "../data/meta";
import { SHEETS, animKey } from "../gfx/sprites3d";
import { PricePrompt } from "./PricePrompt";
import { panel, txt } from "./uiStyle";

type Action = Record<string, unknown>;
type Obj = Phaser.GameObjects.GameObject;
type Piece = { id: string; qty?: number; plus?: number; ref?: Record<string, number>; ench?: string };
type Sel = { where: "bag"; ref: number; id: string } | { where: "gear"; ref: GearSlot; id: string };
type ForgeTab = "stones" | "upgrade" | "refine" | "enchant";
interface MenuOption { label: string; color?: string; run: () => void; keepOpen?: boolean }
interface MarketRow { id: number; seller: string; item: Piece & { qty: number }; price: number; left: number }
export interface MarketMsg {
  cat: string;
  sort: "price" | "new";
  page: number;
  pages: number;
  rows: MarketRow[];
  mine: MarketRow[];
  box: { gold: number; items: Piece[] };
  fee: number;
  tax: number;
  max: number;
  categories: Record<string, string>;
}

const CELL = 46;
const STRIDE = 50;
const COLS = 6;
const INV_W = 640;
const H = 420;
const SLOT = 52;          // equipment slot size
const BAG_CELL = 48;
const BAG_STRIDE = 53;
const BAG_PAGE = 30;      // slots per bag page (6 × 5)
const SHOP_W = 252;
const FORGE_W = 312;
const MARKET_W = 384;
const SHOP_STRIDE = 56;
const GAP = 10;
const LEFT_SLOTS: GearSlot[] = ["weapon", "armor", "legs"];
const RIGHT_SLOTS: GearSlot[] = ["necklace", "ring", "boots"];
/** Faded icon shown in an empty slot, by class (weapon and clothes follow the class style). */
const KIND: Record<string, { weapon: string; cloth: string; glow: number }> = {
  blade_master: { weapon: "sword", cloth: "plate", glow: 0xff5a4a },
  grand_sorcerer: { weapon: "staff", cloth: "robe", glow: 0x5ac8ff },
  night_ranger: { weapon: "bow", cloth: "leather", glow: 0x7aff8a },
};
const RARITY_ORDER = ["comum", "incomum", "raro", "epico", "lendario"];
const TYPE_NAMES: Record<string, string> = { potion: "Poção", material: "Material", tool: "Ferramenta" };
const STONES = ["stone_up_1", "stone_up_2", "stone_up_3", "stone_protect", "stone_refine", "stone_enchant"];

const hexOf = (c: string): number => parseInt(c.slice(1), 16);
// same rules as server/forge.py (the server decides; these only explain the costs on screen)
const stoneFor = (target: number): string => (target <= 5 ? "stone_up_1" : target <= 10 ? "stone_up_2" : "stone_up_3");
const upFee = (target: number): number => 100 * target;
const refineFee = (tier: number): number => 400 * Math.max(1, tier);
const failRule = (target: number): string => (target <= 5 ? "Se falhar: o item não perde nível."
  : target <= 10 ? "Se falhar: o item cai 1 nível." : "Se falhar: o item volta para +10.");

export class InventoryUI {
  private root?: Phaser.GameObjects.Container;
  private menu?: Phaser.GameObjects.Container;
  private tip?: Phaser.GameObjects.Container;
  private inv: InventoryState | null = null;
  private hero: HeroState | null = null;
  private shop: ShopMsg | null = null;
  private forge: { name: string } | null = null;
  private market: MarketMsg | null = null;
  private marketTab: "buy" | "mine" = "buy";
  private forgeTab: ForgeTab = "stones";
  private sel: Sel | null = null;
  /** which page of the bag is shown (BAG_PAGE slots each) */
  private bagPage = 0;
  private protect = false;
  /** element picked in the forge's Encantar tab */
  private enchantEl = "fire";
  private lastResult: { ok: boolean; text: string } | null = null;
  private visible = false;
  private heroSig = "";

  constructor(private scene: Phaser.Scene, private send: (a: Action) => void, private cls: string) {}

  get isOpen(): boolean {
    return this.visible;
  }

  get inMarket(): boolean {
    return this.visible && this.market !== null;
  }

  setInventory(inv: InventoryState): void {
    this.inv = inv;
    if (!inv.shop) { this.shop = null; this.forge = null; this.market = null; } // the server closed it (e.g. map change)
    if (this.sel && !this.selected()) this.sel = null;    // the selected piece moved or is gone
    if (this.visible) this.redraw();
  }

  setHero(h: HeroState): void {
    this.hero = h;
    // hero updates arrive on every skill use; only redraw when what the window shows changed
    const sig = [h.level, h.atk, h.def, h.max_hp, h.max_mp, h.crit, h.crit_dmg, h.gold, h.gems].join("|");
    if (sig !== this.heroSig) {
      this.heroSig = sig;
      if (this.visible) this.redraw();
    }
  }

  openShop(msg: ShopMsg): void {
    this.shop = msg;
    this.forge = null;
    this.visible = true;
    this.redraw();
  }

  openForge(msg: { name: string }): void {
    this.forge = msg;
    this.shop = null;
    this.lastResult = null;
    this.visible = true;
    this.redraw();
  }

  openMarket(msg: MarketMsg): void {
    if (!this.market) this.marketTab = "buy";
    this.market = msg;
    this.shop = null;
    this.forge = null;
    this.visible = true;
    this.redraw();
  }

  forgeResult(r: { ok: boolean; text: string }): void {
    this.lastResult = r;
    if (this.visible) this.redraw();
  }

  toggle(): void {
    if (this.visible) this.close();
    else {
      this.visible = true;
      this.redraw();
    }
  }

  close(): void {
    if (this.shop || this.forge || this.market) this.send({ type: "close_shop" });
    this.shop = null;
    this.forge = null;
    this.market = null;
    this.sel = null;
    this.visible = false;
    this.clear();
  }

  private sideWidth(): number {
    return this.shop ? SHOP_W + GAP : this.forge ? FORGE_W + GAP : this.market ? MARKET_W + GAP : 0;
  }

  layout(): void {
    if (!this.root) return;
    const w = this.scene.scale.width, h = this.scene.scale.height;
    const total = INV_W + this.sideWidth();
    this.root.setPosition(w / 2, h / 2 - 10).setScale(Math.min(1, (w - 16) / total, (h - (isTouch() ? 12 : 120)) / H));
  }

  /** The piece the forge is working on, if it is still where it was selected. */
  private selected(): Piece | null {
    const s = this.sel, inv = this.inv;
    if (!s || !inv) return null;
    const p = s.where === "bag" ? inv.bag[s.ref] : inv.gear[s.ref];
    return p && p.id === s.id ? p : null;
  }

  private count(id: string): number {
    return (this.inv?.bag ?? []).filter((e) => e.id === id).reduce((a, e) => a + e.qty, 0);
  }

  // ── drawing ──────────────────────────────────────────────────────────

  private clear(): void {
    this.root?.destroy();
    this.root = undefined;
    this.closeMenu();
    this.hideTip();
  }

  private redraw(): void {
    this.clear();
    if (!this.visible || !this.inv) return;
    const total = INV_W + this.sideWidth();
    const objs: Obj[] = [];
    let x = -total / 2;
    if (this.shop) {
      this.drawShop(objs, x, -H / 2, this.shop);
      x += SHOP_W + GAP;
    } else if (this.forge) {
      this.drawForge(objs, x, -H / 2, this.forge);
      x += FORGE_W + GAP;
    } else if (this.market) {
      this.drawMarket(objs, x, -H / 2, this.market);
      x += MARKET_W + GAP;
    }
    this.drawInventory(objs, x, -H / 2, this.inv);
    this.root = this.scene.add.container(0, 0, objs).setDepth(82);
    this.layout();
  }

  private frame(objs: Obj[], x: number, y: number, w: number, h: number, title: string, onClose: () => void): void {
    const g = this.scene.add.graphics();
    panel(g, x, y, w, h, 12, 0.96);
    // swallow clicks so they never reach the world under the window
    const blocker = this.scene.add.zone(x, y, w, h).setOrigin(0).setInteractive();
    blocker.on("pointerdown", () => this.closeMenu());
    objs.push(blocker, g, this.scene.add.text(x + w / 2, y + 12, title, txt(15, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5, 0));
    const close = this.scene.add.text(x + w - 18, y + 10, "✕", txt(16, "#e8dcc0")).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    close.on("pointerdown", onClose);
    objs.push(close);
  }

  private cell(objs: Obj[], x: number, y: number, p: Piece | undefined, onClick: (ptr: Phaser.Input.Pointer) => void,
               extra?: () => string[], selected = false, size = CELL): void {
    const def = p ? META.items[p.id] : undefined;
    const g = this.scene.add.graphics();
    g.fillStyle(0x15111c, 0.95).fillRoundedRect(x, y, size, size, 5);
    const border = def ? hexOf(META.rarity[def.rarity]?.color ?? "#6b5226") : 0x3a3020;
    g.lineStyle(def ? 2 : 1, border, def ? 0.9 : 1).strokeRoundedRect(x, y, size, size, 5);
    objs.push(g);
    if (!def || !p) return;
    if (def.rarity !== "comum") g.fillStyle(border, 0.12).fillRoundedRect(x + 2, y + 2, size - 4, size - 4, 4);
    if (selected) g.lineStyle(3, 0xffd77a, 1).strokeRoundedRect(x - 2, y - 2, size + 4, size + 4, 6);
    objs.push(this.scene.add.image(x + size / 2, y + size / 2, `item_${def.icon}`).setScale((size - 6) / 48));
    if ((p.qty ?? 1) > 1) objs.push(this.scene.add.text(x + size - 3, y + size - 2, `${p.qty}`, txt(10, "#ffffff", { fontStyle: "bold" })).setOrigin(1, 1));
    if (p.plus) objs.push(this.scene.add.text(x + 3, y + 1, `+${p.plus}`, txt(10, p.plus >= 10 ? "#ffa040" : "#ffd77a", { fontStyle: "bold" })));
    if (p.ref && Object.keys(p.ref).length) objs.push(this.scene.add.text(x + size - 3, y + 1, "✦", txt(9, "#c08cff")).setOrigin(1, 0));
    const hover = this.scene.add.graphics().setVisible(false);
    hover.lineStyle(2, 0xffe9a8, 0.9).strokeRoundedRect(x - 1, y - 1, size + 2, size + 2, 6);
    hover.fillStyle(0xffe9a8, 0.08).fillRoundedRect(x, y, size, size, 5);
    objs.push(hover);
    const zone = this.scene.add.zone(x, y, size, size).setOrigin(0).setInteractive({ useHandCursor: true });
    zone.on("pointerover", (ptr: Phaser.Input.Pointer) => { hover.setVisible(true); this.showTip(p, ptr, extra?.() ?? []); });
    zone.on("pointermove", (ptr: Phaser.Input.Pointer) => this.moveTip(ptr));
    zone.on("pointerout", () => { hover.setVisible(false); this.hideTip(); });
    zone.on("pointerdown", (ptr: Phaser.Input.Pointer) => { this.hideTip(); onClick(ptr); });
    objs.push(zone);
  }

  private button(objs: Obj[], x: number, y: number, label: string, enabled: boolean, run: () => void, color = "#9dff8a"): Phaser.GameObjects.Text {
    const b = this.scene.add.text(x, y, label, txt(11, enabled ? color : "#6a6050", {
      backgroundColor: enabled ? "#1e1a10" : "#141210", padding: { x: 8, y: 3 }, fontStyle: "bold",
    }));
    if (enabled) {
      b.setInteractive({ useHandCursor: true });
      b.on("pointerover", () => b.setBackgroundColor("#3a2e18")).on("pointerout", () => b.setBackgroundColor("#1e1a10"));
      b.on("pointerdown", run);
    }
    objs.push(b);
    return b;
  }

  private drawInventory(objs: Obj[], px: number, py: number, inv: InventoryState): void {
    this.frame(objs, px, py, INV_W, H, "INVENTÁRIO", () => this.close());
    const goldText = this.scene.add.text(px + 18, py + 14, `◆ ${fmtBig(inv.gold)} ouro`, txt(12, "#ffd77a", { fontStyle: "bold" }));
    objs.push(goldText,
      this.scene.add.image(px + 30 + goldText.width, py + 21, "item_gem").setScale(0.3),
      this.scene.add.text(px + 40 + goldText.width, py + 14, `${fmtBig(this.hero?.gems ?? 0)} gemas`, txt(12, "#8ad8ff", { fontStyle: "bold" })));
    this.drawDoll(objs, px + 16, py + 44, 272, 238, inv);
    this.drawStats(objs, px + 16, py + 290, 272, H - 290 - 36);

    // bag grid
    const gx = px + 304, gy = py + 44;
    const slots = inv.cap ?? META.bag_slots ?? 30;
    const pages = Math.max(1, Math.ceil(slots / BAG_PAGE));
    this.bagPage = Math.min(this.bagPage, pages - 1);
    const selling = !!(this.shop || this.forge);
    objs.push(this.scene.add.text(gx, gy, "BOLSA", txt(11, "#d6b878", { fontStyle: "bold" })));
    objs.push(this.scene.add.text(gx + 6 * BAG_STRIDE - 5, gy, `${inv.bag.length}/${slots}`,
      txt(11, inv.bag.length >= slots ? "#ff7a6a" : "#a8987a")).setOrigin(1, 0));
    // page tabs: a dot marks pages holding a better piece
    for (let pg = 0; pg < pages && pages > 1; pg++) {
      const on = pg === this.bagPage;
      const upgrade = inv.bag.slice(pg * BAG_PAGE, (pg + 1) * BAG_PAGE).some((e) => this.isUpgrade(e));
      const used = inv.bag.length > pg * BAG_PAGE;
      const tab = this.scene.add.text(gx + 52 + pg * 40, gy - 2, `${pg + 1}${upgrade ? " ▲" : ""}`, txt(10, on ? "#ffd77a" : used ? "#c8bca0" : "#6a6050", {
        backgroundColor: on ? "#3a2e18" : "#15110c", padding: { x: 6, y: 2 }, fontStyle: on ? "bold" : "normal", fixedWidth: 34, align: "center",
      })).setInteractive({ useHandCursor: true });
      if (upgrade && !on) tab.setColor("#7aff7a");
      tab.on("pointerdown", () => { this.bagPage = pg; this.redraw(); });
      objs.push(tab);
    }
    const first = this.bagPage * BAG_PAGE, last = Math.min(slots, first + BAG_PAGE);
    for (let i = first; i < last; i++) {
      const e: BagEntry | undefined = inv.bag[i];
      const k = i - first;
      const x = gx + (k % COLS) * BAG_STRIDE, y = gy + 20 + Math.floor(k / COLS) * BAG_STRIDE;
      const isSel = !!e && this.sel?.where === "bag" && this.sel.ref === i;
      this.cell(objs, x, y, e, (ptr) => e && this.openMenu(ptr, this.bagOptions(i, e)),
        () => (selling && e ? [`Vende por ${this.sellPrice(e)} ouro${e.qty > 1 ? " (cada)" : ""}`] : []), isSel, BAG_CELL);
      if (e && this.isUpgrade(e)) {
        // a piece better than what is worn in its slot
        objs.push(this.scene.add.text(x + BAG_CELL - 3, y + BAG_CELL - 2, "▲", txt(11, "#7aff7a", { fontStyle: "bold" })).setOrigin(1, 1));
      }
    }
    // rarity legend under the bag
    let lx = gx;
    const ly = gy + 20 + Math.ceil(BAG_PAGE / COLS) * BAG_STRIDE + 6;
    for (const r of RARITY_ORDER) {
      const info = META.rarity[r];
      if (!info) continue;
      const dot = this.scene.add.graphics();
      dot.fillStyle(hexOf(info.color), 1).fillCircle(lx + 5, ly + 7, 4);
      const label = this.scene.add.text(lx + 12, ly, info.name, txt(9, info.color));
      objs.push(dot, label);
      lx += label.width + 22;
    }
    objs.push(this.scene.add.text(gx, ly + 18, "▲ melhor do que o equipado", txt(9, "#7aff7a")));
    // one click wears the best piece of the bag in every slot (the server decides)
    const better = inv.bag.some((e) => this.isUpgrade(e));
    const auto = this.button(objs, gx + 6 * BAG_STRIDE - 5, ly + 14, "⚡ Equipar os melhores", better,
      () => this.send({ type: "auto_equip" }), "#7aff7a");
    auto.setOrigin(1, 0);
    const hint = this.market ? "Clique num item da bolsa para anunciar no mercado."
      : this.forge ? "Clique num equipamento para escolher o que a forja vai trabalhar."
      : this.shop ? "Clique num item da bolsa para vender. Q e E bebem poções." : "Clique num item para usar ou equipar. Q e E bebem poções.";
    objs.push(this.scene.add.text(px + INV_W / 2, py + H - 24, hint, txt(10, "#8a7c62")).setOrigin(0.5, 0));
  }

  /** The hero in the middle of a dark card, with the six equipment slots around. */
  private drawDoll(objs: Obj[], x: number, y: number, w: number, h: number, inv: InventoryState): void {
    const kind = KIND[this.cls] ?? KIND.blade_master;
    const g = this.scene.add.graphics();
    g.fillStyle(0x110d16, 0.96).fillRoundedRect(x, y, w, h, 8);
    g.lineStyle(1, 0x6b5226, 0.8).strokeRoundedRect(x, y, w, h, 8);
    const cx = x + w / 2, foot = y + h - 30;
    // a soft light and a rune circle under the hero, in the class colour
    g.fillStyle(kind.glow, 0.07).fillCircle(cx, y + h / 2, 70);
    g.lineStyle(1.5, kind.glow, 0.45).strokeEllipse(cx, foot, 116, 30);
    g.lineStyle(1, kind.glow, 0.25).strokeEllipse(cx, foot, 86, 20);
    objs.push(g);
    objs.push(this.scene.add.text(cx, y + 8, "EQUIPAMENTO", txt(11, "#d6b878", { fontStyle: "bold" })).setOrigin(0.5, 0));
    const fig = this.heroFigure(cx, foot, 150);
    if (fig) objs.push(fig);
    if (this.hero) {
      objs.push(this.scene.add.text(cx, foot + 10, `${this.hero.name} · Nv ${this.hero.level}`, txt(10, "#e8dcc0")).setOrigin(0.5, 0));
    }
    const top = y + 30, row = 68;
    LEFT_SLOTS.forEach((s, i) => this.gearSlot(objs, x + 12, top + i * row, s, inv, kind));
    RIGHT_SLOTS.forEach((s, i) => this.gearSlot(objs, x + w - 12 - SLOT, top + i * row, s, inv, kind));
  }

  private gearSlot(objs: Obj[], x: number, y: number, slot: GearSlot, inv: InventoryState,
                   kind: { weapon: string; cloth: string }): void {
    const p: GearPiece | undefined = inv.gear[slot];
    const def = p ? META.items[p.id] : undefined;
    if (p && def) {
      const isSel = this.sel?.where === "gear" && this.sel.ref === slot;
      this.cell(objs, x, y, p, (ptr) => this.openMenu(ptr, this.gearOptions(slot, p)), undefined, isSel, SLOT);
    } else {
      const g = this.scene.add.graphics();
      g.fillStyle(0x0d0a12, 0.95).fillRoundedRect(x, y, SLOT, SLOT, 6);
      g.lineStyle(1, 0x4a3c24, 1).strokeRoundedRect(x, y, SLOT, SLOT, 6);
      g.lineStyle(1, 0x2a2216, 1).strokeRoundedRect(x + 4, y + 4, SLOT - 8, SLOT - 8, 4);
      const ghost = { weapon: kind.weapon, armor: kind.cloth, legs: `legs_${kind.cloth}`, boots: `boots_${kind.cloth}`,
        ring: "ring", necklace: "amulet" }[slot];
      objs.push(g, this.scene.add.image(x + SLOT / 2, y + SLOT / 2, `item_${ghost}`).setScale((SLOT - 12) / 48)
        .setAlpha(0.2).setTint(0xa8987a));
    }
    objs.push(this.scene.add.text(x + SLOT / 2, y + SLOT + 2, SLOT_NAMES[slot],
      txt(9, def ? META.rarity[def.rarity].color : "#7a6c52")).setOrigin(0.5, 0));
  }

  /** The hero's own 3D figure breathing in the idle pose (or the portrait if the figure is not loaded). */
  private heroFigure(cx: number, foot: number, height: number): Phaser.GameObjects.GameObject | null {
    const key = `unit_${this.cls}`;
    const info = SHEETS[key];
    const tex = `${key}:idle`;
    if (info && this.scene.textures.exists(tex)) {
      const fig = this.scene.add.sprite(cx, foot, tex, 2 * info.anims.idle.frames).setOrigin(0.5, info.originY);
      fig.setScale(height / (info.height * (44 / info.scale)));
      const anim = animKey(key, "idle", 2);
      if (this.scene.anims.exists(anim)) fig.play(anim);
      return fig;
    }
    const tex2 = `portrait_${this.cls}`;
    return this.scene.textures.exists(tex2) ? this.scene.add.image(cx, foot - height / 2, tex2).setScale(1.6) : null;
  }

  /** Attack, defense, life, mana and the critical lines, in two columns. */
  private drawStats(objs: Obj[], x: number, y: number, w: number, h: number): void {
    const g = this.scene.add.graphics();
    g.fillStyle(0x110d16, 0.96).fillRoundedRect(x, y, w, h, 8);
    g.lineStyle(1, 0x6b5226, 0.8).strokeRoundedRect(x, y, w, h, 8);
    objs.push(g);
    const hero = this.hero;
    if (!hero) return;
    const crit = critText(hero).map((l) => l.replace(/ (\d[\d,]*%)$/, "|$1").split("|") as [string, string]);
    const rows: [string, string, string][] = [
      ["Ataque", fmtBig(Math.round(hero.atk)), "#ffb27a"], ["Defesa", fmtBig(hero.def), "#8ad8ff"],
      ["Vida", fmtBig(hero.max_hp), "#ff7a7a"], ["Mana", fmtBig(hero.max_mp), "#7aaaff"],
      ...crit.map(([k, v]) => [k.replace("Chance de crítico", "Crítico"), v ?? "", "#ffd77a"] as [string, string, string]),
    ];
    const colW = (w - 24) / 2;
    rows.forEach(([k, v, c], i) => {
      const cx = x + 12 + (i % 2) * colW, cy = y + 10 + Math.floor(i / 2) * 18;
      objs.push(this.scene.add.text(cx, cy, k, txt(10, "#a8987a")));
      objs.push(this.scene.add.text(cx + colW - 10, cy, v, txt(10, c, { fontStyle: "bold" })).setOrigin(1, 0));
    });
  }

  /** True when a bag piece fits this hero and beats the worn piece of its slot in total stat value. */
  private isUpgrade(e: BagEntry): boolean {
    const def = META.items[e.id];
    if (!def || def.type !== "gear" || !def.slot) return false;
    if (def.cls?.length && !def.cls.includes(this.cls)) return false;
    if ((def.lvl ?? 1) > (this.hero?.level ?? 1)) return false;
    const worn = this.inv?.gear[def.slot];
    if (!worn || !META.items[worn.id]) return true;
    return this.score(e) > this.score(worn) + 1e-6;
  }

  /** Same score as the server's auto-equip (server/items.py piece_score). */
  private score(p: Piece): number {
    const w = META.score_weights ?? {};
    const stats = Object.entries(pieceStats(p)).reduce((a, [k, v]) => a + (w[k] ?? (PERCENT_STATS.has(k) ? 300 : 1)) * v, 0);
    return stats + Object.values(p.ref ?? {}).reduce((a, v) => a + (META.ref_weight ?? 300) * v, 0);
  }

  private sellPrice(e: Piece): number {
    return Math.floor(META.items[e.id].sell * (1 + 0.25 * (e.plus ?? 0)));
  }

  private drawShop(objs: Obj[], px: number, py: number, shop: ShopMsg): void {
    this.frame(objs, px, py, SHOP_W, H, shop.name.split(",")[0].toUpperCase(), () => this.close());
    objs.push(this.scene.add.text(px + SHOP_W / 2, py + 34, "Clique num item para comprar", txt(10, "#a8987a")).setOrigin(0.5, 0));
    const gold = this.inv?.gold ?? 0;
    shop.items.forEach((id, i) => {
      const def = META.items[id];
      if (!def) return;
      const x = px + 16 + (i % 4) * SHOP_STRIDE, y = py + 56 + Math.floor(i / 4) * (SHOP_STRIDE + 12);
      const opts: MenuOption[] = [{ label: `Comprar (${def.price} ouro)`, run: () => this.send({ type: "buy", item: id, qty: 1 }) }];
      if (def.type === "potion") opts.push({ label: `Comprar 5 (${(def.price ?? 0) * 5} ouro)`, run: () => this.send({ type: "buy", item: id, qty: 5 }) });
      this.cell(objs, x, y, { id }, (p) => this.openMenu(p, opts), () => [`Preço: ${def.price} ouro`]);
      objs.push(this.scene.add.text(x + CELL / 2, y + CELL + 1, `${def.price}`,
        txt(9, (def.price ?? 0) <= gold ? "#ffd77a" : "#a05050")).setOrigin(0.5, 0));
    });
  }

  // ── forge ────────────────────────────────────────────────────────────

  private drawForge(objs: Obj[], px: number, py: number, f: { name: string }): void {
    this.frame(objs, px, py, FORGE_W, H, `FORJA — ${f.name.split(",")[0].toUpperCase()}`, () => this.close());
    const tabs: [ForgeTab, string][] = [["stones", "Pedras"], ["upgrade", "Aprimorar"], ["refine", "Refinar"], ["enchant", "Encantar"]];
    tabs.forEach(([id, label], i) => {
      const on = this.forgeTab === id;
      const t = this.scene.add.text(px + 14 + i * 74, py + 38, label, txt(10, on ? "#ffd77a" : "#a8987a", {
        backgroundColor: on ? "#2e2414" : "#15110c", padding: { x: 4, y: 4 }, fontStyle: on ? "bold" : "normal", fixedWidth: 70, align: "center",
      })).setInteractive({ useHandCursor: true });
      t.on("pointerdown", () => { this.forgeTab = id; this.lastResult = null; this.redraw(); });
      objs.push(t);
    });
    const top = py + 70;
    if (this.forgeTab === "stones") this.drawStones(objs, px, top);
    else this.drawWork(objs, px, top, this.forgeTab);
    if (this.lastResult) {
      objs.push(this.scene.add.text(px + FORGE_W / 2, py + H - 26, this.lastResult.text, txt(10, this.lastResult.ok ? "#9dff8a" : "#ff8a7a", {
        align: "center", wordWrap: { width: FORGE_W - 30 },
      })).setOrigin(0.5, 1));
    }
  }

  private drawStones(objs: Obj[], px: number, top: number): void {
    const gold = this.inv?.gold ?? 0;
    STONES.forEach((stone, i) => {
      const r = META.forge?.recipes[stone];
      if (!r) return;
      const y = top + i * 44;
      this.cell(objs, px + 14, y, { id: stone }, () => undefined, () => [], false, 40);
      objs.push(this.scene.add.text(px + 62, y, META.items[stone].name.replace(/^Pedra de /, ""),
        txt(10, META.rarity[META.items[stone].rarity].color, { fontStyle: "bold" })));
      let canMake = gold >= r.gold;
      const mats = Object.entries(r.mats).map(([m, n]) => {
        const have = this.count(m);
        if (have < n) canMake = false;
        return `${n}× ${META.items[m].name.replace("Minério de ", "")} (${have})`;
      });
      objs.push(this.scene.add.text(px + 62, y + 14, `${mats.join(" + ")}`, txt(9, "#c8bca0", { wordWrap: { width: 170 } })));
      objs.push(this.scene.add.text(px + 62, y + 28, `+ ${r.gold} ouro`, txt(9, gold >= r.gold ? "#ffd77a" : "#ff7a6a")));
      this.button(objs, px + FORGE_W - 92, y + 2, "Criar", canMake, () => this.send({ type: "forge_craft", stone, qty: 1 }));
      this.button(objs, px + FORGE_W - 92, y + 22, "Criar 5", canMake, () => this.send({ type: "forge_craft", stone, qty: 5 }), "#ffd77a");
    });
  }

  private drawWork(objs: Obj[], px: number, top: number, mode: "upgrade" | "refine" | "enchant"): void {
    const p = this.selected();
    if (!p || !this.sel) {
      objs.push(this.scene.add.text(px + FORGE_W / 2, top + 60, mode === "upgrade"
        ? "Escolha um equipamento\n(na bolsa ou equipado)\npara aprimorar de +0 até +15."
        : mode === "enchant" ? "Escolha uma arma\n(na bolsa ou equipada)\npara encantar com um elemento."
        : "Escolha um equipamento\n(na bolsa ou equipado)\npara receber bônus de refino.",
      txt(11, "#a8987a", { align: "center", lineSpacing: 6 })).setOrigin(0.5, 0));
      return;
    }
    const def = META.items[p.id];
    this.cell(objs, px + 16, top, p, () => undefined, undefined, true);
    objs.push(this.scene.add.text(px + 72, top + 2, pieceName(p), txt(12, META.rarity[def.rarity].color, { fontStyle: "bold", wordWrap: { width: 220 } })));
    objs.push(this.scene.add.text(px + 72, top + 22, this.sel.where === "gear" ? "Equipado" : "Na bolsa", txt(9, "#8a7c62")));
    const gold = this.inv?.gold ?? 0;
    const lines: [string, string][] = [];
    let can = false, run: () => void = () => undefined, label = "";
    if (mode === "upgrade") {
      const plus = p.plus ?? 0, max = META.forge?.max_plus ?? 15;
      if (plus >= max) {
        lines.push([`Este item já está no máximo (+${max}).`, "#ffd77a"]);
      } else {
        const target = plus + 1, stone = stoneFor(target), fee = upFee(target);
        const chance = Math.round((META.forge?.up_chance[target] ?? 0) * 100);
        const haveStone = this.count(stone), haveProt = this.count("stone_protect");
        const now = pieceStats(p), next = pieceStats({ id: p.id, plus: target });
        const gains = Object.keys(next).filter((k) => next[k] !== now[k]).map((k) =>
          statLines({ [k]: next[k] })[0].replace(/^\+/, "") + ` (antes ${PERCENT_STATS.has(k) ? `${Math.round(now[k] * 100)}%` : now[k]})`);
        lines.push([`Próximo nível: +${target}   ·   Chance: ${chance}%`, "#ffd77a"]);
        if (gains.length) lines.push([`Fica: ${gains.join(", ")}`, "#9dff8a"]);
        lines.push([`Custo: ${fee} ouro + 1× ${META.items[stone].name} (tem ${haveStone})`, gold >= fee && haveStone > 0 ? "#e8dcc0" : "#ff7a6a"]);
        lines.push([failRule(target), "#c8bca0"]);
        if (target > 5) {
          const box = this.scene.add.text(px + 16, top + 158, `${this.protect ? "☑" : "☐"} Usar Pedra de Proteção (tem ${haveProt})`,
            txt(10, haveProt > 0 ? "#8ad8ff" : "#6a6050")).setInteractive({ useHandCursor: haveProt > 0 });
          box.on("pointerdown", () => { if (haveProt > 0) { this.protect = !this.protect; this.redraw(); } });
          objs.push(box);
        }
        can = gold >= fee && haveStone > 0 && (!this.protect || target <= 5 || haveProt > 0);
        label = "APRIMORAR";
        const sel = this.sel;
        run = () => this.send({ type: "forge_upgrade", where: sel.where, ref: sel.ref, item: p.id, protect: this.protect && target > 5 });
      }
    } else if (mode === "enchant") {
      const enchants = META.forge?.enchants ?? {};
      if (def.slot !== "weapon") {
        lines.push(["Só armas podem ser encantadas. Escolha uma arma.", "#ff9a7a"]);
      } else {
        const cur = p.ench ? enchants[p.ench] : undefined;
        lines.push([cur ? `Encantamento atual: ${cur.name} — ${cur.desc}.` : "Esta arma ainda não tem encantamento.", cur?.color ?? "#c8bca0"]);
        // the four elements
        Object.entries(enchants).forEach(([el, e], i) => {
          const on = this.enchantEl === el;
          const b = this.scene.add.text(px + 16 + (i % 2) * 150, top + 92 + Math.floor(i / 2) * 30, `${on ? "◉" : "○"} ${e.name}`, txt(11, e.color, {
            fontStyle: "bold", backgroundColor: on ? "#2e2414" : "#15110c", padding: { x: 8, y: 4 }, fixedWidth: 140,
          })).setInteractive({ useHandCursor: true });
          b.on("pointerdown", () => { this.enchantEl = el; this.redraw(); });
          objs.push(b);
        });
        const pick = enchants[this.enchantEl];
        const fee = 600 * Math.max(1, def.tier ?? 1), have = this.count("stone_enchant");
        lines.push([`${pick?.name ?? ""}: ${pick?.desc ?? ""}.`, pick?.color ?? "#ffd77a"]);
        can = gold >= fee && have > 0 && p.ench !== this.enchantEl;
        lines.push([`Custo: ${fee} ouro + 1× Pedra de Encantamento (tem ${have})`, gold >= fee && have > 0 ? "#e8dcc0" : "#ff7a6a"]);
        label = p.ench ? "TROCAR ENCANTAMENTO" : "ENCANTAR";
        const sel = this.sel, el = this.enchantEl;
        run = () => this.send({ type: "forge_enchant", where: sel.where, ref: sel.ref, item: p.id, element: el });
      }
    } else {
      const fee = refineFee(def.tier ?? 1), have = this.count("stone_refine");
      const current = refLines(p.ref);
      const full = current.length >= (META.forge?.refine_max ?? 3);
      lines.push([current.length ? `Bônus atuais: ${current.join(", ")}` : "Ainda sem bônus de refino.", "#c08cff"]);
      lines.push([`Custo: ${fee} ouro + 1× Pedra de Refino (tem ${have})`, gold >= fee && have > 0 ? "#e8dcc0" : "#ff7a6a"]);
      lines.push([full ? "Com 3 bônus, refinar sorteia os 3 de novo." : `Cada refino adiciona um bônus (até ${META.forge?.refine_max ?? 3}).`, "#c8bca0"]);
      can = gold >= fee && have > 0;
      label = full ? "REFINAR DE NOVO" : "REFINAR";
      const sel = this.sel;
      run = () => this.send({ type: "forge_refine", where: sel.where, ref: sel.ref, item: p.id });
    }
    let ly = top + 58; // stack by real height: long lines wrap
    if (mode === "enchant" && lines.length > 1) {
      // current enchantment above the element buttons, the rest below them
      const first = this.scene.add.text(px + 16, ly, lines[0][0], txt(10, lines[0][1], { wordWrap: { width: FORGE_W - 32 } }));
      objs.push(first);
      lines.shift();
      ly = top + 158;
    }
    for (const [t, c] of lines) {
      const line = this.scene.add.text(px + 16, ly, t, txt(10, c, { wordWrap: { width: FORGE_W - 32 } }));
      objs.push(line);
      ly += line.height + 6;
    }
    if (label) this.button(objs, px + FORGE_W / 2 - 60, mode === "enchant" ? Math.max(top + 230, ly + 4) : top + 190, label, can, run,
      mode === "upgrade" ? "#ffd77a" : mode === "enchant" ? "#ffb070" : "#c08cff");
  }

  // ── player market ────────────────────────────────────────────────────

  private drawMarket(objs: Obj[], px: number, py: number, m: MarketMsg): void {
    this.frame(objs, px, py, MARKET_W, H, "MERCADO DE RAVENCREST", () => this.close());
    const tabs: ["buy" | "mine", string][] = [["buy", "Comprar"], ["mine", `Meus anúncios (${m.mine.length}/${m.max})`]];
    tabs.forEach(([id, label], i) => {
      const on = this.marketTab === id;
      const t = this.scene.add.text(px + 16 + i * 150, py + 38, label, txt(11, on ? "#ffd77a" : "#a8987a", {
        backgroundColor: on ? "#2e2414" : "#15110c", padding: { x: 10, y: 4 }, fontStyle: on ? "bold" : "normal", fixedWidth: 142, align: "center",
      })).setInteractive({ useHandCursor: true });
      t.on("pointerdown", () => { this.marketTab = id; this.redraw(); });
      objs.push(t);
    });
    if (this.marketTab === "buy") this.drawMarketBuy(objs, px, py, m);
    else this.drawMarketMine(objs, px, py, m);
  }

  private marketRow(objs: Obj[], px: number, y: number, r: MarketRow, action: () => void, label: string, enabled: boolean, sub: string): void {
    const def = META.items[r.item.id];
    if (!def) return;
    this.cell(objs, px + 14, y, r.item, () => undefined, () => [`Vendedor: ${r.seller}`, `Preço: ${r.price} ouro`], false, 28);
    const name = `${def.type === "gear" ? pieceName(r.item) : def.name}${r.item.qty > 1 ? ` ×${r.item.qty}` : ""}`;
    objs.push(this.scene.add.text(px + 50, y - 1, name, txt(10, META.rarity[def.rarity].color, { fontStyle: "bold", fixedWidth: 200 })));
    objs.push(this.scene.add.text(px + 50, y + 14, sub, txt(9, "#8a7c62")));
    objs.push(this.scene.add.text(px + MARKET_W - 96, y + 6, `${r.price}`, txt(11, "#ffd77a", { fontStyle: "bold" })).setOrigin(1, 0));
    this.button(objs, px + MARKET_W - 88, y + 3, label, enabled, action, label === "Cancelar" ? "#ff9a8a" : "#9dff8a");
  }

  private drawMarketBuy(objs: Obj[], px: number, py: number, m: MarketMsg): void {
    let x = px + 14;
    for (const [cat, label] of Object.entries(m.categories)) {
      const on = m.cat === cat;
      const b = this.scene.add.text(x, py + 68, label, txt(9, on ? "#ffd77a" : "#c8bca0", {
        backgroundColor: on ? "#3a2e18" : "#15110c", padding: { x: 6, y: 3 },
      })).setInteractive({ useHandCursor: true });
      b.on("pointerdown", () => this.send({ type: "market_query", cat }));
      objs.push(b);
      x += b.width + 4;
    }
    // sort toggle sits in the bottom bar, left of the page buttons, so the category row has the full width
    const sort = this.scene.add.text(px + 16, py + H - 26, m.sort === "price" ? "Ordem: mais barato" : "Ordem: mais novo",
      txt(9, "#8ad8ff", { backgroundColor: "#15110c", padding: { x: 6, y: 3 } })).setInteractive({ useHandCursor: true });
    sort.on("pointerdown", () => this.send({ type: "market_query", sort: m.sort === "price" ? "new" : "price" }));
    objs.push(sort);
    const gold = this.inv?.gold ?? 0;
    const myName = this.hero?.name;
    if (!m.rows.length) {
      objs.push(this.scene.add.text(px + MARKET_W / 2, py + 170, "Nenhum anúncio aqui ainda.\nSeja o primeiro a vender!",
        txt(11, "#8a7c62", { align: "center" })).setOrigin(0.5));
    }
    m.rows.forEach((r, i) => {
      const own = r.seller === myName;
      const hours = Math.max(1, Math.round(r.left / 3600));
      this.marketRow(objs, px, py + 98 + i * 32, r, () => this.send({ type: "market_buy", id: r.id }),
        "Comprar", !own && gold >= r.price, own ? "seu anúncio" : `de ${r.seller} · ${hours}h`);
    });
    if (m.pages > 1) {
      const nav = (label: string, page: number, ok: boolean, nx: number) => {
        const t = this.scene.add.text(nx, py + H - 26, label, txt(12, ok ? "#ffd77a" : "#4a4030", { fontStyle: "bold" })).setOrigin(0.5, 0);
        if (ok) t.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.send({ type: "market_query", page }));
        objs.push(t);
      };
      const cx = px + MARKET_W - 80;
      nav("◀", m.page - 1, m.page > 0, cx - 46);
      objs.push(this.scene.add.text(cx, py + H - 24, `${m.page + 1} / ${m.pages}`, txt(10, "#c8bca0")).setOrigin(0.5, 0));
      nav("▶", m.page + 1, m.page < m.pages - 1, cx + 46);
    }
  }

  private drawMarketMine(objs: Obj[], px: number, py: number, m: MarketMsg): void {
    const box = m.box;
    const g = this.scene.add.graphics();
    g.fillStyle(0x1a140c, 0.9).fillRoundedRect(px + 14, py + 66, MARKET_W - 28, 30, 5);
    objs.push(g);
    objs.push(this.scene.add.text(px + 22, py + 74, `Caixa de coleta: ${box.gold} ouro · ${box.items.length} item(ns)`,
      txt(10, box.gold || box.items.length ? "#9dff8a" : "#8a7c62")));
    this.button(objs, px + MARKET_W - 110, py + 71, "Coletar tudo", box.gold > 0 || box.items.length > 0,
      () => this.send({ type: "market_collect" }), "#ffd77a");
    if (!m.mine.length) {
      objs.push(this.scene.add.text(px + MARKET_W / 2, py + 190,
        "Você não tem anúncios.\nClique num item da bolsa e\nescolha \"Anunciar no mercado\".", txt(11, "#8a7c62", { align: "center" })).setOrigin(0.5));
    }
    m.mine.slice(0, 7).forEach((r, i) => {
      const h = Math.floor(r.left / 3600), min = Math.floor((r.left % 3600) / 60);
      this.marketRow(objs, px, py + 106 + i * 32, r, () => this.send({ type: "market_cancel", id: r.id }),
        "Cancelar", true, `termina em ${h}h ${String(min).padStart(2, "0")}min`);
    });
    if (m.mine.length > 7) objs.push(this.scene.add.text(px + MARKET_W / 2, py + H - 22, `+${m.mine.length - 7} anúncio(s)…`, txt(9, "#8a7c62")).setOrigin(0.5, 0));
  }

  private promptListing(index: number, e: BagEntry): void {
    const m = this.market;
    if (!m) return;
    const def = META.items[e.id];
    new PricePrompt({
      name: def.type === "gear" ? pieceName(e) : def.name,
      color: META.rarity[def.rarity].color,
      maxQty: def.type === "gear" ? 1 : e.qty,
      suggested: Math.max(1, this.sellPrice(e) * 3),
      fee: m.fee,
      tax: m.tax,
      onConfirm: (qty, price) => this.send({ type: "market_sell", index, item: e.id, qty, price }),
    });
  }

  private select(sel: Sel): void {
    this.sel = sel;
    this.lastResult = null;
    if (this.forgeTab === "stones") this.forgeTab = "upgrade";
    this.redraw();
  }

  // ── menus ────────────────────────────────────────────────────────────

  private gearOptions(slot: GearSlot, p: GearPiece): MenuOption[] {
    const opts: MenuOption[] = [];
    if (this.forge) opts.push({ label: "Escolher na forja", color: "#ffd77a", run: () => this.select({ where: "gear", ref: slot, id: p.id }) });
    opts.push({ label: "Desequipar", run: () => this.send({ type: "unequip", slot }) });
    return opts;
  }

  private bagOptions(index: number, e: BagEntry): MenuOption[] {
    const def = META.items[e.id];
    const id = e.id, qty = e.qty;
    const opts: MenuOption[] = [];
    if (def.type === "gear" && this.forge) opts.push({ label: "Escolher na forja", color: "#ffd77a", run: () => this.select({ where: "bag", ref: index, id }) });
    if (this.market) opts.push({ label: "Anunciar no mercado", color: "#ffd77a", run: () => this.promptListing(index, e) });
    if (def.type === "gear") opts.push({ label: "Equipar", color: "#9dff8a", run: () => this.send({ type: "equip", index, item: id }) });
    if (def.type === "potion") opts.push({ label: "Beber", color: "#9dff8a", run: () => this.send({ type: "use_potion", kind: def.kind }) });
    if (this.shop || this.forge) {
      const price = this.sellPrice(e);
      opts.push({ label: `Vender (+${price} ouro)`, color: "#ffd77a", run: () => this.send({ type: "sell", index, item: id, qty: 1 }) });
      if (qty > 1) opts.push({ label: `Vender todos (+${price * qty} ouro)`, color: "#ffd77a",
        run: () => this.send({ type: "sell", index, item: id, qty }) });
    }
    const precious = def.type === "gear" && (def.rarity !== "comum" || (e.plus ?? 0) > 0);
    const discard: MenuOption = {
      label: "Descartar", color: "#ff8a7a", keepOpen: precious,
      run: () => {
        if (!precious || discard.label !== "Descartar") { this.send({ type: "discard", index, item: id }); this.closeMenu(); return; }
        discard.label = "Confirmar descarte";
        this.redrawMenu();
      },
    };
    opts.push(discard);
    return opts;
  }

  // ── context menu ─────────────────────────────────────────────────────

  private menuAt?: { x: number; y: number; opts: MenuOption[] };

  private openMenu(p: Phaser.Input.Pointer, opts: MenuOption[]): void {
    this.menuAt = { x: p.x, y: p.y, opts };
    this.redrawMenu();
  }

  private redrawMenu(): void {
    this.menu?.destroy();
    if (!this.menuAt) return;
    const { opts } = this.menuAt;
    const all = [...opts, { label: "Cancelar", color: "#bfa77a", run: () => undefined }];
    const w = 200, rowH = 26, h = all.length * rowH + 10;
    const sw = this.scene.scale.width, sh = this.scene.scale.height;
    const x = Phaser.Math.Clamp(this.menuAt.x + 6, 4, sw - w - 4), y = Phaser.Math.Clamp(this.menuAt.y + 6, 4, sh - h - 4);
    const shade = this.scene.add.zone(-x, -y, sw, sh).setOrigin(0).setInteractive();
    shade.on("pointerdown", () => this.closeMenu());
    const g = this.scene.add.graphics();
    panel(g, 0, 0, w, h, 6, 0.98);
    const objs: Obj[] = [shade, g];
    all.forEach((o, i) => {
      const b = this.scene.add.text(10, 6 + i * rowH, o.label, txt(12, o.color ?? "#f3e3b8", {
        fixedWidth: w - 20, padding: { x: 6, y: 4 }, backgroundColor: "#1a140c",
      })).setInteractive({ useHandCursor: true });
      b.on("pointerover", () => b.setBackgroundColor("#2e2414")).on("pointerout", () => b.setBackgroundColor("#1a140c"));
      b.on("pointerdown", () => {
        o.run();
        if (!o.keepOpen) this.closeMenu();
      });
      objs.push(b);
    });
    this.menu = this.scene.add.container(x, y, objs).setDepth(95);
  }

  private closeMenu(): void {
    this.menu?.destroy();
    this.menu = undefined;
    this.menuAt = undefined;
  }

  // ── tooltip ──────────────────────────────────────────────────────────

  private showTip(p: Piece, ptr: Phaser.Input.Pointer, extra: string[]): void {
    this.hideTip();
    if (this.menu) return; // never cover an open menu
    const def = META.items[p.id];
    const rarity = META.rarity[def.rarity];
    const kind = def.type === "gear" ? SLOT_NAMES[def.slot!] : TYPE_NAMES[def.type];
    const lines: { t: string; c: string }[] = [{ t: `${rarity.name} · ${kind}`, c: "#a8987a" }];
    for (const s of statLines(def.type === "gear" ? pieceStats(p) : def.stats)) lines.push({ t: s, c: "#9dff8a" });
    for (const s of refLines(p.ref)) lines.push({ t: `✦ ${s}`, c: "#c08cff" });
    const ench = p.ench ? META.forge?.enchants?.[p.ench] : undefined;
    if (ench) lines.push({ t: `✶ Encantamento: ${ench.name} — ${ench.desc}`, c: ench.color });
    if (def.desc) lines.push({ t: def.desc, c: "#d8ccb0" });
    if (def.type === "gear") {
      const lvl = this.hero?.level ?? 1;
      if (def.lvl && def.lvl > 1) lines.push({ t: `Nível necessário: ${def.lvl}`, c: lvl >= def.lvl ? "#c8bca0" : "#ff7a6a" });
      if (def.cls?.length) {
        const ok = def.cls.includes(this.cls);
        lines.push({ t: `Classe: ${def.cls.map((c) => CLASS_INFO[c]?.name ?? c).join(", ")}`, c: ok ? "#c8bca0" : "#ff7a6a" });
      }
      const worn = this.inv?.gear[def.slot!];
      if (worn && worn !== p && META.items[worn.id]) lines.push({ t: `Equipado agora: ${pieceName(worn)}`, c: "#8a7c62" });
    }
    for (const e of extra) lines.push({ t: e, c: "#ffd77a" });
    const name = this.scene.add.text(10, 8, def.type === "gear" ? pieceName(p) : def.name, txt(13, rarity.color, { fontStyle: "bold" }));
    const body = lines.map((l, i) => this.scene.add.text(10, 30 + i * 16, l.t, txt(10, l.c, { wordWrap: { width: 220 } })));
    const w = Math.max(name.width, ...body.map((b) => b.width)) + 20;
    const h = 38 + lines.length * 16;
    const g = this.scene.add.graphics();
    panel(g, 0, 0, w, h, 6, 0.97);
    this.tip = this.scene.add.container(0, 0, [g, name, ...body]).setDepth(96).setSize(w, h);
    this.moveTip(ptr);
  }

  private moveTip(p: Phaser.Input.Pointer): void {
    if (!this.tip) return;
    const sw = this.scene.scale.width, sh = this.scene.scale.height;
    const w = this.tip.width, h = this.tip.height;
    let x = p.x + 16, y = p.y + 16;
    if (x + w > sw - 4) x = p.x - w - 12;
    if (y + h > sh - 4) y = sh - h - 4;
    this.tip.setPosition(Math.max(4, x), Math.max(4, y));
  }

  private hideTip(): void {
    this.tip?.destroy();
    this.tip = undefined;
  }
}

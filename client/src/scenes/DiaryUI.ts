/**
 * Discovery diary (key J / Menu → Diário): every hidden place of the world by map. Places already found show their
 * story and bonus; the others show "???" and a hint of where to look. The data comes from /meta (META.discovery) and
 * the hero's `found` list; the server decides what was found.
 */
import Phaser from "phaser";
import { isTouch } from "../ui/device";
import { META, fmtBig, type PlaceDef } from "../data/meta";
import { panel, txt } from "./uiStyle";

type Obj = Phaser.GameObjects.GameObject;

const W = 800;
const H = 540;
const ORDER = ["town_01", "forest_01", "dungeon_01", "mine_01", "swamp_01", "frost_01", "ash_01", "crimson_01", "ghost_01", "void_01"];

/** "+1% de vida" from a place's bonus. */
export function bonusLabel(p: PlaceDef): string {
  const [key, val] = p.bonus;
  const name = META.discovery?.bonus_text[key] ?? key;
  return `+${+(val * 100).toFixed(1)}% de ${name}`;
}

/** The sum of the bonuses of the places found, as short labels. */
export function bonusTotals(found: string[]): string[] {
  const sum = new Map<string, number>();
  for (const ps of Object.values(META.discovery?.places ?? {})) {
    for (const p of ps) if (found.includes(p.id)) sum.set(p.bonus[0], (sum.get(p.bonus[0]) ?? 0) + p.bonus[1]);
  }
  return [...sum].map(([k, v]) => `+${+(v * 100).toFixed(1)}% ${META.discovery?.bonus_text[k] ?? k}`);
}

export class DiaryUI {
  private root?: Phaser.GameObjects.Container;
  private sel = "";

  constructor(private scene: Phaser.Scene, private found: () => string[], private currentMap: () => string) {}

  get isOpen(): boolean {
    return !!this.root;
  }

  toggle(): void {
    if (this.root) { this.close(); return; }
    const here = this.currentMap();
    this.sel = META.discovery?.places[here] ? here : ORDER[0];
    this.draw();
  }

  close(): void {
    this.root?.destroy();
    this.root = undefined;
  }

  /** A new place was found while the window is open. */
  refresh(): void {
    if (this.root) this.draw();
  }

  private draw(): void {
    this.root?.destroy();
    const d = META.discovery;
    const found = this.found();
    const objs: Obj[] = [];
    const g = this.scene.add.graphics();
    panel(g, -W / 2, -H / 2, W, H, 12, 0.97);
    objs.push(this.scene.add.zone(-W / 2, -H / 2, W, H).setOrigin(0).setInteractive(), g);
    const close = this.scene.add.text(W / 2 - 16, -H / 2 + 10, "✕", txt(16, "#e8dcc0")).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => this.close());
    const total = d?.total ?? 0;
    objs.push(close,
      this.scene.add.text(0, -H / 2 + 12, "DIÁRIO DE DESCOBERTAS", txt(17, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5, 0),
      this.scene.add.text(0, -H / 2 + 36, "Ande pelos mapas e procure as estrelas douradas. Cada lugar achado dá um bônus para sempre.",
        txt(10, "#c8bca0")).setOrigin(0.5, 0),
      this.scene.add.text(-W / 2 + 18, -H / 2 + 14, `Encontrados: ${found.length} / ${total}`, txt(12, "#ffd77a", { fontStyle: "bold" })));
    const totals = bonusTotals(found);
    objs.push(this.scene.add.text(0, -H / 2 + 54, totals.length ? `Seus bônus: ${totals.join("  ·  ")}` : "Nenhum lugar encontrado ainda.",
      txt(10, "#9dff8a", { align: "center", wordWrap: { width: W - 60 } })).setOrigin(0.5, 0));
    if (!d) { this.finish(objs); return; }

    // the maps, on the left
    const lx = -W / 2 + 16, ly = -H / 2 + 84, lw = 200;
    ORDER.filter((id) => d.places[id]).forEach((id, i) => {
      const ps = d.places[id];
      const n = ps.filter((p) => found.includes(p.id)).length;
      const done = n === ps.length;
      const y = ly + i * 43;
      const bg = this.scene.add.graphics();
      const on = id === this.sel;
      bg.fillStyle(on ? 0x3a2a14 : 0x1a140c, 1).fillRoundedRect(lx, y, lw, 38, 6);
      bg.lineStyle(1, on ? 0xd6aa5a : 0x4a3a20, 1).strokeRoundedRect(lx, y, lw, 38, 6);
      const name = META.maps[id]?.name ?? id;
      objs.push(bg,
        this.scene.add.text(lx + 10, y + 5, name, txt(11, on ? "#ffe6a0" : "#e8dcc0", { fontStyle: "bold" })),
        this.scene.add.text(lx + 10, y + 21, done ? "Completo ✓" : `${n} de ${ps.length}`, txt(9, done ? "#9dff8a" : "#a8987a")));
      const hit = this.scene.add.zone(lx, y, lw, 38).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on("pointerdown", () => { this.sel = id; this.draw(); });
      objs.push(hit);
    });

    // the places of the chosen map, on the right
    const rx = lx + lw + 18, rw = W / 2 - 18 - rx;
    let y = ly;
    const ps = d.places[this.sel] ?? [];
    const gold = d.map_gold[this.sel] ?? 0;
    objs.push(this.scene.add.text(rx, y, META.maps[this.sel]?.name ?? this.sel, txt(14, "#ffd77a", { fontStyle: "bold" })),
      this.scene.add.text(rx + rw, y + 2, gold ? `Achou todos: +${fmtBig(gold)} ouro` : "", txt(10, "#ffd77a")).setOrigin(1, 0));
    y += 26;
    for (const p of ps) {
      const got = found.includes(p.id);
      const icon = p.landmark ? "★" : "✦";
      if (got) {
        const t1 = this.scene.add.text(rx, y, `${icon} ${p.name}${p.landmark ? "  (marco lendário)" : ""}`, txt(12, "#ffe6a0", { fontStyle: "bold" }));
        const t2 = this.scene.add.text(rx + rw, y + 1, bonusLabel(p), txt(11, "#9dff8a", { fontStyle: "bold" })).setOrigin(1, 0);
        const t3 = this.scene.add.text(rx + 16, y + 18, p.lore, txt(10, "#d8ccb0", { wordWrap: { width: rw - 20 }, lineSpacing: 2 }));
        objs.push(t1, t2, t3);
        y += 22 + t3.height + 8;
      } else {
        const t1 = this.scene.add.text(rx, y, `${icon} ? ? ?`, txt(12, "#6a6050", { fontStyle: "bold" }));
        const t2 = this.scene.add.text(rx + rw, y + 1, bonusLabel(p), txt(11, "#5a6a50")).setOrigin(1, 0);
        const t3 = this.scene.add.text(rx + 16, y + 18, `Dica: ${p.hint}`, txt(10, "#a8987a", { fontStyle: "italic", wordWrap: { width: rw - 20 } }));
        objs.push(t1, t2, t3);
        y += 22 + t3.height + 8;
      }
    }
    this.finish(objs);
  }

  private finish(objs: Obj[]): void {
    const s = this.scene.scale;
    this.root = this.scene.add.container(s.width / 2, s.height / 2, objs).setDepth(83)
      .setScale(Math.min(1, (s.width - 16) / W, (s.height - (isTouch() ? 12 : 90)) / H));
  }
}

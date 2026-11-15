/**
 * World map (key N / Menu → Mapa): every region of the world along the story's road, the one the hero is in, the
 * ones the story already unlocked (teleport there for a little gold) and the sealed ones. The server decides what is
 * open and charges the teleport; this window only shows it and asks.
 */
import Phaser from "phaser";
import { isTouch } from "../ui/device";
import { fmtBig } from "../data/meta";
import { panel, txt } from "./uiStyle";

type Obj = Phaser.GameObjects.GameObject;

export interface WorldMapMsg {
  current: string;
  gold: number;
  maps: { id: string; name: string; theme: string; level: string; unlocked: boolean; cost: number }[];
  links: [string, string][];
}

const W = 760;
const H = 500;
// where each region sits on the parchment (0..1): the story's road from the town to the Void Citadel
const SPOTS: Record<string, [number, number]> = {
  town_01: [0.14, 0.74], arena_01: [0.06, 0.3], dungeon_01: [0.19, 0.97], forest_01: [0.31, 0.6], mine_01: [0.45, 0.9],
  swamp_01: [0.48, 0.68], frost_01: [0.55, 0.42], ash_01: [0.7, 0.6], crimson_01: [0.8, 0.36], ghost_01: [0.64, 0.2],
  void_01: [0.87, 0.13],
};
/** "Mineração — veios mais ricos…" → "Mineração": the map stays readable */
const short = (level: string) => level.split(" — ")[0];
const THEME_COLOR: Record<string, number> = {
  town: 0xffd77a, forest: 0x6fcf5a, crypt: 0xa8a0b8, mine: 0xc08a50, swamp: 0x4fbf9a, frost: 0x8fd8ff, ash: 0xff8a3a,
  crimson: 0xe0404a, ghost: 0x9fd8d0, void: 0xb070ff, arena: 0xd04040,
};

export class WorldMapUI {
  private root?: Phaser.GameObjects.Container;
  private data: WorldMapMsg | null = null;
  private confirm = "";
  private waiting = false;

  constructor(private scene: Phaser.Scene, private send: (m: Record<string, unknown>) => void) {}

  get isOpen(): boolean {
    return !!this.root;
  }

  toggle(): void {
    if (this.root) { this.close(); return; }
    this.confirm = "";
    this.waiting = true;
    this.draw();
    this.send({ type: "world_map" });
  }

  close(): void {
    this.root?.destroy();
    this.root = undefined;
    this.confirm = "";
  }

  set(m: WorldMapMsg): void {
    this.data = m;
    this.waiting = false;
    if (this.root) this.draw();
  }

  /** After a teleport (the map changed) the window closes by itself. */
  mapChanged(): void {
    if (this.root) this.close();
  }

  private draw(): void {
    this.root?.destroy();
    const objs: Obj[] = [];
    const g = this.scene.add.graphics();
    panel(g, -W / 2, -H / 2, W, H, 12, 0.97);
    objs.push(this.scene.add.zone(-W / 2, -H / 2, W, H).setOrigin(0).setInteractive(), g);
    const close = this.scene.add.text(W / 2 - 16, -H / 2 + 10, "✕", txt(16, "#e8dcc0")).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => this.close());
    objs.push(close, this.scene.add.text(0, -H / 2 + 12, "MAPA DO MUNDO", txt(17, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5, 0),
      this.scene.add.text(0, -H / 2 + 36, "Toque numa região liberada para se teleportar até a entrada dela.", txt(10, "#c8bca0")).setOrigin(0.5, 0));
    const d = this.data;
    if (d) objs.push(this.scene.add.text(-W / 2 + 18, -H / 2 + 16, `Ouro: ${fmtBig(d.gold)}`, txt(12, "#ffd77a", { fontStyle: "bold" })));

    // the parchment
    const mx = -W / 2 + 20, my = -H / 2 + 60, mw = W - 40, mh = H - 80;
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x1a140c, 1).fillRoundedRect(mx, my, mw, mh, 10);
    bg.lineStyle(1, 0x6b5226, 1).strokeRoundedRect(mx, my, mw, mh, 10);
    objs.push(bg);
    if (!d || this.waiting) {
      objs.push(this.scene.add.text(0, 20, "Abrindo o mapa…", txt(12, "#a8987a")).setOrigin(0.5));
      this.finish(objs);
      return;
    }
    const pos = (id: string, i: number): [number, number] => {
      const s = SPOTS[id] ?? [0.1 + (i % 6) * 0.15, 0.2 + Math.floor(i / 6) * 0.3];
      return [mx + 30 + s[0] * (mw - 60), my + 26 + s[1] * (mh - 70)];
    };
    const at = new Map(d.maps.map((m, i) => [m.id, pos(m.id, i)] as const));
    const open = new Map(d.maps.map((m) => [m.id, m.unlocked] as const));
    // roads between regions (a dashed gold line when both ends are open)
    const roads = this.scene.add.graphics();
    for (const [a, b] of d.links) {
      const pa = at.get(a), pb = at.get(b);
      if (!pa || !pb) continue;
      const lit = open.get(a) && open.get(b);
      roads.lineStyle(lit ? 3 : 2, lit ? 0xd6aa5a : 0x3a3024, lit ? 0.85 : 0.8);
      const steps = 14;
      for (let k = 0; k < steps; k += 2) {
        const t0 = k / steps, t1 = (k + 1) / steps;
        roads.lineBetween(pa[0] + (pb[0] - pa[0]) * t0, pa[1] + (pb[1] - pa[1]) * t0, pa[0] + (pb[0] - pa[0]) * t1, pa[1] + (pb[1] - pa[1]) * t1);
      }
    }
    objs.push(roads);
    for (const m of d.maps) {
      const [x, y] = at.get(m.id)!;
      const here = m.id === d.current;
      const color = THEME_COLOR[m.theme] ?? 0xd6aa5a;
      const node = this.scene.add.graphics();
      if (m.unlocked) {
        node.fillStyle(color, 0.25).fillCircle(x, y, 26);
        node.fillStyle(0x120e18, 1).fillCircle(x, y, 19);
        node.lineStyle(3, color, 1).strokeCircle(x, y, 19);
        node.fillStyle(color, 1).fillCircle(x, y, 7);
      } else {
        node.fillStyle(0x0c0a10, 1).fillCircle(x, y, 17);
        node.lineStyle(2, 0x4a4034, 1).strokeCircle(x, y, 17);
        // a small padlock
        node.lineStyle(2, 0x6a6050, 1).strokeCircle(x, y - 3, 4);
        node.fillStyle(0x6a6050, 1).fillRect(x - 6, y - 1, 12, 9);
      }
      objs.push(node);
      if (here) {
        const ring = this.scene.add.graphics();
        ring.lineStyle(3, 0xffffff, 0.9).strokeCircle(x, y, 27);
        objs.push(ring, this.scene.add.text(x, y - 46, "Você está aqui", txt(9, "#ffffff", { fontStyle: "bold" })).setOrigin(0.5));
        this.scene.tweens.add({ targets: ring, alpha: { from: 0.35, to: 1 }, duration: 800, yoyo: true, repeat: -1 });
      }
      objs.push(this.scene.add.text(x, y + 24, m.name, txt(10, m.unlocked ? "#f3e3b8" : "#6a6050", { fontStyle: "bold", align: "center" })).setOrigin(0.5, 0),
        this.scene.add.text(x, y + 38, m.unlocked ? (here ? short(m.level) : `${short(m.level)} · ${fmtBig(m.cost)} ouro`) : "Selado pela história",
          txt(8, m.unlocked ? "#c8bca0" : "#5a5044", { align: "center" })).setOrigin(0.5, 0));
      if (m.unlocked && !here) {
        const hit = this.scene.add.zone(x - 30, y - 30, 60, 74).setOrigin(0).setInteractive({ useHandCursor: true });
        hit.on("pointerover", () => node.setAlpha(0.75)).on("pointerout", () => node.setAlpha(1));
        hit.on("pointerdown", () => { this.confirm = m.id; this.draw(); });
        objs.push(hit);
      }
    }
    if (this.confirm) this.drawConfirm(objs, d);
    this.finish(objs);
  }

  private drawConfirm(objs: Obj[], d: WorldMapMsg): void {
    const m = d.maps.find((x) => x.id === this.confirm);
    if (!m) return;
    const g = this.scene.add.graphics();
    g.fillStyle(0x000000, 0.65).fillRect(-W / 2, -H / 2, W, H);
    panel(g, -210, -80, 420, 160, 12, 0.99);
    objs.push(this.scene.add.zone(-W / 2, -H / 2, W, H).setOrigin(0).setInteractive(), g);
    const afford = d.gold >= m.cost;
    objs.push(this.scene.add.text(0, -60, `Teleportar para ${m.name}?`, txt(15, "#ffd77a", { fontStyle: "bold", align: "center", wordWrap: { width: 390 } })).setOrigin(0.5, 0),
      this.scene.add.text(0, -26, `${m.level}\nCusto: ${fmtBig(m.cost)} ouro${afford ? "" : " — ouro insuficiente"}`,
        txt(11, afford ? "#e8dcc0" : "#ff8a7a", { align: "center", lineSpacing: 4 })).setOrigin(0.5, 0));
    const go = this.scene.add.text(70, 30, "Teleportar", txt(13, afford ? "#fff1c4" : "#6a6050", {
      fontStyle: "bold", backgroundColor: afford ? "#2e5a1e" : "#1a1a14", padding: { x: 14, y: 8 },
    })).setOrigin(0.5, 0);
    if (afford) go.setInteractive({ useHandCursor: true }).on("pointerdown", () => { this.send({ type: "teleport", map: m.id }); this.confirm = ""; });
    const no = this.scene.add.text(-90, 30, "Cancelar", txt(13, "#c8bca0", { backgroundColor: "#1a140c", padding: { x: 14, y: 8 } }))
      .setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    no.on("pointerdown", () => { this.confirm = ""; this.draw(); });
    objs.push(go, no);
  }

  private finish(objs: Obj[]): void {
    const s = this.scene.scale;
    this.root = this.scene.add.container(s.width / 2, s.height / 2, objs).setDepth(83)
      .setScale(Math.min(1, (s.width - 16) / W, (s.height - (isTouch() ? 12 : 90)) / H));
  }
}

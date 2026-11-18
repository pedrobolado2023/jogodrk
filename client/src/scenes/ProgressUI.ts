/**
 * The windows and boxes of the hero's long-term progress (server/progress.py, invasion.py, duel.py):
 *  - the first steps box (tutorial) and the welcome gift;
 *  - the login calendar (7 days of gifts);
 *  - achievements;
 *  - the ranking (strongest, this week's PvP and hunters, guilds);
 *  - the event banner at the top (town invasion, Arena tournament, duel).
 * The server decides everything; these only show it and send the player's clicks.
 */
import Phaser from "phaser";
import { isTouch } from "../ui/device";
import { CLASS_INFO, META, fmtBig } from "../data/meta";
import { panel, txt } from "./uiStyle";

type Obj = Phaser.GameObjects.GameObject;
type Send = (m: Record<string, unknown>) => void;
export type Reward = { gold?: number; gems?: number; item?: string; qty?: number; boost?: string; minutes?: number; title?: string };

/** "1.000 ouro", "10× Poção de Vida Grande", "50 gemas", "EXP +50% por 30 min", "título Fiel de Ravencrest". */
export function rewardText(r: Reward): string {
  if (r.gold) return `${fmtBig(r.gold)} ouro`;
  if (r.gems) return `${r.gems} gemas`;
  if (r.item) return `${r.qty ?? 1}× ${META.items[r.item]?.name ?? r.item}`;
  if (r.boost) return `${r.boost === "exp" ? "EXP" : "Ouro"} +50% por ${r.minutes} min`;
  if (r.title) return `título ${META.titles.find((t) => t.id === r.title)?.name ?? r.title}`;
  return "";
}

/** A big centered window, scaled down on small screens (same look as the world map). */
function windowFrame(scene: Phaser.Scene, w: number, h: number, title: string, onClose: () => void, subtitle = ""): Obj[] {
  const g = scene.add.graphics();
  panel(g, -w / 2, -h / 2, w, h, 12, 0.97);
  const close = scene.add.text(w / 2 - 16, -h / 2 + 10, "✕", txt(16, "#e8dcc0")).setOrigin(1, 0).setInteractive({ useHandCursor: true });
  close.on("pointerdown", onClose);
  const objs: Obj[] = [scene.add.zone(-w / 2, -h / 2, w, h).setOrigin(0).setInteractive(), g, close,
    scene.add.text(0, -h / 2 + 12, title, txt(17, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5, 0)];
  if (subtitle) objs.push(scene.add.text(0, -h / 2 + 36, subtitle, txt(10, "#c8bca0", { align: "center", wordWrap: { width: w - 60 } })).setOrigin(0.5, 0));
  return objs;
}

function place(scene: Phaser.Scene, objs: Obj[], w: number, h: number, depth = 83): Phaser.GameObjects.Container {
  const s = scene.scale;
  return scene.add.container(s.width / 2, s.height / 2, objs).setDepth(depth)
    .setScale(Math.min(1, (s.width - 16) / w, (s.height - (isTouch() ? 12 : 90)) / h));
}

function button(scene: Phaser.Scene, x: number, y: number, label: string, color: string, bg: string, onClick: () => void): Phaser.GameObjects.Text {
  const b = scene.add.text(x, y, label, txt(13, color, { fontStyle: "bold", backgroundColor: bg, padding: { x: 14, y: 8 } }))
    .setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
  b.on("pointerdown", onClick).on("pointerover", () => b.setAlpha(0.8)).on("pointerout", () => b.setAlpha(1));
  return b;
}

// ── first steps ──────────────────────────────────────────────────────────

export interface TutorialMsg { done: boolean; step?: number; steps?: number; title?: string; text?: string; n?: number; count?: number; reward?: Reward[]; gift?: string[] }

export const TUTORIAL_W = 380;

export class TutorialBox {
  private box?: Phaser.GameObjects.Container;
  private gift?: Phaser.GameObjects.Container;
  height = 0;

  constructor(private scene: Phaser.Scene, private send: Send, private relayout: () => void) {}

  set(m: TutorialMsg): void {
    this.box?.destroy();
    this.box = undefined;
    this.height = 0;
    if (m.done) {
      if (m.gift) this.showGift(m.gift);
      this.relayout();
      return;
    }
    const w = TUTORIAL_W;
    const head = this.scene.add.text(0, 8, `PRIMEIROS PASSOS  ${m.step}/${m.steps}  ·  ${m.title}`, txt(11, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5, 0);
    const body = this.scene.add.text(0, 26, m.text ?? "", txt(11, "#f3e8cc", { align: "center", wordWrap: { width: w - 28 }, lineSpacing: 2 })).setOrigin(0.5, 0);
    const prog = (m.count ?? 1) > 1 ? `  ·  ${Math.floor(m.n ?? 0)}/${m.count}` : "";
    const foot = this.scene.add.text(0, 30 + body.height, `Prêmio: ${(m.reward ?? []).map(rewardText).join(", ")}${prog}`,
      txt(10, "#9dff8a")).setOrigin(0.5, 0);
    const h = 36 + body.height + foot.height;
    const g = this.scene.add.graphics();
    panel(g, -w / 2, 0, w, h, 10, 0.9);
    g.lineStyle(2, 0xd6aa5a, 0.9).strokeRoundedRect(-w / 2 + 2, 2, w - 4, h - 4, 9);
    this.box = this.scene.add.container(0, 0, [g, head, body, foot]).setDepth(70);
    this.scene.tweens.add({ targets: g, alpha: { from: 0.75, to: 1 }, duration: 900, yoyo: true, repeat: 2 });
    this.height = h;
    this.relayout();
  }

  /** Called by the HUD layout: centered at the top, under nothing. */
  position(x: number, y: number, k: number): void {
    this.box?.setPosition(x, y).setScale(k);
  }

  private showGift(got: string[]): void {
    this.gift?.destroy();
    const W = 460, H = 280;
    const objs = windowFrame(this.scene, W, H, "PRESENTE DE BOAS-VINDAS!", () => this.closeGift(), "Você aprendeu o básico. Leve isto para a sua jornada:");
    objs.push(this.scene.add.text(0, -60, got.map((x) => `•  ${x}`).join("\n"), txt(13, "#9dff8a", { fontStyle: "bold", lineSpacing: 6, align: "center" })).setOrigin(0.5, 0));
    objs.push(this.scene.add.text(0, 50, "Que tal testar o PvP agora? Na Arena de Sangue morrer não tira nada.", txt(10, "#c8bca0", { align: "center", wordWrap: { width: W - 60 } })).setOrigin(0.5, 0));
    objs.push(button(this.scene, -100, 84, "⚔ Ir para a Arena PvP", "#ffe0d0", "#5a1410", () => { this.send({ type: "dialog_option", option: "go_arena" }); this.closeGift(); }));
    objs.push(button(this.scene, 120, 84, "Continuar", "#c8bca0", "#1a140c", () => this.closeGift()));
    this.gift = place(this.scene, objs, W, H, 112);
  }

  private closeGift(): void {
    this.gift?.destroy();
    this.gift = undefined;
  }
}

// ── login calendar ───────────────────────────────────────────────────────

export interface LoginMsg { day: number; ready: boolean; total: number; days: Reward[][]; got?: string[] }

export class LoginUI {
  private root?: Phaser.GameObjects.Container;
  data: LoginMsg | null = null;
  private shownToday = false;

  constructor(private scene: Phaser.Scene, private send: Send) {}

  get isOpen(): boolean { return !!this.root; }

  set(m: LoginMsg): void {
    this.data = m;
    if (this.root) this.draw();
    else if (m.ready && !this.shownToday) {
      this.shownToday = true;
      this.scene.time.delayedCall(1500, () => { if (!this.root && this.data?.ready) this.draw(); });
    }
  }

  toggle(): void {
    if (this.root) this.close();
    else this.draw();
  }

  close(): void {
    this.root?.destroy();
    this.root = undefined;
  }

  private draw(): void {
    this.root?.destroy();
    const d = this.data;
    const W = 760, H = 330;
    const objs = windowFrame(this.scene, W, H, "PRESENTES DIÁRIOS", () => this.close(),
      "Entre no jogo todo dia e pegue um presente. O 7º dia é o maior!");
    if (!d) { this.root = place(this.scene, objs, W, H); return; }
    const cw = 96, gap = 8, x0 = -(7 * cw + 6 * gap) / 2;
    d.days.forEach((rw, i) => {
      const x = x0 + i * (cw + gap), y = -H / 2 + 70;
      // `day` is the next gift to take: before it are the ones taken this week; after today's is taken it points one ahead
      const taken = !d.ready && d.day === 0 ? true : i < d.day;
      const today = i === (d.ready ? d.day : (d.day + 6) % 7);
      const g = this.scene.add.graphics();
      g.fillStyle(today ? 0x3a2a14 : 0x1a140c, 1).fillRoundedRect(x, y, cw, 170, 8);
      g.lineStyle(today ? 3 : 1, today ? (d.ready ? 0xffd23c : 0x9a8a6a) : 0x4a3a20, 1).strokeRoundedRect(x, y, cw, 170, 8);
      objs.push(g, this.scene.add.text(x + cw / 2, y + 8, `Dia ${i + 1}`, txt(12, i === 6 ? "#ffd23c" : "#e8dcc0", { fontStyle: "bold" })).setOrigin(0.5, 0),
        this.scene.add.text(x + cw / 2, y + 30, rw.map(rewardText).join("\n"), txt(9, "#d8ccb0", { align: "center", wordWrap: { width: cw - 10 }, lineSpacing: 3 })).setOrigin(0.5, 0));
      if (taken || (today && !d.ready)) objs.push(this.scene.add.text(x + cw / 2, y + 146, "✓ pego", txt(11, "#9dff8a", { fontStyle: "bold" })).setOrigin(0.5, 0));
      else if (today) objs.push(this.scene.add.text(x + cw / 2, y + 146, "HOJE", txt(11, "#ffd23c", { fontStyle: "bold" })).setOrigin(0.5, 0));
    });
    if (d.ready) objs.push(button(this.scene, 0, H / 2 - 62, "Pegar o presente de hoje", "#fff1c4", "#2e5a1e", () => this.send({ type: "login_claim" })));
    else objs.push(this.scene.add.text(0, H / 2 - 56, d.got ? `Você ganhou: ${d.got.join(", ")}. Volte amanhã!` : "Você já pegou o presente de hoje. Volte amanhã!",
      txt(11, "#9dff8a", { align: "center", wordWrap: { width: W - 60 } })).setOrigin(0.5, 0));
    objs.push(this.scene.add.text(-W / 2 + 18, -H / 2 + 14, `Dias de jogo: ${d.total}`, txt(11, "#ffd77a", { fontStyle: "bold" })));
    this.root = place(this.scene, objs, W, H);
  }
}

// ── achievements ─────────────────────────────────────────────────────────

export interface AchState { got: string[]; c: Record<string, number> }
interface AchDef { id: string; name: string; desc: string; kind: string; count: number; reward: Reward[] }

export class AchievementsUI {
  private root?: Phaser.GameObjects.Container;
  state: AchState = { got: [], c: {} };

  constructor(private scene: Phaser.Scene) {}

  get isOpen(): boolean { return !!this.root; }

  set(s: AchState): void {
    this.state = s;
    if (this.root) this.draw();
  }

  toggle(): void {
    if (this.root) this.close();
    else this.draw();
  }

  close(): void {
    this.root?.destroy();
    this.root = undefined;
  }

  private draw(): void {
    this.root?.destroy();
    const defs = ((META as unknown as { achievements?: AchDef[] }).achievements ?? []);
    const W = 860, H = 600;
    const done = defs.filter((a) => this.state.got.includes(a.id)).length;
    const objs = windowFrame(this.scene, W, H, "CONQUISTAS", () => this.close(), "Cada conquista dá um prêmio na hora. As maiores dão títulos.");
    objs.push(this.scene.add.text(-W / 2 + 18, -H / 2 + 14, `Feitas: ${done} / ${defs.length}`, txt(12, "#ffd77a", { fontStyle: "bold" })));
    const cols = 2, colW = (W - 48) / cols, rowH = 34;
    const perCol = Math.ceil(defs.length / cols);
    defs.forEach((a, i) => {
      const col = Math.floor(i / perCol), row = i % perCol;
      const x = -W / 2 + 18 + col * (colW + 12), y = -H / 2 + 58 + row * rowH;
      const got = this.state.got.includes(a.id);
      const n = Math.min(a.count, this.state.c[a.kind] ?? 0);
      const g = this.scene.add.graphics();
      g.fillStyle(got ? 0x1e2a14 : 0x1a140c, 1).fillRoundedRect(x, y, colW, rowH - 4, 5);
      g.fillStyle(got ? 0x5aa83a : 0x8a6a2a, got ? 0.35 : 0.5).fillRoundedRect(x, y + rowH - 8, colW * (n / a.count), 4, 2);
      objs.push(g,
        this.scene.add.text(x + 8, y + 3, `${got ? "✓" : "○"} ${a.name}`, txt(11, got ? "#9dff8a" : "#f3e3b8", { fontStyle: "bold" })),
        this.scene.add.text(x + 8, y + 16, `${a.desc}  ${got ? "" : `(${fmtBig(n)}/${fmtBig(a.count)})`}`, txt(9, "#a8987a")),
        this.scene.add.text(x + colW - 8, y + 9, a.reward.map(rewardText).join(" + "), txt(9, got ? "#6a8a5a" : "#ffd77a", { align: "right" })).setOrigin(1, 0));
    });
    this.root = place(this.scene, objs, W, H);
  }
}

// ── ranking ──────────────────────────────────────────────────────────────

interface RankRow { id: string; name: string; cls: string; level: number; value: number }
export interface RankingMsg {
  strong: RankRow[]; pvp: RankRow[]; hunt: RankRow[]; guilds: { name: string; members: number; power: number }[];
  prizes: { pvp: Reward[][]; hunt: Reward[][] }; me: string; week_left: number;
}
const TABS: { id: "strong" | "pvp" | "hunt" | "guilds"; label: string; value: string }[] = [
  { id: "strong", label: "Mais fortes", value: "Nível" },
  { id: "pvp", label: "PvP da semana", value: "Jogadores derrotados" },
  { id: "hunt", label: "Caçadores da semana", value: "Monstros" },
  { id: "guilds", label: "Guildas", value: "Força (níveis somados)" },
];

export class RankingUI {
  private root?: Phaser.GameObjects.Container;
  private data: RankingMsg | null = null;
  private tab: (typeof TABS)[number]["id"] = "strong";

  constructor(private scene: Phaser.Scene, private send: Send) {}

  get isOpen(): boolean { return !!this.root; }

  toggle(): void {
    if (this.root) { this.close(); return; }
    this.draw();
    this.send({ type: "ranking" });
  }

  close(): void {
    this.root?.destroy();
    this.root = undefined;
  }

  set(m: RankingMsg): void {
    this.data = m;
    if (this.root) this.draw();
  }

  private draw(): void {
    this.root?.destroy();
    const W = 720, H = 600;
    const objs = windowFrame(this.scene, W, H, "RANKING", () => this.close());
    TABS.forEach((t, i) => {
      const on = t.id === this.tab;
      const b = this.scene.add.text(-W / 2 + 24 + i * 170, -H / 2 + 44, t.label, txt(11, on ? "#1a0e04" : "#e8dcc0", {
        fontStyle: "bold", backgroundColor: on ? "#ffd77a" : "#2a2014", padding: { x: 10, y: 6 },
      })).setInteractive({ useHandCursor: true });
      b.on("pointerdown", () => { this.tab = t.id; this.draw(); });
      objs.push(b);
    });
    const d = this.data;
    if (!d) {
      objs.push(this.scene.add.text(0, 0, "Carregando o ranking…", txt(12, "#a8987a")).setOrigin(0.5));
      this.root = place(this.scene, objs, W, H);
      return;
    }
    const tab = TABS.find((t) => t.id === this.tab)!;
    const y0 = -H / 2 + 92;
    objs.push(this.scene.add.text(-W / 2 + 30, y0, "#", txt(10, "#a8987a")), this.scene.add.text(-W / 2 + 70, y0, "Nome", txt(10, "#a8987a")),
      this.scene.add.text(W / 2 - 30, y0, tab.value, txt(10, "#a8987a")).setOrigin(1, 0));
    const medal = ["#ffd23c", "#d8d8e8", "#e09a5a"];
    if (this.tab === "guilds") {
      d.guilds.forEach((g, i) => {
        const y = y0 + 20 + i * 21;
        objs.push(this.scene.add.text(-W / 2 + 30, y, `${i + 1}`, txt(11, medal[i] ?? "#c8bca0", { fontStyle: "bold" })),
          this.scene.add.text(-W / 2 + 70, y, `${g.name}  ·  ${g.members} membro${g.members === 1 ? "" : "s"}`, txt(11, "#f3e3b8")),
          this.scene.add.text(W / 2 - 30, y, fmtBig(g.power), txt(11, "#ffd77a", { fontStyle: "bold" })).setOrigin(1, 0));
      });
      if (!d.guilds.length) objs.push(this.scene.add.text(0, 0, "Nenhuma guilda ainda.", txt(12, "#a8987a")).setOrigin(0.5));
    } else {
      const rows = d[this.tab];
      rows.forEach((r, i) => {
        const y = y0 + 20 + i * 21;
        const me = r.id === d.me;
        objs.push(this.scene.add.text(-W / 2 + 30, y, `${i + 1}`, txt(11, medal[i] ?? "#c8bca0", { fontStyle: "bold" })),
          this.scene.add.text(-W / 2 + 70, y, `${r.name}${me ? "  (você)" : ""}  ·  ${CLASS_INFO[r.cls]?.name ?? r.cls} · Nv ${r.level}`,
            txt(11, me ? "#9dff8a" : "#f3e3b8", { fontStyle: me ? "bold" : "normal" })),
          this.scene.add.text(W / 2 - 30, y, fmtBig(r.value), txt(11, "#ffd77a", { fontStyle: "bold" })).setOrigin(1, 0));
      });
      if (!rows.length) objs.push(this.scene.add.text(0, 0, "Ninguém pontuou ainda esta semana. Seja o primeiro!", txt(12, "#a8987a")).setOrigin(0.5));
    }
    let foot = "";
    if (this.tab === "pvp" || this.tab === "hunt") {
      const pr = d.prizes[this.tab].map((p, i) => `${i + 1}º: ${p.map(rewardText).join(" + ")}`).join("   ·   ");
      const days = Math.floor(d.week_left / 86400), hours = Math.floor((d.week_left % 86400) / 3600);
      foot = `Prêmios no fim da semana — ${pr}\nA semana acaba em ${days}d ${hours}h (segunda-feira, 00:00).`;
    } else if (this.tab === "strong") {
      foot = "Os heróis de nível mais alto do servidor.";
    } else {
      foot = "Força = soma dos níveis dos membros da guilda.";
    }
    objs.push(this.scene.add.text(0, H / 2 - 52, foot, txt(10, "#c8bca0", { align: "center", wordWrap: { width: W - 40 }, lineSpacing: 3 })).setOrigin(0.5, 0));
    this.root = place(this.scene, objs, W, H);
  }
}

// ── event banner (invasion, tournament, duel) ────────────────────────────

export interface InvasionMsg { state: string; wave?: number; waves?: number; left?: number; ends_in?: number; level?: number; next_at?: string }
export interface TourneyMsg { state: string; ends_in?: number; rows?: { id: string; name: string; kills: number; deaths: number }[]; next?: string }
export interface DuelMsg { state: "start" | "end"; foe_name?: string; time?: number; text?: string }

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export class EventBanner {
  private text: Phaser.GameObjects.Text;
  private inv: InvasionMsg | null = null;
  private tour: TourneyMsg | null = null;
  private duel: { foe: string; until: number } | null = null;
  private got = 0;  // when the last message arrived (the countdowns run here between messages)
  meId = "";

  constructor(private scene: Phaser.Scene) {
    this.text = scene.add.text(0, 0, "", txt(12, "#fff1c4", {
      fontStyle: "bold", align: "center", backgroundColor: "#3a0c08ee", padding: { x: 14, y: 6 },
    })).setOrigin(0.5, 0).setDepth(71).setVisible(false);
    scene.time.addEvent({ delay: 1000, loop: true, callback: () => this.render() });
  }

  get height(): number { return this.text.visible ? this.text.displayHeight : 0; }

  position(x: number, y: number, k: number): void { this.text.setPosition(x, y).setScale(k); }

  setInvasion(m: InvasionMsg): void { this.inv = m.state === "active" ? m : null; this.got = this.scene.time.now; this.render(); }
  setTourney(m: TourneyMsg): void { this.tour = m.state === "active" ? m : null; this.got = this.scene.time.now; this.render(); }
  setDuel(m: DuelMsg): void {
    this.duel = m.state === "start" ? { foe: m.foe_name ?? "", until: this.scene.time.now + (m.time ?? 120) * 1000 } : null;
    this.render();
  }

  private render(): void {
    const lines: string[] = [];
    const passed = (this.scene.time.now - this.got) / 1000;
    if (this.inv) lines.push(`⚔ INVASÃO DA VILA — onda ${this.inv.wave}/${this.inv.waves} · ${this.inv.left} monstros · ${mmss(Math.max(0, (this.inv.ends_in ?? 0) - passed))}`);
    if (this.tour) {
      const rows = this.tour.rows ?? [];
      const mine = rows.findIndex((r) => r.id === this.meId);
      const lead = rows[0] ? `líder: ${rows[0].name} (${rows[0].kills})` : "ninguém pontuou ainda";
      lines.push(`🏆 TORNEIO DA ARENA — ${mmss(Math.max(0, (this.tour.ends_in ?? 0) - passed))} · ${lead}${mine >= 0 ? ` · você: ${rows[mine].kills} (${mine + 1}º)` : ""}`);
    }
    if (this.duel) lines.push(`⚔ DUELO contra ${this.duel.foe} — ${mmss(Math.max(0, (this.duel.until - this.scene.time.now) / 1000))}`);
    this.text.setText(lines.join("\n")).setVisible(lines.length > 0);
  }
}

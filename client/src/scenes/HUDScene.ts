import Phaser from "phaser";
import { socket } from "../network/socket";
import { CLASS_INFO, GEAR_SLOTS, META, type SeasonState, critText, fmtBig, type GuildState, PARTY_COLOR, PK_INFO, SLOT_NAMES, pieceName, classPassives, classSkills, type HeroState, type InventoryState, type MapInfo, type PartyMember, type ShopMsg, type SkillDef } from "../data/meta";
import { ensureTextures } from "../gfx/textures";
import { ensureSkillIcons } from "../gfx/themeProps";
import { terrainMapTexture } from "../gfx/world";
import { portraitFromSheet } from "../gfx/sprites3d";
import { ensureItemIcons } from "../gfx/itemIcons";
import type { DailyState, GameScene } from "./GameScene";
import { TextPrompt } from "./TextPrompt";
import { QUALITY_NAMES, cycleQuality, quality } from "../gfx/quality";
import { InventoryUI, type MarketMsg } from "./InventoryUI";
import { PassUI } from "./PassUI";
import { ShopUI } from "./ShopUI";
import { ChatUI, type ChatMsg } from "./ChatUI";
import { panel, txt } from "./uiStyle";
import { isTouch } from "../ui/device";

const BAR_TEX_W = 220;
const SLOT = 46;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

const JOY_R = 56;
const POTIONS = [{ kind: "hp", key: "Q", icon: "item_potion_hp_s" }, { kind: "mp", key: "E", icon: "item_potion_mp_s" }] as const;

interface PotionSlot {
  kind: "hp" | "mp";
  icon: Phaser.GameObjects.Image;
  count: Phaser.GameObjects.Text;
}

interface Slot {
  skill: SkillDef;
  root: Phaser.GameObjects.Container;
  icon: Phaser.GameObjects.Image;
  cd: Phaser.GameObjects.Graphics;
  cdText: Phaser.GameObjects.Text;
  lock: Phaser.GameObjects.Text;
  readyAt: number;
}


interface FriendRow { id: string; name: string; online: boolean; level: number; cls: string; map: string }

export class HUDScene extends Phaser.Scene {
  private cls = "blade_master";
  private hero: HeroState | null = null;
  private map: MapInfo | null = null;

  private vignette!: Phaser.GameObjects.Image;
  private hurt!: Phaser.GameObjects.Image;
  private playerPanel!: Phaser.GameObjects.Container;
  private nameText!: Phaser.GameObjects.Text;
  private hpFill!: Phaser.GameObjects.Image;
  private hpTrail!: Phaser.GameObjects.Image;
  private mpFill!: Phaser.GameObjects.Image;
  private expFill!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;
  private mpText!: Phaser.GameObjects.Text;
  private expText!: Phaser.GameObjects.Text;
  /** active shop boosts under the portrait, and when each ends (local clock) */
  private boostText!: Phaser.GameObjects.Text;
  private boostEnds: Record<string, number> = {};
  private pkText!: Phaser.GameObjects.Text;
  private buffRow!: Phaser.GameObjects.Container;
  private trailPct = 1;

  private targetPanel!: Phaser.GameObjects.Container;
  private targetName!: Phaser.GameObjects.Text;
  private targetFill!: Phaser.GameObjects.Image;
  private targetHp!: Phaser.GameObjects.Text;
  private bossPanel!: Phaser.GameObjects.Container;
  private bossFill!: Phaser.GameObjects.Image;
  private bossName!: Phaser.GameObjects.Text;

  private skillBar!: Phaser.GameObjects.Container;
  private slots: Slot[] = [];
  private potionSlots: PotionSlot[] = [];
  private barWidth = 0;
  private inventoryUI!: InventoryUI;
  private passUI!: PassUI;
  private shopUI!: ShopUI;
  private chat?: ChatUI;
  private partyBox!: Phaser.GameObjects.Container;
  private party: PartyMember[] = [];
  private inviteBtn!: Phaser.GameObjects.Text;
  private friendBtn!: Phaser.GameObjects.Text;
  private guildBtn!: Phaser.GameObjects.Text;
  private targetInfo: TargetInfo | null = null;
  private wbBox!: Phaser.GameObjects.Container;
  private wbText!: Phaser.GameObjects.Text;
  private wbStatus!: Phaser.GameObjects.Text;
  private wbState: WbStatus | null = null;
  private wbResultWin?: Phaser.GameObjects.Container;
  private tooltip!: Phaser.GameObjects.Text;

  private minimap!: Phaser.GameObjects.Container;
  private minimapDots!: Phaser.GameObjects.Graphics;
  private minimapView!: Phaser.Textures.CanvasTexture;
  private minimapLabel!: Phaser.GameObjects.Text;
  private terrain: HTMLCanvasElement | null = null;

  private questBox!: Phaser.GameObjects.Container;
  private questTitle!: Phaser.GameObjects.Text;
  private questGoal!: Phaser.GameObjects.Text;
  private questAuto!: Phaser.GameObjects.Text;
  private dailyBox!: Phaser.GameObjects.Container;
  private dailyText!: Phaser.GameObjects.Text;
  private dailyHead!: Phaser.GameObjects.Text;
  private dailyShown = false;
  private friends: FriendRow[] = [];
  private friendsMax = 50;
  private friendsWin?: Phaser.GameObjects.Container;
  private friendsPage = 0;
  private friendConfirm = "";
  private guild: GuildState = { guild: null };
  private guildWin?: Phaser.GameObjects.Container;
  private guildConfirm = "";
  private scoreBox!: Phaser.GameObjects.Container;
  private scoreText!: Phaser.GameObjects.Text;

  private buttons!: Phaser.GameObjects.Container;
  private autoFarmText!: Phaser.GameObjects.Text;
  private feed: Phaser.GameObjects.Text[] = [];
  private book?: Phaser.GameObjects.Container;
  private charPanel?: Phaser.GameObjects.Container;
  private dialog?: Phaser.GameObjects.Container;
  private death!: Phaser.GameObjects.Container;
  private deathCount!: Phaser.GameObjects.Text;
  private deathKiller!: Phaser.GameObjects.Text;
  private deathTimer?: Phaser.Time.TimerEvent;
  // touch controls
  private mobile = false;
  private barBg!: Phaser.GameObjects.Graphics;
  private potionRoots: Phaser.GameObjects.Container[] = [];
  private menuItems: Phaser.GameObjects.Container[] = [];
  private menuOpen = false;
  private menuShade?: Phaser.GameObjects.Rectangle;
  private menuBtn?: Phaser.GameObjects.Container;
  private touchBtns: Phaser.GameObjects.Container[] = [];
  private joyRoot?: Phaser.GameObjects.Container;
  private joyKnob?: Phaser.GameObjects.Graphics;
  private joyZone?: Phaser.GameObjects.Zone;
  private joyPtr = -1;
  private joyHome = { x: 0, y: 0 };
  private covered = false;

  constructor() {
    super({ key: "HUDScene" });
  }

  init(data: { charClass: string }): void {
    this.cls = data.charClass;
    this.slots = [];
    this.potionSlots = [];
    this.feed = [];
    this.hero = null;
    this.map = null;
    this.book = this.charPanel = this.dialog = undefined;
    this.potionRoots = [];
    this.menuItems = [];
    this.touchBtns = [];
    this.menuOpen = false;
    this.joyPtr = -1;
    this.covered = false;
    this.menuShade = this.menuBtn = this.joyRoot = this.joyKnob = this.joyZone = undefined;
  }

  create(): void {
    ensureTextures(this);
    ensureSkillIcons(this, [...META.skills, ...META.passives]);
    ensureItemIcons(this);
    this.inventoryUI = new InventoryUI(this, (a) => this.scene.get("GameScene").events.emit("inv_action", a), this.cls);
    this.passUI = new PassUI(this, (a) => this.scene.get("GameScene").events.emit("inv_action", a), () => this.toggleShop("destaques"));
    this.shopUI = new ShopUI(this, (a) => this.scene.get("GameScene").events.emit("inv_action", a));
    this.mobile = isTouch();
    this.chat = new ChatUI((m) => this.scene.get("GameScene").events.emit("inv_action", m));
    this.chat.onFriends = () => this.toggleFriends();
    this.chat.onGuild = () => this.toggleGuild();
    this.events.once("shutdown", () => { this.chat?.destroy(); this.chat = undefined; });
    this.vignette = this.add.image(0, 0, "vignette").setOrigin(0);
    this.hurt = this.add.image(0, 0, "vignette_red").setOrigin(0).setAlpha(0);

    this.buildPlayerPanel();
    this.buildTarget();
    this.buildSkillBar();
    this.buildMinimap();
    this.buildQuest();
    this.buildScore();
    this.partyBox = this.add.container(10, 150);
    this.buildWorldBoss();
    this.buildButtons();
    if (this.mobile) { this.buildTouch(); this.chat.setTouch(64); }
    this.buildDeath();
    this.tooltip = this.add.text(0, 0, "", txt(11, "#f3e3b8", {
      align: "left", backgroundColor: "#120e18", padding: { x: 8, y: 6 }, wordWrap: { width: 230 },
    })).setOrigin(0.5, 1).setVisible(false).setDepth(50);

    this.layout();
    this.scale.on("resize", this.layout, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.layout, this));

    const game = this.scene.get("GameScene");
    game.events.on("hero", (h: HeroState) => { this.hero = h; this.refreshHero(); this.inventoryUI.setHero(h); });
    game.events.on("inventory", (inv: InventoryState) => this.onInventory(inv));
    game.events.on("shop", (m: ShopMsg) => { this.closeWindows(); this.inventoryUI.openShop(m); });
    game.events.on("forge", (m: { name: string }) => { this.closeWindows(); this.inventoryUI.openForge(m); });
    // the market also sends refreshes (a sale, a new page): only clear other windows when it first opens
    game.events.on("market", (m: MarketMsg) => {
      if (!this.inventoryUI.inMarket) this.closeWindows();
      this.inventoryUI.openMarket(m);
    });
    game.events.on("forge_result", (r: { ok: boolean; text: string }) => {
      this.inventoryUI.forgeResult(r);
      this.toast(r.text, r.ok ? "#9dff8a" : "#ff8a7a");
    });
    game.events.on("toggle_inv", () => this.toggleInv());
    game.events.on("chat", (m: ChatMsg) => this.chat?.add(m));
    game.events.on("open_chat", () => this.chat?.openInput());
    game.events.on("party", (members: PartyMember[]) => { this.party = members; this.drawParty(); });
    game.events.on("daily", (d: DailyState) => this.drawDaily(d));
    game.events.on("friends", (m: { friends: FriendRow[]; max: number }) => {
      this.friends = m.friends;
      this.friendsMax = m.max;
      if (this.friendsWin) this.drawFriends();
      if (this.targetInfo) this.showTarget(this.targetInfo);
    });
    game.events.on("toggle_friends", () => this.toggleFriends());
    game.events.on("season", (st: SeasonState) => { this.passUI.set(st); this.shopUI.setSeason(st); });
    game.events.on("hero", (h: HeroState) => this.shopUI.setHero(h));
    game.events.on("toggle_shop", () => this.toggleShop());
    game.events.on("toggle_pass", () => this.togglePass());
    game.events.on("guild", (st: GuildState) => {
      this.guild = st;
      if (this.guildWin) this.drawGuild();
      if (this.targetInfo) this.showTarget(this.targetInfo);
    });
    game.events.on("toggle_guild", () => this.toggleGuild());
    game.events.on("wb_status", (s: WbStatus) => { this.wbState = s; this.drawWbStatus(); });
    game.events.on("wb_scores", (s: WbScores) => this.drawWbScores(s));
    game.events.on("wb_result", (r: WbResult) => this.showWbResult(r));
    const early = (game as GameScene).inventory;
    if (early) this.onInventory(early);
    game.events.on("map_info", (m: MapInfo) => this.onMap(m));
    game.events.on("portals_update", (m: MapInfo) => {
      this.textures.remove(`terrain_${m.map_id}`);
      this.terrain = this.textures.get(terrainMapTexture(this, m)).getSourceImage() as HTMLCanvasElement;
    });
    game.events.on("player_hurt", () => { this.hurt.setAlpha(0.7); this.tweens.add({ targets: this.hurt, alpha: 0, duration: 450 }); });
    game.events.on("target_update", (t: TargetInfo | null) => this.showTarget(t));
    game.events.on("boss_update", (b: { name: string; hp: number; maxHp: number } | null) => this.showBoss(b));
    game.events.on("skill_cast", (id: string) => {
      const s = this.slots.find((x) => x.skill.id === id);
      if (!s) return;
      s.readyAt = this.time.now + s.skill.cd;
      this.tweens.add({ targets: s.root, scale: 0.88, duration: 70, yoyo: true });
    });
    game.events.on("loot", (l: { exp: number; gold: number; loot: string[]; party?: boolean }) => this.pushLoot(l));
    game.events.on("notice", (n: { text: string; kind: string }) => this.toast(n.text, n.kind === "warn" ? "#ffb070" : n.kind === "quest" ? "#ffd77a" : "#e8dcc0"));
    game.events.on("level_up", (m: { level: number; unlocked: string[] }) => this.levelBanner(m.level, m.unlocked));
    game.events.on("dialog", (d: DialogMsg) => this.showDialog(d));
    game.events.on("arena_scores", (rows: ScoreRow[]) => this.showScores(rows));
    game.events.on("kill_feed", (t: string) => this.feedLine(t, "#ff8a7a"));
    game.events.on("player_dead", (secs: number, killer?: string) => this.showDeath(secs, killer));
    game.events.on("player_respawned", () => this.hideDeath());
    game.events.on("story_end", (m: { title?: string; text?: string }) => this.storyEnd(m));
    game.events.on("toggle_book", () => this.toggleBook());
    game.events.on("toggle_char", () => this.toggleChar());
    game.events.on("escape", () => this.closeAll());
    game.events.on("auto_state", (mode: "farm" | "quest" | null) => {
      this.autoFarmText.setText(mode === "farm" ? "Auto-Farm: LIGADO" : mode === "quest" ? "Auto: Missão" : "Auto-Farm: DESLIGADO")
        .setColor(mode ? "#9dff8a" : "#bfa77a");
      this.questAuto.setText(mode === "quest" ? "■ parar" : "▶ automático").setColor(mode === "quest" ? "#9dff8a" : "#d8c28a");
    });

    this.time.addEvent({ delay: 5000, loop: true, callback: () => socket.sendPing() });
    this.time.addEvent({ delay: 150, loop: true, callback: () => this.drawMinimap() });
  }

  update(time: number): void {
    if (this.mobile) this.coverTouch();
    if (!this.hero) return;
    if (this.hero.pk && this.hero.pk.status !== "white") this.updatePkText();
    const hpPct = Phaser.Math.Clamp(this.hero.hp / this.hero.max_hp, 0, 1);
    this.trailPct = this.trailPct > hpPct ? Math.max(hpPct, this.trailPct - 0.006) : hpPct;
    this.hpTrail.setCrop(0, 0, BAR_TEX_W * this.trailPct, 16);
    for (const s of this.slots) {
      const left = s.readyAt - time;
      s.cd.clear();
      const locked = this.hero.level < s.skill.lvl;
      if (left > 0 && !locked) {
        s.cd.fillStyle(0x000000, 0.68);
        s.cd.slice(0, 0, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / s.skill.cd), false);
        s.cd.fillPath();
        s.cdText.setText(left > 1000 ? `${Math.ceil(left / 1000)}` : (left / 1000).toFixed(1));
      } else {
        s.cdText.setText("");
      }
      s.icon.setAlpha(locked ? 0.18 : this.hero.mp >= s.skill.mp ? 1 : 0.4);
    }
  }

  // ── Build ────────────────────────────────────────────────────────────

  private buildPlayerPanel(): void {
    const info = CLASS_INFO[this.cls];
    const frame = this.add.image(0, 0, "hud_player_frame").setOrigin(0);
    const portrait = this.add.image(46, 46, portraitFromSheet(this, `unit_${this.cls}`) ?? `portrait_${this.cls}`);
    this.nameText = this.add.text(98, 17, "", txt(13, info.color, { fontStyle: "bold" }));
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.85).fillRoundedRect(96, 37, 190, 15, 3).fillRoundedRect(96, 55, 190, 11, 3).fillRoundedRect(96, 69, 190, 6, 2);
    const sx = 186 / BAR_TEX_W;
    this.hpTrail = this.add.image(98, 39, "bar_trail").setOrigin(0).setScale(sx, 11 / 16);
    this.hpFill = this.add.image(98, 39, "bar_hp").setOrigin(0).setScale(sx, 11 / 16);
    this.mpFill = this.add.image(98, 57, "bar_mp").setOrigin(0).setScale(sx, 7 / 16);
    this.expFill = this.add.graphics();
    this.hpText = this.add.text(191, 44.5, "", txt(9, "#ffffff")).setOrigin(0.5).setResolution(2);
    this.mpText = this.add.text(191, 60.5, "", txt(8, "#dfe8ff")).setOrigin(0.5).setResolution(2);
    this.expText = this.add.text(98, 77, "", txt(8, "#e8d49a")).setResolution(2);
    this.buffRow = this.add.container(98, 96);
    this.pkText = this.add.text(12, 120, "", txt(9, "#ff4a4a", { fontStyle: "bold" })).setResolution(2);
    this.boostText = this.add.text(12, 136, "", txt(9, "#9dff8a", { fontStyle: "bold", lineSpacing: 2 })).setResolution(2);
    this.playerPanel = this.add.container(10, 8, [frame, portrait, this.nameText, bg, this.hpTrail, this.hpFill, this.mpFill,
      this.expFill, this.hpText, this.mpText, this.expText, this.buffRow, this.pkText, this.boostText]);
    // the shop boosts count down on screen (minutes), between hero updates
    this.time.addEvent({ delay: 10_000, loop: true, callback: () => this.refreshBoosts() });
  }

  private buildTarget(): void {
    const frame = this.add.image(0, 0, "hud_target_frame").setOrigin(0.5, 0);
    this.targetName = this.add.text(0, 9, "", txt(12, "#e07a6a", { fontStyle: "bold" })).setOrigin(0.5, 0);
    const bg = this.add.graphics().fillStyle(0x000000, 0.85).fillRoundedRect(-112, 30, 224, 14, 3);
    this.targetFill = this.add.image(-110, 32, "bar_enemy").setOrigin(0).setScale(220 / BAR_TEX_W, 10 / 16);
    this.targetHp = this.add.text(0, 37, "", txt(9, "#ffffff")).setOrigin(0.5).setResolution(2);
    this.inviteBtn = this.add.text(0, 58, "+ Convidar para o grupo", txt(11, PARTY_COLOR, {
      backgroundColor: "#13201a", padding: { x: 8, y: 3 },
    })).setOrigin(0.5, 0).setInteractive({ useHandCursor: true }).setVisible(false);
    this.inviteBtn.on("pointerdown", () => {
      if (this.targetInfo?.hero) this.scene.get("GameScene").events.emit("inv_action", { type: "party_invite", name: this.targetInfo.name });
    });
    this.friendBtn = this.add.text(0, 84, "+ Amigo", txt(11, "#d8a8ff", {
      backgroundColor: "#1a1420", padding: { x: 8, y: 3 },
    })).setOrigin(0.5, 0).setInteractive({ useHandCursor: true }).setVisible(false);
    this.friendBtn.on("pointerdown", () => {
      if (this.targetInfo?.hero) this.scene.get("GameScene").events.emit("inv_action", { type: "friend_add", name: this.targetInfo.name });
    });
    this.guildBtn = this.add.text(0, 110, "+ Guilda", txt(11, "#8fd0ff", {
      backgroundColor: "#0e1a22", padding: { x: 8, y: 3 },
    })).setOrigin(0.5, 0).setInteractive({ useHandCursor: true }).setVisible(false);
    this.guildBtn.on("pointerdown", () => {
      if (this.targetInfo?.hero) this.scene.get("GameScene").events.emit("inv_action", { type: "guild_invite", name: this.targetInfo.name });
    });
    this.targetPanel = this.add.container(0, 10, [frame, this.targetName, bg, this.targetFill, this.targetHp, this.inviteBtn,
      this.friendBtn, this.guildBtn]).setVisible(false);

    const g = this.add.graphics();
    panel(g, -190, 0, 380, 44, 6);
    this.bossName = this.add.text(0, 6, "", txt(13, "#d8a8ff", { fontStyle: "bold" })).setOrigin(0.5, 0);
    const bb = this.add.graphics().fillStyle(0x000000, 0.9).fillRoundedRect(-176, 25, 352, 12, 3);
    this.bossFill = this.add.image(-174, 27, "bar_enemy").setOrigin(0).setScale(348 / BAR_TEX_W, 8 / 16);
    this.bossPanel = this.add.container(0, 0, [g, this.bossName, bb, this.bossFill]).setVisible(false);
  }

  private buildSkillBar(): void {
    const skills = classSkills(this.cls);
    const potW = POTIONS.length * (SLOT + 4) + 10;
    const w = skills.length * (SLOT + 4) + 14 + potW;
    this.barWidth = w;
    const g = this.add.graphics();
    panel(g, -w / 2, -SLOT - 18, w, SLOT + 16, 10);
    this.barBg = g;
    g.lineStyle(1, 0x6b5226, 0.8).lineBetween(-w / 2 + potW + 3, -SLOT - 12, -w / 2 + potW + 3, -8);
    this.skillBar = this.add.container(0, 0, [g]);
    POTIONS.forEach((pt, i) => {
      const slotImg = this.add.image(0, 0, "hud_slot").setScale(SLOT / 60);
      const icon = this.add.image(0, 0, pt.icon).setScale((SLOT - 8) / 48);
      const key = this.add.text(-SLOT / 2 + 4, -SLOT / 2 + 2, pt.key, txt(10, "#ffd77a", { fontStyle: "bold" }));
      const count = this.add.text(SLOT / 2 - 3, SLOT / 2 - 2, "0", txt(10, "#ffffff", { fontStyle: "bold" })).setOrigin(1, 1);
      const root = this.add.container(-w / 2 + 7 + SLOT / 2 + i * (SLOT + 4), -SLOT / 2 - 10, [slotImg, icon, key, count]);
      root.setSize(SLOT, SLOT).setInteractive({ useHandCursor: true });
      root.on("pointerdown", () => {
        this.scene.get("GameScene").events.emit("inv_action", { type: "use_potion", kind: pt.kind });
        this.tweens.add({ targets: root, scale: 0.88, duration: 70, yoyo: true });
      });
      root.on("pointerover", () => {
        if (this.mobile) return;
        const m = root.getWorldTransformMatrix();
        this.tooltip.setText(pt.kind === "hp" ? "POÇÕES DE VIDA (Q)\nBebe a poção de vida que melhor cobre o que falta."
          : "POÇÕES DE MANA (E)\nBebe a poção de mana que melhor cobre o que falta.")
          .setVisible(true).setPosition(Phaser.Math.Clamp(m.tx, 130, this.scale.width - 130), m.ty - SLOT / 2 - 6);
      });
      root.on("pointerout", () => this.tooltip.setVisible(false));
      this.skillBar.add(root);
      this.potionSlots.push({ kind: pt.kind, icon, count });
      this.potionRoots.push(root);
    });
    const x0 = -w / 2 + potW + 7 + SLOT / 2;
    skills.forEach((skill, i) => {
      const slotImg = this.add.image(0, 0, "hud_slot").setScale(SLOT / 60);
      const icon = this.add.image(0, 0, `icon_${skill.id}`).setScale((SLOT - 6) / 48);
      const cd = this.add.graphics();
      const cdText = this.add.text(0, 0, "", txt(14, "#ffffff", { fontStyle: "bold" })).setOrigin(0.5);
      const key = this.add.text(-SLOT / 2 + 4, -SLOT / 2 + 2, KEYS[i], txt(10, "#ffd77a", { fontStyle: "bold" }));
      const lock = this.add.text(0, 6, `Nv ${skill.lvl}`, txt(10, "#c8b0ff", { fontStyle: "bold" })).setOrigin(0.5);
      const root = this.add.container(x0 + i * (SLOT + 4), -SLOT / 2 - 10, [slotImg, icon, cd, cdText, key, lock]);
      root.setSize(SLOT, SLOT).setInteractive({ useHandCursor: true });
      root.on("pointerdown", () => this.scene.get("GameScene").events.emit("request_skill", i));
      root.on("pointerover", () => {
        const m = root.getWorldTransformMatrix();
        this.showTooltip(skill, m.tx, m.ty - SLOT / 2 - 6);
      });
      root.on("pointerout", () => this.tooltip.setVisible(false));
      this.skillBar.add(root);
      this.slots.push({ skill, root, icon, cd, cdText, lock, readyAt: 0 });
    });
  }

  private showTooltip(s: SkillDef, x: number, y: number): void {
    if (this.mobile) return; // a tap casts the skill; the skill book explains them
    const lines = [s.name.toUpperCase(), s.desc];
    if (s.passive) lines.push(`Passiva · Nível ${s.lvl}`);
    else lines.push(`${s.mp} mana · recarga ${(s.cd / 1000).toFixed(1)}s${s.range > 2.5 ? ` · alcance ${s.range}` : ""}`, `Nível necessário: ${s.lvl}`);
    this.tooltip.setText(lines.join("\n")).setVisible(true).setPosition(
      Phaser.Math.Clamp(x, 130, this.scale.width - 130), y);
  }

  private buildMinimap(): void {
    const frame = this.add.image(0, 0, "hud_minimap");
    if (this.textures.exists("minimap_view")) this.textures.remove("minimap_view");
    this.minimapView = this.textures.createCanvas("minimap_view", 140, 140)!;
    const view = this.add.image(0, 0, "minimap_view");
    this.minimapDots = this.add.graphics();
    this.minimapLabel = this.add.text(0, 82, "", txt(11, "#d9c28a", { align: "center" })).setOrigin(0.5, 0);
    this.minimap = this.add.container(0, 0, [frame, view, this.minimapDots, this.minimapLabel]);
  }

  private buildQuest(): void {
    const g = this.add.graphics();
    panel(g, 0, 0, 200, 58, 6, 0.8);
    const head = this.add.text(10, 6, "HISTÓRIA", txt(9, "#a8987a"));
    this.questTitle = this.add.text(10, 19, "", txt(11, "#ffd77a", { fontStyle: "bold" }));
    this.questGoal = this.add.text(10, 36, "", txt(10, "#e8dcc0", { wordWrap: { width: 182 } }));
    this.questAuto = this.add.text(190, 5, "▶ automático", txt(9, "#d8c28a")).setOrigin(1, 0);
    const hit = this.add.zone(0, 0, 200, 58).setOrigin(0).setInteractive({ useHandCursor: true });
    hit.on("pointerdown", () => this.scene.get("GameScene").events.emit("auto_quest"));
    hit.on("pointerover", () => g.setAlpha(0.8)).on("pointerout", () => g.setAlpha(1));
    this.questBox = this.add.container(0, 0, [g, head, this.questTitle, this.questGoal, this.questAuto, hit]);
    const dg = this.add.graphics();
    panel(dg, 0, 0, 200, 76, 6, 0.8);
    this.dailyHead = this.add.text(10, 6, "MISSÕES DIÁRIAS", txt(9, "#a8987a"));
    this.dailyText = this.add.text(10, 20, "", txt(10, "#e8dcc0", { lineSpacing: 3, wordWrap: { width: 184 } }));
    this.dailyBox = this.add.container(0, 0, [dg, this.dailyHead, this.dailyText]).setVisible(false);
  }

  private drawDaily(d: DailyState): void {
    const short = (s: string) => s.replace("Derrote ", "").replace(" nas Minas", "").replace(/Tente aprimorar equipamentos (\d+)× na forja/, "Aprimore na forja");
    this.dailyText.setText(d.tasks.map((t) => {
      const mark = t.claimed ? "✔" : t.n >= t.count ? "★" : "•";
      return `${mark} ${short(t.text)} ${t.claimed ? "" : `${t.n}/${t.count}`}`.trim();
    }).join("\n"));
    const ready = d.tasks.some((t) => t.n >= t.count && !t.claimed);
    this.dailyHead.setText(d.bonus ? "MISSÕES DIÁRIAS — FEITAS HOJE" : ready ? "MISSÕES DIÁRIAS — FALE COM HALD" : "MISSÕES DIÁRIAS")
      .setColor(ready ? "#ffd77a" : "#a8987a");
    this.dailyShown = true;
    this.layout();
  }

  private buildScore(): void {
    const g = this.add.graphics();
    panel(g, 0, 0, 200, 150, 6, 0.85);
    const head = this.add.text(100, 7, "PLACAR DA ARENA", txt(11, "#ff9a8a", { fontStyle: "bold" })).setOrigin(0.5, 0);
    this.scoreText = this.add.text(10, 26, "", txt(10, "#e8dcc0", { lineSpacing: 3 }));
    this.scoreBox = this.add.container(0, 0, [g, head, this.scoreText]).setVisible(false);
  }

  private buildButtons(): void {
    const mk = (label: string, y: number, onClick: () => void): Phaser.GameObjects.Text => {
      const bg = this.add.image(0, y, "hud_button").setScale(0.78, 0.7);
      // phones have no keyboard: no shortcut hints on the buttons
      const t = this.add.text(0, y, this.mobile ? label.replace(/ \([^)]*\)$/, "") : label, txt(11, "#bfa77a")).setOrigin(0.5);
      const c = this.add.container(0, 0, [bg, t]);
      c.setData("y", y);
      this.menuItems.push(c);
      bg.setInteractive({ useHandCursor: true }).on("pointerdown", () => { onClick(); if (this.mobile) this.setMenu(false); })
        .on("pointerover", () => bg.setAlpha(0.8)).on("pointerout", () => bg.setAlpha(1));
      this.buttons.add(c);
      return t;
    };
    this.buttons = this.add.container(0, 0);
    const q = mk(`Gráficos: ${QUALITY_NAMES[quality()]}`, -228, () => {
      const next = cycleQuality();
      q.setText(`Gráficos: ${QUALITY_NAMES[next]}`);
      (this.scene.get("GameScene") as GameScene).applyQuality();
      this.toast(next === "baixa" ? "Gráficos: Baixa — sem neblina, sombras e balanço das árvores (mais leve)."
        : next === "media" ? "Gráficos: Média — sem os raios de luz." : "Gráficos: Alta — todos os efeitos ligados.", "#e8dcc0");
    });
    mk("◆ Loja (L)", -292, () => this.toggleShop());
    mk("★ Passe (P)", -260, () => this.togglePass());
    mk("Guilda (G)", -196, () => this.toggleGuild());
    mk("Amigos (F)", -164, () => this.toggleFriends());
    mk("Chat (Enter)", -132, () => this.chat?.openInput());
    mk("Inventário (I)", -100, () => this.toggleInv());
    mk("Livro de Skills (K)", -68, () => this.toggleBook());
    mk("Personagem (C)", -36, () => this.toggleChar());
    this.autoFarmText = mk("Auto-Farm: DESLIGADO", -4, () => this.scene.get("GameScene").events.emit("toggle_autofarm"));
    if (this.mobile) mk("Montaria", 28, () => this.scene.get("GameScene").events.emit("toggle_mount"));
  }

  private buildDeath(): void {
    const shade = this.add.rectangle(0, 0, 10, 10, 0x0a0000, 0.6).setOrigin(0);
    const red = this.add.image(0, 0, "vignette_red").setOrigin(0);
    const title = this.add.text(0, 0, "VOCÊ MORREU", txt(52, "#b3141f", { fontStyle: "bold", strokeThickness: 6 })).setOrigin(0.5);
    title.setShadow(0, 0, "#ff2030", 18, true, true).setPadding(32, 24, 32, 24);
    this.deathKiller = this.add.text(0, 0, "", txt(15, "#ffb0a0")).setOrigin(0.5);
    this.deathCount = this.add.text(0, 0, "", txt(17, "#d8c8b0")).setOrigin(0.5);
    this.death = this.add.container(0, 0, [shade, red, title, this.deathKiller, this.deathCount]).setVisible(false).setDepth(100);
    this.death.setData({ shade, red, title });
  }

  private layout(): void {
    const w = this.scale.width, h = this.scale.height;
    this.vignette.setDisplaySize(w, h);
    this.hurt.setDisplaySize(w, h);
    this.targetPanel.setPosition(w / 2, 10);
    this.bossPanel.setPosition(w / 2, 70);
    const barW = this.barWidth;
    const barScale = Math.min(1, (w - 12) / barW);
    this.skillBar.setPosition(w / 2, h - 6).setScale(barScale);
    const compact = w < 760, tiny = w < 600;
    const mm = tiny ? 0.55 : compact ? 0.8 : 1;
    this.minimap.setPosition(w - 84 * mm, 84 * mm).setScale(mm);
    this.questBox.setPosition(w - 210, compact ? 192 : 206).setVisible(!tiny);
    const dailyH = this.dailyShown && !tiny ? 92 : 0;
    this.dailyBox?.setPosition(w - 210, (compact ? 192 : 206) + 64).setVisible(this.dailyShown && !tiny);
    this.scoreBox.setPosition(10, 128).setScale(tiny ? 0.75 : 1);
    this.wbBox?.setPosition(10, 128).setScale(tiny ? 0.75 : 1);
    const boxBelow = this.scoreBox.visible ? 150 * this.scoreBox.scaleY : this.wbBox?.visible ? 180 * this.wbBox.scaleY : 0;
    this.partyBox?.setPosition(10, boxBelow ? 128 + boxBelow + 8 : tiny ? 112 : 146).setScale(tiny ? 0.8 : 1);
    this.wbStatus?.setPosition(w - 210, (compact ? 192 : 206) + (tiny ? -80 : 64 + dailyH)).setVisible(true);
    this.wbResultWin?.setPosition(w / 2, h / 2);
    this.buttons.setPosition(w - 92, h - 84 - (SLOT + 20) * (barScale < 1 ? 1 - barScale : 0)).setVisible(!tiny);
    this.inventoryUI?.layout();
    this.playerPanel.setScale(tiny ? 0.72 : 1);
    // chat sits beside the skill bar when there is room, otherwise above it; the loot feed stacks on top
    const free = (w - barW * barScale) / 2 - 20;
    const chatBottom = free >= 260 ? 10 : (SLOT + 26) * barScale + 8;
    this.chat?.place(chatBottom, free >= 260 ? Math.min(340, free) : Math.min(340, w - 20));
    const feedBase = h - chatBottom - (this.chat?.height() ?? 120) - 8;
    this.feed.forEach((t, i) => t.setPosition(12, feedBase - i * 18));
    const d = this.death.getData(["shade", "red", "title"]) as [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Image, Phaser.GameObjects.Text];
    d[0].setSize(w, h);
    d[1].setDisplaySize(w, h);
    d[2].setPosition(w / 2, h * 0.4);
    this.deathKiller.setPosition(w / 2, h * 0.4 + 46);
    this.deathCount.setPosition(w / 2, h * 0.4 + 74);
    const fit = Math.min(1, (h - 20) / 480, (w - 20) / 670);
    this.book?.setPosition(w / 2, h / 2).setScale(fit);
    this.charPanel?.setPosition(w / 2, h / 2).setScale(Math.min(1, (h - 20) / 340));
    this.dialog?.setPosition(w / 2, h - 96);
    if (this.mobile) this.layoutTouch(w, h);
  }

  // ── Touch controls (phones and tablets) ─────────────────────────────

  /** A round button with a short label (Menu, Alvo, Montar). */
  private roundBtn(label: string, r: number, action: () => void): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    g.fillStyle(0x120e18, 0.82).fillCircle(0, 0, r);
    g.lineStyle(2, 0xd6aa5a, 0.85).strokeCircle(0, 0, r);
    g.lineStyle(1, 0xd6aa5a, 0.3).strokeCircle(0, 0, r - 5);
    const t = this.add.text(0, 0, label, txt(label.length > 5 ? 9 : 10, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5);
    const c = this.add.container(0, 0, [g, t]).setSize(r * 2, r * 2).setInteractive({ useHandCursor: true }).setDepth(6);
    c.on("pointerdown", () => {
      action();
      this.tweens.add({ targets: c, scale: 0.86, duration: 70, yoyo: true });
    });
    return c;
  }

  private buildTouch(): void {
    // the joystick appears wherever the thumb lands in the lower left of the screen
    const base = this.add.graphics();
    base.fillStyle(0x000000, 0.35).fillCircle(0, 0, JOY_R);
    base.lineStyle(2, 0xd6aa5a, 0.55).strokeCircle(0, 0, JOY_R);
    base.lineStyle(1, 0xd6aa5a, 0.25).strokeCircle(0, 0, JOY_R * 0.55);
    this.joyKnob = this.add.graphics();
    this.joyKnob.fillStyle(0x2a2030, 0.95).fillCircle(0, 0, 26).lineStyle(2, 0xffd77a, 0.9).strokeCircle(0, 0, 26);
    this.joyRoot = this.add.container(0, 0, [base, this.joyKnob]).setAlpha(0.5).setDepth(5);
    this.joyZone = this.add.zone(0, 0, 10, 10).setOrigin(0, 1).setInteractive();
    this.joyZone.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      if (this.joyPtr >= 0) return;
      this.joyPtr = ptr.id;
      this.registry.set("joyPointer", ptr.id);
      this.joyRoot!.setPosition(ptr.x, ptr.y).setAlpha(1);
      this.moveJoy(ptr);
    });
    this.input.on("pointermove", (ptr: Phaser.Input.Pointer) => { if (ptr.id === this.joyPtr) this.moveJoy(ptr); });
    const up = (ptr: Phaser.Input.Pointer) => { if (ptr.id === this.joyPtr) this.releaseJoy(); };
    this.input.on("pointerup", up);
    this.input.on("pointerupoutside", up);
    this.input.on("gameout", () => this.releaseJoy());
    this.events.once("shutdown", () => this.registry.set("joyPointer", -1));

    const game = () => this.scene.get("GameScene").events;
    this.menuBtn = this.roundBtn("MENU", 24, () => this.setMenu(!this.menuOpen));
    this.touchBtns.push(this.roundBtn("ALVO", 24, () => game().emit("cycle_target")));
    this.touchBtns.push(this.roundBtn("MONTAR", 24, () => game().emit("toggle_mount")));
    this.menuShade = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.6).setOrigin(0).setInteractive().setVisible(false).setDepth(59);
    this.menuShade.on("pointerdown", () => this.setMenu(false));
    this.buttons.setDepth(60).setVisible(false);
  }

  /** While a window or the menu is open, the joystick, the round buttons and the chat step aside. */
  private coverTouch(): void {
    const open = this.menuOpen || !!(this.book || this.charPanel || this.friendsWin || this.guildWin)
      || !!this.inventoryUI?.isOpen || !!this.passUI?.isOpen || !!this.shopUI?.isOpen;
    if (open === this.covered) return;
    this.covered = open;
    if (open) this.releaseJoy();
    this.chat?.setHidden(open);
    this.joyRoot?.setVisible(!open);
    if (open) this.joyZone?.disableInteractive(); else this.joyZone?.setInteractive();
    this.touchBtns.forEach((b) => b.setVisible(!open));
  }

  private moveJoy(ptr: Phaser.Input.Pointer): void {
    const dx = ptr.x - this.joyRoot!.x, dy = ptr.y - this.joyRoot!.y;
    const len = Math.hypot(dx, dy);
    const k = len > JOY_R ? JOY_R / len : 1;
    this.joyKnob!.setPosition(dx * k, dy * k);
    this.scene.get("GameScene").events.emit("joy", (dx * k) / JOY_R, (dy * k) / JOY_R);
  }

  private releaseJoy(): void {
    if (this.joyPtr < 0) return;
    this.joyPtr = -1;
    this.registry.set("joyPointer", -1);
    this.joyKnob!.setPosition(0, 0);
    this.joyRoot!.setPosition(this.joyHome.x, this.joyHome.y).setAlpha(0.5);
    this.scene.get("GameScene").events.emit("joy", 0, 0);
  }

  private setMenu(open: boolean): void {
    this.menuOpen = open;
    if (open) this.closeWindows();
    this.menuShade?.setVisible(open);
    this.buttons.setVisible(open);
  }

  /**
   * Phone layout: joystick bottom left with the chat above it, the skills as a big 5×2 grid bottom right with the
   * potions beside them, round buttons (target, mount) above the grid, the menu button next to the minimap and the
   * story box under it. Sizes follow the screen height, so any phone (and tablets) fits.
   */
  private layoutTouch(w: number, h: number): void {
    const k = h >= 560 ? 1.2 : h >= 450 ? 1.1 : 1;
    const step = (SLOT + 8) * k;
    const right = w - 10, bottom = h - 8;
    this.barBg.setVisible(false);
    this.skillBar.setPosition(0, 0).setScale(1);
    this.slots.forEach((s, i) => s.root.setPosition(right - (4.5 - (i % 5)) * step, bottom - (Math.floor(i / 5) + 0.5) * step).setScale(k));
    const gridLeft = right - 5 * step;
    this.potionRoots.forEach((r, i) => r.setPosition(gridLeft - step * 0.5 - 6, bottom - (i + 0.5) * step).setScale(k));
    const gridTop = bottom - Math.ceil(this.slots.length / 5) * step;
    this.touchBtns.forEach((b, i) => b.setPosition(right - 26 * k - i * 60 * k, gridTop - 32 * k).setScale(k));

    const mm = h < 450 ? 0.6 : h < 600 ? 0.75 : 0.9;
    this.minimap.setPosition(w - 84 * mm, 84 * mm).setScale(mm);
    this.menuBtn?.setPosition(w - 168 * mm - 34 * k, 34 * k).setScale(k);
    const qs = h < 450 ? 0.8 : 1;
    const qy = 168 * mm + 8;
    this.questBox.setPosition(w - 206 * qs, qy).setScale(qs).setVisible(true);
    const showDaily = this.dailyShown && h >= 470;
    this.dailyBox?.setPosition(w - 206 * qs, qy + 64 * qs).setScale(qs).setVisible(showDaily);
    this.wbStatus?.setPosition(w - 210 * qs, qy + (64 + (showDaily ? 84 : 0)) * qs).setScale(qs);
    this.playerPanel.setScale(h < 450 ? 0.78 : 0.92);

    this.joyHome = { x: 22 + JOY_R, y: h - 22 - JOY_R };
    if (this.joyPtr < 0) this.joyRoot?.setPosition(this.joyHome.x, this.joyHome.y);
    this.joyZone?.setPosition(0, h).setSize(Math.max(160, Math.min(w * 0.45, gridLeft - step - 40)), h * 0.62);
    const chatBottom = 22 + JOY_R * 2 + 10;
    this.chat?.place(chatBottom, Math.min(300, w * 0.36));
    const feedBase = h - chatBottom - (this.chat?.height() ?? 70) - 8;
    this.feed.forEach((t, i) => t.setPosition(12, feedBase - i * 18));

    // the menu: every window button in two columns, in the middle of the screen
    this.menuShade?.setSize(w, h);
    const rows = Math.ceil(this.menuItems.length / 2);
    this.menuItems.forEach((c, i) => {
      const y0 = c.getData("y") as number;
      c.setPosition(((i % 2) - 0.5) * 200, (Math.floor(i / 2) - (rows - 1) / 2) * 46 - y0 * 1.2).setScale(1.2);
    });
    this.buttons.setPosition(w / 2, h / 2).setScale(Math.min(1, (h - 24) / (rows * 46), (w - 20) / 410)).setVisible(this.menuOpen);
    this.dialog?.setPosition(w / 2, h - 96);
  }

  // ── Updates ──────────────────────────────────────────────────────────

  private refreshBoosts(): void {
    if (!this.boostText) return;
    const names: Record<string, string> = { exp: "EXP +50%", gold: "Ouro +50%" };
    const lines = Object.entries(this.boostEnds)
      .map(([k, end]) => [k, Math.ceil((end - Date.now()) / 60_000)] as const)
      .filter(([, min]) => min > 0)
      .map(([k, min]) => `⚡ ${names[k] ?? k} · ${min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}` : `${min} min`}`);
    this.boostText.setText(lines.join("\n"));
  }

  private refreshHero(): void {
    const h = this.hero!;
    const hpPct = Phaser.Math.Clamp(h.hp / h.max_hp, 0, 1);
    this.hpFill.setCrop(0, 0, BAR_TEX_W * hpPct, 16);
    this.mpFill.setCrop(0, 0, BAR_TEX_W * Phaser.Math.Clamp(h.mp / h.max_mp, 0, 1), 16);
    this.hpText.setText(`${Math.max(0, h.hp)} / ${h.max_hp}`);
    this.mpText.setText(`${h.mp} / ${h.max_mp}`);
    this.nameText.setText(`${h.name}  ·  Nv ${h.level}`);
    const ep = h.exp_next ? Phaser.Math.Clamp(h.exp / h.exp_next, 0, 1) : 1;
    this.expFill.clear().fillStyle(0xd9a040, 1).fillRoundedRect(97, 70, 188 * ep, 4, 2);
    this.expText.setText(h.level >= META.max_level ? "NÍVEL MÁXIMO" : `EXP ${fmtBig(h.exp)} / ${fmtBig(h.exp_next)}`);
    this.refreshPk();
    this.boostEnds = Object.fromEntries(Object.entries(h.boosts ?? {}).map(([k, s]) => [k, Date.now() + s * 1000]));
    this.refreshBoosts();
    for (const s of this.slots) s.lock.setVisible(h.level < s.skill.lvl);
    this.buffRow.removeAll(true);
    h.buffs.forEach((id, i) => {
      const icon = this.add.image(i * 24, 0, `icon_${id}`).setScale(20 / 48).setOrigin(0);
      this.buffRow.add(icon);
    });
    this.refreshQuest();
    if (this.charPanel) { this.charPanel.destroy(); this.charPanel = undefined; this.toggleChar(); }
  }

  private pkSince = 0;

  private refreshPk(): void {
    this.pkSince = this.time.now;
    this.updatePkText();
  }

  private updatePkText(): void {
    const pk = this.hero?.pk;
    if (!pk || pk.status === "white") { this.pkText.setText(""); return; }
    const gone = (this.time.now - this.pkSince) / 1000;
    const left = Math.max(0, Math.ceil((pk.status === "red" ? pk.red_left : pk.aggressor_left) - gone));
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    this.pkText.setText(pk.status === "red" ? `ASSASSINO  ${clock}  ·  NPCs não te atendem` : `AGRESSOR  ${clock}`)
      .setColor(PK_INFO[pk.status].color);
  }

  // ── World boss ───────────────────────────────────────────────────────

  private buildWorldBoss(): void {
    const g = this.add.graphics();
    panel(g, 0, 0, 220, 180, 6, 0.85);
    const head = this.add.text(110, 7, "BOSS GLOBAL", txt(11, "#ffb347", { fontStyle: "bold" })).setOrigin(0.5, 0);
    this.wbText = this.add.text(10, 26, "Aguardando o boss…", txt(10, "#e8dcc0", { lineSpacing: 3, wordWrap: { width: 200 } }));
    this.wbBox = this.add.container(10, 128, [g, head, this.wbText]).setVisible(false);
    // clickable line under the quest box: when the next boss comes, or a button to join it now
    this.wbStatus = this.add.text(0, 0, "", txt(10, "#ffb347", { backgroundColor: "#1a120a", padding: { x: 6, y: 3 }, wordWrap: { width: 196 } }))
      .setInteractive({ useHandCursor: true });
    this.wbStatus.on("pointerdown", () => {
      if (this.wbState?.state === "active") this.scene.get("GameScene").events.emit("inv_action", { type: "wb_join" });
    });
  }

  private drawWbStatus(): void {
    const s = this.wbState;
    if (!s) return;
    if (s.state === "active" && this.map?.map_id !== "worldboss_01") {
      this.wbStatus.setText(`⚔ BOSS GLOBAL ATIVO: ${s.boss}\nClique aqui para entrar`).setColor("#ffd77a");
      this.tweens.killTweensOf(this.wbStatus);
      this.tweens.add({ targets: this.wbStatus, alpha: { from: 1, to: 0.55 }, duration: 600, yoyo: true, repeat: -1 });
    } else {
      this.tweens.killTweensOf(this.wbStatus);
      this.wbStatus.setAlpha(1).setColor("#ffb347")
        .setText(s.state === "idle" ? `Boss Global: ${s.next_boss} às ${s.next_at}` : `Boss Global: ${s.boss ?? ""}`);
    }
    this.layout();
  }

  private drawWbScores(s: WbScores): void {
    const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
    const left = `${Math.floor(s.ends_in / 60)}:${String(s.ends_in % 60).padStart(2, "0")}`;
    const rows = s.rows.map((r, i) => `${i + 1}. ${r.name.slice(0, 12)}  ${fmt(r.dmg)} (${r.pct}%)`);
    this.wbText.setText([
      s.boss,
      `Jogadores: ${s.participants}  ·  vida ×${s.participants}`,
      `Tempo: ${left}`,
      "",
      ...(rows.length ? rows : ["Ninguém causou dano ainda"]),
      "",
      `Você: ${fmt(s.me)} (${s.me_pct}%)`,
    ].join("\n"));
  }

  private showWbResult(r: WbResult): void {
    this.wbResultWin?.destroy();
    const W = 380, H = 300;
    const g = this.add.graphics();
    panel(g, -W / 2, -H / 2, W, H, 12, 0.97);
    const blocker = this.add.zone(-W / 2, -H / 2, W, H).setOrigin(0).setInteractive();
    const medals = ["1º", "2º", "3º"];
    const items: Phaser.GameObjects.GameObject[] = [blocker, g,
      this.add.text(0, -H / 2 + 14, `${r.boss.toUpperCase()} FOI DERROTADO!`, txt(15, "#ffd77a", { fontStyle: "bold", align: "center", wordWrap: { width: W - 30 } })).setOrigin(0.5, 0),
      this.add.text(-W / 2 + 22, -H / 2 + 58, [
        "MAIOR DANO",
        ...r.top.map((t, i) => `${medals[i]}  ${t.name}  —  ${t.dmg} (${t.pct}%)`),
        "",
        `Último golpe: ${r.last_hit}`,
        `Jogadores no evento: ${r.participants}`,
        "",
        `Seu dano: ${r.dmg} (${r.pct}%)`,
        r.places.length ? `Você ganhou: ${r.places.join(" + ")}` : "Recompensa de participação",
      ].join("\n"), txt(11, "#e8dcc0", { lineSpacing: 4 })),
      this.add.text(-W / 2 + 22, H / 2 - 64, `Recompensas: ${r.rewards.join(", ")}`, txt(10, "#9dff8a", { wordWrap: { width: W - 44 } })),
    ];
    const close = this.add.text(0, H / 2 - 22, "Fechar", txt(12, "#bfa77a", { backgroundColor: "#1a140c", padding: { x: 12, y: 4 } }))
      .setOrigin(0.5).setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => { this.wbResultWin?.destroy(); this.wbResultWin = undefined; });
    items.push(close);
    this.wbResultWin = this.add.container(this.scale.width / 2, this.scale.height / 2, items).setDepth(110).setAlpha(0);
    this.tweens.add({ targets: this.wbResultWin, alpha: 1, duration: 300 });
  }

  /** Party frame: the other members with HP, leader star, and where they are. */
  private drawParty(): void {
    this.partyBox.removeAll(true);
    const others = this.party.filter((m) => m.id !== this.hero?.char_id);
    if (!others.length) return;
    const W = 196, rowH = 30, H = 26 + others.length * rowH;
    const g = this.add.graphics();
    panel(g, 0, 0, W, H, 6, 0.8);
    const items: Phaser.GameObjects.GameObject[] = [g, this.add.text(10, 6, "GRUPO", txt(9, "#a8987a"))];
    const leave = this.add.text(W - 10, 5, "Sair", txt(10, "#ff9a8a", { backgroundColor: "#1a0e0e", padding: { x: 5, y: 1 } }))
      .setOrigin(1, 0).setInteractive({ useHandCursor: true });
    leave.on("pointerdown", () => this.scene.get("GameScene").events.emit("inv_action", { type: "party_leave" }));
    items.push(leave);
    others.forEach((m, i) => {
      const y = 24 + i * rowH;
      const away = !m.online ? "offline" : m.map !== this.map?.map_id ? (META.maps[m.map]?.name ?? "outro mapa") : "";
      items.push(this.add.text(10, y, `${m.leader ? "★ " : ""}${m.name}  Nv ${m.level}`, txt(10, m.online ? PARTY_COLOR : "#7a7a70", { fontStyle: "bold" })));
      if (away) items.push(this.add.text(W - 10, y + 1, away, txt(8, "#a8987a")).setOrigin(1, 0));
      const pct = m.online ? Phaser.Math.Clamp(m.hp / m.max_hp, 0, 1) : 0;
      const bar = this.add.graphics();
      bar.fillStyle(0x000000, 0.85).fillRoundedRect(10, y + 15, W - 20, 6, 2);
      bar.fillStyle(pct > 0.5 ? 0x3fbf4a : pct > 0.25 ? 0xd07a20 : 0xd03030, 1).fillRoundedRect(10, y + 15, (W - 20) * pct, 6, 2);
      items.push(bar);
    });
    this.partyBox.add(items);
  }

  private refreshQuest(): void {
    const st = this.hero?.story;
    if (!st) return;
    const q = META.quests[st.q];
    if (st.st === "done" || !q) {
      this.questTitle.setText("História concluída");
      this.questGoal.setText("Desafie a Arena ou caçe nas terras sombrias.");
    } else if (st.st === "offer") {
      this.questTitle.setText(q.title);
      this.questGoal.setText("Fale com o Ancião Aldric (na entrada do mapa).");
    } else if (st.st === "active") {
      this.questTitle.setText(q.title);
      this.questGoal.setText(`${q.goal_text}: ${st.n}/${q.count}`);
    } else {
      this.questTitle.setText(q.title);
      this.questGoal.setText("Concluída! Fale com o Ancião Aldric (na entrada do mapa).");
    }
  }

  private onMap(m: MapInfo): void {
    this.map = m;
    this.terrain = this.textures.get(terrainMapTexture(this, m)).getSourceImage() as HTMLCanvasElement;
    this.minimapLabel.setText(`${m.name}\n${m.level}`);
    this.scoreBox.setVisible(m.pvp);
    this.wbBox.setVisible(!!m.event);
    this.drawWbStatus(); // "click to join" makes no sense once you are in the room
    this.drawParty();
    this.layout();
    this.showZoneTitle(m.name, m.pvp ? "PvP livre — cada abate conta pontos" : m.level);
    this.tooltip.setVisible(false);
    this.closeAll();
  }

  private showTarget(t: TargetInfo | null): void {
    this.targetInfo = t;
    if (!t || t.boss) { this.targetPanel.setVisible(false); return; }
    const myId = this.hero?.char_id;
    const leader = this.party.find((m) => m.leader)?.id;
    const canInvite = !!t.hero && (!this.party.length || leader === myId);
    this.inviteBtn.setVisible(canInvite);
    const isFriend = this.friends.some((f) => f.name === t.name);
    this.friendBtn.setVisible(!!t.hero && !isFriend).setY(canInvite ? 84 : 58);
    const rank = this.guild.guild?.my_rank;
    const canGuild = !!t.hero && !t.guild && (rank === "leader" || rank === "officer");
    const gy = 58 + (canInvite ? 26 : 0) + (this.friendBtn.visible ? 26 : 0);
    this.guildBtn.setVisible(canGuild).setY(gy);
    this.targetPanel.setVisible(true);
    const pk = t.pk ? PK_INFO[t.pk] : undefined;
    const war = !!t.guild && !!this.guild.guild?.enemies.includes(t.guild);
    this.targetName.setText(pk ? `${t.name} · Nv ${t.level} · ${pk.name}` : `${t.name} · Nv ${t.level}`)
      .setColor(war ? "#ff7a3a" : pk ? pk.color : t.hero ? "#ff9a8a" : "#e07a6a");
    const known = !t.hero || t.maxHp > 1; // another player's HP is only known once they take damage
    this.targetFill.setCrop(0, 0, BAR_TEX_W * (known ? Phaser.Math.Clamp(t.hp / t.maxHp, 0, 1) : 1), 16);
    this.targetHp.setText(known ? `${Math.max(0, t.hp)} / ${t.maxHp}` : "");
  }

  private showBoss(b: { name: string; hp: number; maxHp: number } | null): void {
    if (!b) { this.bossPanel.setVisible(false); return; }
    this.bossPanel.setVisible(true);
    this.bossName.setText(`${b.name}  ${Math.max(0, b.hp)} / ${b.maxHp}`);
    this.bossFill.setCrop(0, 0, BAR_TEX_W * Phaser.Math.Clamp(b.hp / b.maxHp, 0, 1), 16);
  }

  private drawMinimap(): void {
    const game = this.scene.get("GameScene") as GameScene;
    if (!this.map || !this.terrain || !game.scene.isActive()) return;
    const d = game.getMinimapData();
    if (!d) return;
    const k = this.map.size > 100 ? 1.7 : 2.6;
    const ctx = this.minimapView.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, 140, 140);
    ctx.save();
    ctx.beginPath(); ctx.arc(70, 70, 66, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#050508"; ctx.fillRect(0, 0, 140, 140);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(k, k * 0.5, -k, k * 0.5, 70 - k * (d.px - d.py), 70 - k * 0.5 * (d.px + d.py));
    ctx.drawImage(this.terrain, 0, 0);
    ctx.restore();
    this.minimapView.refresh();
    const g = this.minimapDots;
    g.clear();
    const plot = (x: number, y: number): [number, number] | null => {
      const dx = x - d.px, dy = y - d.py;
      const mx = (dx - dy) * k, my = (dx + dy) * k * 0.5;
      return mx * mx + my * my < 64 * 64 ? [mx, my] : null;
    };
    for (const m of d.mobs) { const p = plot(m.x, m.y); if (p) g.fillStyle(m.boss ? 0xb05cff : 0xe0303a, 1).fillCircle(p[0], p[1], m.boss ? 4 : 2.2); }
    for (const n of d.npcs) { const p = plot(n.x, n.y); if (p) g.fillStyle(0xffd77a, 1).fillCircle(p[0], p[1], 2.6); }
    for (const r of d.players) { const p = plot(r.x, r.y); if (p) g.fillStyle(r.party ? 0x8aff9a : 0x7fb0ff, 1).fillCircle(p[0], p[1], r.party ? 3.2 : 2.6); }
    g.fillStyle(0xffffff, 1).fillTriangle(0, -5, 4, 4, -4, 4);
  }

  private pushLoot(l: { exp: number; gold: number; loot: string[]; party?: boolean }): void {
    if (l.exp || l.gold) this.feedLine(`+${fmtBig(l.exp)} EXP${l.party ? " (grupo)" : ""}${l.gold ? `   +${fmtBig(l.gold)} ouro` : ""}`, "#ffd77a");
    for (const it of l.loot ?? []) this.feedLine(`Item: ${it}`, "#9fe0ff");
  }

  private feedLine(text: string, color: string): void {
    const t = this.add.text(12, 0, text, txt(12, color)).setOrigin(0, 1).setAlpha(0);
    this.feed.unshift(t);
    this.tweens.add({ targets: t, alpha: 1, duration: 200 });
    this.tweens.add({ targets: t, alpha: 0, delay: 4500, duration: 800, onComplete: () => { t.destroy(); this.feed = this.feed.filter((f) => f !== t); } });
    while (this.feed.length > 6) this.feed.pop()!.destroy();
    this.layout();
  }

  private toasts: Phaser.GameObjects.Text[] = [];

  /** Center-screen notices; several at once stack downwards instead of overlapping. */
  private toast(text: string, color: string): void {
    this.toasts = this.toasts.filter((o) => o.active);
    const y = 112 + this.toasts.reduce((acc, o) => acc + o.height + 6, 0);
    const t = this.add.text(this.scale.width / 2, y + 8, text, txt(15, color, { fontStyle: "bold", align: "center", wordWrap: { width: 460 } }))
      .setOrigin(0.5, 0).setAlpha(0).setDepth(97); // above the inventory/shop windows
    this.toasts.push(t);
    this.tweens.add({ targets: t, alpha: 1, y, duration: 250 });
    this.tweens.add({ targets: t, alpha: 0, delay: 3200, duration: 600, onComplete: () => { t.destroy(); this.toasts = this.toasts.filter((o) => o !== t); } });
  }

  private levelBanner(level: number, unlocked: string[]): void {
    const w = this.scale.width, y = this.scale.height * 0.3;
    const g = this.add.graphics();
    panel(g, -170, -36, 340, unlocked.length ? 92 : 64, 10);
    const t = this.add.text(0, -18, `NÍVEL ${level}`, txt(28, "#ffd77a", { fontStyle: "bold", strokeThickness: 5 })).setOrigin(0.5);
    t.setShadow(0, 0, "#ffb040", 12, true, true).setPadding(16, 10, 16, 10);
    const sub = this.add.text(0, 14, unlocked.length ? `Nova skill: ${unlocked.join(", ")}` : "Seus atributos aumentaram",
      txt(12, "#e8dcc0", { align: "center", wordWrap: { width: 310 } })).setOrigin(0.5, 0);
    const c = this.add.container(w / 2, y, [g, t, sub]).setDepth(70).setAlpha(0).setScale(0.8);
    this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 300, ease: "Back.easeOut" });
    this.tweens.add({ targets: c, alpha: 0, delay: 3800, duration: 600, onComplete: () => c.destroy() });
  }

  private showZoneTitle(name: string, sub: string): void {
    const w = this.scale.width, y = this.scale.height * 0.22;
    const title = this.add.text(w / 2, y, name, txt(34, "#e8d6a8", { fontStyle: "bold", strokeThickness: 5 })).setOrigin(0.5);
    title.setShadow(0, 0, "#ffb050", 14, true, true).setPadding(24, 16, 24, 16);
    const subtitle = this.add.text(w / 2, y + 36, sub, txt(14, "#a8987a")).setOrigin(0.5);
    const all = [title, subtitle];
    for (const o of all) o.setAlpha(0);
    this.tweens.add({ targets: all, alpha: 1, duration: 800, delay: 300 });
    this.tweens.add({ targets: all, alpha: 0, duration: 1000, delay: 3000, onComplete: () => all.forEach((o) => o.destroy()) });
  }

  // ── Windows ──────────────────────────────────────────────────────────

  private closeAll(): void {
    this.closeWindows();
    this.dialog?.destroy(); this.dialog = undefined;
  }

  /** The big centered windows overlap, so only one is open at a time. */
  private closeWindows(): void {
    this.book?.destroy(); this.book = undefined;
    this.charPanel?.destroy(); this.charPanel = undefined;
    this.friendsWin?.destroy(); this.friendsWin = undefined;
    this.guildWin?.destroy(); this.guildWin = undefined;
    if (this.inventoryUI?.isOpen) this.inventoryUI.close();
    if (this.passUI?.isOpen) this.passUI.close();
    if (this.shopUI?.isOpen) this.shopUI.close();
  }

  private toggleShop(tab?: "destaques" | "visuais" | "gemas"): void {
    const open = this.shopUI.isOpen;
    this.closeWindows();
    if (!open || tab) this.shopUI.toggle(tab);
  }

  private togglePass(): void {
    const open = this.passUI.isOpen;
    this.closeWindows();
    if (!open) this.passUI.toggle();
  }

  private toggleGuild(): void {
    if (this.guildWin) { this.guildWin.destroy(); this.guildWin = undefined; return; }
    this.closeWindows();
    this.guildConfirm = "";
    this.drawGuild();
  }

  private guildAction(m: Record<string, unknown>): void {
    this.scene.get("GameScene").events.emit("inv_action", m);
  }

  /** Guild window: create one, or see the members (online first) with rank actions, wars and invites. */
  private drawGuild(): void {
    this.guildWin?.destroy();
    const W = 500;
    const g = this.guild.guild;
    const items: Phaser.GameObjects.GameObject[] = [];
    const btn = (x: number, y: number, label: string, color: string, onClick: () => void, origin = 1) => {
      const b = this.add.text(x, y, label, txt(10, color, { backgroundColor: "#1a140e", padding: { x: 6, y: 3 } }))
        .setOrigin(origin, 0.5).setInteractive({ useHandCursor: true });
      b.on("pointerdown", onClick);
      items.push(b);
      return b;
    };
    const confirmBtn = (x: number, y: number, key: string, label: string, color: string, run: () => void) =>
      btn(x, y, this.guildConfirm === key ? "Confirmar?" : label, this.guildConfirm === key ? "#ff6a5a" : color, () => {
        if (this.guildConfirm === key) { this.guildConfirm = ""; run(); } else { this.guildConfirm = key; this.drawGuild(); }
      });
    let H: number;
    if (!g) {
      H = 190;
      const cost = this.guild.cost ?? 10000, lvl = this.guild.min_level ?? 20;
      items.push(this.add.text(0, -H / 2 + 50, "Você não está em uma guilda.", txt(12, "#e8dcc0")).setOrigin(0.5, 0),
        this.add.text(0, -H / 2 + 74, `Crie a sua por ${fmtBig(cost)} de ouro (nível ${lvl}+), ou peça um convite\na um líder ou oficial de guilda.`,
          txt(10, "#a8987a", { align: "center" })).setOrigin(0.5, 0));
      btn(0, H / 2 - 36, "Criar guilda", "#9dff8a", () => new TextPrompt({
        title: "Criar guilda", hint: `Custa ${fmtBig(cost)} de ouro. De 3 a 16 letras, números e espaços.`,
        placeholder: "Nome da guilda", confirm: "Criar", maxLength: 16,
        onConfirm: (name) => this.guildAction({ type: "guild_create", name }),
      }), 0.5);
    } else {
      const rowH = 30, rows = g.members.slice(0, 12);
      H = 150 + rows.length * rowH + (g.wars.length ? 24 + g.wars.length * 18 : 0);
      const online = g.members.filter((m) => m.online).length;
      const boss = g.my_rank === "leader", staff = boss || g.my_rank === "officer";
      const myId = (this.scene.get("GameScene") as GameScene).charId;
      items.push(this.add.text(0, -H / 2 + 34, `${online} online · ${g.members.length}/${g.max} membros`, txt(10, "#a8987a")).setOrigin(0.5, 0));
      let y = -H / 2 + 62;
      for (const m of rows) {
        const dot = this.add.graphics().fillStyle(m.online ? 0x4ad04a : 0x5a5a5a, 1).fillCircle(-W / 2 + 18, y, 4);
        const rankColor = m.rank === "leader" ? "#ffd77a" : m.rank === "officer" ? "#8fd0ff" : "#a8a090";
        items.push(dot,
          this.add.text(-W / 2 + 30, y - 9, m.name, txt(12, m.online ? "#e8dcc0" : "#8a8478", { fontStyle: "bold" })),
          this.add.text(-W / 2 + 30, y + 5, `${m.rank_name}${m.online ? ` · Nv ${m.level} · ${META.maps[m.map]?.name ?? "?"}` : " · offline"}`,
            txt(9, m.online ? rankColor : "#6a6458")));
        let x = W / 2 - 14;
        if (m.id !== myId) {
          const canKick = boss || (g.my_rank === "officer" && m.rank === "member");
          if (canKick) x -= confirmBtn(x, y, `kick:${m.id}`, "Expulsar", "#c08a7a", () => this.guildAction({ type: "guild_kick", id: m.id })).width + 6;
          if (boss) {
            x -= confirmBtn(x, y, `lead:${m.id}`, "Fazer líder", "#ffd77a", () => this.guildAction({ type: "guild_transfer", id: m.id })).width + 6;
            if (m.rank === "member") x -= btn(x, y, "Promover", "#8fd0ff", () => this.guildAction({ type: "guild_promote", id: m.id })).width + 6;
            else if (m.rank === "officer") x -= btn(x, y, "Rebaixar", "#a8a090", () => this.guildAction({ type: "guild_demote", id: m.id })).width + 6;
          }
        }
        y += rowH;
      }
      if (g.members.length > rows.length) {
        items.push(this.add.text(0, y - 12, `… e mais ${g.members.length - rows.length} membros`, txt(9, "#a8987a")).setOrigin(0.5, 0));
      }
      if (g.wars.length) {
        items.push(this.add.text(-W / 2 + 18, y, "EM GUERRA", txt(10, "#ff7a3a", { fontStyle: "bold" })));
        g.wars.forEach((w, i) => items.push(this.add.text(-W / 2 + 18, y + 18 + i * 18,
          `${w.name} — placar ${w.us} x ${w.them} · faltam ${w.minutes} min`, txt(10, "#ffb08a"))));
      }
      const by = H / 2 - 26;
      let bx = -W / 2 + 18;
      if (staff) bx += btn(bx, by, "Convidar", "#9dff8a", () => new TextPrompt({
        title: "Convidar para a guilda", hint: "O jogador precisa estar online.", placeholder: "Nome do jogador", confirm: "Convidar",
        onConfirm: (name) => this.guildAction({ type: "guild_invite", name }),
      }), 0).width + 8;
      if (boss) bx += btn(bx, by, "Declarar guerra", "#ff7a3a", () => new TextPrompt({
        title: "Declarar guerra", hint: "Por 1 hora, as duas guildas podem lutar fora das zonas seguras sem virar Assassino. Cada abate vale ponto.",
        placeholder: "Nome da guilda inimiga", confirm: "Declarar", maxLength: 16,
        onConfirm: (name) => this.guildAction({ type: "guild_war", name }),
      }), 0).width + 8;
      if (boss) confirmBtn(W / 2 - 14, by, "disband", "Desfazer guilda", "#ff6a5a", () => this.guildAction({ type: "guild_disband" }));
      else confirmBtn(W / 2 - 14, by, "leave", "Sair da guilda", "#c08a7a", () => this.guildAction({ type: "guild_leave" }));
      items.push(this.add.text(-W / 2 + 18, by - 22, "Chat da guilda: /gu mensagem", txt(9, "#6fb0e8")));
    }
    const bg = this.add.graphics();
    panel(bg, -W / 2, -H / 2, W, H, 12, 0.96);
    const title = this.add.text(0, -H / 2 + 12, g ? `GUILDA ${g.name.toUpperCase()}` : "GUILDA", txt(16, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5, 0);
    const close = this.add.text(W / 2 - 14, -H / 2 + 10, "✕", txt(14, "#bfa77a")).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => this.toggleGuild());
    this.guildWin = this.add.container(this.scale.width / 2, this.scale.height / 2, [bg, title, close, ...items]).setDepth(60);
  }

  private toggleFriends(): void {
    if (this.friendsWin) { this.friendsWin.destroy(); this.friendsWin = undefined; return; }
    this.closeWindows();
    this.friendsPage = 0;
    this.friendConfirm = "";
    this.drawFriends();
  }

  /** Friends window: who is online (and where), with whisper / party / remove buttons. */
  private drawFriends(): void {
    this.friendsWin?.destroy();
    const PER = 9, W = 470, rowH = 34;
    const pages = Math.max(1, Math.ceil(this.friends.length / PER));
    this.friendsPage = Math.min(this.friendsPage, pages - 1);
    const rows = this.friends.slice(this.friendsPage * PER, (this.friendsPage + 1) * PER);
    const H = 92 + Math.max(1, rows.length) * rowH + (pages > 1 ? 24 : 0);
    const g = this.add.graphics();
    panel(g, -W / 2, -H / 2, W, H, 12, 0.96);
    const online = this.friends.filter((f) => f.online).length;
    const items: Phaser.GameObjects.GameObject[] = [g,
      this.add.text(0, -H / 2 + 12, "AMIGOS", txt(16, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5, 0),
      this.add.text(0, -H / 2 + 34, `${online} online · ${this.friends.length}/${this.friendsMax}`, txt(10, "#a8987a")).setOrigin(0.5, 0)];
    const close = this.add.text(W / 2 - 14, -H / 2 + 10, "✕", txt(14, "#bfa77a")).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => this.toggleFriends());
    items.push(close);
    const send = (m: Record<string, unknown>) => this.scene.get("GameScene").events.emit("inv_action", m);
    const btn = (x: number, y: number, label: string, color: string, onClick: () => void) => {
      const b = this.add.text(x, y, label, txt(10, color, { backgroundColor: "#1a140e", padding: { x: 6, y: 3 } }))
        .setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
      b.on("pointerdown", onClick);
      items.push(b);
      return b;
    };
    const top = -H / 2 + 58;
    if (!rows.length) {
      items.push(this.add.text(0, top + 14, "Você ainda não tem amigos.\nClique em um jogador e use \"+ Amigo\", ou digite /amigo Nome no chat.",
        txt(11, "#e8dcc0", { align: "center" })).setOrigin(0.5, 0));
    }
    rows.forEach((f, i) => {
      const y = top + i * rowH + 14;
      const dot = this.add.graphics().fillStyle(f.online ? 0x4ad04a : 0x5a5a5a, 1).fillCircle(-W / 2 + 18, y, 4);
      const cls = f.cls ? CLASS_INFO[f.cls as keyof typeof CLASS_INFO]?.name ?? "" : "";
      const where = f.online ? `Nv ${f.level} ${cls} · ${META.maps[f.map]?.name ?? "?"}` : "offline";
      items.push(dot,
        this.add.text(-W / 2 + 30, y - 9, f.name, txt(12, f.online ? "#e8dcc0" : "#8a8478", { fontStyle: "bold" })),
        this.add.text(-W / 2 + 30, y + 5, where, txt(9, f.online ? "#a8c890" : "#6a6458")));
      let x = W / 2 - 14;
      const confirming = this.friendConfirm === f.id;
      const rm = btn(x, y, confirming ? "Confirmar?" : "Remover", confirming ? "#ff6a5a" : "#c08a7a", () => {
        if (this.friendConfirm === f.id) { send({ type: "friend_remove", id: f.id }); this.friendConfirm = ""; }
        else { this.friendConfirm = f.id; this.drawFriends(); }
      });
      x -= rm.width + 6;
      if (f.online) {
        const pt = btn(x, y, "Grupo", PARTY_COLOR, () => send({ type: "party_invite", name: f.name }));
        x -= pt.width + 6;
        btn(x, y, "Sussurrar", "#d8a8ff", () => { this.toggleFriends(); this.chat?.openInput(`/w ${f.name} `); });
      }
    });
    if (pages > 1) {
      const py = H / 2 - 22;
      items.push(this.add.text(0, py, `${this.friendsPage + 1}/${pages}`, txt(10, "#a8987a")).setOrigin(0.5));
      if (this.friendsPage > 0) {
        const p = this.add.text(-40, py, "◀", txt(12, "#ffd77a")).setOrigin(0.5).setInteractive({ useHandCursor: true });
        p.on("pointerdown", () => { this.friendsPage--; this.drawFriends(); });
        items.push(p);
      }
      if (this.friendsPage < pages - 1) {
        const n = this.add.text(40, py, "▶", txt(12, "#ffd77a")).setOrigin(0.5).setInteractive({ useHandCursor: true });
        n.on("pointerdown", () => { this.friendsPage++; this.drawFriends(); });
        items.push(n);
      }
    }
    this.friendsWin = this.add.container(this.scale.width / 2, this.scale.height / 2, items).setDepth(60);
  }

  private toggleInv(): void {
    const open = this.inventoryUI.isOpen;
    this.closeWindows();
    if (!open) this.inventoryUI.toggle();
  }

  private onInventory(inv: InventoryState): void {
    this.inventoryUI.setInventory(inv);
    for (const ps of this.potionSlots) {
      const n = inv.bag.filter((e) => META.items[e.id]?.kind === ps.kind).reduce((a, e) => a + e.qty, 0);
      ps.count.setText(`${n}`);
      ps.icon.setAlpha(n > 0 ? 1 : 0.3);
    }
  }

  private toggleBook(): void {
    if (this.book) { this.book.destroy(); this.book = undefined; return; }
    this.closeWindows();
    const W = 660, H = 470;
    const g = this.add.graphics();
    panel(g, -W / 2, -H / 2, W, H, 12, 0.96);
    const items: Phaser.GameObjects.GameObject[] = [g];
    items.push(this.add.text(0, -H / 2 + 12, `LIVRO DE SKILLS — ${CLASS_INFO[this.cls].name.toUpperCase()}`, txt(15, "#ffd77a", { fontStyle: "bold" })).setOrigin(0.5, 0));
    const close = this.add.text(W / 2 - 18, -H / 2 + 10, "✕", txt(16, "#e8dcc0")).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => this.toggleBook());
    items.push(close);
    const lvl = this.hero?.level ?? 1;
    const row = (s: SkillDef, x: number, y: number, key?: string) => {
      const ok = lvl >= s.lvl;
      items.push(this.add.image(x, y, `icon_${s.id}`).setScale(30 / 48).setOrigin(0, 0.5).setAlpha(ok ? 1 : 0.3));
      items.push(this.add.text(x + 38, y - 13, `${key ? `[${key}] ` : ""}${s.name}`, txt(11, ok ? "#f3e3b8" : "#8a8070", { fontStyle: "bold" })));
      items.push(this.add.text(x + 38, y + 1, s.desc, txt(9, ok ? "#c8bca0" : "#6a6050", { wordWrap: { width: 250 } })));
      items.push(this.add.text(x + 300, y - 13, ok ? (s.passive ? "ATIVA" : `${s.mp} MP`) : `Nv ${s.lvl}`,
        txt(9, ok ? "#9dff8a" : "#c8b0ff")).setOrigin(1, 0));
    };
    items.push(this.add.text(-W / 2 + 20, -H / 2 + 42, "SKILLS ATIVAS", txt(11, "#a8987a")));
    items.push(this.add.text(10, -H / 2 + 42, "SKILLS PASSIVAS", txt(11, "#a8987a")));
    classSkills(this.cls).forEach((s, i) => row(s, -W / 2 + 18, -H / 2 + 80 + i * 39, KEYS[i]));
    classPassives(this.cls).forEach((s, i) => row(s, 10, -H / 2 + 80 + i * 39));
    items.push(this.add.text(10, -H / 2 + 290, [
      "Dicas:",
      "• Teclas 1–0 usam as skills da barra.",
      "• Clique num inimigo para mirar; TAB troca o alvo.",
      "• Se o alvo estiver longe, o herói se aproxima sozinho.",
      "• Passivas funcionam sempre, a partir do nível indicado.",
    ].join("\n"), txt(10, "#bcae90", { lineSpacing: 4 })));
    this.book = this.add.container(this.scale.width / 2, this.scale.height / 2, items).setDepth(80);
    this.layout();
  }

  private toggleChar(): void {
    if (this.charPanel) { this.charPanel.destroy(); this.charPanel = undefined; return; }
    const h = this.hero;
    if (!h) return;
    this.closeWindows();
    const W = 300, H = 710;
    const g = this.add.graphics();
    panel(g, -W / 2, -H / 2, W, H, 12, 0.96);
    const gear = (this.scene.get("GameScene") as GameScene).inventory?.gear ?? {};
    const worn = GEAR_SLOTS
      .map((s) => `${SLOT_NAMES[s]}: ${gear[s] ? pieceName(gear[s]!) : "—"}`).join("\n");
    const lines = [
      `Força ${h.str}     Agilidade ${h.agi}`,
      `Inteligência ${h.int}     Vitalidade ${h.vit}`,
      "",
      `Ataque ${h.atk}     Defesa ${h.def}`,
      ...critText(h),
      `Vida ${h.max_hp}     Mana ${h.max_mp}`,
      "",
      `Arena: ${h.pvp.kills} abates · ${h.pvp.deaths} mortes`,
      `Nome: ${PK_INFO[h.pk?.status ?? "white"].name}${h.pk?.kills ? ` · inocentes mortos: ${h.pk.kills}` : ""}`,
      `Ouro: ${h.gold}`,
    ];
    const items: Phaser.GameObjects.GameObject[] = [
      g,
      this.add.text(0, -H / 2 + 12, `${h.name} — Nv ${h.level}`, txt(15, CLASS_INFO[this.cls].color, { fontStyle: "bold" })).setOrigin(0.5, 0),
      this.add.text(0, -H / 2 + 34, CLASS_INFO[this.cls].name, txt(11, "#a8987a")).setOrigin(0.5, 0),
      this.add.text(-W / 2 + 20, -H / 2 + 60, lines.join("\n"), txt(11, "#e8dcc0", { lineSpacing: 4 })),
      this.add.text(-W / 2 + 20, -H / 2 + 300, "EQUIPAMENTO  (inventário: tecla I)", txt(10, "#a8987a")),
      this.add.text(-W / 2 + 20, -H / 2 + 316, worn, txt(10, "#9fe0ff", { lineSpacing: 2 })),
    ];
    // titles: earned ones can be worn (click), the next one shows what it takes
    const owned = h.cosmetics?.titles ?? [];
    const earned = META.titles.filter((t) => (t.pass ? owned.includes(t.id) : h.level >= t.level));
    const next = META.titles.find((t) => !t.pass && h.level < t.level);
    items.push(this.add.text(-W / 2 + 20, -H / 2 + 424, earned.length ? "TÍTULO  (clique para usar)" : "TÍTULO", txt(10, "#a8987a")));
    let cx = -W / 2 + 20, cy = -H / 2 + 442;
    for (const t of [{ id: "", name: "Nenhum", color: "#a8a090", level: 0 }, ...earned]) {
      if (t.id === "" && !earned.length) break;
      const on = (h.title ?? "") === t.id;
      const chip = this.add.text(cx, cy, t.name, txt(10, t.color, {
        backgroundColor: on ? "#3a2e14" : "#16120c", padding: { x: 6, y: 3 }, fontStyle: on ? "bold" : "normal",
      })).setInteractive({ useHandCursor: true });
      if (cx + chip.width > W / 2 - 20) { cx = -W / 2 + 20; cy += 22; chip.setPosition(cx, cy); }
      cx += chip.width + 6;
      chip.on("pointerdown", () => {
        this.scene.get("GameScene").events.emit("inv_action", { type: "set_title", title: t.id });
        this.time.delayedCall(250, () => { this.toggleChar(); this.toggleChar(); });
      });
      items.push(chip);
    }
    if (next) {
      cy += earned.length ? 24 : 0;
      items.push(this.add.text(-W / 2 + 20, cy, `Próximo: «${next.name}» no nível ${next.level}`, txt(10, next.color)));
    }
    // mounts (cosmetic): ride one, or walk
    const mounts = (META.mounts ?? []).filter((m) => h.cosmetics?.mounts?.includes(m.id));
    cy += 26;
    items.push(this.add.text(-W / 2 + 20, cy, mounts.length ? "MONTARIA  (clique para montar · tecla M)" : "MONTARIA  (compre na Loja — tecla L)", txt(10, "#a8987a")));
    cx = -W / 2 + 20; cy += 18;
    for (const m of mounts.length ? [{ id: "", name: "A pé" }, ...mounts] : []) {
      const on = (h.cosmetics?.mount ?? "") === m.id;
      const chip = this.add.text(cx, cy, m.name, txt(10, m.id ? "#ffc89a" : "#a8a090", {
        backgroundColor: on ? "#3a2e14" : "#16120c", padding: { x: 6, y: 3 }, fontStyle: on ? "bold" : "normal",
      })).setInteractive({ useHandCursor: true });
      if (cx + chip.width > W / 2 - 20) { cx = -W / 2 + 20; cy += 22; chip.setPosition(cx, cy); }
      cx += chip.width + 6;
      chip.on("pointerdown", () => {
        this.scene.get("GameScene").events.emit("inv_action", { type: "set_mount", mount: m.id });
        this.time.delayedCall(250, () => { this.toggleChar(); this.toggleChar(); });
      });
      items.push(chip);
    }
    // mascots (cosmetic): bring one along, or none
    const pets = (META.pets ?? []).filter((p) => h.cosmetics?.pets?.includes(p.id));
    cy += 26;
    items.push(this.add.text(-W / 2 + 20, cy, pets.length ? "MASCOTE  (clique para levar)" : "MASCOTE  (compre na Loja — tecla L)", txt(10, "#a8987a")));
    cx = -W / 2 + 20; cy += 18;
    for (const p of pets.length ? [{ id: "", name: "Nenhum" }, ...pets] : []) {
      const on = (h.cosmetics?.pet ?? "") === p.id;
      const chip = this.add.text(cx, cy, p.name, txt(10, p.id ? "#9fe0ff" : "#a8a090", {
        backgroundColor: on ? "#3a2e14" : "#16120c", padding: { x: 6, y: 3 }, fontStyle: on ? "bold" : "normal",
      })).setInteractive({ useHandCursor: true });
      if (cx + chip.width > W / 2 - 20) { cx = -W / 2 + 20; cy += 22; chip.setPosition(cx, cy); }
      cx += chip.width + 6;
      chip.on("pointerdown", () => {
        this.scene.get("GameScene").events.emit("inv_action", { type: "set_pet", pet: p.id });
        this.time.delayedCall(250, () => { this.toggleChar(); this.toggleChar(); });
      });
      items.push(chip);
    }
    // auras from the season pass (cosmetic): wear one, or none
    const auras = (META.auras ?? []).filter((a) => h.cosmetics?.auras.includes(a.id));
    cy += 26;
    items.push(this.add.text(-W / 2 + 20, cy, auras.length ? "AURA  (clique para usar)" : "AURA  (ganhe no Passe de Temporada — tecla P)", txt(10, "#a8987a")));
    cx = -W / 2 + 20; cy += 18;
    for (const a of auras.length ? [{ id: "", name: "Nenhuma", color: "white" }, ...auras] : []) {
      const on = (h.cosmetics?.aura ?? "") === a.id;
      const chip = this.add.text(cx, cy, a.name, txt(10, a.id ? "#ffd77a" : "#a8a090", {
        backgroundColor: on ? "#3a2e14" : "#16120c", padding: { x: 6, y: 3 }, fontStyle: on ? "bold" : "normal",
      })).setInteractive({ useHandCursor: true });
      if (cx + chip.width > W / 2 - 20) { cx = -W / 2 + 20; cy += 22; chip.setPosition(cx, cy); }
      cx += chip.width + 6;
      chip.on("pointerdown", () => {
        this.scene.get("GameScene").events.emit("inv_action", { type: "set_aura", aura: a.id });
        this.time.delayedCall(250, () => { this.toggleChar(); this.toggleChar(); });
      });
      items.push(chip);
    }
    const close = this.add.text(W / 2 - 18, -H / 2 + 10, "✕", txt(16, "#e8dcc0")).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => this.toggleChar());
    items.push(close);
    this.charPanel = this.add.container(this.scale.width / 2, this.scale.height / 2, items).setDepth(80);
    this.layout();
  }

  private showDialog(d: DialogMsg): void {
    this.dialog?.destroy();
    const W = Math.min(560, this.scale.width - 30), H = 150;
    const g = this.add.graphics();
    panel(g, -W / 2, -H / 2, W, H, 10, 0.96);
    const items: Phaser.GameObjects.GameObject[] = [g];
    items.push(this.add.text(-W / 2 + 16, -H / 2 + 10, d.name, txt(14, "#ffd77a", { fontStyle: "bold" })));
    if (d.title) items.push(this.add.text(W / 2 - 16, -H / 2 + 12, `Missão: ${d.title}`, txt(11, "#c8b0ff")).setOrigin(1, 0));
    const body = this.add.text(-W / 2 + 16, -H / 2 + 34, "", txt(12, "#f0e6d0", { wordWrap: { width: W - 32 }, lineSpacing: 4 }));
    items.push(body);
    const full = d.lines.join("\n");
    let i = 0;
    const typer = this.time.addEvent({ delay: 18, repeat: full.length, callback: () => body.setText(full.slice(0, ++i)) });
    const opts = [...d.options, { id: "close", label: "Fechar" }];
    let x = W / 2 - 16;
    for (let k = opts.length - 1; k >= 0; k--) {
      const o = opts[k];
      const b = this.add.text(x, H / 2 - 14, o.label, txt(12, o.id === "close" ? "#bfa77a" : "#9dff8a", {
        backgroundColor: "#1a140c", padding: { x: 10, y: 5 }, fontStyle: "bold",
      })).setOrigin(1, 1).setInteractive({ useHandCursor: true });
      b.on("pointerover", () => b.setBackgroundColor("#2e2414")).on("pointerout", () => b.setBackgroundColor("#1a140c"));
      b.on("pointerdown", () => {
        typer.remove();
        if (o.id !== "close") this.scene.get("GameScene").events.emit("dialog_option", o.id);
        this.dialog?.destroy();
        this.dialog = undefined;
      });
      items.push(b);
      x -= b.width + 10;
    }
    this.dialog = this.add.container(this.scale.width / 2, this.scale.height - 96, items).setDepth(85).setAlpha(0);
    this.tweens.add({ targets: this.dialog, alpha: 1, duration: 180 });
  }

  private showScores(rows: ScoreRow[]): void {
    const lines = rows.slice(0, 8).map((r, i) => `${i + 1}. ${r.name.slice(0, 12).padEnd(12)}  ${r.kills} / ${r.deaths}`);
    this.scoreText.setText(lines.length ? `Nome            abates/mortes\n${lines.join("\n")}` : "Ninguém na arena");
  }

  private showDeath(secs: number, killer?: string): void {
    this.death.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.death, alpha: 1, duration: 600 });
    this.deathKiller.setText(killer ? `Derrotado por ${killer}` : "");
    let left = Math.round(secs);
    this.deathCount.setText(`Renascendo em ${left}…`);
    this.deathTimer?.remove();
    this.deathTimer = this.time.addEvent({
      delay: 1000, repeat: left - 1,
      callback: () => { left -= 1; this.deathCount.setText(left > 0 ? `Renascendo em ${left}…` : "Renascendo…"); },
    });
  }

  private hideDeath(): void {
    this.deathTimer?.remove();
    this.tweens.add({ targets: this.death, alpha: 0, duration: 400, onComplete: () => this.death.setVisible(false) });
  }

  private storyEnd(m: { title?: string; text?: string } = {}): void {
    const w = this.scale.width, h = this.scale.height;
    const shade = this.add.rectangle(0, 0, w, h, 0x000000, 0.75).setOrigin(0);
    const t = this.add.text(w / 2, h * 0.32, m.title ?? "FIM DO CAPÍTULO", txt(40, "#ffd77a", { fontStyle: "bold", strokeThickness: 6 })).setOrigin(0.5);
    t.setShadow(0, 0, "#ffb040", 16, true, true).setPadding(24, 16, 24, 16);
    const s = this.add.text(w / 2, h * 0.32 + 52, m.text ?? "Sua lenda continua.",
      txt(15, "#e8dcc0", { align: "center", lineSpacing: 6 })).setOrigin(0.5, 0);
    const b = this.add.text(w / 2, h * 0.32 + 130, "Continuar jogando", txt(16, "#9dff8a", { backgroundColor: "#1a140c", padding: { x: 14, y: 8 } }))
      .setOrigin(0.5).setInteractive({ useHandCursor: true });
    const c = this.add.container(0, 0, [shade, t, s, b]).setDepth(120).setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 900 });
    b.on("pointerdown", () => c.destroy());
  }
}

interface WbStatus { state: "idle" | "active" | "over"; next_boss: string; next_at: string; boss?: string; ends_in?: number }

interface WbScores {
  boss: string;
  participants: number;
  rows: { name: string; dmg: number; pct: number }[];
  ends_in: number;
  me: number;
  me_pct: number;
}

interface WbResult {
  boss: string;
  top: { name: string; dmg: number; pct: number }[];
  last_hit: string;
  participants: number;
  dmg: number;
  pct: number;
  places: string[];
  rewards: string[];
}

interface TargetInfo {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  boss: boolean;
  hero?: boolean;
  pk?: "white" | "aggressor" | "red";
  guild?: string;
}

interface DialogMsg {
  npc: string;
  name: string;
  title?: string;
  lines: string[];
  options: { id: string; label: string }[];
}

interface ScoreRow {
  name: string;
  cls: string;
  level: number;
  kills: number;
  deaths: number;
}

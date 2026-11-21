import Phaser from "phaser";
import { socket, type ServerMessage } from "../network/socket";
import { worldToScreen, screenToWorld } from "../utils/isometric";
import { MOVE_SPEED } from "../utils/constants";
import { META, PARTY_COLOR, fmtBig, PK_INFO, basicSkill, classSkills, skillById, type GuildState, type HeroState, type InventoryState, type MapInfo, type PartyMember, type PkStatus, type SkillDef } from "../data/meta";
import { GLOW_COLORS, ensureTextures, UNIT_ORIGIN, UNIT_RES, WALK_FRAMES } from "../gfx/textures";
import { ensureSkillIcons } from "../gfx/themeProps";
import { GROUND_DEPTH, WorldRenderer } from "../gfx/world";
import { DECAL_DEPTH, FX_DEPTH, Fx } from "../gfx/effects";
import { PixelFx, hasFx, isLoopFx, palette, type PfxHandle } from "../gfx/pixelfx";
import { FONT } from "../gfx/draw";
import { gfx } from "../gfx/quality";
import { switchGpu, watchGpu } from "../gfx/renderer";
import { VEIN_INFO, VEIN_ORIGIN, ensureVeinTextures } from "../gfx/veins";
import { FLOATING, PLACE_ORIGIN, ensurePlaceMark, placeTexture } from "../gfx/landmarks";
import { THEME_ORIGIN } from "../gfx/themeProps";
import { isTouch } from "../ui/device";
import { isResting } from "../ui/restMode";
import { SHEETS, animKey, dirIndex, hasSheet, knowsSheet, loadedSheets, releaseSheet, requestGraded, requestSheet, resumeSheets, skinKey, suspendSheets } from "../gfx/sprites3d";

export interface DailyState {
  day: string;
  bonus: boolean;
  tasks: { text: string; kind?: string; target?: string; n: number; count: number; claimed: boolean }[];
}

type AutoMode = "farm" | "quest" | "daily" | "pvp";

interface AutoState {
  mode: AutoMode;
  /** "pvp": the player being hunted */
  victim?: string;
  /** "pvp" / "farm": the player is walking somewhere by hand; the attack waits until the hero gets there */
  manual?: boolean;
  ax: number;
  ay: number;
  map: string;
  nextThink: number;
  nextPot: number;
  /** next time the auto-mission may answer the Elder (turn in / accept) */
  nextTalk: number;
  /** deaths in the last 10 minutes; three of them stop the auto-pilot */
  deaths: number[];
  dead: boolean;
}

/** Deaths within AUTO_DEATH_WINDOW that make the auto-pilot give up (the monsters are too strong). */
const AUTO_MAX_DEATHS = 3;
const AUTO_DEATH_WINDOW = 10 * 60 * 1000;

/** Other players that carry a light into the night at once (the nearest ones). */
const MAX_PLAYER_LIGHTS = 8;

/** Time between two skill effects got ready in the background after entering a map. */
const WARM_EVERY = 150;

/** The night overlay is drawn this many times smaller than the screen, then stretched (3 with the graphics card,
 *  where the whole layer is sent to the card every frame: smaller means less to send). */
let DARK_RES = 2;

/** Hunting radius of auto-farm around the spot where it was turned on. */
const AUTO_RADIUS = 10;

/** Glow colour (a GLOW_COLORS name) behind each level title. */
const TITLE_GLOW: Record<string, string> = {
  desbravador: "green", veterano: "cyan", campeao: "blue", senhor_guerra: "purple", lenda_viva: "purple",
  matador_dragoes: "orange", mao_destino: "gold", imortal: "red", semideus: "gold", eterno: "white",
};

/** Night colour of each map: the darkness is tinted so every place has its own mood. */
const MOOD: Record<string, number> = {
  town: 0x080c1c, forest: 0x03100c, crypt: 0x0a0614, swamp: 0x061206, mine: 0x0e0a06, arena: 0x120604,
  frost: 0x08142a, ash: 0x1c0804, crimson: 0x1a0408, ghost: 0x04140f, void: 0x0e041c,
};
/** Maps where moonlight falls through the canopy or the clouds. */
const RAY_THEMES = new Set(["forest", "ghost", "frost", "town", "swamp"]);

/** World labels are drawn with a 2× font at half scale: sharp when the camera zooms in, and correctly centred
 *  (Phaser's setResolution draws texts twice as big and off-centre with the Canvas renderer). */
const SHARP = 0.5;

const HERO_SCALE = 0.8;
const MOB_LOOK: Record<string, [string, number]> = {
  wolf: ["mob_wolf", 0.8], goblin: ["mob_goblin", 0.85], treant: ["mob_treant", 0.95],
  skeleton: ["mob_skeleton", 0.85], death_knight: ["mob_death_knight", 1.05],
  swamp_ghoul: ["mob_ghoul", 0.85], bog_mutant: ["mob_bog_mutant", 1.0], swamp_witch: ["mob_witch", 1.05],
  frost_wolf: ["mob_frost_wolf", 0.85], frost_sentinel: ["mob_frost_sentinel", 0.9], ice_troll: ["mob_ice_troll", 1.0],
  lich_king: ["mob_lich_king", 1.05],
  ash_hound: ["mob_ash_hound", 0.85], magma_brute: ["mob_magma_brute", 1.0], cinder_cultist: ["mob_cinder_cultist", 0.9],
  ash_dragon: ["mob_ash_dragon", 1.1], blood_ghoul: ["mob_blood_ghoul", 0.85], crimson_knight: ["mob_crimson_knight", 0.9],
  flesh_horror: ["mob_flesh_horror", 1.0], blood_queen: ["mob_blood_queen", 1.05], phantom_soldier: ["mob_phantom_soldier", 0.9],
  necromancer: ["mob_necromancer", 0.9], spectral_colossus: ["mob_spectral_colossus", 1.0], ghost_king: ["mob_ghost_king", 1.05],
  void_stalker: ["mob_void_stalker", 0.9], void_titan: ["mob_void_titan", 1.0], void_witch: ["mob_void_witch", 0.9],
  void_dragon: ["mob_void_dragon", 1.1],
  wb_gorgath: ["wb_gorgath", 1.3], wb_ignaroth: ["wb_ignaroth", 1.3], wb_krovak: ["wb_krovak", 1.3],
};
/** Pixel effect played where each world boss skill lands. */
const WB_FX: Record<string, string> = {
  quake: "impacts/ground-slam", boulders: "explosions/small-explosion", roar: "impacts/ground-slam", doom: "shadow/dark-explosion",
  flame_ring: "fire/fire-ring", meteors: "fire/meteor", heat: "fire/fire-ring", inferno: "fire/meteor",
  frost_nova: "ice/frost-nova", icicles: "ice/ice-lance", blizzard: "ice/frost-nova", absolute_zero: "ice/frost-nova",
};
const NPC_LOOK: Record<string, string> = {
  elder: "npc_elder", healer: "npc_healer", warrior: "npc_warrior", merchant: "npc_merchant", smith: "npc_smith",
};
const CLASS_RING: Record<string, string> = { blade_master: "red", grand_sorcerer: "cyan", night_ranger: "green" };
const DOT_COLOR: Record<string, string> = { bleed: "#ff5a5a", poison: "#9dff6a", burn: "#ffaa44" };
const STATUS_FX: Record<string, string> = { stun: "status/stunned", freeze: "status/frozen", slow: "status/slowed" };
const ERRORS: Record<string, string> = {
  not_enough_mp: "Mana insuficiente", on_cooldown: "Ainda recarregando", dead: "Você está morto",
  locked: "Skill bloqueada", no_target: "Escolha um alvo", too_far: "Alvo muito longe", stunned: "Você está atordoado",
  safe_zone: "Não é possível lutar na vila", unknown: "Skill desconhecida", unavailable: "Indisponível",
  gcd: "", // the server's global cooldown was still running (network timing): silent, the skill is tried again
};
/** Global cooldown after any skill but the basic attack, like the server (game.py GCD_SECS). */
const GCD_MS = 900;
/** Tiles from the target where a skill may go off: blows that must touch walk into contact (range - 0.2), ranged
 *  shots stop a little past their range (the server forgives 0.9 tile for those). `slack` is that ranged margin. */
function castReach(skill: SkillDef, slack: number): number {
  const short = ["melee", "dash", "aoe_self"].includes(skill.kind) || skill.range < 3;
  return short ? Math.max(0.8, skill.range - 0.2) : skill.range + slack;
}

interface Unit {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite;
  flash: Phaser.GameObjects.Image;
  /** Pre-rendered 3D sheet key, when this unit has one (otherwise the canvas art is used). */
  sheet?: string;
  dir: number;
  anim: string;
  action?: { anim: string; until: number };
  lastX: number;
  lastY: number;
  speed: number;
  shadow: Phaser.GameObjects.Image;
  label?: Phaser.GameObjects.Text;
  /** level title shown above the name */
  titleTag?: Phaser.GameObjects.Text;
  /** the title's glow and (higher titles) sparkles */
  titleGlow?: Phaser.GameObjects.Image;
  titleSparks?: Phaser.GameObjects.Particles.ParticleEmitter;
  /** season pass aura at the feet (a cosmetic): glow, ring and rising sparks */
  aura?: { id: string; objs: Phaser.GameObjects.GameObject[] };
  /** the horse this hero rides (looks only); `on` is false for a moment while attacking or casting */
  ride?: { id: string; sheet: string; horse: Phaser.GameObjects.Sprite; raise: number; on: boolean; anim: string; combat: number;
    /** the hero already seated on this mount, drawn in 3D as one sheet (ride_<class>_<mount>); once loaded it
     *  replaces the hero body + horse pair while riding */
    full?: string };
  /** guild name shown above the name */
  guildTag?: Phaser.GameObjects.Text;
  bubble?: Phaser.GameObjects.Text;
  hpBar?: Phaser.GameObjects.Graphics;
  mark?: Phaser.GameObjects.Image;
  scale: number;
  height: number;
  worldX: number;
  worldY: number;
  targetX: number;
  targetY: number;
  moving: boolean;
  phase: number;
  seed: number;
  baseKey: string;
  /** heroes: the skin worn ("" = the class's own look); baseKey is then `unit_<cls>~<skin>` */
  skin?: string;
  frame: string;
  hp: number;
  maxHp: number;
  dead: boolean;
}

interface MobUnit extends Unit {
  id: string;
  defId: string;
  name: string;
  level: number;
  boss: boolean;
}

interface VeinObj {
  id: string;
  kind: string;
  x: number;
  y: number;
  ready: boolean;
  img: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

interface RemoteHero extends Unit {
  id: string;
  name: string;
  cls: string;
  level: number;
  pk: PkStatus;
  guild: string;
}

/** Name colour of players whose guild is at war with ours. */
const WAR_COLOR = "#ff7a3a";

interface Npc extends Unit {
  id: string;
  name: string;
  role: string;
}

type Target = { kind: "mob" | "hero"; id: string } | null;

export interface MinimapData {
  px: number;
  py: number;
  mobs: { x: number; y: number; boss: boolean }[];
  players: { x: number; y: number; party: boolean }[];
  npcs: { x: number; y: number }[];
  /** hidden places of this map the hero already found */
  places: { x: number; y: number; landmark: boolean }[];
  target: string | null;
}

/** The automatic modes that fight (they stay on while the player walks; only turning them off or a safe zone ends them). */
const attackMode = (m: AutoMode) => m === "farm" || m === "pvp";

/** How much darker the world gets at night. */
const NIGHT_EXTRA = 0.16;

export class GameScene extends Phaser.Scene {
  charId = "";
  private cls = "blade_master";
  hero!: HeroState;
  mapInfo: MapInfo | null = null;

  private player!: Unit;
  private moveTarget: { x: number; y: number } | null = null;
  private lastMoveSent = 0;
  private lastReal = 0;
  private bossShown: string | null = null;
  private baseZoom = 1.5;
  /** Touch joystick direction on screen (-1..1), from the HUD. */
  private joy = { x: 0, y: 0, active: false };
  private pinchDist = 0;
  private zoomPulse = 1;
  private look = { x: 0, y: 0 };
  private isDead = false;
  private stunnedUntil = 0;
  /** boss danger circles about to land (world tiles): the auto-pilot walks out of them */
  private dangers: { x: number; y: number; r: number; until: number }[] = [];
  /** auto-pilot: "farm" hunts around where it was turned on; "quest" travels to the story goal and works it */
  private auto: AutoState | null = null;
  inventory: InventoryState | null = null;
  private lastSnapshot: ServerMessage[] = [];
  party: PartyMember[] = [];

  private remotes = new Map<string, RemoteHero>();
  private mobs = new Map<string, MobUnit>();
  private npcs = new Map<string, Npc>();
  /** the Hidden Wanderer's exploration marks (only the quest holder gets them, only up close) */
  private hqMarks = new Map<number, Phaser.GameObjects.GameObject[]>();
  /** the star and glow over each hidden place of this map not found yet, by place id */
  private placeMarks = new Map<string, Phaser.GameObjects.GameObject[]>();
  /** our guild's name and the guilds we are at war with */
  myGuild = "";
  private guildEnemies = new Set<string>();
  /** today's daily missions, as sent by the server */
  daily: DailyState | null = null;
  private portalObjs: Phaser.GameObjects.GameObject[] = [];
  private portalFx: PfxHandle[] = [];

  private target: Target = null;
  private pendingCast: { skill: SkillDef } | null = null;
  /** A skill pressed during the global cooldown: it goes off as soon as the cooldown ends (or is dropped at `until`). */
  private queuedCast: { skill: SkillDef; until: number } | null = null;
  private gcdUntil = 0;
  private pendingTalk: string | null = null;
  private pendingMine: string | null = null;
  private veins = new Map<string, VeinObj>();
  private digging = new Map<string, Phaser.Time.TimerEvent>(); // char id → swing loop while mining
  private mineBar?: { g: Phaser.GameObjects.Graphics; t: Phaser.GameObjects.Text; start: number; dur: number };
  private targetRing!: Phaser.GameObjects.Container;
  private hoverRing!: Phaser.GameObjects.Image;
  private heroRing!: Phaser.GameObjects.Image;
  private hover: Target = null;
  private cdUntil = new Map<string, number>();
  private statuses = new Map<string, PfxHandle>();

  private world: WorldRenderer | null = null;
  /** the world's night (server/daynight.py): darker, monsters hit harder and give more */
  private isNight = false;
  /** the player we are dueling (no innocent-player warning when hitting them) */
  private duelFoe: string | null = null;
  private fx!: Fx;
  private pfx!: PixelFx;
  /** the night: a small canvas we paint ourselves (same result with the processor or the graphics card) */
  private dark!: Phaser.GameObjects.Image;
  private darkTex!: Phaser.Textures.CanvasTexture;
  private lightMask!: CanvasImageSource;
  private darkness = 0.5;
  /** colour of the night over this map (its mood) */
  private nightTint = 0x04060f;
  private rays: { img: Phaser.GameObjects.Image; phase: number }[] = [];
  private flashLights: { x: number; y: number; r: number; until: number; dur: number }[] = [];
  private fog: { img: Phaser.GameObjects.Image; vx: number; vy: number }[] = [];
  private ambient: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private metrics = new Map<string, Phaser.Types.GameObjects.Text.TextMetrics>();
  private loadingText?: Phaser.GameObjects.Text;
  private sheetGc?: Phaser.Time.TimerEvent;

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { charId: string; charClass: string }): void {
    this.charId = data.charId;
    this.cls = data.charClass;
    this.remotes.clear();
    this.lastSnapshot = [];
    this.party = [];
    this.mobs.clear();
    this.npcs.clear();
    this.statuses.clear();
    this.cdUntil.clear();
    this.mapInfo = null;
    this.world = null;
    this.fog = [];
    this.ambient = [];
    this.portalObjs = [];
    this.portalFx = [];
    this.target = null;
    this.isDead = false;
    this.sheetGc = undefined;
  }

  create(): void {
    ensureTextures(this);
    ensureSkillIcons(this, [...META.skills, ...META.passives]);
    ensureVeinTextures(this);
    const cam = this.cameras.main;
    cam.setBackgroundColor("#06070b");
    // phones see more of the world around the hero (their screens are short)
    this.baseZoom = isTouch() ? (cam.height < 500 ? 1.0 : 1.2) : cam.height < 620 ? 1.3 : 1.5;
    this.joy = { x: 0, y: 0, active: false };
    cam.setZoom(this.baseZoom);

    this.fx = new Fx(this);
    this.fx.onFlash = (x, y, r, dur) => this.flashLights.push({ x, y, r, dur, until: this.time.now + dur });
    this.pfx = new PixelFx(this);
    this.warmEffects();
    // automatic graphics card: if the game is slow with it on this computer, go back to the processor
    watchGpu(this.game, () => {
      this.events.emit("notice", { text: "A placa de vídeo deixou o jogo lento neste aparelho. Voltando ao modo normal...", kind: "warn" });
      this.time.delayedCall(2500, () => switchGpu("off"));
    });
    this.events.once("shutdown", () => { this.pfx.clear(); socket.disconnect(); socket.clearHandlers(); });
    // rest mode (tab hidden / window out of focus): keep playing, drop what is only there to be seen
    const onRest = () => {
      this.pfx.clear();
      this.world?.dropChunks();
      for (const key of this.textures.getTextureKeys()) if (key.startsWith("thumb:")) this.textures.remove(key);
      // the 3D sheets are most of the memory: every figure goes blank and its pictures are freed until wake
      // (forget the animation too: Phaser replays the old one, with freed pictures, when asked for a missing one)
      const blank = (s: Phaser.GameObjects.Sprite) => { s.anims.stop(); s.anims.currentAnim = null; s.anims.currentFrame = null; s.setTexture("__DEFAULT"); };
      for (const u of this.sheetUnits()) { blank(u.body); u.anim = ""; }
      for (const u of [this.player, ...this.remotes.values()]) if (u?.ride) { blank(u.ride.horse); u.ride.anim = ""; }
      suspendSheets(this);
    };
    const onWake = () => {
      resumeSheets();
      if (!this.mapInfo || !this.world) return;
      this.world.rebuild(this.player.worldX, this.player.worldY, this.viewRadius());
      for (const u of this.sheetUnits()) {
        const key = u.sheet!;
        void this.loadSheet(key).then((ok) => {
          if (!ok || !u.root.active || u.sheet !== key) return;
          u.anim = "";
          u.body.setTexture(`${key}:idle`, u.dir * SHEETS[key].anims.idle.frames);
        });
      }
      for (const u of [this.player, ...this.remotes.values()]) {
        const r = u?.ride;
        if (!r) continue;
        void this.loadSheet(r.sheet).then((ok) => {
          if (!ok || u.ride !== r) return;
          r.anim = "";
          r.horse.setTexture(`${r.sheet}:idle`, u.dir * SHEETS[r.sheet].anims.idle.frames);
        });
      }
    };
    this.game.events.on("rest", onRest);
    this.game.events.on("wake", onWake);
    this.events.once("shutdown", () => { this.game.events.off("rest", onRest); this.game.events.off("wake", onWake); });

    this.player = this.createUnit(`unit_${this.cls}`, 0, 0, HERO_SCALE);
    cam.startFollow(this.player.root, true, 0.09, 0.09);
    this.targetRing = this.add.container(0, 0, [this.add.image(0, 0, "target_ring")]).setDepth(DECAL_DEPTH + 20).setVisible(false);
    this.hoverRing = this.add.image(0, 0, "ring_white").setAlpha(0.35).setDepth(DECAL_DEPTH + 19).setVisible(false);
    this.heroRing = this.add.image(0, 0, `ring_${CLASS_RING[this.cls] ?? "gold"}`).setAlpha(0.28).setScale(0.32, 0.16)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(DECAL_DEPTH + 16);

    this.lightMask = this.textures.get("light_mask").getSourceImage() as CanvasImageSource;
    DARK_RES = this.game.renderer.type === Phaser.WEBGL ? 3 : 2;
    if (this.textures.exists("night_dark")) this.textures.remove("night_dark");
    this.darkTex = this.textures.createCanvas("night_dark", 64, 64)!;
    this.dark = this.add.image(0, 0, "night_dark").setOrigin(0).setDepth(FX_DEPTH - 30);

    this.loadingText = this.add.text(0, 0, "Entrando no mundo…", { fontFamily: FONT, fontSize: "14px", color: "#d8c8a0" })
      .setOrigin(0.5).setScrollFactor(0).setDepth(FX_DEPTH + 100);
    this.loadingText.setPosition(cam.width / 2, cam.height / 2);

    this.setupInput();
    this.setupNetwork();
    socket.connect(this.charId);
  }

  // ── Map loading ──────────────────────────────────────────────────────

  private loadMap(info: MapInfo, x: number, y: number): void {
    this.world?.destroy();
    for (const o of this.portalObjs) o.destroy();
    for (const h of this.portalFx) h.stop();
    for (const m of this.mobs.values()) m.root.destroy();
    for (const r of this.remotes.values()) r.root.destroy();
    for (const n of this.npcs.values()) n.root.destroy();
    for (const s of this.statuses.values()) s.stop();
    for (const e of this.ambient) e.destroy();
    for (const f of this.fog) f.img.destroy();
    this.pfx.clear();
    this.mobs.clear(); this.remotes.clear(); this.npcs.clear(); this.statuses.clear();
    for (const objs of this.hqMarks.values()) objs.forEach((o) => o.destroy());
    this.hqMarks.clear();
    for (const objs of this.placeMarks.values()) objs.forEach((o) => o.destroy());
    this.placeMarks.clear();
    for (const r of this.rays) r.img.destroy();
    this.portalObjs = []; this.portalFx = []; this.ambient = []; this.fog = []; this.rays = [];
    this.target = null; this.pendingCast = null; this.queuedCast = null; this.pendingTalk = null; this.moveTarget = null; this.dangers = [];
    this.clearVeins();
    this.events.emit("target_update", null);
    this.events.emit("boss_update", null);
    this.bossShown = null;

    this.mapInfo = info;
    this.loadingText?.destroy();
    this.loadingText = undefined;

    this.world = new WorldRenderer(this, info);
    this.darkness = this.world.theme.darkness + (this.isNight ? NIGHT_EXTRA : 0);
    this.nightTint = MOOD[info.theme] ?? 0x04060f;

    for (const f of this.world.theme.fires) {
      const { sx, sy } = worldToScreen(f.wx, f.wy);
      this.portalFx.push(this.pfx.play(f.fx, sx, sy + 4, { scale: f.scale, keep: true }));
    }
    this.buildPortals(info);
    this.buildPlaces(info);
    for (const n of info.npcs) this.addNpc(n.id, n.name, n.look, n.role, n.x, n.y);

    this.player.worldX = x;
    this.player.worldY = y;
    this.placeUnit(this.player);
    for (const p of this.lastSnapshot) this.addRemote(p);
    this.cameras.main.centerOn(this.player.root.x, this.player.root.y);
    this.world.update(x, y, this.viewRadius(), true);
    this.createAmbience(info.theme);
    this.updateQuestMarkers();
    this.cameras.main.fadeIn(450, 0, 0, 0);
    this.events.emit("map_info", info);
    this.fx.ring(this.player.root.x, this.player.root.y, "gold", 0.2, 1.4, 700);
    // the previous map's units are gone; once this map's mobs and players have arrived, free the rest
    this.sheetGc?.remove();
    this.sheetGc = this.time.delayedCall(4000, () => this.releaseUnusedSheets());
  }

  private buildPortals(info: MapInfo): void {
    for (const p of info.portals) {
      const { sx, sy } = worldToScreen(p.x, p.y);
      const base = this.add.image(sx, sy, "portal_base").setDepth(DECAL_DEPTH + 12).setAlpha(p.locked ? 0.45 : 1);
      const label = this.cachedText(sx, sy - 92, p.locked ? `${p.label}\n(selado)` : p.label, {
        fontFamily: FONT, fontSize: "24px", color: p.locked ? "#8a8690" : "#e6d2ff", stroke: "#000", strokeThickness: 6, align: "center",
      }).setOrigin(0.5).setDepth(sy + 200).setScale(SHARP);
      this.portalObjs.push(base, label);
      if (!p.locked) this.portalFx.push(this.pfx.play("arcane/portal", sx, sy + 6, { scale: 0.75, glow: 160, keep: true }));
    }
  }

  // ── Units ────────────────────────────────────────────────────────────

  private createUnit(texKey: string, wx: number, wy: number, scale: number, label?: string, labelColor = "#e8dcc0", withHp = false): Unit {
    let body: Phaser.GameObjects.Sprite, flash: Phaser.GameObjects.Image, shadow: Phaser.GameObjects.Image;
    let s: number, height: number;
    const sheet = hasSheet(texKey) ? texKey : undefined;
    if (sheet) {
      const info = SHEETS[sheet];
      s = info.scale;
      height = info.height * 44 + 4;
      shadow = this.add.image(0, 2, "shadow").setScale(info.height * 0.75 + 0.35, 0.8);
      body = this.add.sprite(0, 0, `${sheet}:idle`, 0).setOrigin(0.5, info.originY).setScale(s);
      flash = this.add.image(0, 0, "shadow").setAlpha(0);
    } else {
      // characters that only exist in 3D (e.g. the merchant) borrow a similar drawing while loading
      const drawKey = this.textures.exists(texKey) ? texKey
        : texKey.startsWith("mob_") || texKey.startsWith("wb_") ? "mob_generic" : "npc_elder";
      const [ox, oy] = UNIT_ORIGIN[drawKey] ?? [0.5, 0.95];
      const src = this.textures.get(drawKey).getSourceImage();
      s = scale / UNIT_RES;
      shadow = this.add.image(0, 2, "shadow").setScale((src.width / UNIT_RES / 64) * scale * 0.85, scale * 0.9);
      body = this.add.sprite(0, 0, drawKey).setOrigin(ox, oy).setScale(s);
      flash = this.add.image(0, 0, `${drawKey}_flash`).setOrigin(ox, oy).setScale(s).setAlpha(0);
      height = src.height * oy * s;
    }
    const root = this.add.container(0, 0, [shadow, body, flash]);
    const unit: Unit = {
      root, body, flash, shadow, scale: s, height, worldX: wx, worldY: wy, targetX: wx, targetY: wy, moving: false,
      phase: 0, seed: Math.random() * 10, baseKey: texKey, frame: texKey, hp: 1, maxHp: 1, dead: false,
      sheet, dir: 2, anim: "", lastX: wx, lastY: wy, speed: 0,
    };
    if (label) {
      unit.label = this.cachedText(0, -height - 18, label, {
        fontFamily: FONT, fontSize: "22px", color: labelColor, stroke: "#000000", strokeThickness: 6,
      }).setOrigin(0.5).setScale(SHARP);
      root.add(unit.label);
    }
    if (withHp) {
      unit.hpBar = this.add.graphics();
      root.add(unit.hpBar);
    }
    this.placeUnit(unit);
    if (!sheet && knowsSheet(texKey)) {
      // a monster with no drawing of its own would show the green generic blob while its 3D sheet loads:
      // keep it hidden (shadow only) and show the 3D figure when it arrives
      const placeholder = unit.body.texture.key === "mob_generic";
      if (placeholder) { unit.body.setVisible(false); unit.flash.setVisible(false); }
      // a failed load (network hiccup) is retried a few times; only then the generic drawing shows up
      const tryLoad = (left: number): void => {
        void requestSheet(this, texKey).then((ok) => {
          if (ok) { this.upgradeUnit(unit); return; }
          if (left > 0 && unit.root.active) this.time.delayedCall(4000, () => tryLoad(left - 1));
          else if (placeholder && unit.root.active) { unit.body.setVisible(true); unit.flash.setVisible(true); }
        });
      };
      tryLoad(3);
    }
    return unit;
  }

  /** Swap a unit drawn with the canvas art to its freshly loaded 3D sheet. */
  private upgradeUnit(u: Unit): void {
    if (u.sheet || u.dead || !u.root.active || !u.body.active || !hasSheet(u.baseKey)) return;
    const info = SHEETS[u.baseKey];
    this.tweens.killTweensOf([u.body, u.flash]);
    u.sheet = u.baseKey;
    u.scale = info.scale;
    u.height = info.height * 44 + 4;
    u.dir = u.body.flipX ? 4 : 2;
    u.anim = "";
    u.body.setTexture(`${u.sheet}:idle`, 0).setOrigin(0.5, info.originY).setScale(info.scale)
      .setFlipX(false).setRotation(0).setPosition(0, 0).setAlpha(1).setVisible(true);
    u.flash.setTexture("shadow").setOrigin(0.5).setScale(1).setFlipX(false).setRotation(0).setPosition(0, 0).setAlpha(0).setVisible(true);
    u.shadow.setScale(info.height * 0.75 + 0.35, 0.8);
    u.label?.setY(-u.height - 18);
    this.layoutTags(u);
  }

  /** Stacks the guild and the title above the name (or above the head for the own hero, who has no label). */
  private layoutTags(u: Unit): void {
    // the own hero has no name label: its tags sit right above the head (the 3D frame has some empty space on top)
    const lift = u.ride?.on ? u.ride.raise : 0;  // mounted: everything sits higher
    u.label?.setY(-u.height - 18 - lift);
    let y = (u.label ? -u.height - 32 : -u.height - 2) - lift;
    if (u.guildTag) { u.guildTag.setY(y); y -= 13; }
    u.titleTag?.setY(y);
    u.titleGlow?.setY(y);
    u.titleSparks?.setPosition(0, y);
  }

  /** Puts (or removes) a guild name above a hero. */
  private setGuildTag(u: Unit, guild: string | undefined): void {
    if (!guild) { u.guildTag?.destroy(); u.guildTag = undefined; this.layoutTags(u); return; }
    if (!u.guildTag) {
      u.guildTag = this.add.text(0, 0, "", {
        fontFamily: FONT, fontSize: "20px", color: "#8fd0ff", stroke: "#000000", strokeThickness: 6,
      }).setOrigin(0.5).setScale(SHARP);
      u.root.add(u.guildTag);
    }
    const war = this.guildEnemies.has(guild);
    u.guildTag.setText(`‹${guild}›`).setColor(war ? WAR_COLOR : "#8fd0ff");
    this.layoutTags(u);
  }

  /** Colour of another player's name: party, PK status, or at war with our guild. */
  private remoteColor(r: RemoteHero): string {
    if (this.canFightPlayers() && r.guild && this.guildEnemies.has(r.guild)) return WAR_COLOR;
    return this.nameColor(r.pk, this.inParty(r.id));
  }

  private refreshRemoteColors(): void {
    for (const r of this.remotes.values()) {
      r.label?.setColor(this.remoteColor(r));
      if (r.guildTag) this.setGuildTag(r, r.guild);
    }
  }

  /** Puts (or removes) a level title above a hero. */
  /** A cosmetic aura at the hero's feet: a pulsing glow, a turning ring and (with enough quality) rising sparks. */
  private setAura(u: Unit, auraId: string | undefined): void {
    if ((u.aura?.id ?? "") === (auraId ?? "")) return;
    for (const o of u.aura?.objs ?? []) { this.tweens.killTweensOf(o); o.destroy(); }
    u.aura = undefined;
    const def = META.auras?.find((a) => a.id === auraId);
    if (!def) return;
    const glow = this.add.image(0, 0, `glow_${def.color}`).setBlendMode(Phaser.BlendModes.ADD).setScale(2.4, 0.9).setAlpha(0.5);
    const ring = this.add.image(0, 0, `ring_${def.color}`).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5, 0.22).setAlpha(0.7);
    const objs: Phaser.GameObjects.GameObject[] = [glow, ring];
    this.tweens.add({ targets: glow, alpha: { from: 0.3, to: 0.65 }, duration: 1300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.tweens.add({ targets: ring, scaleX: { from: 0.46, to: 0.56 }, scaleY: { from: 0.2, to: 0.25 }, duration: 1300, yoyo: true,
      repeat: -1, ease: "Sine.easeInOut" });
    u.root.addAt([glow, ring], 0);
    if (gfx().particles >= 0.7) {
      const sparks = this.add.particles(0, 0, `spark_${def.color}`, {
        x: { min: -22, max: 22 }, y: { min: -6, max: 4 }, lifespan: 1100, speedY: { min: -40, max: -18 }, speedX: { min: -6, max: 6 },
        scale: { start: 0.45, end: 0 }, alpha: { start: 0.9, end: 0 }, frequency: 120, blendMode: "ADD",
      });
      u.root.addAt(sparks, 2);
      objs.push(sparks);
    }
    u.aura = { id: def.id, objs };
  }

  private setTitleTag(u: Unit, titleId: string | undefined): void {
    const t = META.titles.find((x) => x.id === titleId);
    for (const o of [u.titleTag, u.titleGlow]) if (o) { this.tweens.killTweensOf(o); o.destroy(); }
    u.titleSparks?.destroy();
    u.titleTag = u.titleGlow = u.titleSparks = undefined;
    if (!t) { this.layoutTags(u); return; }
    const tag = this.add.text(0, 0, `« ${t.name} »`, {
      fontFamily: FONT, fontSize: "23px", color: t.color, stroke: "#000000", strokeThickness: 6, fontStyle: "bold",
    }).setOrigin(0.5).setScale(SHARP);
    const glowKey = TITLE_GLOW[t.id] ?? "gold";
    const glow = this.add.image(0, 0, `glow_${glowKey}`).setBlendMode(Phaser.BlendModes.ADD)
      .setScale((tag.displayWidth + 26) / 44, 0.42).setAlpha(0.35);
    u.root.add([glow, tag]);
    u.titleTag = tag;
    u.titleGlow = glow;
    this.tweens.add({ targets: glow, alpha: { from: 0.22, to: 0.62 }, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.tweens.add({ targets: tag, scale: { from: SHARP, to: SHARP * 1.06 }, duration: 1500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    if (t.level >= 500 && gfx().particles >= 0.7) {
      // the great titles shed little sparks that drift up
      const half = tag.displayWidth / 2;
      u.titleSparks = this.add.particles(0, 0, `spark_${glowKey}`, {
        x: { min: -half, max: half }, y: { min: -3, max: 3 }, lifespan: 900, speedY: { min: -22, max: -10 },
        speedX: { min: -6, max: 6 }, scale: { start: 0.3, end: 0 }, alpha: { start: 0.9, end: 0 }, frequency: 160,
        blendMode: "ADD",
      });
      u.root.add(u.titleSparks);
    }
    tag.once("destroy", () => this.tweens.killTweensOf(tag));
    glow.once("destroy", () => this.tweens.killTweensOf(glow));
    this.layoutTags(u);
  }

  /** A hero's class sheet (`unit_<cls>`), whatever skin he wears. */
  private heroBase(u: Unit): string {
    const r = u as Partial<RemoteHero>;
    if (u === this.player) return `unit_${this.cls}`;
    return r.cls ? `unit_${r.cls}` : u.baseKey.split("~")[0];
  }

  /** Dresses a hero in a skin (or back in the class's own look). The recoloured sheets are made in the browser
   *  from the class's own (no download); the hero keeps his current look until they are ready. */
  private setSkin(u: Unit, skinId: string | undefined): void {
    const want = skinId ?? "";
    if ((u.skin ?? "") === want) return;
    u.skin = want;
    if (u.ride) {
      // the seated picture depends on the look: get off and back on with the new one
      const owner = u === this.player ? this.charId : (u as RemoteHero).id, mount = u.ride.id;
      this.setMount(owner, undefined);
      this.setMount(owner, mount);
    }
    const base = this.heroBase(u);
    const def = want ? META.skins?.find((s) => s.id === want) : undefined;
    const apply = (key: string): void => {
      if ((u.skin ?? "") !== want || !u.root.active || u.baseKey === key) return;
      u.baseKey = key;
      if (!u.sheet) { this.upgradeUnit(u); return; }
      u.sheet = key;
      u.anim = "";
      u.body.setTexture(`${key}:idle`, u.dir * SHEETS[key].anims.idle.frames);
    };
    if (!def) {
      if (hasSheet(base)) apply(base);
      else void requestSheet(this, base).then((ok) => { if (ok) apply(base); });
      return;
    }
    if (def.sheet) {
      // its own model, rendered with this class's animations
      const key = `${def.sheet}_${base.replace(/^unit_/, "")}`;
      if (!knowsSheet(key)) return;
      if (hasSheet(key)) apply(key);
      else void requestSheet(this, key).then((ok) => { if (ok) apply(key); });
      return;
    }
    if (def.grade) void requestGraded(this, base, def.id, def.grade).then((ok) => { if (ok) apply(skinKey(base, def.id)); });
  }

  /** Puts a hero on a mount (or takes him off). Looks only, the pace never changes. The hero seated on that mount is
   *  one 3D sheet (ride_<class>_<mount>, or ride_<skin sheet>_<mount> for a skin with its own model), the only thing
   *  loaded. A recolour skin (or a mount without that sheet) rides the plain animal instead, in his own sheet's seated
   *  pose ("ride"), so the colours show on the mount. */
  private setMount(ownerId: string, mountId: string | undefined): void {
    const u = ownerId === this.charId ? this.player : this.remotes.get(ownerId);
    if (!u) return;
    const want = mountId ?? "";
    if ((u.ride?.id ?? "") === want) return;
    if (u.ride) {
      u.ride.horse.destroy();
      u.ride = undefined;
      u.body.setY(0).setVisible(true);
      if (u.body.isCropped) u.body.setCrop();
      this.layoutTags(u);
    }
    const def = META.mounts?.find((m) => m.id === want);
    if (!def) return;
    // a skin with its own model has its own seated sheets (ride_<skin sheet>_<mount>, the same for every class);
    // a recolour skin rides the plain animal in the class's seated pose, recoloured like the rest of the hero
    const skinDef = u.skin ? META.skins?.find((s) => s.id === u.skin) : undefined;
    const rider = skinDef?.sheet ?? (skinDef ? "" : this.heroBase(u).replace(/^unit_/, ""));
    const combined = `ride_${rider}_${def.id}`;
    const full = !!rider && knowsSheet(combined);
    const sheet = full ? combined : def.sheet;
    const put = () => {
      if (u.ride || !u.root.active) return;
      const want2 = ownerId === this.charId ? this.hero?.cosmetics?.mount : (this.remotes.get(ownerId) === u ? want : "");
      if (want2 !== def.id) return;
      const info = SHEETS[sheet];
      const horse = this.add.sprite(0, 0, `${sheet}:idle`, u.dir * info.anims.idle.frames).setOrigin(0.5, info.originY).setScale(info.scale);
      u.root.addAt(horse, u.root.getIndex(u.body));  // just under the rider
      u.ride = full
        // name and tags above the rider's head (about 1.45× the mount's height)
        ? { id: def.id, sheet, full: sheet, horse, raise: Math.max(0, Math.round(info.height * 44 * 1.45 - (u.height - 4))), on: false, anim: "", combat: 0 }
        // saddle: the animal's back, as a share of its height (horse 0.72, stag 0.52, dragon 0.40…)
        : { id: def.id, sheet, horse, raise: Math.round(info.height * 44 * (def.saddle ?? 0.72)), on: false, anim: "", combat: 0 };
      horse.setVisible(false);  // updateRides shows it (and hides the body) on the next frame
    };
    if (hasSheet(sheet)) put();
    else void requestSheet(this, sheet).then((ok) => { if (ok) put(); });
  }

  /** Each frame: rider up on the saddle (idle pose, legs cut at the knee) and the horse walking his way;
   *  while attacking or casting the hero steps down for a moment, so the full attack animation shows. */
  private updateRides(time: number): void {
    for (const u of [this.player, ...this.remotes.values()]) {
      const r = u?.ride;
      if (!u || !r || !u.sheet) continue;
      const fighting = (u.action && time < u.action.until) || time - r.combat < 2500 || u.dead || (u === this.player && this.isDead);
      const on = !fighting;
      if (on !== r.on) {
        r.on = on;
        r.horse.setVisible(on);
        u.shadow.setScale(on ? u.shadow.scaleX * 1.8 : u.shadow.scaleX / 1.8, u.shadow.scaleY);
        u.body.setVisible(!(on && r.full));
        if (r.full) {
          if (u.body.isCropped) u.body.setCrop();
        } else if (on && !SHEETS[u.sheet].anims.ride) {
          // no seated pose rendered: keep the body from the head down to the knees (feet at originY of the frame)
          const info = SHEETS[u.sheet];
          const foot = info.originY * info.size, bodyPx = (info.height * 44) / info.scale;
          u.body.setCrop(0, 0, info.size, foot - bodyPx * 0.28);
        } else if (u.body.isCropped) {
          u.body.setCrop();
        }
        u.body.setY(0);
        this.layoutTags(u);
      }
      if (!on) continue;
      if (r.full) {
        // one sheet: the mount walks and the hero rides it, both from the same 3D render
        const fa = SHEETS[r.full].anims;
        const anim = u.moving ? (fa.run && (u === this.player || u.speed > 2.6) ? "run" : fa.walk ? "walk" : "idle") : "idle";
        const key = animKey(r.full, anim, u.dir);
        if (key !== r.anim && this.anims.exists(key)) { r.horse.play(key); r.anim = key; }
        continue;
      }
      // the horse's body sits ~9 px ahead of its frame point and the saddle just behind the middle:
      // nudge the rider a little forward along his direction (screen angles clockwise from east, ground squashed 2:1)
      const ang = (u.dir * Math.PI) / 4;
      u.body.x = Math.cos(ang) * 9;
      const heroPx = SHEETS[u.sheet].height * 44;
      const seat = SHEETS[u.sheet].anims.ride ? heroPx * 0.52 - 3 : heroPx * 0.28;  // the hips sink a little into the saddle
      u.body.y = -r.raise + Math.round(seat) + Math.sin(ang) * 4.5;
      const info = SHEETS[r.sheet];
      const anim = u.moving ? (info.anims.run && (u === this.player || u.speed > 2.6) ? "run" : "walk") : "idle";
      const key = animKey(r.sheet, anim, u.dir);
      if (key !== r.anim && this.anims.exists(key)) { r.horse.play(key); r.anim = key; }
    }
  }

  /** mascots following heroes: owner char id → the pet unit */
  private pets = new Map<string, { id: string; unit: Unit }>();
  /** the pet each owner should show (a sheet may still be loading) */
  private petWanted = new Map<string, string>();

  /** Shows (or removes) the mascot that follows a hero; the 3D sheet loads first, so it never pops in as a placeholder. */
  private setPet(ownerId: string, petId: string | undefined): void {
    const want = petId ?? "";
    this.petWanted.set(ownerId, want);
    const cur = this.pets.get(ownerId);
    if ((cur?.id ?? "") === want) return;
    if (cur) { cur.unit.root.destroy(); this.pets.delete(ownerId); }
    const def = META.pets?.find((p) => p.id === want);
    if (!def) return;
    const spawn = () => {
      if (this.petWanted.get(ownerId) !== def.id || this.pets.has(ownerId)) return;
      const owner = ownerId === this.charId ? this.player : this.remotes.get(ownerId);
      if (!owner) return;
      const u = this.createUnit(def.sheet, owner.worldX - 1.1, owner.worldY + 0.5, 0.6);
      this.pets.set(ownerId, { id: def.id, unit: u });
    };
    if (hasSheet(def.sheet)) spawn();
    else void requestSheet(this, def.sheet).then((ok) => { if (ok) spawn(); });
  }

  /** Each pet trots after its owner and stops a little behind, like a real companion. */
  private updatePets(time: number, dt: number): void {
    for (const [ownerId, p] of this.pets) {
      const owner = ownerId === this.charId ? this.player : this.remotes.get(ownerId);
      if (!owner || !owner.root.active) { p.unit.root.destroy(); this.pets.delete(ownerId); continue; }
      const u = p.unit;
      const dx = u.worldX - owner.worldX, dy = u.worldY - owner.worldY;
      const d = Math.hypot(dx, dy);
      if (d > 1.7) {
        const k = 1.2 / d;
        u.targetX = owner.worldX + dx * k;
        u.targetY = owner.worldY + dy * k;
      }
      this.stepToward(u, dt, MOVE_SPEED * (d > 4 ? 1.6 : 1.1));
      this.animate(u, time, dt);
    }
  }

  /** Every unit on the map drawn with a 3D sheet (heroes, monsters, NPCs, mascots). */
  private sheetUnits(): Unit[] {
    const all: Unit[] = [this.player, ...this.remotes.values(), ...this.mobs.values(), ...this.npcs.values()];
    for (const p of this.pets.values()) all.push(p.unit);
    return all.filter((u) => u?.sheet && u.root.active);
  }

  /** (Re)load a sheet: a skin's recolour is made again from the class sheet, the rest come from the files. */
  private loadSheet(key: string): Promise<boolean> {
    const [base, skin] = key.split("~");
    const g = skin ? META.skins?.find((s) => s.id === skin)?.grade : undefined;
    return g ? requestGraded(this, base, skin, g) : requestSheet(this, key);
  }

  /** Free the 3D sheets that no unit on this map uses (the player's hero is always kept). */
  private releaseUnusedSheets(): void {
    const used = new Set<string>([this.player.baseKey]);
    for (const p of this.pets.values()) used.add(p.unit.baseKey);
    for (const u of [this.player, ...this.remotes.values()]) if (u.ride) used.add(u.ride.sheet);
    for (const group of [this.mobs, this.remotes, this.npcs] as Map<string, Unit>[]) {
      for (const u of group.values()) if (u.root.active) used.add(u.baseKey);
    }
    for (const key of loadedSheets()) if (!used.has(key)) releaseSheet(this, key);
  }

  private placeUnit(u: Unit): void {
    const { sx, sy } = worldToScreen(u.worldX, u.worldY);
    u.root.setPosition(sx, sy).setDepth(sy);
  }

  private face(u: Unit, screenDx: number, screenDy = 0): void {
    if (u.sheet) {
      if (Math.abs(screenDx) + Math.abs(screenDy) > 0.01) u.dir = dirIndex(screenDx, screenDy);
      return;
    }
    if (Math.abs(screenDx) < 0.001) return;
    u.body.setFlipX(screenDx < 0);
    u.flash.setFlipX(screenDx < 0);
  }

  /** Play a one-shot animation (attack, cast, hit) on a 3D unit; falls back to `alt` when missing. */
  private playAction(u: Unit, anim: string, alt?: string): void {
    if (!u.sheet || u.dead) return;
    const anims = SHEETS[u.sheet].anims;
    const name = anims[anim] ? anim : alt && anims[alt] ? alt : null;
    if (!name) return;
    const a = anims[name];
    u.action = { anim: name, until: this.time.now + (a.frames / a.fps) * 1000 };
    if (u.ride) u.ride.combat = this.time.now;
    u.anim = "";
  }

  private animateSheet(u: Unit, time: number, dt: number): void {
    const moved = Math.hypot(u.worldX - u.lastX, u.worldY - u.lastY) / Math.max(dt, 0.001);
    u.speed += (moved - u.speed) * Math.min(1, dt * 8);
    u.lastX = u.worldX;
    u.lastY = u.worldY;
    if (!hasSheet(u.sheet!)) return; // resting, or coming back from rest: the pictures are not loaded yet
    const anims = SHEETS[u.sheet!].anims;
    let anim = "idle";
    if (u.action && time < u.action.until) anim = u.action.anim;
    else if (u.ride?.on && anims.ride) anim = "ride";
    else if (u.moving && !u.ride?.on) anim = anims.run && (u === this.player || u.speed > 2.6) ? "run" : anims.walk ? "walk" : "idle";
    let key = animKey(u.sheet!, anim, u.dir);
    if (key === u.anim) return;
    if (!this.anims.exists(key)) {
      anim = "idle";
      key = animKey(u.sheet!, anim, u.dir);
      if (key === u.anim || !this.anims.exists(key)) return;
    }
    const sameAnim = u.anim.split(":")[1] === anim;
    const progress = sameAnim && u.body.anims.currentAnim ? u.body.anims.getProgress() : 0;
    u.body.play(key);
    if (sameAnim && u.body.anims.currentAnim && SHEETS[u.sheet!].anims[anim]?.loop) u.body.anims.setProgress(progress);
    u.anim = key;
  }

  private drawHp(u: Unit, color = 0xc0303a, w = 34): void {
    if (!u.hpBar) return;
    const g = u.hpBar;
    g.clear();
    const h = 4, y = -u.height - 7;
    const pct = Phaser.Math.Clamp(u.hp / u.maxHp, 0, 1);
    g.fillStyle(0x000000, 0.75).fillRect(-w / 2 - 1, y - 1, w + 2, h + 2);
    g.fillStyle(0x3a0a0a, 1).fillRect(-w / 2, y, w, h);
    g.fillStyle(pct > 0.5 ? color : pct > 0.25 ? 0xd07a20 : 0xe0a020, 1).fillRect(-w / 2, y, w * pct, h);
    g.fillStyle(0xffffff, 0.25).fillRect(-w / 2, y, w * pct, 1);
  }

  private addMob(m: ServerMessage, respawn: boolean): void {
    const id = m.id as string;
    const old = this.mobs.get(id);
    if (old) {
      if (!old.dead) return;
      old.root.destroy();
    }
    const defId = m.def_id as string;
    const [tex, scale] = MOB_LOOK[defId] ?? ["mob_generic", 0.85];
    const boss = !!m.boss;
    const label = `${m.name} · Nv ${m.level}`;
    const u = this.createUnit(tex, m.x as number, m.y as number, scale, label, boss ? "#d8a8ff" : "#e07a6a", true);
    // extend the same object (not a copy): a pending 3D upgrade holds a reference to it
    const mob: MobUnit = Object.assign(u, { id, defId, name: m.name as string, level: m.level as number, boss, hp: m.hp as number, maxHp: m.max_hp as number });
    this.drawHp(mob, boss ? 0x9a48ec : 0xc0303a, boss ? 60 : 34);
    this.mobs.set(id, mob);
    if (respawn) {
      mob.root.setAlpha(0);
      this.tweens.add({ targets: mob.root, alpha: 1, duration: 600 });
      this.pfx.play("spawn/summon-rise", mob.root.x, mob.root.y, { scale: 0.5, palette: palette("shadow"), life: 2.2 });
    }
  }

  private addRemote(m: ServerMessage): void {
    const id = m.char_id as string;
    if (id === this.charId) return;
    const existing = this.remotes.get(id);
    if (existing) {
      existing.targetX = m.x as number;
      existing.targetY = m.y as number;
      return;
    }
    const cls = (m.cls as string) || "blade_master";
    const fight = this.canFightPlayers();
    const pk = ((m.pk as PkStatus) ?? "white");
    const u = this.createUnit(`unit_${cls}`, m.x as number, m.y as number, HERO_SCALE, `${m.name} · Nv ${m.level ?? 1}`,
      this.nameColor(pk, this.inParty(id)), fight);
    const r: RemoteHero = Object.assign(u, { id, name: m.name as string, cls, level: (m.level as number) ?? 1, hp: 1, maxHp: 1, pk,
      guild: (m.guild as string) || "" });
    if (fight) this.drawHp(r, 0xd04040);
    r.label?.setColor(this.remoteColor(r));
    this.remotes.set(id, r);  // first: setMount/setPet look the hero up by id
    this.setTitleTag(r, m.title as string | undefined);
    this.setAura(r, m.aura as string | undefined);
    this.setPet(id, m.pet as string | undefined);
    this.setSkin(r, m.skin as string | undefined);  // before the mount: a skinned hero rides in his own look
    this.setMount(id, m.mount as string | undefined);
    this.setGuildTag(r, r.guild);
  }

  /** Players can hurt each other everywhere except the safe town (free in the arena, with PK rules outside). */
  private canFightPlayers(): boolean {
    return !!this.mapInfo && !this.mapInfo.safe && !this.mapInfo.event;
  }

  private nameColor(pk: PkStatus, party = false): string {
    if (party && pk === "white") return PARTY_COLOR;
    return this.mapInfo?.pvp && !party ? "#ff9a8a" : PK_INFO[pk].color;
  }

  inParty(id: string): boolean {
    return id !== this.charId && this.party.some((m) => m.id === id);
  }

  /** Auto-targeting (TAB, skills without a target) never picks an innocent player outside the arena. */
  private autoTargetable(r: RemoteHero): boolean {
    if (this.inParty(r.id) || (r.guild && r.guild === this.myGuild)) return false;
    if (this.canFightPlayers() && r.guild && this.guildEnemies.has(r.guild)) return true;
    return !!this.mapInfo?.pvp || (this.canFightPlayers() && r.pk !== "white");
  }

  private addNpc(id: string, name: string, look: string, role: string, x: number, y: number): void {
    const u = this.createUnit(NPC_LOOK[look] ?? "npc_elder", x, y, HERO_SCALE, name, "#ffd77a");
    u.body.setFlipX(true);
    u.flash.setFlipX(true);
    const npc: Npc = Object.assign(u, { id, name, role });
    if (role === "story" || role === "daily") {
      npc.mark = this.add.image(0, -u.height - 34, "mark_quest").setVisible(false);
      npc.root.add(npc.mark);
      this.tweens.add({ targets: npc.mark, y: npc.mark.y - 5, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    this.npcs.set(id, npc);
  }

  /** A hooded figure in purple that fades in out of the mist, with a slow glow at its feet. */
  private addHiddenNpc(id: string, name: string, x: number, y: number): void {
    const u = this.createUnit(NPC_LOOK.elder, x, y, HERO_SCALE, name, "#c8a8ff");
    u.body.setFlipX(true);
    u.flash.setFlipX(true);
    u.body.setTint(0xb8a8ff);
    const glow = this.add.image(0, -u.height * 0.45, "glow_purple").setBlendMode(Phaser.BlendModes.ADD).setScale(2.4).setAlpha(0.35);
    const ring = this.add.image(0, 0, "ring_purple").setBlendMode(Phaser.BlendModes.ADD).setScale(0.55, 0.22).setAlpha(0.6);
    const mist = this.add.particles(0, -10, "spark_purple", {
      x: { min: -18, max: 18 }, lifespan: 1600, speedY: { min: -26, max: -10 }, scale: { start: 0.5, end: 0 },
      alpha: { start: 0.8, end: 0 }, frequency: 160, blendMode: "ADD",
    });
    u.root.addAt([glow, ring, mist], 0);
    this.tweens.add({ targets: glow, alpha: { from: 0.2, to: 0.5 }, duration: 1600, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: ring, alpha: { from: 0.3, to: 0.7 }, duration: 1300, yoyo: true, repeat: -1 });
    u.root.setAlpha(0);
    this.tweens.add({ targets: u.root, alpha: 1, duration: 900 });
    this.npcs.set(id, Object.assign(u, { id, name, role: "hidden" }) as Npc);
  }

  /** An exploration mark on the ground: a purple glow; touching it is checked by the server. */
  /** The hidden places of this map (server/discovery.py): their objects, and a floating star over each one not found. */
  private buildPlaces(info: MapInfo): void {
    const world = this.world;
    if (!world) return;
    ensurePlaceMark(this);
    const found = new Set(this.hero?.found ?? []);
    for (const p of META.discovery?.places[info.map_id] ?? []) {
      const key = placeTexture(this, p.look, p.glow);
      let top = 70;
      if (key && this.textures.exists(key)) {
        const origin = PLACE_ORIGIN[p.look] ?? THEME_ORIGIN[key] ?? [0.5, 0.9];
        const light = p.landmark ? 260 : p.look === "shrine" ? 120 : 0;
        const img = world.addPlace(key, p.x, p.y, origin, p.landmark || p.look === "statue", light);
        top = img.height * origin[1];
        const { sx, sy } = worldToScreen(p.x, p.y);
        if (p.landmark) {
          const shadow = this.add.image(sx + 6, sy + 2, "shadow").setScale(img.width / 64 * 0.8, img.width / 64 * 0.3).setAlpha(0.5)
            .setDepth(GROUND_DEPTH + 2);
          world.own(shadow);
          if (FLOATING.has(p.look)) this.tweens.add({ targets: img, y: img.y - 10, duration: 2600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        }
        if (p.glow && (p.landmark || p.look === "shrine")) {
          const glow = this.add.image(sx, sy - top * 0.45, `glow_${p.glow}`).setBlendMode(Phaser.BlendModes.ADD)
            .setScale(p.landmark ? 5 : 1.6).setAlpha(p.landmark ? 0.35 : 0.45).setDepth(sy + 1);
          world.own(glow);
          this.tweens.add({ targets: glow, alpha: { from: glow.alpha * 0.6, to: glow.alpha }, duration: 1800, yoyo: true, repeat: -1 });
        }
      }
      if (!found.has(p.id)) this.placeMark(p.id, p.x, p.y, top);
    }
  }

  /** A gold star bobbing over a place not found yet, with a few sparks rising. */
  private placeMark(id: string, wx: number, wy: number, top: number): void {
    const { sx, sy } = worldToScreen(wx, wy);
    const y = sy - Math.min(top, 240) - 26;
    const star = this.add.image(sx, y, "mark_place").setDepth(sy + 3);
    const sparks = this.add.particles(sx, sy - 10, "spark_gold", {
      x: { min: -18, max: 18 }, lifespan: 1600, speedY: { min: -36, max: -12 }, scale: { start: 0.55, end: 0 },
      alpha: { start: 0.9, end: 0 }, frequency: 180, blendMode: "ADD",
    }).setDepth(sy + 2);
    this.tweens.add({ targets: star, y: y - 8, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.placeMarks.set(id, [star, sparks]);
  }

  /** The server says the hero just found a place: remember it, a burst of light over it, and the HUD tells the story. */
  private onDiscovered(m: ServerMessage): void {
    const id = m.id as string;
    if (this.hero) this.hero.found = [...(this.hero.found ?? []).filter((x) => x !== id), id];
    const objs = this.placeMarks.get(id);
    if (objs) {
      const star = objs[0] as Phaser.GameObjects.Image;
      this.fx.ring(star.x, star.y + 40, "gold", 0.5, 3, 700);
      this.fx.burst("sparks", "gold", star.x, star.y, 30);
      objs.forEach((o) => o.destroy());
      this.placeMarks.delete(id);
    }
    this.events.emit("discovered", m);
  }

  private hqMark(id: number, wx: number, wy: number, gone: boolean, found: boolean): void {
    const old = this.hqMarks.get(id);
    if (old) {
      const first = old[0] as Phaser.GameObjects.Image;
      if (found) {
        this.fx.ring(first.x, first.y, "purple", 0.4, 2.4, 600);
        this.fx.burst("wisps", "purple", first.x, first.y - 10, 24);
      }
      old.forEach((o) => o.destroy());
      this.hqMarks.delete(id);
    }
    if (gone) return;
    const { sx, sy } = worldToScreen(wx, wy);
    const ring = this.add.image(sx, sy, "ring_purple").setBlendMode(Phaser.BlendModes.ADD).setScale(0.5, 0.2).setDepth(DECAL_DEPTH + 20);
    const glow = this.add.image(sx, sy - 14, "glow_purple").setBlendMode(Phaser.BlendModes.ADD).setScale(1.4).setDepth(sy + 1);
    const sparks = this.add.particles(sx, sy, "spark_purple", {
      x: { min: -14, max: 14 }, lifespan: 1400, speedY: { min: -40, max: -15 }, scale: { start: 0.6, end: 0 },
      alpha: { start: 1, end: 0 }, frequency: 110, blendMode: "ADD",
    }).setDepth(sy + 2);
    this.tweens.add({ targets: glow, alpha: { from: 0.35, to: 0.9 }, scale: { from: 1.1, to: 1.6 }, duration: 900, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: ring, scaleX: { from: 0.4, to: 0.7 }, scaleY: { from: 0.16, to: 0.28 }, alpha: { from: 0.9, to: 0.3 }, duration: 1200, repeat: -1 });
    this.hqMarks.set(id, [ring, glow, sparks]);
  }

  private updateQuestMarkers(): void {
    const st = this.hero?.story?.st;
    const dailyReady = !!this.daily?.tasks.some((t) => t.n >= t.count && !t.claimed);
    for (const n of this.npcs.values()) {
      if (!n.mark) continue;
      if (n.role === "daily") {
        n.mark.setVisible(dailyReady).setTexture("mark_ready");
        continue;
      }
      n.mark.setVisible(st === "offer" || st === "ready");
      n.mark.setTexture(st === "ready" ? "mark_ready" : "mark_quest");
    }
  }

  private killUnit(u: Unit, onDone?: () => void): void {
    u.dead = true;
    u.label?.setVisible(false);
    u.hpBar?.setVisible(false);
    if (u.sheet && SHEETS[u.sheet].anims.death && this.anims.exists(animKey(u.sheet, "death", u.dir))) {
      u.body.play(animKey(u.sheet, "death", u.dir));
      u.anim = "";
    } else {
      const dir = u.body.flipX ? -1 : 1;
      this.tweens.add({ targets: [u.body, u.flash], rotation: dir * 1.45, y: -4, duration: 420, ease: "Bounce.easeOut" });
    }
    this.tweens.add({ targets: u.root, alpha: 0, delay: 900, duration: 700, onComplete: onDone });
  }

  private hitFlash(u: Unit): void {
    if (isResting()) return;
    if (u.sheet) {
      this.tweens.add({ targets: u.body, alpha: { from: 1, to: 0.45 }, duration: 60, yoyo: true });
      if (!u.action || this.time.now > u.action.until) this.playAction(u, "hit");
      return;
    }
    u.flash.setAlpha(1);
    this.tweens.add({ targets: u.flash, alpha: 0, duration: 160, ease: "Quad.easeOut" });
    this.tweens.add({ targets: u.body, x: { from: 0, to: u.body.flipX ? 4 : -4 }, duration: 60, yoyo: true, ease: "Quad.easeOut" });
  }

  private unitOf(id: string | null | undefined): Unit | undefined {
    if (!id) return undefined;
    if (id === this.charId) return this.player;
    return this.mobs.get(id) ?? this.remotes.get(id);
  }

  // ── Input ────────────────────────────────────────────────────────────

  private setupInput(): void {
    const cam = this.cameras.main;
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.mapInfo) return;
      if (p.rightButtonDown()) { this.setTarget(null); return; }
      if (p.leftButtonDown()) this.handleLeftClick(p);
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const t = this.pick(p);
      const npc = t ? null : this.npcAt(p);
      this.hover = t;
      this.input.setDefaultCursor(t ? "crosshair" : npc ? "pointer" : "default");
    });
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.baseZoom = Phaser.Math.Clamp(this.baseZoom - dy * 0.0012, isTouch() ? 0.8 : 1.0, 2.3);
    });
    this.input.mouse?.disableContextMenu();
    const keys = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "ZERO"];
    keys.forEach((k, i) => this.input.keyboard!.on(`keydown-${k}`, () => this.castSlot(i)));
    this.input.keyboard!.on("keydown-SPACE", (e: KeyboardEvent) => { e.preventDefault(); this.castBasic(); });
    this.input.keyboard!.on("keydown-ESC", () => { this.setTarget(null); this.events.emit("escape"); });
    this.input.keyboard!.on("keydown-TAB", (e: KeyboardEvent) => { e.preventDefault(); this.cycleTarget(); });
    this.input.keyboard!.on("keydown-K", () => this.events.emit("toggle_book"));
    this.input.keyboard!.on("keydown-N", () => this.events.emit("toggle_map"));
    this.input.keyboard!.on("keydown-J", () => this.events.emit("toggle_diary"));
    this.input.keyboard!.on("keydown-O", () => this.events.emit("toggle_achievements"));
    this.input.keyboard!.on("keydown-R", () => this.events.emit("toggle_ranking"));
    this.input.keyboard!.on("keydown-C", () => this.events.emit("toggle_char"));
    this.input.keyboard!.on("keydown-I", () => this.events.emit("toggle_inv"));
    this.input.keyboard!.on("keydown-F", () => this.events.emit("toggle_friends"));
    this.input.keyboard!.on("keydown-G", () => this.events.emit("toggle_guild"));
    this.input.keyboard!.on("keydown-P", () => this.events.emit("toggle_pass"));
    this.input.keyboard!.on("keydown-L", () => this.events.emit("toggle_shop"));
    this.input.keyboard!.on("keydown-M", () => socket.send({ type: "toggle_mount" }));
    this.input.keyboard!.on("keydown-ENTER", () => this.events.emit("open_chat"));
    this.input.keyboard!.on("keydown-Q", () => socket.send({ type: "use_potion", kind: "hp" }));
    this.input.keyboard!.on("keydown-E", () => socket.send({ type: "use_potion", kind: "mp" }));
    // inventory and shop actions from the HUD: {type: "buy" | "sell" | "equip" | "unequip" | "discard" | ...}
    this.events.on("inv_action", (msg: Record<string, unknown>) => socket.send(msg));
    this.events.on("request_skill", (slot: number) => this.castSlot(slot));
    this.events.on("basic_attack", () => this.castBasic());
    // touch controls (HUD): joystick, next target, mount
    this.events.on("joy", (x: number, y: number) => {
      const was = this.joy.active;
      this.joy = { x, y, active: Math.hypot(x, y) > 0.18 };
      if (was && !this.joy.active && this.player) { this.moveTarget = null; this.sendPos(true); }
    });
    this.events.on("cycle_target", () => this.cycleTarget());
    this.events.on("toggle_mount", () => socket.send({ type: "toggle_mount" }));
    this.events.on("dialog_option", (opt: string) => socket.dialogOption(opt));
    this.events.on("toggle_autofarm", () => {
      if (this.auto?.mode === "farm") { this.stopAuto(); return; }
      if (this.mapInfo?.safe) {
        this.events.emit("notice", { text: "Aqui é zona segura. Ligue o Auto-Farm numa área com monstros.", kind: "warn" });
        return;
      }
      this.startAuto("farm");
    });
    this.events.on("auto_quest", () => {
      if (this.auto?.mode === "quest") { this.stopAuto(); return; }
      this.startAuto("quest");
    });
    this.events.on("auto_daily", () => {
      if (this.auto?.mode === "daily") { this.stopAuto(); return; }
      this.startAuto("daily");
    });
    // automatic PvP: keeps attacking the player marked as target until one of the two falls
    this.events.on("auto_pvp", () => {
      if (this.auto?.mode === "pvp") { this.stopAuto("Ataque automático desligado."); return; }
      const r = this.target?.kind === "hero" ? this.remotes.get(this.target.id) : undefined;
      if (!r || r.dead) {
        this.events.emit("notice", { text: "Marque primeiro o jogador que você quer atacar (clique nele).", kind: "warn" });
        return;
      }
      if (!this.canFightPlayers()) {
        this.events.emit("notice", { text: "Aqui não dá para lutar contra jogadores.", kind: "warn" });
        return;
      }
      if (this.inParty(r.id) || (r.guild && r.guild === this.myGuild)) {
        this.events.emit("notice", { text: "Esse jogador é do seu grupo ou da sua guilda.", kind: "warn" });
        return;
      }
      this.startAuto("pvp", r.id);
    });
  }

  private pick(p: Phaser.Input.Pointer): Target {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    let best: Target = null, bestD = Infinity;
    const test = (u: Unit, kind: "mob" | "hero", id: string) => {
      if (u.dead) return;
      const halfW = Math.max(18, u.body.displayWidth * 0.38);
      if (Math.abs(wp.x - u.root.x) > halfW || wp.y > u.root.y + 10 || wp.y < u.root.y - u.height) return;
      const d = Math.abs(wp.y - (u.root.y - u.height / 2)) + Math.abs(wp.x - u.root.x);
      if (d < bestD) { bestD = d; best = { kind, id }; }
    };
    for (const [id, m] of this.mobs) test(m, "mob", id);
    for (const [id, r] of this.remotes) if (!this.inParty(id)) test(r, "hero", id);
    return best;
  }

  private npcAt(p: Phaser.Input.Pointer): Npc | null {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    for (const n of this.npcs.values()) {
      if (Math.abs(wp.x - n.root.x) < 22 && wp.y < n.root.y + 10 && wp.y > n.root.y - n.height - 20) return n;
    }
    return null;
  }

  private setTarget(t: Target): void {
    this.target = t;
    const u = t ? (t.kind === "mob" ? this.mobs.get(t.id) : this.remotes.get(t.id)) : undefined;
    if (!u) this.target = null;
    this.emitTarget();
  }

  private emitTarget(): void {
    const t = this.target;
    if (!t) { this.events.emit("target_update", null); return; }
    const m = t.kind === "mob" ? this.mobs.get(t.id) : undefined;
    const r = t.kind === "hero" ? this.remotes.get(t.id) : undefined;
    const u = m ?? r;
    if (!u) return;
    this.events.emit("target_update", {
      name: m ? m.name : r!.name, level: m ? m.level : r!.level, hp: u.hp, maxHp: u.maxHp, boss: !!m?.boss, hero: !!r,
      pk: r && this.canFightPlayers() && !this.mapInfo?.pvp ? r.pk : undefined, guild: r?.guild ?? "",
      fight: !!r && this.canFightPlayers() && !this.inParty(r.id) && !(r.guild && r.guild === this.myGuild),
    });
  }

  /** Two fingers on the world (not on the joystick) pinch the camera closer or farther. */
  private pinchZoom(): void {
    const a = this.input.pointer1, b = this.input.pointer2;
    const joyId = this.registry.get("joyPointer") as number | undefined;
    if (a?.isDown && b?.isDown && a.id !== joyId && b.id !== joyId) {
      const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      if (this.pinchDist > 0) this.baseZoom = Phaser.Math.Clamp(this.baseZoom * (d / this.pinchDist), 0.8, 2.3);
      this.pinchDist = d;
    } else {
      this.pinchDist = 0;
    }
  }

  private cycleTarget(): void {
    const list = this.enemies().sort((a, b) => a.d - b.d).slice(0, 6);
    if (!list.length) return;
    const i = list.findIndex((e) => e.id === this.target?.id);
    const next = list[(i + 1) % list.length];
    this.setTarget({ kind: next.kind, id: next.id });
  }

  private enemies(): { kind: "mob" | "hero"; id: string; d: number; u: Unit }[] {
    const p = this.player;
    const out: { kind: "mob" | "hero"; id: string; d: number; u: Unit }[] = [];
    for (const [id, m] of this.mobs) if (!m.dead) out.push({ kind: "mob", id, d: Math.hypot(m.worldX - p.worldX, m.worldY - p.worldY), u: m });
    for (const [id, r] of this.remotes) {
      if (!r.dead && this.autoTargetable(r)) out.push({ kind: "hero", id, d: Math.hypot(r.worldX - p.worldX, r.worldY - p.worldY), u: r });
    }
    return out;
  }

  private handleLeftClick(p: Phaser.Input.Pointer): void {
    if (this.isDead) return;
    const t = this.pick(p);
    if (t) {
      this.setTarget(t);
      const u = this.unitOf(t.id)!;
      this.fx.ring(u.root.x, u.root.y, "red", 0.9, 0.4, 260);
      const r = t.kind === "hero" ? this.remotes.get(t.id) : undefined;
      if (r && r.id !== this.duelFoe && this.canFightPlayers() && !this.mapInfo?.pvp && r.pk === "white" && this.hero?.pk?.status !== "red") {
        this.events.emit("notice", { text: `${r.name} é inocente. Atacar te deixa Agressor; matar te deixa Assassino (nome vermelho).`, kind: "warn" });
      }
      return;
    }
    const vein = this.veinAt(p);
    if (vein) {
      // stop just short of the vein, on the side the hero comes from
      const d = Math.hypot(this.player.worldX - vein.x, this.player.worldY - vein.y) || 1;
      this.pendingMine = vein.id;
      this.pendingTalk = null;
      this.walkTo(vein.x + ((this.player.worldX - vein.x) / d) * 1.3, vein.y + ((this.player.worldY - vein.y) / d) * 1.3);
      return;
    }
    const npc = this.npcAt(p);
    if (npc) {
      this.pendingMine = null;
      this.pendingTalk = npc.id;
      this.walkTo(npc.worldX + 1.2, npc.worldY + 1.2);
      return;
    }
    this.pendingCast = null;
    this.pendingTalk = null;
    this.pendingMine = null;
    this.takeControl();
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    const { wx, wy } = screenToWorld(wp.x, wp.y);
    const n = (this.mapInfo?.size ?? 40) - 1.5;
    const x = Phaser.Math.Clamp(wx, 0.5, n), y = Phaser.Math.Clamp(wy, 0.5, n);
    this.walkTo(x, y);
    const { sx, sy } = worldToScreen(x, y);
    const marker = this.add.container(sx, sy, [this.add.image(0, 0, "move_ring")]).setScale(0.4, 0.2).setDepth(DECAL_DEPTH + 15);
    this.tweens.add({ targets: marker, scaleX: 0.15, scaleY: 0.075, alpha: 0, duration: 520, ease: "Cubic.easeIn", onComplete: () => marker.destroy() });
  }

  private walkTo(x: number, y: number): void {
    this.moveTarget = { x, y };
  }

  // ── Auto-pilot ───────────────────────────────────────────────────────

  private startAuto(mode: AutoMode, victim?: string): void {
    const p = this.player;
    this.auto = { mode, victim, ax: p.worldX, ay: p.worldY, map: this.mapInfo?.map_id ?? "", nextThink: 0, nextPot: 0, nextTalk: 0, deaths: [], dead: false };
    this.events.emit("auto_state", mode);
    const victimName = victim ? this.remotes.get(victim)?.name ?? "o alvo" : "";
    this.events.emit("notice", {
      text: mode === "pvp" ? `Ataque automático ligado: atacando ${victimName}. Pode andar à vontade; só desliga quando você desligar ou entrar numa zona segura.`
        : mode === "farm" ? "Auto-Farm ligado: caçando os monstros por perto. Pode andar à vontade; só desliga quando você desligar ou entrar numa zona segura."
        : mode === "daily" ? "Diárias automáticas ligadas: vou fazer as caçadas do dia e entregar ao Sargento Hald."
        : "Missão automática ligada: vou cumprir, entregar e pegar as próximas missões sozinho.",
      kind: "quest",
    });
  }

  /**
   * The player moves the hero by hand. The attack modes (Auto-Farm and the automatic attack on a player) stay on:
   * they wait until the hero gets where the player sent it and go on from there. They only end when the player
   * turns them off or enters a safe zone. The mission modes stop (their route would fight the player's).
   */
  private takeControl(): void {
    if (!this.auto) return;
    if (attackMode(this.auto.mode)) { this.auto.manual = true; return; }
    this.stopAuto("Modo automático desligado (você assumiu o controle).");
  }

  private stopAuto(text?: string): void {
    if (!this.auto) return;
    this.auto = null;
    this.pendingCast = null;
    this.moveTarget = null;
    this.events.emit("auto_state", null);
    if (text) this.events.emit("notice", { text, kind: "info" });
  }

  /** Next map on the shortest portal route from `from` to `to` (breadth-first over META.world). */
  private nextHop(from: string, to: string): string | null {
    const prev = new Map<string, string>([[from, from]]);
    const queue = [from];
    while (queue.length) {
      const m = queue.shift()!;
      if (m === to) break;
      for (const p of META.world[m] ?? []) {
        if (!prev.has(p.to)) { prev.set(p.to, m); queue.push(p.to); }
      }
    }
    if (!prev.has(to)) return null;
    let step = to;
    while (prev.get(step) !== from) step = prev.get(step)!;
    return step;
  }

  /** Walks toward `map`; true once the hero is on it. Stops the auto-pilot if a sealed portal is in the way. */
  private travelTo(map: string): boolean {
    const here = this.mapInfo!;
    if (here.map_id === map) return true;
    const hop = this.nextHop(here.map_id, map);
    const portal = hop ? here.portals.find((p) => p.to === hop) : undefined;
    if (!portal) { this.stopAuto("Não achei o caminho para lá."); return false; }
    if (portal.locked) { this.stopAuto("O caminho está selado. Avance na história com o Ancião Aldric."); return false; }
    this.pendingCast = null;
    this.walkTo(portal.x, portal.y);
    return false;
  }

  private thinkAuto(time: number): void {
    const a = this.auto!;
    if (!this.mapInfo || !this.hero || time < a.nextThink) return;
    if (this.isDead) {
      if (attackMode(a.mode)) return;  // stays on: it picks up again once the hero is back on its feet
      if (!a.dead) {
        a.dead = true;
        a.deaths = [...a.deaths.filter((t) => time - t < AUTO_DEATH_WINDOW), time];
        if (a.deaths.length >= AUTO_MAX_DEATHS) {
          this.stopAuto("Modo automático desligado: você morreu 3 vezes. Os monstros estão fortes demais; suba de nível ou melhore o equipamento.");
        }
      }
      return;
    }
    a.dead = false;
    a.nextThink = time + 200;
    const p = this.player;
    if (this.mapInfo.map_id !== a.map) { a.map = this.mapInfo.map_id; a.ax = p.worldX; a.ay = p.worldY; }
    // the attack modes end in a safe zone (nothing to fight there)
    if (a.mode === "farm" && this.mapInfo.safe) { this.stopAuto("Auto-Farm desligado: você entrou numa zona segura."); return; }
    if (a.mode === "pvp" && !this.canFightPlayers()) { this.stopAuto("Ataque automático desligado: você entrou numa zona segura."); return; }
    if (a.manual) {
      if (this.moveTarget || this.joy.active) return;  // still walking where the player sent the hero
      a.manual = false;
      a.ax = p.worldX; a.ay = p.worldY;               // Auto-Farm hunts around the place the player walked to
    }

    // a boss is about to hit the ground under us: run out of the circle before anything else
    this.dangers = this.dangers.filter((d) => d.until > time);
    const threat = this.dangers.find((d) => Math.hypot(p.worldX - d.x, p.worldY - d.y) < d.r + 0.6);
    if (threat) {
      let dx = p.worldX - threat.x, dy = p.worldY - threat.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.2) { const ang = Math.random() * Math.PI * 2; dx = Math.cos(ang); dy = Math.sin(ang); } else { dx /= len; dy /= len; }
      // pick the first escape direction (straight out, then turning) that does not end inside another circle
      const n = (this.mapInfo.size ?? 40) - 1.5;
      for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4, 3.1]) {
        const ex = dx * Math.cos(turn) - dy * Math.sin(turn), ey = dx * Math.sin(turn) + dy * Math.cos(turn);
        const tx = Phaser.Math.Clamp(threat.x + ex * (threat.r + 1.8), 0.5, n), ty = Phaser.Math.Clamp(threat.y + ey * (threat.r + 1.8), 0.5, n);
        // nor on a portal (stepping on the exit would leave the fight)
        const onPortal = this.mapInfo.portals.some((pt) => Math.hypot(tx - pt.x, ty - pt.y) < 2.2);
        if (!onPortal && !this.dangers.some((d) => d !== threat && Math.hypot(tx - d.x, ty - d.y) < d.r + 0.4)) {
          this.pendingCast = null;
          this.walkTo(tx, ty);
          break;
        }
      }
      a.nextThink = time + 120;
      return;
    }

    // potions, like a careful player
    if (time >= a.nextPot) {
      if (this.hero.hp < this.hero.max_hp * 0.5) { socket.send({ type: "use_potion", kind: "hp" }); a.nextPot = time + 3000; }
      else if (this.hero.mp < this.hero.max_mp * 0.3) { socket.send({ type: "use_potion", kind: "mp" }); a.nextPot = time + 3000; }
    }

    if (a.mode === "pvp") {
      const r = this.remotes.get(a.victim ?? "");
      // out of sight or down: keep waiting, the attack goes on when the player is back in reach
      if (!r || r.dead) return;
      if (this.target?.id !== r.id) this.setTarget({ kind: "hero", id: r.id });
      if (!this.pendingCast) this.autoFight(time, r, Math.hypot(r.worldX - p.worldX, r.worldY - p.worldY));
      return;
    }

    let prey: string | null = null; // which monster to hunt ("" = any)
    let home = { x: a.ax, y: a.ay };
    let radius = AUTO_RADIUS;
    if (a.mode === "quest") {
      const st = this.hero.story;
      const q = META.quests[st?.q ?? 0];
      if (!st || st.st === "done" || !q) { this.stopAuto("Parabéns! Você concluiu toda a história."); return; }
      if (st.st !== "active") {
        // offer or ready: walk to the Elder, hand the quest in and take the next one, then keep going. He waits at the
        // entrance of every story map, so use the one here; on a map without him, go to the mission's map.
        let elder = [...this.npcs.values()].find((n) => n.role === "story");
        if (!elder) {
          const questMap = (META.spawns[q.mob] ?? [])[0]?.[0] ?? "town_01";
          if (!this.travelTo(questMap)) return;
          elder = [...this.npcs.values()].find((n) => n.role === "story");
          if (!elder) return;
        }
        this.pendingCast = null;
        if (Math.hypot(elder.worldX - p.worldX, elder.worldY - p.worldY) > 2.4) {
          this.walkTo(elder.worldX + 1.2, elder.worldY + 1.2);
        } else if (time >= a.nextTalk) {
          this.face(p, elder.root.x - p.root.x, elder.root.y - p.root.y);
          socket.dialogOption(st.st === "ready" ? "turnin" : "accept");
          a.nextTalk = time + 1200;
        }
        return;
      }
      const spots = META.spawns[q.mob] ?? [];
      const spot = spots.find(([m]) => m === this.mapInfo!.map_id) ?? spots[0];
      if (!spot) { this.stopAuto(); return; }
      if (!this.travelTo(spot[0])) return;
      prey = q.mob;
      home = { x: spot[1], y: spot[2] };
      radius = 30;
    } else if (a.mode === "daily") {
      // the day's hunts one after another, then hand them in to Sergeant Hald in town
      const d = this.daily;
      if (!d) return;
      const hunt = d.tasks.find((t) => t.kind === "kill" && t.target && !t.claimed && t.n < t.count);
      if (hunt) {
        const spots = META.spawns[hunt.target!] ?? [];
        const spot = spots.find(([m]) => m === this.mapInfo!.map_id) ?? spots[0];
        if (!spot) { this.stopAuto(); return; }
        if (!this.travelTo(spot[0])) return;
        prey = hunt.target!;
        home = { x: spot[1], y: spot[2] };
        radius = 30;
      } else if (d.tasks.some((t) => !t.claimed && t.n >= t.count)) {
        if (!this.travelTo("town_01")) return;
        const hald = [...this.npcs.values()].find((n) => n.role === "daily");
        if (!hald) return;
        this.pendingCast = null;
        if (Math.hypot(hald.worldX - p.worldX, hald.worldY - p.worldY) > 2.4) {
          this.walkTo(hald.worldX + 1.2, hald.worldY + 1.2);
        } else if (time >= a.nextTalk) {
          this.face(p, hald.root.x - p.root.x, hald.root.y - p.root.y);
          socket.dialogOption("daily_claim");
          a.nextTalk = time + 1500;
        }
        return;
      } else {
        const left = d.tasks.filter((t) => !t.claimed && t.n < t.count);
        this.stopAuto(left.length
          ? `Caçadas do dia feitas e entregues! Falta fazer você mesmo: ${left.map((t) => t.text).join(" · ")}.`
          : "Missões diárias concluídas! Volte amanhã para novas missões.");
        return;
      }
    } else if (this.mapInfo.safe) {
      this.stopAuto("Auto-Farm desligado: você entrou numa zona segura.");
      return;
    }

    // pick the nearest living monster in the hunting area (bosses only when the quest asks for them)
    let best: MobUnit | null = null, bestD = Infinity;
    for (const m of this.mobs.values()) {
      // bosses only when the quest asks for one, or in the Global Boss room (where the boss is the point)
      if (m.dead || (prey ? m.defId !== prey : m.boss && !this.mapInfo.event)) continue;
      if (Math.hypot(m.worldX - home.x, m.worldY - home.y) > radius) continue;
      const d = Math.hypot(m.worldX - p.worldX, m.worldY - p.worldY);
      if (d < bestD) { best = m; bestD = d; }
    }
    const current = this.target?.kind === "mob" ? this.mobs.get(this.target.id) : undefined;
    if (current && !current.dead && (!prey || current.defId === prey)) { best = current; bestD = Math.hypot(current.worldX - p.worldX, current.worldY - p.worldY); }
    // self-defense: a monster biting us right now comes first, even if it is not the quest's prey
    for (const m of this.mobs.values()) {
      if (m.dead || m.boss) continue;
      const d = Math.hypot(m.worldX - p.worldX, m.worldY - p.worldY);
      if (d < 2.2 && d < bestD) { best = m; bestD = d; }
    }
    if (!best) {
      this.pendingCast = null;
      if (Math.hypot(home.x - p.worldX, home.y - p.worldY) > 2.5) this.walkTo(home.x, home.y);
      return;
    }
    if (this.target?.id !== best.id) this.setTarget({ kind: "mob", id: best.id });
    if (this.pendingCast) return; // already walking into range for a skill
    this.autoFight(time, best, bestD);
  }

  /** Auto-pilot's attack on the current target: the strongest ready skill (heal when hurt, buffs whenever they are
   *  up), else the basic attack, else walk closer. Deliberate pacing: after a skill it waits for the global
   *  cooldown, and while waiting it only closes in (a melee hero into contact, a ranged one into shooting range). */
  private autoFight(time: number, foe: Unit, dist: number): void {
    const gcd = time < this.gcdUntil;
    const skills = classSkills(this.cls).filter((s) => s.lvl <= this.hero!.level && s.kind !== "blink").reverse();
    const ready = gcd ? [] : skills.filter((s) => (this.cdUntil.get(s.id) ?? 0) <= time && this.hero!.mp >= s.mp);
    const pick = ready.find((s) => s.kind === "heal" && this.hero!.hp < this.hero!.max_hp * 0.6)
      ?? ready.find((s) => s.kind === "buff")
      ?? ready.find((s) => s.kind !== "heal" && s.kind !== "buff");
    const basic = basicSkill(this.cls);
    if (pick) this.tryCast(pick);
    else if (!gcd && basic && (this.cdUntil.get(basic.id) ?? 0) <= time) this.tryCast(basic);
    else if (basic && dist > castReach(basic, 0.6)) {
      // close in to just inside reach, not onto the monster
      const r = Math.max(0.3, castReach(basic, 0.6) - 0.3), k = dist > 0 ? r / dist : 0;
      this.walkTo(foe.worldX + (this.player!.worldX - foe.worldX) * k, foe.worldY + (this.player!.worldY - foe.worldY) * k);
    }
  }

  /** The free basic attack (button / Space): silent while it recharges, so holding it down just keeps attacking. */
  private castBasic(): void {
    const skill = basicSkill(this.cls);
    if (!skill || this.isDead || !this.hero || (this.cdUntil.get(skill.id) ?? 0) > this.time.now) return;
    if (this.mapInfo?.safe) { this.say(ERRORS.safe_zone, "#ffd77a"); return; }
    if (this.auto && !attackMode(this.auto.mode)) this.stopAuto("Modo automático desligado (você assumiu o controle).");
    this.tryCast(skill);
  }

  private castSlot(slot: number): void {
    const skill = classSkills(this.cls)[slot];
    if (!skill || this.isDead || !this.hero) return;
    if (this.hero.level < skill.lvl) {
      this.say(`Desbloqueia no nível ${skill.lvl}`, "#c8b0ff");
      return;
    }
    if ((this.cdUntil.get(skill.id) ?? 0) > this.time.now) { this.say(ERRORS.on_cooldown, "#9fb8ff"); return; }
    if (this.hero.mp < skill.mp) { this.say(ERRORS.not_enough_mp, "#9fb8ff"); return; }
    if (this.mapInfo?.safe && !["buff", "heal", "blink"].includes(skill.kind)) { this.say(ERRORS.safe_zone, "#ffd77a"); return; }
    this.tryCast(skill);
  }

  private tryCast(skill: SkillDef): void {
    const needsTarget = ["melee", "projectile", "dash", "chain"].includes(skill.kind);
    const wantsTarget = needsTarget || ["aoe_target", "line"].includes(skill.kind);
    // a spin around the hero (aoe_self) with a chosen target walks into the pack first, like a melee blow
    const approach = wantsTarget || (skill.kind === "aoe_self" && !!this.target);
    let t = this.target;
    if (wantsTarget && !t) {
      const near = this.enemies().filter((e) => e.d <= Math.max(10, skill.range + 2)).sort((a, b) => a.d - b.d)[0];
      if (near) { this.setTarget({ kind: near.kind, id: near.id }); t = this.target; }
    }
    if (needsTarget && !t) { this.say(ERRORS.no_target, "#ffd77a"); return; }
    if (t && approach) {
      const u = this.unitOf(t.id);
      const d = u ? Math.hypot(u.worldX - this.player.worldX, u.worldY - this.player.worldY) : 0;
      if (u && d > castReach(skill, 0.6)) {
        this.pendingCast = { skill };
        this.walkTo(u.worldX, u.worldY);
        return;
      }
    }
    this.pendingCast = null;
    if (t && approach) this.moveTarget = null;   // in reach: stop here instead of walking into the monster
    // global cooldown (not for the basic attack): wait quietly and go off as soon as it ends
    if (!skill.basic && this.time.now < this.gcdUntil) {
      this.queuedCast = { skill, until: this.gcdUntil + 1500 };
      return;
    }
    if (!skill.basic) this.gcdUntil = this.time.now + GCD_MS;
    if (t && wantsTarget) {
      socket.sendSkill(skill.id, t.id);
    } else if (skill.kind === "blink" || skill.kind === "aoe_target" || skill.kind === "line") {
      const wp = this.cameras.main.getWorldPoint(this.input.activePointer.x, this.input.activePointer.y);
      const { wx, wy } = screenToWorld(wp.x, wp.y);
      socket.sendSkill(skill.id, t?.id ?? null, wx, wy);
    } else {
      socket.sendSkill(skill.id, null);
    }
  }

  // ── Network ──────────────────────────────────────────────────────────

  private setupNetwork(): void {
    socket.clearHandlers();
    socket.on("welcome", (m) => {
      this.hero = m.hero as HeroState;
      if (this.player) this.setTitleTag(this.player, this.hero.title);
      if (this.player) this.setAura(this.player, this.hero.cosmetics?.aura);
      if (this.player) this.setPet(this.charId, this.hero.cosmetics?.pet);
      if (this.player) this.setMount(this.charId, this.hero.cosmetics?.mount);
      if (this.player) this.setSkin(this.player, this.hero.cosmetics?.skin);
      this.events.emit("hero", this.hero);
      this.loadMap(m as unknown as MapInfo, m.x as number, m.y as number);
    });
    socket.on("map_change", (m) => this.loadMap(m as unknown as MapInfo, m.x as number, m.y as number));
    socket.on("portals", (m) => {
      if (!this.mapInfo) return;
      this.mapInfo.portals = (m as unknown as MapInfo).portals;
      for (const o of this.portalObjs) o.destroy();
      this.portalObjs = [];
      this.buildPortals(this.mapInfo);
      this.events.emit("portals_update", this.mapInfo);
    });
    socket.on("hero", (m) => {
      const prev = this.hero;
      this.hero = m as unknown as HeroState;
      if (prev?.title !== this.hero.title && this.player) this.setTitleTag(this.player, this.hero.title);
      if (this.player) this.setAura(this.player, this.hero.cosmetics?.aura);
      if (this.player) this.setPet(this.charId, this.hero.cosmetics?.pet);
      if (this.player) this.setMount(this.charId, this.hero.cosmetics?.mount);
      if (this.player) this.setSkin(this.player, this.hero.cosmetics?.skin);
      this.events.emit("hero", this.hero);
      if (prev?.story?.st !== this.hero.story?.st) this.updateQuestMarkers();
    });
    socket.on("stats", (m) => {
      if (!this.hero) return;
      Object.assign(this.hero, { hp: m.hp, mp: m.mp, max_hp: m.max_hp ?? this.hero.max_hp, max_mp: m.max_mp ?? this.hero.max_mp });
      this.events.emit("hero", this.hero);
    });
    socket.on("friends", (m) => this.events.emit("friends", m));
    socket.on("guild", (m) => {
      const st = m as unknown as GuildState;
      this.myGuild = st.guild?.name ?? "";
      this.guildEnemies = new Set(st.guild?.enemies ?? []);
      this.setGuildTag(this.player, this.myGuild);
      this.refreshRemoteColors();
      this.events.emit("guild", st);
    });
    socket.on("guild_tag", (m) => {
      const id = m.char_id as string, name = (m.guild as string) || "";
      if (id === this.charId) { this.setGuildTag(this.player, name); return; }
      const r = this.remotes.get(id);
      if (r) { r.guild = name; this.setGuildTag(r, name); r.label?.setColor(this.remoteColor(r)); }
    });
    // the Hidden Wanderer: the server only sends it when the hero is close
    socket.on("hidden_npc", (m) => {
      const old = this.npcs.get("hidden_wanderer");
      if (old) { old.root.destroy(); this.npcs.delete("hidden_wanderer"); }
      if (!m.gone) this.addHiddenNpc(m.id as string, m.name as string, m.x as number, m.y as number);
    });
    socket.on("hq_mark", (m) => this.hqMark(m.id as number, m.x as number, m.y as number, !!m.gone, !!m.found));
    socket.on("hq", (m) => this.events.emit("hq", m));
    socket.on("discovered", (m) => this.onDiscovered(m));
    socket.on("duel", (m) => { this.duelFoe = m.state === "start" ? (m.foe as string) : null; });
    for (const kind of ["tutorial", "login_cal", "achievements", "achievement", "ranking", "invasion", "tourney", "duel"]) {
      socket.on(kind, (m) => this.events.emit(kind, m));
    }
    socket.on("daynight", (m) => {
      this.isNight = !!m.night;
      if (this.world) this.darkness = this.world.theme.darkness + (this.isNight ? NIGHT_EXTRA : 0);
      this.events.emit("daynight", m);
    });
    // a town invasion makes the town a place to fight monsters for a while
    socket.on("map_safe", (m) => {
      if (!this.mapInfo) return;
      this.mapInfo.safe = !!m.safe;
      this.events.emit("map_safe", this.mapInfo);
    });
    // the weapon's element triggered on a hit: a burst in its colour on the monster
    socket.on("enchant_proc", (m) => {
      const u = this.mobs.get(m.target as string);
      if (!u) return;
      const color = ({ burn: "orange", slow: "ice", shock: "gold", poison: "green" } as Record<string, string>)[m.kind as string] ?? "white";
      this.fx.burst("sparks", color, u.root.x, u.root.y - u.height * 0.5, 14);
      this.fx.flash(u.root.x, u.root.y - u.height * 0.5, color, 0.9, 260, 0.6);
    });
    socket.on("world_map", (m) => this.events.emit("world_map", m));
    socket.on("daily", (m) => {
      this.daily = m as unknown as DailyState;
      this.updateQuestMarkers();
      this.events.emit("daily", this.daily);
    });
    socket.on("story", (m) => {
      if (!this.hero) return;
      this.hero.story = m.story as HeroState["story"];
      this.updateQuestMarkers();
      this.events.emit("hero", this.hero);
    });
    socket.on("story_end", (m) => this.events.emit("story_end", m));
    socket.on("dialog", (m) => this.events.emit("dialog", m));
    socket.on("notice", (m) => this.events.emit("notice", m));
    socket.on("arena_scores", (m) => this.events.emit("arena_scores", m.rows));

    socket.on("reward", (m) => this.events.emit("loot", m));
    socket.on("aura", (m) => {
      const u = m.char_id === this.charId ? this.player : this.remotes.get(m.char_id as string);
      if (u) this.setAura(u, m.aura as string);
    });
    socket.on("season", (m) => this.events.emit("season", m));
    socket.on("mount", (m) => { if (m.char_id !== this.charId) this.setMount(m.char_id as string, m.mount as string); });
    socket.on("pet", (m) => { if (m.char_id !== this.charId) this.setPet(m.char_id as string, m.pet as string); });
    socket.on("skin", (m) => {
      const u = m.char_id === this.charId ? this.player : this.remotes.get(m.char_id as string);
      if (u) this.setSkin(u, m.skin as string);
    });
    socket.on("title", (m) => {
      const u = m.char_id === this.charId ? this.player : this.remotes.get(m.char_id as string);
      if (u) this.setTitleTag(u, m.title as string);
    });
    socket.on("pk_status", (m) => {
      const st = m.status as PkStatus;
      const r = this.remotes.get(m.char_id as string);
      if (r) {
        r.pk = st;
        r.label?.setColor(this.remoteColor(r));
        if (this.target?.id === r.id) this.emitTarget();
      }
    });
    socket.on("kill_feed", (m) => this.events.emit("kill_feed", m.text as string));
    socket.on("veins", (m) => {
      this.clearVeins();
      for (const v of m.veins as Omit<VeinObj, "img" | "label">[]) this.addVein(v);
    });
    socket.on("vein", (m) => {
      const v = this.veins.get(m.id as string);
      if (!v) return;
      v.ready = !!m.ready;
      v.img.setTexture(v.ready ? `vein_${v.kind}` : "vein_empty");
      v.label.setText(v.ready ? VEIN_INFO[v.kind].name : `${VEIN_INFO[v.kind].name} (esgotado)`).setAlpha(v.ready ? 0.85 : 0.45);
    });
    socket.on("mining", (m) => this.onMining(m.char_id as string, m.vein as string, m.dur as number));
    socket.on("mining_end", (m) => this.onMiningEnd(m.char_id as string, !!m.ok));
    socket.on("party", (m) => {
      this.party = (m.members as PartyMember[]) ?? [];
      for (const r of this.remotes.values()) r.label?.setColor(this.remoteColor(r));
      if (this.target?.kind === "hero" && this.inParty(this.target.id)) this.setTarget(null);
      this.events.emit("party", this.party);
    });
    socket.on("chat", (m) => {
      this.events.emit("chat", m);
      if (m.channel === "map") this.speechBubble(m.from_id as string, m.text as string);
    });
    socket.on("inventory", (m) => {
      this.inventory = m as unknown as InventoryState;
      this.events.emit("inventory", this.inventory);
      // gold changes with trades, shops and the forge: keep the player panel's gold in step
      if (this.hero && this.hero.gold !== this.inventory.gold) {
        this.hero.gold = this.inventory.gold;
        this.events.emit("hero", this.hero);
      }
    });
    socket.on("shop", (m) => this.events.emit("shop", m));
    socket.on("forge", (m) => this.events.emit("forge", m));
    socket.on("market", (m) => this.events.emit("market", m));
    socket.on("forge_result", (m) => this.events.emit("forge_result", m));
    socket.on("potion", (m) => {
      const u = m.char_id === this.charId ? this.player : this.remotes.get(m.char_id as string);
      if (!u) return;
      const hp = m.kind === "hp";
      this.fx.ring(u.root.x, u.root.y, hp ? "green" : "cyan", 0.2, 0.9, 500);
      this.floatText(u.root.x, u.root.y - u.height - 10, `+${m.amount as number}`, hp ? "#7dff7a" : "#7ac8ff", 15, 0);
    });

    // the server sends this right before welcome/map_change, whose loadMap clears the remotes:
    // keep it so loadMap can bring back the players who were already there
    socket.on("nearby_snapshot", (m) => {
      this.lastSnapshot = m.players as ServerMessage[];
      if (this.mapInfo) for (const p of this.lastSnapshot) this.addRemote(p);
    });
    socket.on("player_spawn", (m) => { if (m.map === this.mapInfo?.map_id) this.addRemote(m); });
    socket.on("player_despawn", (m) => {
      const r = this.remotes.get(m.char_id as string);
      if (r) { r.root.destroy(); this.remotes.delete(m.char_id as string); }
      if (this.target?.id === m.char_id) this.setTarget(null);
    });
    // other players' positions, in short form: [id, x, y] (only the players close enough to be seen)
    socket.on("mv", (m) => {
      for (const [id, x, y] of m.m as [string, number, number][]) {
        if (id === this.charId) continue;
        const r = this.remotes.get(id);
        if (r) { r.targetX = x; r.targetY = y; }
      }
    });

    socket.on("mob_spawn", (m) => this.addMob(m, this.mobs.has(m.id as string) && !!this.mapInfo));
    socket.on("mob_move", (m) => {
      const mob = this.mobs.get(m.id as string);
      if (mob && !mob.dead) { mob.targetX = m.x as number; mob.targetY = m.y as number; }
    });
    // monster moves only reach players in range: walking closer brings the current place and life of the ones around
    socket.on("mob_sync", (m) => {
      for (const [id, x, y, hp] of m.mobs as [string, number, number, number][]) {
        const mob = this.mobs.get(id);
        if (!mob || mob.dead) continue;
        mob.targetX = x; mob.targetY = y;
        // far away (it moved a lot while out of sight): appear there instead of sliding across the map
        if (Math.hypot(mob.worldX - x, mob.worldY - y) > 6) { mob.worldX = x; mob.worldY = y; this.placeUnit(mob); }
        if (mob.hp !== hp) { mob.hp = hp; this.drawHp(mob, mob.boss ? 0x9a48ec : 0xc0303a, mob.boss ? 60 : 34); }
      }
    });
    socket.on("mob_damaged", (m) => this.onMobDamaged(m));
    socket.on("cc", (m) => this.onCC(m));
    socket.on("skill_used", (m) => this.onSkillUsed(m));
    socket.on("damage", (m) => this.onDamage(m));
    socket.on("level_up", (m) => this.onLevelUp(m));
    socket.on("skill_error", (m) => {
      const err = m.error as string;
      if (err === "gcd") {
        // a short pause before the skill is tried again (it never went off, so it keeps no long cooldown)
        const retry = this.time.now + 300;
        this.cdUntil.set(m.skill_id as string, retry);
        this.gcdUntil = Math.max(this.gcdUntil, retry);
        const def = skillById(m.skill_id as string);   // a key pressed by hand is not lost
        if (def && !this.queuedCast) this.queuedCast = { skill: def, until: retry + 1500 };
        return;
      }
      if (err === "too_far") {
        // the target moved away: walk after it; if it already died, there is nothing to say
        const def = skillById(m.skill_id as string);
        if (!this.target) return;
        if (def) { this.pendingCast = { skill: def }; const u = this.unitOf(this.target.id); if (u) this.walkTo(u.worldX, u.worldY); return; }
      }
      this.say(ERRORS[err] ?? "Não foi possível", "#9fb8ff");
    });
    socket.on("boss_warn", (m) => this.onBossWarn(m));
    socket.on("mob_hp", (m) => {
      const mob = this.mobs.get(m.id as string);
      if (!mob) return;
      mob.hp = m.hp as number;
      mob.maxHp = m.max_hp as number;
      this.drawHp(mob, 0x9b30ff, 60);
      if (this.target?.id === mob.id) this.emitTarget();
    });
    socket.on("wb_cast", (m) => this.onWorldBossCast(m));
    socket.on("wb_impact", (m) => this.onWorldBossImpact(m));
    socket.on("wb_scores", (m) => this.events.emit("wb_scores", m));
    socket.on("wb_status", (m) => this.events.emit("wb_status", m));
    socket.on("wb_result", (m) => this.events.emit("wb_result", m));
    socket.on("boss_slam", (m) => {
      const { sx, sy } = worldToScreen(m.x as number, m.y as number);
      const theme = this.mapInfo?.theme;
      const fx = theme === "frost" ? "ice/frost-nova" : theme === "ash" ? "fire/fire-ring" : "shadow/dark-explosion";
      this.pfx.play(fx, sx, sy, { once: true, scale: 1.1, glow: 260, depth: sy + 4 });
      this.fx.shake(0.014, 300);
      this.punch(0.06);
    });
    socket.on("player_respawn", (m) => this.onRespawn(m));
    socket.on("hero_respawn", (m) => {
      const r = this.remotes.get(m.char_id as string);
      if (!r) return;
      r.dead = false;
      r.worldX = r.targetX = m.x as number;
      r.worldY = r.targetY = m.y as number;
      this.tweens.killTweensOf([r.body, r.flash, r.root]);
      r.body.setRotation(0).setY(0);
      r.flash.setRotation(0);
      r.root.setAlpha(1);
      r.label?.setVisible(true);
      r.hp = r.maxHp;
      if (r.hpBar) { r.hpBar.setVisible(true); this.drawHp(r, 0xd04040); }
      this.placeUnit(r);
    });
  }

  private onMobDamaged(m: ServerMessage): void {
    const mob = this.mobs.get(m.mob_id as string);
    if (!mob || mob.dead) return;
    mob.hp = m.hp_remaining as number;
    this.drawHp(mob, mob.boss ? 0x9a48ec : 0xc0303a, mob.boss ? 60 : 34);
    const dot = m.dot as string | undefined;
    if (!dot) {
      this.hitFlash(mob);
      this.fx.burst("blood", "red", mob.root.x, mob.root.y - mob.height * 0.45, 4);
      if (this.pfx.count("impacts/hit-spark") < 3) {
        this.pfx.play("impacts/hit-spark", mob.root.x, mob.root.y - mob.height * 0.35, { scale: 0.55, flip: Math.random() < 0.5, depth: FX_DEPTH, fps: 20 });
      }
    }
    this.damageNumber(mob.root.x, mob.root.y - mob.height, m.damage as number, false, !!m.crit, dot);
    if (this.target?.id === mob.id) this.emitTarget();
    if (mob.boss && m.killed) { this.bossShown = null; this.events.emit("boss_update", null); }
    if (m.killed) {
      if (this.target?.id === mob.id) this.setTarget(null);
      const { x, y } = mob.root;
      this.killUnit(mob, () => { mob.root.destroy(); if (this.mobs.get(mob.id) === mob) this.mobs.delete(mob.id); });
      this.fx.burst("blood", "red", x, y - mob.height * 0.4, 12);
      this.time.delayedCall(350, () => this.pfx.play("spawn/soul-rise", x, y, { scale: mob.boss ? 1 : 0.6, glow: 90, depth: FX_DEPTH }));
      if (mob.boss) this.fx.shake(0.012, 500);
    }
  }

  private onCC(m: ServerMessage): void {
    const u = this.unitOf(m.target as string);
    if (!u) return;
    if (m.target === this.charId && m.kind !== "slow") this.stunnedUntil = this.time.now + (m.dur as number) * 600;
    const fxName = STATUS_FX[m.kind as string];
    if (!fxName) return;
    const key = `${m.target}:${m.kind}`;
    this.statuses.get(key)?.stop();
    const above = m.kind === "stun";
    this.statuses.set(key, this.pfx.play(fxName, 0, 0, {
      follow: u.root, dy: above ? -u.height + 6 : 0, scale: above ? 0.6 : 0.7, life: m.dur as number, depth: FX_DEPTH,
    }));
  }

  /**
   * Gets every skill effect ready a little at a time after entering the map (one every WARM_EVERY ms): the first
   * use of an effect used to build it on the spot, a hitch of up to a few hundred ms in the middle of a fight.
   */
  private warmEffects(): void {
    const todo = new Map<string, string[] | undefined>();
    const add = (name?: string, pal?: string) => { if (name && hasFx(name)) todo.set(`${name}|${pal ?? ""}`, isLoopFx(name) ? palette(pal) : undefined); };
    for (const s of META.skills) {
      const v = s.vfx;
      if (!v) continue;
      for (const n of [v.cast, v.after, v.buff, v.proj, v.hit]) add(n, v.pal);
      for (const n of [v.impact, v.status, v.area, v.area2]) add(n);
    }
    for (const n of [...Object.values(STATUS_FX), "impacts/hit-spark", "spawn/soul-rise"]) add(n);
    const queue = [...todo.entries()];
    const timer = this.time.addEvent({
      delay: WARM_EVERY, loop: true, callback: () => {
        if (isResting()) return;
        const next = queue.shift();
        if (!next) { timer.remove(); return; }
        const name = next[0].split("|")[0];
        if (isLoopFx(name)) this.pfx.bake(name, next[1]);
        else this.pfx.warm([name], 2);
      },
    });
  }

  private onSkillUsed(m: ServerMessage): void {
    const own = m.char_id === this.charId;
    const caster = own ? this.player : this.remotes.get(m.char_id as string);
    const def = skillById(m.skill_id as string);
    if (!caster || !def) return;
    if (own) {
      this.cdUntil.set(def.id, this.time.now + def.cd);
      if (!def.basic) this.gcdUntil = Math.max(this.gcdUntil, this.time.now + GCD_MS); // the server's started a bit earlier
      this.events.emit("skill_cast", def.id);
    }
    const blink = m.blink as { x: number; y: number } | undefined;
    const dash = m.dash as { x: number; y: number } | undefined;
    const from = { x: caster.root.x, y: caster.root.y };
    const dest = blink ?? dash;
    if (dest) {
      if (own) { this.moveTarget = null; this.pendingCast = null; }
      caster.worldX = caster.targetX = dest.x;
      caster.worldY = caster.targetY = dest.y;
      this.placeUnit(caster);
    }
    this.playSkillVfx(def, caster, m, from, !!dash);
  }

  private playSkillVfx(def: SkillDef, caster: Unit, m: ServerMessage, from: { x: number; y: number }, dashed: boolean): void {
    if (isResting()) return; // this screen is resting: skip the show (other players' screens still draw it)
    const v = def.vfx ?? {};
    const pal = palette(v.pal);
    const target = this.unitOf(m.target as string);
    const t = worldToScreen(m.tx as number, m.ty as number);
    const tx = target ? target.root.x : t.sx, ty = target ? target.root.y : t.sy;
    const tmid = target ? ty - target.height * 0.5 : ty - 20;
    const cx = caster.root.x, cy = caster.root.y, mid = cy - caster.height * 0.5;
    if (target || def.kind === "aoe_target" || def.kind === "line") this.face(caster, tx - cx, ty - cy);
    const magic = ["projectile", "aoe_target", "chain", "line", "buff", "blink", "heal"].includes(def.kind) && def.cls !== "blade_master";
    this.playAction(caster, magic ? "cast" : "attack", magic ? "attack" : "cast");
    const flip = caster.body.flipX;
    const repeat = v.repeat ?? 1;

    if (def.kind === "melee" || def.kind === "dash") {
      this.tweens.add({ targets: [caster.body, caster.flash], x: { from: 0, to: flip ? -8 : 8 }, duration: 70, yoyo: true });
    } else if (def.kind === "aoe_self" && caster.scale) {
      if (!caster.sheet) {
        this.tweens.add({ targets: [caster.body, caster.flash], scaleX: { from: caster.scale, to: -caster.scale }, duration: 100, yoyo: true, repeat: 1 });
      }
    } else if (["projectile", "aoe_target", "chain", "line"].includes(def.kind)) {
      this.fx.flash(cx + (flip ? -14 : 14), mid - 6, def.cls === "grand_sorcerer" ? "cyan" : "gold", 1, 220, 0.5);
    }
    if (dashed) {
      for (let i = 1; i <= 5; i++) {
        const k = i / 6;
        const ghost = this.add.image(from.x + (cx - from.x) * k, from.y + (cy - from.y) * k, caster.body.texture.key, caster.body.frame.name)
          .setOrigin(caster.body.originX, caster.body.originY).setScale(caster.scale).setFlipX(flip).setAlpha(0).setDepth(cy);
        this.tweens.add({ targets: ghost, alpha: { from: 0.45, to: 0 }, delay: i * 25, duration: 320, onComplete: () => ghost.destroy() });
      }
    }
    if (v.cast) this.pfx.play(v.cast, from.x, from.y, { once: true, scale: v.cs ?? 0.8, palette: pal });
    if (v.after) this.time.delayedCall(120, () => this.pfx.play(v.after!, caster.root.x, caster.root.y, { once: true, scale: v.cs ?? 0.8, palette: pal }));
    if (v.buff) this.pfx.play(v.buff, 0, 0, { follow: caster.root, palette: pal, scale: v.bs ?? 0.85, life: Math.min(8, def.buff?.dur ?? 3), glow: 100 });

    if (v.proj) {
      for (let r = 0; r < repeat; r++) {
        this.time.delayedCall(r * 140, () => {
          const sx = cx + (tx > cx ? 10 : -10), sy = mid - 6;
          const ex = def.kind === "line" ? t.sx : tx, ey = def.kind === "line" ? t.sy - 20 : tmid;
          const h = this.pfx.play(v.proj!, sx, sy, { scale: v.ps ?? 0.6, palette: pal, depth: FX_DEPTH, glow: 70, important: true });
          h.setRotation(Math.atan2(ey - sy, ex - sx));
          const pos = { x: sx, y: sy };
          this.tweens.add({
            targets: pos, x: ex, y: ey, duration: Math.max(140, Math.hypot(ex - sx, ey - sy) * 0.55),
            onUpdate: () => h.setPosition(pos.x, pos.y),
            onComplete: () => {
              h.stop();
              if (v.hit && def.kind !== "line") this.pfx.play(v.hit, tx, tmid + 10, { once: true, scale: v.hs ?? 0.6, palette: pal, depth: FX_DEPTH, flip: tx < cx, important: true });
              if (v.impact && def.kind !== "line") this.pfx.play(v.impact, tx, tmid + 6, { once: true, scale: v.is ?? 0.6, depth: FX_DEPTH + 1, glow: 90 });
              if (v.status && target) this.pfx.play(v.status, 0, 0, { follow: target.root, scale: 0.7, life: def.dot ? def.dot.ticks * def.dot.every : 3, depth: FX_DEPTH });
              if (v.shake) this.fx.shake(v.shake, 160);
            },
          });
        });
      }
    } else if (v.hit && target && def.kind !== "chain") {
      this.time.delayedCall(dashed ? 110 : 40, () => {
        this.pfx.play(v.hit!, target.root.x, tmid + 14, { once: true, scale: v.hs ?? 0.7, flip: target.root.x < caster.root.x, depth: FX_DEPTH, palette: pal, important: true });
        if (v.impact) this.pfx.play(v.impact, target.root.x, tmid + 8, { once: true, scale: v.is ?? 0.6, depth: FX_DEPTH + 1, glow: 90 });
        if (v.shake) { this.fx.shake(v.shake, 160); if (caster === this.player) this.punch(0.08); }
      });
      if (v.status) this.pfx.play(v.status, 0, 0, { follow: target.root, scale: 0.7, life: def.dot ? def.dot.ticks * def.dot.every : 3, depth: FX_DEPTH });
    }

    if (v.area) {
      const ax = def.kind === "aoe_self" || def.kind === "blink" ? from.x : tx;
      const ay = def.kind === "aoe_self" || def.kind === "blink" ? from.y : ty;
      for (let r = 0; r < repeat; r++) {
        this.time.delayedCall((v.delay ?? 0) * 1000 * (r === 0 ? 0 : 1) + r * 260, () => {
          this.pfx.play(v.area!, ax, ay, { scale: v.as ?? 1, palette: pal, glow: 200, depth: Math.max(ay, cy) + 3, life: 3, speed: 1.2 });
          if (v.area2 && r === 0) this.pfx.play(v.area2, ax, ay, { scale: v.as2 ?? 1, glow: 120, depth: Math.max(ay, cy) + 2, life: 2.5, speed: 1.2 });
        });
      }
      if (v.shake) this.time.delayedCall((v.delay ?? 0) * 1000, () => this.fx.shake(v.shake!, 220));
      if (caster === this.player) this.time.delayedCall((v.delay ?? 0) * 1000, () => this.punch(v.shake ? 0.1 : 0.05));
    }

    this.playImpactVfx(def, caster, m, from, tx, ty);

    if (def.kind === "chain") {
      const ids = (m.chain as string[]) ?? [];
      let px = cx, py = mid;
      ids.forEach((id, i) => {
        const u = this.unitOf(id);
        if (!u) return;
        const qx = u.root.x, qy = u.root.y - u.height * 0.5;
        const ax = px, ay = py;
        this.time.delayedCall(i * 90, () => {
          this.lightning(ax, ay, qx, qy, v.beam ?? "#9fd8ff");
          if (v.hit) this.pfx.play(v.hit, qx, qy + 12, { once: true, scale: v.hs ?? 0.7, depth: FX_DEPTH });
        });
        px = qx; py = qy;
      });
    }
  }

  /** Extra punch for every attack: a shockwave the size of the area, light, sparks on each enemy hit,
   *  a streak for line skills and a small ring for the splash around single-target hits. */
  private playImpactVfx(def: SkillDef, caster: Unit, m: ServerMessage, from: { x: number; y: number }, tx: number, ty: number): void {
    if (isResting()) return;
    const color = def.vfx?.ring ?? (def.cls === "grand_sorcerer" ? "cyan" : def.cls === "night_ranger" ? "green" : "orange");
    const own = caster === this.player;
    const delay = (def.vfx?.delay ?? 0) * 1000;
    const ringScale = (r: number) => r * 0.83; // ring textures are 54 px in radius; one tile ≈ 45 px across on screen
    const areaAt = def.kind === "aoe_self" || def.kind === "blink" ? from : def.kind === "aoe_target" ? { x: tx, y: ty } : null;
    if (areaAt && def.radius) {
      this.time.delayedCall(delay, () => {
        this.fx.ring(areaAt.x, areaAt.y, color, 0.15, ringScale(def.radius), 460);
        this.time.delayedCall(90, () => this.fx.ring(areaAt.x, areaAt.y, "white", 0.1, ringScale(def.radius) * 0.75, 380));
        this.fx.flash(areaAt.x, areaAt.y - 12, color, Math.min(3.2, 0.6 + def.radius * 0.35), 340, 0.75);
        this.fx.burst("embers", color, areaAt.x, areaAt.y - 6, Math.min(40, 10 + Math.round(def.radius * 4)));
        if (own && !def.vfx?.shake) this.fx.shake(0.0035, 140);
      });
    }
    if (def.kind === "line") {
      const end = worldToScreen(m.tx as number, m.ty as number);
      const width = Math.max(10, (def.width ?? 1.2) * 30);
      const g = this.add.graphics().setDepth(FX_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
      const c = GLOW_COLORS[color] ?? 0xffffff;
      g.lineStyle(width, c, 0.18).lineBetween(from.x, from.y - 14, end.sx, end.sy - 14);
      g.lineStyle(width * 0.35, c, 0.55).lineBetween(from.x, from.y - 14, end.sx, end.sy - 14);
      g.lineStyle(2, 0xffffff, 0.9).lineBetween(from.x, from.y - 14, end.sx, end.sy - 14);
      this.tweens.add({ targets: g, alpha: 0, duration: 320, ease: "Quad.easeIn", onComplete: () => g.destroy() });
    }
    const splash = new Set((m.splash as string[] | undefined) ?? []);
    if (splash.size && def.splash) {
      const t = this.unitOf(m.target as string);
      if (t) this.time.delayedCall(60, () => this.fx.ring(t.root.x, t.root.y, color, 0.1, ringScale(def.splash!), 300));
    }
    // a spark on every enemy struck (the main target already has the skill's own hit effect)
    const hits = ((m.hits as string[] | undefined) ?? []).filter((id) => id !== m.target);
    hits.slice(0, 24).forEach((id, i) => {
      const u = this.unitOf(id);
      if (!u) return;
      this.time.delayedCall(delay + 60 + i * 25, () => {
        if (u.dead && !u.root.active) return;
        const y = u.root.y - u.height * 0.5;
        this.pfx.play("impacts/hit-spark", u.root.x, y + 8, { scale: splash.has(id) ? 0.45 : 0.6, depth: FX_DEPTH });
        this.fx.burst("sparks", color, u.root.x, y, splash.has(id) ? 3 : 6);
      });
    });
  }

  private lightning(ax: number, ay: number, bx: number, by: number, color: string): void {
    const g = this.add.graphics().setDepth(FX_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
    const c = Phaser.Display.Color.HexStringToColor(color).color;
    for (const [w, a] of [[5, 0.25], [2, 1]] as [number, number][]) {
      g.lineStyle(w, c, a);
      g.beginPath();
      g.moveTo(ax, ay);
      const n = 6;
      for (let i = 1; i < n; i++) {
        const k = i / n;
        g.lineTo(ax + (bx - ax) * k + Phaser.Math.Between(-7, 7), ay + (by - ay) * k + Phaser.Math.Between(-7, 7));
      }
      g.lineTo(bx, by);
      g.strokePath();
    }
    this.fx.onFlash?.(bx, by, 90, 200);
    this.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  private onDamage(m: ServerMessage): void {
    const id = m.target_id as string;
    const own = id === this.charId;
    const u = own ? this.player : this.remotes.get(id);
    if (!u) return;
    if (m.dodge) {
      this.floatText(u.root.x, u.root.y - u.height - 10, "Esquiva!", "#d8ffcf", 12, 0);
      return;
    }
    const dot = m.dot as string | undefined;
    if (!dot) {
      this.hitFlash(u);
      this.fx.burst("blood", "red", u.root.x, u.root.y - 40, 5);
      const src = this.mobs.get(m.source as string);
      if (src && !src.dead) {
        const dir = Math.sign(u.root.x - src.root.x) || 1;
        this.face(src, u.root.x - src.root.x, u.root.y - src.root.y);
        this.playAction(src, "attack");
        this.tweens.add({ targets: [src.body, src.flash], x: { from: 0, to: dir * 10 }, duration: 80, yoyo: true, ease: "Quad.easeOut" });
        if (this.pfx.count("melee/claw-swipe") < 2) {
          this.pfx.play("melee/claw-swipe", u.root.x, u.root.y - 18, { scale: 0.55, flip: src.root.x > u.root.x, depth: FX_DEPTH, fps: 20 });
        }
      }
    }
    this.damageNumber(u.root.x, u.root.y - u.height, m.damage as number, own, !!m.crit, dot);
    if (own) {
      this.hero.hp = m.hp_remaining as number;
      this.hero.mp = m.mp_remaining as number;
      this.events.emit("hero", this.hero);
      if (!dot) { this.fx.shake(0.003, 100); this.events.emit("player_hurt"); }
      if (m.killed) this.onPlayerDeath((m.respawn_in as number) ?? 5, m.killer_name as string | undefined);
    } else {
      u.hp = m.hp_remaining as number;
      u.maxHp = (m.max_hp as number) ?? u.maxHp;
      this.drawHp(u, 0xd04040);
      if (this.target?.id === id) this.emitTarget();
      if (m.killed) {
        const r = u as RemoteHero;
        if (this.target?.id === id) this.setTarget(null);
        this.killUnit(r);
        if (m.killer_name) this.events.emit("kill_feed", `${m.killer_name} derrotou ${r.name}`);
      }
    }
  }

  private onLevelUp(m: ServerMessage): void {
    const u = this.unitOf(m.char_id as string);
    if (!u) return;
    this.pfx.play("holy/holy-pillar", u.root.x, u.root.y, { scale: 0.9, glow: 240, depth: u.root.y + 3 });
    this.fx.burst("wisps", "gold", u.root.x, u.root.y - 30, 30);
    if (m.char_id === this.charId) {
      this.floatText(u.root.x, u.root.y - u.height - 26, `NÍVEL ${m.level}!`, "#ffd77a", 20, 0);
      this.punch(0.12);
      this.events.emit("level_up", m);
    } else {
      const r = this.remotes.get(m.char_id as string);
      if (r) { r.level = m.level as number; r.label?.setText(`${r.name} · Nv ${r.level}`); }
    }
  }

  /** World boss skill telegraph: circles on the ground (red and pulsing for the deadly one). */
  private onWorldBossCast(m: ServerMessage): void {
    const warn = (m.warn as number) * 1000;
    const deadly = !!m.deadly;
    const boss = this.mobs.get(m.mob_id as string);
    if (boss) {
      this.playAction(boss, "cast", "attack");
      this.floatText(boss.root.x, boss.root.y - boss.height - 30, m.name as string, deadly ? "#ff3030" : "#ffb347", deadly ? 18 : 14, 0);
    }
    if (m.kind === "all") {
      this.events.emit("notice", { text: `${m.name as string}! Ninguém escapa — prepare uma poção (Q).`, kind: "warn" });
      return;
    }
    let inside = false;
    this.dangers = this.dangers.filter((d) => d.until > this.time.now);
    for (const [cx, cy, r] of m.circles as [number, number, number][]) {
      this.dangers.push({ x: cx, y: cy, r, until: this.time.now + warn + 350 });
      const { sx, sy } = worldToScreen(cx, cy);
      const k = (r * 64) / 256;
      const img = this.add.image(sx, sy, "warn_circle").setDepth(DECAL_DEPTH + 30).setAlpha(0.25).setScale(k)
        .setTint(deadly ? 0xff1a1a : 0xffa040);
      this.tweens.add({ targets: img, alpha: 1, duration: warn, ease: "Quad.easeIn", onComplete: () => img.destroy() });
      if (deadly) {
        this.tweens.add({ targets: img, scale: { from: k * 1.08, to: k }, duration: 260, yoyo: true, repeat: Math.floor(warn / 520) });
        const label = this.add.text(sx, sy, "☠ SAIA DA ÁREA!", {
          fontFamily: FONT, fontSize: "16px", color: "#ff4040", fontStyle: "bold", stroke: "#000", strokeThickness: 4,
        }).setOrigin(0.5).setDepth(FX_DEPTH + 5);
        this.tweens.add({ targets: label, alpha: { from: 1, to: 0.35 }, duration: 300, yoyo: true, repeat: Math.floor(warn / 600),
          onComplete: () => label.destroy() });
      }
      if (Math.hypot(this.player.worldX - cx, this.player.worldY - cy) <= r) inside = true;
    }
    if (deadly) {
      this.events.emit("notice", { text: `☠ ${m.name as string}! Saia da área vermelha — quem ficar pode morrer na hora.`, kind: "warn" });
      if (inside) this.say("SAIA DA ÁREA!", "#ff3030");
    }
  }

  private onWorldBossImpact(m: ServerMessage): void {
    const fx = WB_FX[m.skill as string] ?? "impacts/ground-slam";
    const circles = m.circles as [number, number, number][];
    if (m.kind === "all") {
      const boss = this.mobs.get(m.mob_id as string);
      if (boss) this.pfx.play(fx, boss.root.x, boss.root.y, { once: true, scale: 2.2, glow: 300, depth: boss.root.y + 4 });
      this.events.emit("player_hurt");
    }
    for (const [cx, cy, r] of circles) {
      const { sx, sy } = worldToScreen(cx, cy);
      this.pfx.play(fx, sx, sy, { once: true, scale: Math.max(0.8, r / 2.4), glow: 260, depth: sy + 4 });
      if (m.deadly) this.pfx.play("shadow/dark-explosion", sx, sy, { once: true, scale: r / 2.6, glow: 320, depth: sy + 5 });
    }
    this.fx.shake(m.deadly ? 0.02 : 0.01, m.deadly ? 450 : 250);
    this.punch(m.deadly ? 0.08 : 0.04);
  }

  private onBossWarn(m: ServerMessage): void {
    const { sx, sy } = worldToScreen(m.x as number, m.y as number);
    const r = m.radius as number;
    this.dangers.push({ x: m.x as number, y: m.y as number, r, until: this.time.now + (m.delay as number) * 1000 + 300 });
    const img = this.add.image(sx, sy, "warn_circle").setDepth(DECAL_DEPTH + 30).setAlpha(0.2)
      .setScale((r * 64) / 256 * 1.0, (r * 64) / 256 * 1.0);
    this.tweens.add({ targets: img, alpha: 1, duration: (m.delay as number) * 1000, ease: "Quad.easeIn", onComplete: () => img.destroy() });
    const boss = this.mobs.get(m.mob_id as string);
    if (boss) this.tweens.add({ targets: [boss.body, boss.flash], y: { from: 0, to: -14 }, duration: (m.delay as number) * 900, yoyo: true, ease: "Quad.easeOut" });
  }

  private onPlayerDeath(respawnIn: number, killer?: string): void {
    this.isDead = true;
    this.moveTarget = null;
    this.pendingCast = null;
    this.setTarget(null);
    const p = this.player;
    p.moving = false;
    if (p.sheet && SHEETS[p.sheet].anims.death) p.body.play(animKey(p.sheet, "death", p.dir));
    else this.tweens.add({ targets: [p.body, p.flash], rotation: p.body.flipX ? -1.4 : 1.4, duration: 500, ease: "Bounce.easeOut" });
    this.tweens.add({ targets: p.body, alpha: 0.5, duration: 800 });
    this.fx.burst("blood", "red", p.root.x, p.root.y - 30, 22);
    this.fx.shake(0.008, 300);
    this.events.emit("player_dead", respawnIn, killer);
  }

  private onRespawn(m: ServerMessage): void {
    this.isDead = false;
    const p = this.player;
    p.worldX = m.x as number;
    p.worldY = m.y as number;
    this.moveTarget = null;
    this.placeUnit(p);
    this.tweens.killTweensOf([p.body, p.flash]);
    p.body.setRotation(0).setAlpha(1);
    p.anim = "";
    p.flash.setRotation(0);
    p.root.setAlpha(1);
    this.cameras.main.centerOn(p.root.x, p.root.y);
    this.pfx.play("spawn/respawn-beam", p.root.x, p.root.y, { scale: 0.85, glow: 220, depth: p.root.y + 3 });
    this.hero.hp = m.hp as number;
    this.hero.mp = m.mp as number;
    this.events.emit("hero", this.hero);
    this.events.emit("player_respawned");
  }

  // ── Frame update ─────────────────────────────────────────────────────

  getMinimapData(): MinimapData | null {
    if (!this.mapInfo) return null;
    return {
      px: this.player.worldX, py: this.player.worldY,
      mobs: [...this.mobs.values()].filter((m) => !m.dead).map((m) => ({ x: m.worldX, y: m.worldY, boss: m.boss })),
      players: [...this.remotes.values()].map((r) => ({ x: r.worldX, y: r.worldY, party: this.inParty(r.id) })),
      npcs: [...this.npcs.values()].map((n) => ({ x: n.worldX, y: n.worldY })),
      places: (META.discovery?.places[this.mapInfo.map_id] ?? []).filter((p) => this.hero?.found?.includes(p.id))
        .map((p) => ({ x: p.x, y: p.y, landmark: p.landmark })),
      target: this.target?.id ?? null,
    };
  }

  update(time: number, delta: number): void {
    if (!this.mapInfo || !this.world) return;
    // real elapsed time (Phaser smooths delta), so slow frames don't turn the game into slow motion
    const now = performance.now();
    const dt = Math.min(this.lastReal ? (now - this.lastReal) / 1000 : delta / 1000, 0.25);
    this.lastReal = now;
    const p = this.player;
    const rest = isResting();

    if (this.pendingCast && this.target) {
      const u = this.unitOf(this.target.id);
      if (!u || u.dead) this.pendingCast = null;
      else if (Math.hypot(u.worldX - p.worldX, u.worldY - p.worldY) <= castReach(this.pendingCast.skill, 0.3)) {
        this.moveTarget = null;
        this.sendPos(true);
        this.tryCast(this.pendingCast.skill);
      } else {
        this.moveTarget = { x: u.worldX, y: u.worldY };
      }
    }
    if (this.queuedCast && this.time.now >= this.gcdUntil) {
      const q = this.queuedCast;
      this.queuedCast = null;
      if (this.time.now < q.until && !this.isDead && (this.cdUntil.get(q.skill.id) ?? 0) <= this.time.now) this.tryCast(q.skill);
    }
    if (this.pendingMine) {
      const v = this.veins.get(this.pendingMine);
      if (!v) this.pendingMine = null;
      else if (Math.hypot(v.x - p.worldX, v.y - p.worldY) < 2.0) {
        this.face(p, v.img.x - p.root.x, v.img.y - p.root.y);
        this.pendingMine = null;
        this.moveTarget = null;
        this.sendPos(true);
        socket.send({ type: "mine", vein: v.id });
      }
    }
    this.drawMineBar(time);
    if (this.pendingTalk) {
      const n = this.npcs.get(this.pendingTalk);
      if (n && Math.hypot(n.worldX - p.worldX, n.worldY - p.worldY) < 2.6) {
        socket.talk(n.id);
        this.face(p, n.root.x - p.root.x, n.root.y - p.root.y);
        this.pendingTalk = null;
        this.moveTarget = null;
        this.sendPos(true);
      }
    }

    if (this.joy.active && !this.isDead) {
      // the joystick points on the screen; the world is drawn at an angle, so turn it into world directions
      const wx = this.joy.x / 32 + this.joy.y / 16, wy = this.joy.y / 16 - this.joy.x / 32;
      const len = Math.hypot(wx, wy) || 1;
      this.takeControl();
      this.pendingCast = null;
      this.pendingTalk = null;
      this.pendingMine = null;
      const n = (this.mapInfo?.size ?? 40) - 1.5;
      this.moveTarget = { x: Phaser.Math.Clamp(p.worldX + (wx / len) * 0.7, 0.5, n), y: Phaser.Math.Clamp(p.worldY + (wy / len) * 0.7, 0.5, n) };
    }
    this.pinchZoom();
    if (this.auto) this.thinkAuto(time);
    if (this.moveTarget && !this.isDead && time > this.stunnedUntil) {
      const dx = this.moveTarget.x - p.worldX, dy = this.moveTarget.y - p.worldY;
      const dist = Math.hypot(dx, dy);
      const speed = MOVE_SPEED * (1 + (this.hero?.speed ?? 0));
      if (dist < 0.05) {
        p.worldX = this.moveTarget.x;
        p.worldY = this.moveTarget.y;
        this.moveTarget = null;
        p.moving = false;
        this.sendPos(true);
      } else {
        const r = Math.min((speed * dt) / dist, 1);
        p.worldX += dx * r;
        p.worldY += dy * r;
        p.moving = true;
        this.face(p, (dx - dy) * 32, (dx + dy) * 16);
        if (!rest && Math.random() < dt * 6) this.fx.burst("dust", "white", p.root.x, p.root.y, 1);
        this.sendPos(false);
      }
      this.placeUnit(p);
    } else {
      p.moving = false;
    }

    for (const r of this.remotes.values()) if (!r.dead) this.stepToward(r, dt, MOVE_SPEED * 1.2);
    this.updatePets(time, dt);
    for (const mob of this.mobs.values()) {
      if (mob.dead) continue;
      this.stepToward(mob, dt, 5);
      const focus = mob.id === this.hover?.id || mob.id === this.target?.id || mob.boss;
      mob.label?.setVisible(focus);
      mob.hpBar?.setVisible(focus || mob.hp < mob.maxHp);
    }
    for (const u of [p, ...this.remotes.values(), ...this.mobs.values(), ...this.npcs.values()]) this.animate(u, time, dt);
    this.updateRides(time);
    if (rest) return; // rest mode: nothing is drawn, so the camera, ground, light and effects can wait

    this.world.update(p.worldX, p.worldY, this.viewRadius());
    this.world.updateOcclusion(p.root.x, p.root.y - 30, time);
    this.pfx.update(dt);
    this.updateLighting(time);
    this.heroRing.setPosition(p.root.x, p.root.y).setVisible(!this.isDead);

    const tu = this.target ? this.unitOf(this.target.id) : undefined;
    if (tu && !tu.dead) {
      const s = 0.45 + tu.scale * UNIT_RES * 0.15;
      this.targetRing.setVisible(true).setPosition(tu.root.x, tu.root.y).setScale(s, s * 0.5);
      (this.targetRing.list[0] as Phaser.GameObjects.Image).rotation += dt * 1.2;
    } else {
      this.targetRing.setVisible(false);
    }
    const hu = this.hover && this.hover.id !== this.target?.id ? this.unitOf(this.hover.id) : undefined;
    if (hu && !hu.dead) {
      const s = 0.3 + hu.scale * UNIT_RES * 0.12;
      this.hoverRing.setVisible(true).setPosition(hu.root.x, hu.root.y).setScale(s, s * 0.5);
    } else {
      this.hoverRing.setVisible(false);
    }
    this.updateFog(dt);
    this.updateBossBar();
    this.updateCamera(dt);
  }

  /**
   * Camera: frames a little above the hero (skills and labels stay clear of the skill bar), leads toward the
   * walking direction, eases out near a boss so its ground warnings fit, and punches in on big hits.
   */
  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    const p = this.player;
    let lx = 0, ly = 0;
    if (p.moving && this.moveTarget) {
      const a = worldToScreen(this.moveTarget.x, this.moveTarget.y);
      const dx = a.sx - p.root.x, dy = a.sy - p.root.y;
      const d = Math.hypot(dx, dy) || 1;
      lx = (dx / d) * 70;
      ly = (dy / d) * 45;
    }
    const k = 1 - Math.exp(-dt * 2.2);
    this.look.x += (lx - this.look.x) * k;
    this.look.y += (ly - this.look.y) * k;
    cam.setFollowOffset(-this.look.x, 28 - this.look.y);
    this.zoomPulse += (1 - this.zoomPulse) * (1 - Math.exp(-dt * 4));
    const target = this.baseZoom * (this.bossShown ? 0.84 : 1) * this.zoomPulse;
    cam.setZoom(cam.zoom + (target - cam.zoom) * (1 - Math.exp(-dt * 5)));
  }

  private punch(amount: number): void {
    this.zoomPulse = Math.max(this.zoomPulse, 1 + amount);
  }

  /** The boss bar shows only while a boss is close, and tracks its health. */
  private updateBossBar(): void {
    const p = this.player;
    let near: MobUnit | null = null;
    for (const m of this.mobs.values()) {
      if (m.boss && !m.dead && Math.hypot(m.worldX - p.worldX, m.worldY - p.worldY) < 14) near = m;
    }
    const key = near ? `${near.id}:${near.hp}:${near.maxHp}` : null;
    if (key === this.bossShown) return;
    this.bossShown = key;
    this.events.emit("boss_update", near ? { name: near.name, hp: near.hp, maxHp: near.maxHp } : null);
  }

  private sendPos(force: boolean): void {
    const now = this.time.now;
    if (!force && now - this.lastMoveSent < 100) return;
    this.lastMoveSent = now;
    socket.sendMove(this.player.worldX, this.player.worldY);
  }

  private stepToward(u: Unit, dt: number, speed: number): void {
    const dx = u.targetX - u.worldX, dy = u.targetY - u.worldY;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.02) { u.moving = false; return; }
    if (dist > 8) { u.worldX = u.targetX; u.worldY = u.targetY; this.placeUnit(u); return; }
    const r = Math.min((Math.max(speed, dist * 6) * dt) / dist, 1);
    u.worldX += dx * r;
    u.worldY += dy * r;
    u.moving = dist > 0.08;
    this.face(u, (dx - dy) * 32, (dx + dy) * 16);
    this.placeUnit(u);
  }

  private animate(u: Unit, time: number, dt: number): void {
    if (!u.body.active || u.dead || (u === this.player && this.isDead)) return;
    if (!this.tweens.isTweening(u.body)) {
      u.body.x = 0;
      u.body.scaleX = u.scale;
      u.body.alpha = 1;
      u.flash.x = 0;
      u.flash.scaleX = u.scale;
    }
    if (u.sheet) { this.animateSheet(u, time, dt); return; }
    let y = 0, rot = 0, sy = u.scale;
    if (u.moving) {
      u.phase += dt * 11;
      y = -Math.abs(Math.sin(u.phase)) * 3.5;
      rot = Math.sin(u.phase) * 0.05;
    } else {
      sy = u.scale * (1 + Math.sin(time * 0.0028 + u.seed) * 0.018);
      rot = u.body.rotation * 0.85;
    }
    const frame = u.moving ? u.baseKey + WALK_FRAMES[Math.floor(u.phase / Math.PI) % 2] : u.baseKey;
    if (frame !== u.frame) {
      u.frame = frame;
      u.body.setTexture(frame);
      u.flash.setTexture(`${frame}_flash`);
    }
    u.body.y = y;
    u.body.rotation = rot;
    u.body.scaleY = sy;
    u.flash.y = y;
    u.flash.rotation = rot;
    u.flash.scaleY = sy;
  }

  private updateLighting(time: number): void {
    const v = this.cameras.main.worldView, pad = 48;
    const w = Math.ceil(v.width + pad * 2), h = Math.ceil(v.height + pad * 2);
    // the night is drawn at 1/DARK_RES of the screen and stretched: it is a soft gradient, so it looks the same,
    // and every light cut into it costs a quarter (at full size, a fight full of glowing effects froze the game)
    const dw = Math.ceil(w / DARK_RES), dh = Math.ceil(h / DARK_RES);
    const tex = this.darkTex;
    if (Math.abs(tex.width - dw) > 1 || Math.abs(tex.height - dh) > 1) {
      tex.setSize(dw, dh);
      this.dark.setTexture("night_dark");  // picks up the new size
    }
    const ox = Math.floor(v.x - pad), oy = Math.floor(v.y - pad);
    this.dark.setPosition(ox, oy).setScale(DARK_RES);
    // painted with the browser's 2D canvas and sent to the screen as an image: works the same with the processor
    // and with the graphics card (whose "erase" on render textures does not cut the lights out)
    const ctx = tex.context;
    const tint = this.nightTint;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, tex.width, tex.height);
    ctx.fillStyle = `rgba(${(tint >> 16) & 255},${(tint >> 8) & 255},${tint & 255},${this.darkness})`;
    ctx.fillRect(0, 0, tex.width, tex.height);
    ctx.globalCompositeOperation = "destination-out";
    const light = (x: number, y: number, r: number, a: number) => {
      if (x < ox - r || y < oy - r || x > ox + w + r || y > oy + h + r) return;
      const rw = (r * 2) / DARK_RES, rh = rw * 0.72;
      ctx.globalAlpha = Phaser.Math.Clamp(a, 0, 1);
      ctx.drawImage(this.lightMask, (x - ox) / DARK_RES - rw / 2, (y - oy) / DARK_RES - rh / 2, rw, rh);
    };
    const p = this.player.root;
    light(p.x, p.y - 24, this.isDead ? 110 : 220, 0.95);
    // other players' lights: only the nearest ones (a crowd lit one light each, every frame)
    const near = [...this.remotes.values()].filter((r) => !r.dead && r.root.x > ox - 130 && r.root.x < ox + w + 130
      && r.root.y > oy - 130 && r.root.y < oy + h + 130);
    if (near.length > MAX_PLAYER_LIGHTS) {
      near.sort((a, b) => Math.hypot(a.root.x - p.x, a.root.y - p.y) - Math.hypot(b.root.x - p.x, b.root.y - p.y));
      near.length = MAX_PLAYER_LIGHTS;
    }
    for (const r of near) light(r.root.x, r.root.y - 24, 130, 0.75);
    for (const l of this.world!.lights()) {
      const f = 1 + Math.sin(time * 0.017 + l.x) * l.flicker * 0.6 + Math.sin(time * 0.043 + l.y) * l.flicker * 0.4;
      light(l.x, l.y, l.r * f, l.a);
    }
    // effect lights: only the ones nearest the hero (each one costs about 1 ms per frame; a big fight lit dozens)
    const look = gfx();
    const glows = this.pfx.active.filter((fx) => fx.glow && fx.alive && fx.x > ox - fx.glow && fx.x < ox + w + fx.glow
      && fx.y > oy - fx.glow && fx.y < oy + h + fx.glow);
    if (glows.length > look.fxLights) {
      glows.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
      glows.length = look.fxLights;
    }
    for (const fx of glows) light(fx.x, fx.y - 20, fx.glow, 0.9);
    this.flashLights = this.flashLights.filter((f) => time < f.until);
    for (const f of this.flashLights.slice(-look.fxLights)) light(f.x, f.y, f.r, (f.until - time) / f.dur);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    tex.refresh();
  }

  // ── Ambience and text ────────────────────────────────────────────────

  private createAmbience(theme: string): void {
    const p = this.player.root;
    const rand = Phaser.Math.Between;
    const motes = theme === "crypt" || theme === "swamp" || theme === "ghost" ? "spark_soul"
      : theme === "arena" || theme === "ash" ? "spark_orange" : theme === "frost" ? "spark_ice"
      : theme === "crimson" ? "spark_blood" : theme === "void" ? "spark_purple" : "spark_firefly";
    this.ambient.push(this.add.particles(0, 0, motes, {
      x: { onEmit: () => p.x + rand(-520, 520) },
      y: { onEmit: () => p.y + rand(-360, 360) },
      lifespan: { min: 3500, max: 7000 },
      speedX: { min: -14, max: 14 },
      speedY: theme === "arena" || theme === "ash" ? { min: -30, max: -8 } : { min: -12, max: 6 },
      scale: { min: 0.25, max: 0.55 },
      alpha: { onEmit: () => 0, onUpdate: (_p: unknown, _k: string, t: number) => Math.sin(Math.PI * t) * (theme === "crypt" ? 0.5 : 0.85) },
      frequency: (theme === "town" ? 400 : 160) / gfx().particles,
      blendMode: "ADD",
    }).setDepth(FX_DEPTH - 10));
    if (theme === "forest") {
      this.ambient.push(this.add.particles(0, 0, "leaves", {
        frame: [0, 1, 2],
        x: { onEmit: () => p.x + rand(-560, 560) },
        y: { onEmit: () => p.y + rand(-440, 80) },
        lifespan: 7000, speedY: { min: 12, max: 26 }, speedX: { min: -6, max: 22 },
        rotate: { onEmit: () => rand(0, 360), onUpdate: (_p: unknown, _k: string, _t: number, v: number) => v + 1.2 },
        alpha: { onEmit: () => 0, onUpdate: (_p: unknown, _k: string, t: number) => Math.min(1, Math.sin(Math.PI * t) * 2) * 0.85 },
        scale: { min: 0.8, max: 1.3 }, frequency: 420,
      }).setDepth(7000));
    }
    if (theme === "frost") {
      // steady snowfall drifting with the wind
      this.ambient.push(this.add.particles(0, 0, "spark_white", {
        x: { onEmit: () => p.x + rand(-640, 560) },
        y: { onEmit: () => p.y + rand(-460, 120) },
        lifespan: 6000, speedY: { min: 30, max: 60 }, speedX: { min: 8, max: 26 },
        alpha: { onEmit: () => 0, onUpdate: (_p: unknown, _k: string, t: number) => Math.min(1, Math.sin(Math.PI * t) * 2) * 0.8 },
        scale: { min: 0.15, max: 0.38 }, frequency: 45,
      }).setDepth(7000));
    }
    if (theme === "swamp" || theme === "crimson") {
      // rain: thin slanted streaks (red in the abyss)
      ensureRainTexture(this);
      this.ambient.push(this.add.particles(0, 0, theme === "swamp" ? "rain_drop" : "rain_blood", {
        x: { onEmit: () => p.x + rand(-700, 620) },
        y: { onEmit: () => p.y + rand(-520, 60) },
        lifespan: 900, speedY: { min: 520, max: 680 }, speedX: { min: 90, max: 130 }, rotate: -12,
        alpha: { start: theme === "swamp" ? 0.45 : 0.35, end: 0.1 }, scale: { min: 0.7, max: 1.1 },
        frequency: (theme === "swamp" ? 14 : 30) / gfx().particles,
      }).setDepth(7000));
    }
    if (theme === "ash") {
      // grey ash snowing down slowly
      ensureRainTexture(this);
      this.ambient.push(this.add.particles(0, 0, "ash_flake", {
        x: { onEmit: () => p.x + rand(-640, 560) },
        y: { onEmit: () => p.y + rand(-460, 120) },
        lifespan: 7000, speedY: { min: 14, max: 30 }, speedX: { min: -10, max: 14 },
        alpha: { onEmit: () => 0, onUpdate: (_p: unknown, _k: string, t: number) => Math.min(1, Math.sin(Math.PI * t) * 2) * 0.55 },
        scale: { min: 0.6, max: 1.2 }, frequency: 70 / gfx().particles,
      }).setDepth(7000));
    }
    if (gfx().rays && RAY_THEMES.has(theme)) {
      // slanted moonbeams around the hero, fading in and out slowly
      for (let i = 0; i < 5; i++) {
        const img = this.add.image(p.x + rand(-600, 600), p.y + rand(-420, 300), "light_ray")
          .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(1 + Math.random() * 0.8, 1.4 + Math.random())
          .setDepth(FX_DEPTH - 15);
        this.rays.push({ img, phase: Math.random() * Math.PI * 2 });
      }
    }
    if (gfx().fog && ["forest", "crypt", "swamp", "frost", "crimson", "ghost", "void"].includes(theme)) {
      for (let i = 0; i < 7; i++) {
        const img = this.add.image(p.x + rand(-700, 700), p.y + rand(-500, 500), "fog")
          .setScale(3 + Math.random() * 2.5, 2 + Math.random() * 1.5).setAlpha(0.05 + Math.random() * 0.06).setDepth(FX_DEPTH - 20);
        this.fog.push({ img, vx: 6 + Math.random() * 10, vy: (Math.random() - 0.5) * 4 });
      }
    }
  }

  /** Graphics quality changed: rebuild the ambience and the trees' sway on the spot. */
  applyQuality(): void {
    if (!this.mapInfo) return;
    for (const e of this.ambient) e.destroy();
    for (const f of this.fog) f.img.destroy();
    for (const r of this.rays) r.img.destroy();
    this.ambient = []; this.fog = []; this.rays = [];
    this.createAmbience(this.mapInfo.theme);
    this.world?.setSway(gfx().sway);
  }

  private updateFog(dt: number): void {
    const p = this.player.root;
    const t = this.time.now / 1000;
    for (const r of this.rays) {
      r.img.setAlpha(0.11 + 0.08 * Math.sin(t * 0.35 + r.phase));
      if (r.img.x - p.x > 800) r.img.x = p.x - 800;
      if (p.x - r.img.x > 800) r.img.x = p.x + 800;
      if (r.img.y - p.y > 560) r.img.y = p.y - 560;
      if (p.y - r.img.y > 560) r.img.y = p.y + 560;
    }
    for (const f of this.fog) {
      f.img.x += f.vx * dt;
      f.img.y += f.vy * dt;
      if (f.img.x - p.x > 900) f.img.x = p.x - 900;
      if (p.x - f.img.x > 900) f.img.x = p.x + 900;
      if (f.img.y - p.y > 650) f.img.y = p.y - 650;
      if (p.y - f.img.y > 650) f.img.y = p.y + 650;
    }
  }

  /** Text with cached font metrics: measuring a font reads pixels back from a canvas, which stalls. */
  private cachedText(x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    const key = `${style.fontSize}|${style.fontStyle ?? ""}|${style.strokeThickness ?? 0}`;
    const cached = this.metrics.get(key);
    const t = this.add.text(x, y, text, cached ? { ...style, metrics: cached } : style);
    if (!cached) this.metrics.set(key, t.style.getTextMetrics());
    return t;
  }

  /** Local chat shows above the speaker's head for a few seconds. */
  private speechBubble(charId: string, text: string): void {
    const u = charId === this.charId ? this.player : this.remotes.get(charId);
    if (!u) return;
    u.bubble?.destroy();
    const short = text.length > 90 ? `${text.slice(0, 88)}…` : text;
    const b = this.add.text(0, -u.height - 34, short, {
      fontFamily: FONT, fontSize: "20px", color: "#f3e3b8", align: "center",
      backgroundColor: "#120e18dd", padding: { x: 12, y: 8 }, wordWrap: { width: 340 },
    }).setOrigin(0.5, 1).setScale(SHARP);
    u.root.add(b);
    u.bubble = b;
    this.tweens.add({
      targets: b, alpha: 0, delay: 4500, duration: 500,
      onComplete: () => { b.destroy(); if (u.bubble === b) u.bubble = undefined; },
    });
  }

  // ── Mining ───────────────────────────────────────────────────────────

  private addVein(d: { id: string; kind: string; x: number; y: number; ready: boolean }): void {
    const { sx, sy } = worldToScreen(d.x, d.y);
    const img = this.add.image(sx, sy, d.ready ? `vein_${d.kind}` : "vein_empty").setOrigin(...VEIN_ORIGIN).setDepth(sy);
    const label = this.cachedText(sx, sy + 8, d.ready ? VEIN_INFO[d.kind].name : `${VEIN_INFO[d.kind].name} (esgotado)`, {
      fontFamily: FONT, fontSize: "22px", color: "#e8dcc0", stroke: "#000", strokeThickness: 6,
    }).setOrigin(0.5, 0).setDepth(sy + 1).setAlpha(d.ready ? 0.85 : 0.45).setScale(SHARP);
    this.veins.set(d.id, { ...d, img, label });
  }

  private clearVeins(): void {
    for (const v of this.veins.values()) { v.img.destroy(); v.label.destroy(); }
    this.veins.clear();
    for (const t of this.digging.values()) t.remove();
    this.digging.clear();
    this.pendingMine = null;
    this.endMineBar();
  }

  private veinAt(p: Phaser.Input.Pointer): VeinObj | null {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    for (const v of this.veins.values()) {
      if (Math.abs(wp.x - v.img.x) < 30 && wp.y < v.img.y + 10 && wp.y > v.img.y - 52) return v;
    }
    return null;
  }

  private onMining(charId: string, veinId: string, dur: number): void {
    const u = charId === this.charId ? this.player : this.remotes.get(charId);
    const v = this.veins.get(veinId);
    if (!u) return;
    if (v) this.face(u, v.img.x - u.root.x, v.img.y - u.root.y);
    this.digging.get(charId)?.remove();
    const swing = () => {
      this.playAction(u, "attack");
      if (v) this.pfx.play("impacts/hit-spark", v.img.x + Phaser.Math.Between(-8, 8), v.img.y - 22, { scale: 0.5, depth: v.img.y + 2 });
    };
    swing();
    this.digging.set(charId, this.time.addEvent({ delay: 750, loop: true, callback: swing }));
    if (charId === this.charId) {
      this.endMineBar();
      const g = this.add.graphics().setDepth(FX_DEPTH + 10);
      const t = this.add.text(0, 0, "Minerando…", { fontFamily: FONT, fontSize: "20px", color: "#ffe9a8", stroke: "#000", strokeThickness: 6 })
        .setOrigin(0.5, 1).setDepth(FX_DEPTH + 10).setScale(SHARP);
      this.mineBar = { g, t, start: this.time.now, dur: dur * 1000 };
    }
  }

  private onMiningEnd(charId: string, ok: boolean): void {
    this.digging.get(charId)?.remove();
    this.digging.delete(charId);
    if (charId !== this.charId) return;
    this.endMineBar();
    if (!ok) this.say("Mineração interrompida", "#ffb070");
  }

  private drawMineBar(time: number): void {
    const b = this.mineBar;
    if (!b) return;
    const p = this.player.root;
    const k = Phaser.Math.Clamp((time - b.start) / b.dur, 0, 1);
    const w = 56, y = p.y - this.player.height - 30;
    b.g.clear().fillStyle(0x000000, 0.75).fillRoundedRect(p.x - w / 2 - 1, y - 1, w + 2, 8, 3)
      .fillStyle(0xd9a040, 1).fillRoundedRect(p.x - w / 2, y, w * k, 6, 2);
    b.t.setPosition(p.x, y - 3);
  }

  private endMineBar(): void {
    this.mineBar?.g.destroy();
    this.mineBar?.t.destroy();
    this.mineBar = undefined;
  }

  private say(text: string, color: string): void {
    this.floatText(this.player.root.x, this.player.root.y - this.player.height - 20, text, color, 12, 0);
  }

  private floatText(x: number, y: number, text: string, color: string, size: number, delay: number): void {
    if (isResting()) return;
    const t = this.cachedText(x, y, text, {
      fontFamily: FONT, fontSize: `${Math.round(size * 0.75)}px`, color, stroke: "#000000", strokeThickness: 3, fontStyle: "bold",
    }).setOrigin(0.5).setDepth(FX_DEPTH + 10).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, delay, duration: 120 });
    this.tweens.add({ targets: t, y: y - 34, alpha: 0, delay: delay + 700, duration: 700, ease: "Quad.easeIn", onComplete: () => t.destroy() });
  }

  private lastShake = 0;
  private dmgSide = 1;
  /** damage numbers on screen now (past the quality's limit, plain hits on others are not shown) */
  private numbersAlive = new Set<Phaser.GameObjects.Text>();

  /**
   * A damage number that pops out of the target: just the number (12.345, or 1,2 mi), bigger for bigger hits;
   * critical hits in large gold with a strong pop and a small screen shake. Numbers drift to alternating sides
   * so a burst of hits does not pile up.
   */
  private damageNumber(x: number, y: number, amount: number, taken: boolean, crit: boolean, dot?: string): void {
    if (isResting()) return;
    if (!taken && !crit && this.numbersAlive.size >= gfx().numbers) return;
    const magnitude = Phaser.Math.Clamp(Math.log10(Math.max(10, amount)) / 7, 0, 1);  // 10 → 0.14 … 10 mi → 1
    const base = dot ? 11 : taken ? 14 : 14 + magnitude * 9;
    const size = Math.round(crit ? base * 1.6 : base);
    const color = dot ? DOT_COLOR[dot] ?? "#ffffff" : taken ? "#ff5a5a" : crit ? "#ffd23a" : "#ffffff";
    const stroke = taken ? "#2a0000" : crit ? "#6a1800" : "#1a0a05";
    this.dmgSide = -this.dmgSide;
    const sx = x + this.dmgSide * Phaser.Math.Between(4, 16);
    const t = this.cachedText(sx, y, taken ? `-${fmtBig(amount)}` : fmtBig(amount), {
      fontFamily: FONT, fontSize: `${size}px`, fontStyle: "bold", color, stroke, strokeThickness: crit ? 6 : 4,
    }).setOrigin(0.5).setDepth(FX_DEPTH + (crit ? 12 : 10)).setScale(0.2);
    t.setShadow(0, 2, "#000000", 4, true, true);
    this.numbersAlive.add(t);
    t.once("destroy", () => this.numbersAlive.delete(t));
    const drift = this.dmgSide * Phaser.Math.Between(14, crit ? 40 : 28);
    if (crit) {
      t.setAngle(this.dmgSide * -6);
      this.tweens.add({ targets: t, scale: 1.55, duration: 140, ease: "Back.easeOut" });
      this.tweens.add({ targets: t, scale: 1.2, angle: 0, delay: 140, duration: 160, ease: "Sine.easeOut" });
      if (!taken && this.time.now - this.lastShake > 180) {  // a light jolt, never a constant rumble
        this.lastShake = this.time.now;
        this.fx.shake(0.0035, 90);
      }
    } else {
      this.tweens.add({ targets: t, scale: 1.12, duration: 110, ease: "Back.easeOut" });
      this.tweens.add({ targets: t, scale: 1, delay: 110, duration: 140 });
    }
    this.tweens.add({ targets: t, x: sx + drift, duration: 1000, ease: "Sine.easeOut" });
    this.tweens.add({ targets: t, y: y - (crit ? 70 : 54), duration: 1000, ease: "Cubic.easeOut" });
    this.tweens.add({ targets: t, alpha: 0, delay: crit ? 650 : 520, duration: 420, ease: "Quad.easeIn", onComplete: () => t.destroy() });
  }

  private viewRadius(): number {
    const cam = this.cameras.main;
    return Math.ceil(cam.width / cam.zoom / 2 / 32 + cam.height / cam.zoom / 2 / 16) + 3;
  }
}

/** A thin raindrop streak (and a red one for the crimson abyss). */
function ensureRainTexture(scene: Phaser.Scene): void {
  for (const [key, rgb] of [["rain_drop", "190,220,255"], ["rain_blood", "220,60,70"]] as const) {
    if (scene.textures.exists(key)) continue;
    const t = scene.textures.createCanvas(key, 4, 26)!;
    const c = t.getContext();
    const g = c.createLinearGradient(0, 0, 0, 26);
    g.addColorStop(0, `rgba(${rgb},0)`);
    g.addColorStop(1, `rgba(${rgb},0.9)`);
    c.fillStyle = g;
    c.fillRect(1, 0, 2, 26);
    t.refresh();
  }
  if (!scene.textures.exists("ash_flake")) {
    const t = scene.textures.createCanvas("ash_flake", 6, 6)!;
    const c = t.getContext();
    c.fillStyle = "rgba(150,142,136,0.9)";
    c.beginPath(); c.arc(3, 3, 2.4, 0, Math.PI * 2); c.fill();
    t.refresh();
  }
}

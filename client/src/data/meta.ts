/** Game data downloaded from the server (GET /meta): skills, passives, maps, quests, level curve. */

export const API = (import.meta.env.VITE_API_URL || `http://${location.hostname || "localhost"}:8000`).replace(/\/+$/, "");
export const WS_HOST = new URL(API).host;

export interface SkillVfx {
  cast?: string; cs?: number;
  /** colour of the ground shockwave (a GLOW_COLORS name) */
  ring?: string;
  after?: string;
  proj?: string; ps?: number;
  hit?: string; hs?: number;
  /** second effect on the target, on top of the hit (a flash, a crit burst…) */
  impact?: string; is?: number;
  area?: string; as?: number;
  /** second ground effect layered under the area effect */
  area2?: string; as2?: number;
  status?: string;
  buff?: string; bs?: number;
  pal?: string;
  repeat?: number;
  delay?: number;
  shake?: number;
  beam?: string;
}

export interface SkillDef {
  id: string;
  /** the free basic attack (its own button and the Space key, not one of the 10 slots) */
  basic?: boolean;
  cls: string;
  name: string;
  desc: string;
  icon: { g: string; c: string };
  lvl: number;
  passive?: boolean;
  mp: number;
  cd: number;
  kind: "melee" | "projectile" | "aoe_self" | "aoe_target" | "line" | "chain" | "dash" | "blink" | "buff" | "heal";
  range: number;
  radius: number;
  /** line skills: half width of the line, in tiles */
  width?: number;
  /** single-target skills: radius around the target that also gets hit */
  splash?: number;
  hits: number;
  cc?: { t: string; d: number };
  dot?: { ticks: number; every: number; pct: number; kind: string };
  buff?: Record<string, number>;
  vfx?: SkillVfx;
  fx?: Record<string, number>;
}

/** A hidden place of the discovery diary (server/discovery.py). */
export interface PlaceDef {
  id: string;
  name: string;
  x: number;
  y: number;
  /** texture: "shrine", a giant landmark "lm_<theme>", an ordinary prop key, or "" (an object already on the map) */
  look: string;
  /** GLOW_COLORS name of its light */
  glow: string;
  /** Hero.mod() key and value, e.g. ["max_hp_pct", 0.01] */
  bonus: [string, number];
  hint: string;
  lore: string;
  landmark: boolean;
}

export interface Meta {
  skills: SkillDef[];
  passives: SkillDef[];
  mobs: Record<string, { name: string; level: number; boss: boolean }>;
  maps: Record<string, { name: string; theme: string; level: string; pvp: boolean; safe: boolean }>;
  quests: { id: string; title: string; goal_text: string; count: number; mob: string }[];
  /** hidden places of every map, the gold for finishing a map, and how each bonus is named */
  discovery?: { places: Record<string, PlaceDef[]>; total: number; map_gold: Record<string, number>; bonus_text: Record<string, string> };
  /** portals of every map (for the auto-pilot's routes) */
  world: Record<string, { to: string; x: number; y: number }[]>;
  /** where each monster lives: [map, x, y] */
  spawns: Record<string, [string, number, number][]>;
  items: Record<string, ItemDef>;
  rarity: Record<string, { name: string; color: string }>;
  bag_slots: number;
  /** how much each stat point is worth when comparing pieces (same numbers the server's auto-equip uses) */
  score_weights?: Record<string, number>;
  ref_weight?: number;
  upgrade_step: number;
  forge: ForgeInfo;
  exp_table: number[];
  max_level: number;
  /** level titles (one every 100 levels) */
  /** level titles, plus the season pass titles ("pass": owned through the pass, not by level) */
  titles: { level: number; id: string; name: string; color: string; pass?: boolean }[];
  /** cosmetic auras (glow colour is a GLOW_COLORS name) */
  auras?: { id: string; name: string; color: string }[];
  /** mascots that follow the hero (sheet = 3D sprite key) */
  pets?: { id: string; name: string; sheet: string }[];
  /** horses the hero rides (looks only) */
  mounts?: { id: string; name: string; sheet: string; saddle?: number }[];
  /** skins: the hero's class recoloured (grade applied in the client) */
  skins?: { id: string; name: string; desc: string; grade?: { desat?: number; tint?: [number, number, number]; gain?: number };
    /** a skin with its own 3D model: sheets `<sheet>_<class>` */
    sheet?: string }[];
  season?: SeasonMeta;
  shop?: ShopMeta;
}

export let META: Meta;

export async function loadMeta(): Promise<Meta> {
  const res = await fetch(`${API}/meta`);
  if (!res.ok) throw new Error("Servidor indisponível");
  META = await res.json();
  return META;
}

export const classSkills = (cls: string): SkillDef[] => META.skills.filter((s) => s.cls === cls && !s.basic);
export const basicSkill = (cls: string): SkillDef | undefined => META.skills.find((s) => s.cls === cls && s.basic);
export const classPassives = (cls: string): SkillDef[] => META.passives.filter((s) => s.cls === cls);
export const skillById = (id: string): SkillDef | undefined => META.skills.find((s) => s.id === id);

export const CLASS_INFO: Record<string, { name: string; role: string; color: string; stats: string; lore: string }> = {
  blade_master: {
    name: "Mestre da Lâmina", role: "Guerreiro corpo a corpo", color: "#e0485a", stats: "Força · Vida alta",
    lore: "Um cavaleiro marcado por mil batalhas.",
  },
  grand_sorcerer: {
    name: "Grande Feiticeiro", role: "Magia em área", color: "#6f8cff", stats: "Inteligência · Mana alta",
    lore: "Domina o fogo, o gelo e o próprio vazio.",
  },
  night_ranger: {
    name: "Patrulheiro Noturno", role: "Arqueiro ágil", color: "#7ddc6a", stats: "Agilidade · Críticos",
    lore: "Caça nas sombras e nunca erra o alvo.",
  },
};

const BIG_UNITS = ["mi", "bi", "tri", "quatri", "quinti", "sexti", "septi", "octi", "noni", "deci"];

/** Numbers for people: 12.345 · 4,5 mi · 3,2 bi … then 1,2e45 for the truly huge ones. */
export function fmtBig(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  const a = Math.abs(n);
  if (a < 1e6) return Math.round(n).toLocaleString("pt-BR");
  const e = Math.floor(Math.log10(a) / 3) - 2; // 0 → mi, 1 → bi, ...
  if (e < BIG_UNITS.length) return `${(n / 10 ** (3 * (e + 2))).toFixed(1).replace(".", ",")} ${BIG_UNITS[e]}`;
  return n.toExponential(1).replace(".", ",").replace("e+", "e");
}

export interface GuildMember { id: string; name: string; rank: "leader" | "officer" | "member"; rank_name: string; online: boolean; level: number; map: string }
export interface GuildState {
  guild: null | {
    name: string;
    my_rank: "leader" | "officer" | "member";
    members: GuildMember[];
    max: number;
    wars: { name: string; minutes: number; us: number; them: number }[];
    enemies: string[];
  };
  cost?: number;
  min_level?: number;
}

export interface MapInfo {
  map_id: string;
  name: string;
  theme: "town" | "forest" | "crypt" | "arena" | "swamp" | "mine" | "frost" | "ash" | "crimson" | "ghost" | "void";
  size: number;
  safe: boolean;
  pvp: boolean;
  /** the world boss room: no PvP, no losses on death */
  event?: boolean;
  level: string;
  portals: { id: string; x: number; y: number; to: string; label: string; locked: boolean }[];
  npcs: { id: string; name: string; x: number; y: number; look: string; role: string }[];
  clearings: [number, number, number][];
}

export type GearSlot = "weapon" | "armor" | "legs" | "boots" | "ring" | "necklace";
/** The equipment slots, in the order the windows show them. */
export const GEAR_SLOTS: GearSlot[] = ["weapon", "armor", "legs", "boots", "ring", "necklace"];

export interface ItemDef {
  name: string;
  type: "gear" | "potion" | "material" | "tool";
  icon: string;
  rarity: string;
  price?: number;
  sell: number;
  desc?: string;
  // gear
  slot?: GearSlot;
  lvl?: number;
  tier?: number;
  stats?: Record<string, number>;
  cls?: string[];
  // potion
  kind?: "hp" | "mp";
  amount?: number;
}

/** A bag slot. Gear pieces may carry an upgrade level (`plus`) and refinement lines (`ref`). */
export interface BagEntry { id: string; qty: number; plus?: number; ref?: Record<string, number>; ench?: string }

/** An equipped gear piece. */
export interface GearPiece { id: string; plus?: number; ref?: Record<string, number>; ench?: string }

export interface ForgeInfo {
  recipes: Record<string, { mats: Record<string, number>; gold: number }>;
  up_chance: Record<string, number>;
  max_plus: number;
  refine_lines: Record<string, string>;
  refine_max: number;
  /** weapon enchantments: element → name, what it does, colour */
  enchants?: Record<string, { name: string; desc: string; color: string }>;
}

/** Stats of a piece after its upgrade level (server: items.piece_stats). */
export function pieceStats(p: { id: string; plus?: number }): Record<string, number> {
  const def = META.items[p.id];
  const m = 1 + (META.upgrade_step ?? 0.07) * (p.plus ?? 0);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(def?.stats ?? {})) out[k] = PERCENT_STATS.has(k) ? Math.round(v * m * 10000) / 10000 : Math.round(v * m);
  return out;
}

export function pieceName(p: { id: string; plus?: number }): string {
  const name = META.items[p.id]?.name ?? "?";
  return p.plus ? `${name} +${p.plus}` : name;
}

/** "+4% Dano" lines for refinement bonuses. */
export function refLines(ref: Record<string, number> = {}): string[] {
  return Object.entries(ref).map(([k, v]) => `+${(v * 100).toFixed(1).replace(".", ",")}% ${META.forge?.refine_lines[k] ?? k}`);
}

export interface InventoryState {
  bag: BagEntry[];
  gear: Partial<Record<GearSlot, GearPiece>>;
  gold: number;
  shop: string | null;
  /** bag spaces (more with VIP) */
  cap?: number;
}

export interface PartyMember {
  id: string;
  name: string;
  cls: string;
  level: number;
  hp: number;
  max_hp: number;
  map: string;
  online: boolean;
  leader: boolean;
}

export const PARTY_COLOR = "#8aff9a";

export interface ShopMsg { shop: string; name: string; items: string[] }

export const SLOT_NAMES: Record<GearSlot, string> = {
  weapon: "Arma", armor: "Peito", legs: "Calça", boots: "Bota", ring: "Anel", necklace: "Colar",
};

const STAT_NAMES: Record<string, string> = {
  str: "Força", agi: "Agilidade", int: "Inteligência", vit: "Vitalidade",
  atk: "Ataque", def: "Defesa", hp: "Vida", mp: "Mana", crit: "Chance de crítico", crit_dmg: "Dano crítico",
};

/** Stats kept as fractions (0.05 = 5%). */
export const PERCENT_STATS = new Set(["crit", "crit_dmg"]);

/** "+5 Força" / "+4% Chance de crítico" lines for an item's stats. */
export function statLines(stats: Record<string, number> = {}): string[] {
  return Object.entries(stats).map(([k, v]) => PERCENT_STATS.has(k) ? `+${Math.round(v * 100)}% ${STAT_NAMES[k]}` : `+${v} ${STAT_NAMES[k] ?? k}`);
}

/** "Chance de crítico 37,2% · Dano crítico 181%" for the hero panels. */
export function critText(h: { crit: number; crit_dmg?: number; dodge?: number }): string[] {
  const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;
  return [`Chance de crítico ${pct(h.crit)}`, `Dano crítico ${Math.round((1 + (h.crit_dmg ?? 0.5)) * 100)}%`,
    `Evasão ${pct(h.dodge ?? 0)}`];
}

/** The gem shop (server: shop.meta): only looks and the pass Premium track. */
export interface ShopOffer {
  id: string;
  kind: "premium_pass" | "aura" | "title" | "pet" | "mount" | "skin" | "boost" | "pass_level" | "quest_skip";
  ref?: string;
  name: string;
  price: number;
  /** quest finishing: extra gems per story quest number */
  price_step?: number;
  minutes?: number;
  levels?: number;
  tab: string;
  desc: string;
}
export interface ShopMeta {
  currency: string;
  packs: { id: string; gems: number; bonus: number; price: number }[];
  offers: ShopOffer[];
  soon: { name: string; desc: string }[];
}

/** One reward of the season pass. */
export type PassReward = { gold: number } | { item: string; qty: number } | { title: string } | { aura: string };

export interface SeasonMeta {
  id: string;
  name: string;
  max: number;
  xp_per: number;
  track: { level: number; free: PassReward[]; prem: PassReward[] }[];
  sources: string[];
}

/** The hero's pass this season (server: season.public). */
export interface SeasonState {
  name: string;
  days_left: number;
  xp: number;
  level: number;
  xp_in: number;
  xp_per: number;
  max: number;
  premium: boolean;
  free: number[];
  prem: number[];
  kill_xp_today: number;
  kill_cap: number;
}

export interface HeroState {
  char_id: string;
  name: string;
  /** chosen level title id ("" = none) */
  title?: string;
  /** titles and auras owned for good (season pass) and the aura worn */
  cosmetics?: { titles: string[]; auras: string[]; aura: string; pets?: string[]; pet?: string; mounts?: string[]; mount?: string; skins?: string[]; skin?: string };
  /** premium currency (gem shop) */
  gems?: number;
  /** active shop boosts: "exp" | "gold" → seconds left */
  boosts?: Record<string, number>;
  /** the account's active VIP level (0 = none) */
  vip?: number;
  cls: string;
  level: number;
  exp: number;
  exp_next: number;
  gold: number;
  hp: number;
  mp: number;
  max_hp: number;
  max_mp: number;
  atk: number;
  def: number;
  crit: number;
  /** extra damage of a critical hit (0.5 = criticals do 150%) */
  crit_dmg?: number;
  /** chance to dodge a monster's hit */
  dodge?: number;
  str: number;
  agi: number;
  int: number;
  vit: number;
  speed: number;
  buffs: string[];
  story: { q: number; st: string; n: number };
  loot: Record<string, number>;
  /** hidden places found (discovery diary) */
  found?: string[];
  pvp: { kills: number; deaths: number };
  pk: { status: PkStatus; red_left: number; kills: number; aggressor_left: number };
}

/** Open-world name colors (server/pk_system.py). */
export type PkStatus = "white" | "aggressor" | "red";
export const PK_INFO: Record<PkStatus, { name: string; color: string }> = {
  white: { name: "Inocente", color: "#bcd4ff" },
  aggressor: { name: "Agressor", color: "#d49aff" },
  red: { name: "Assassino", color: "#ff4a4a" },
};

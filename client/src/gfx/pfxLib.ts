/**
 * The pixelfx effect library (every effect by "category/name"). Shared by the game (pixelfx.ts) and the effects
 * worker (fxWorker.ts), so it must not import Phaser.
 */
import type { PfxModule } from "pixelfx";
import * as swordSlash from "pixelfx/fx/melee/sword-slash";
import * as spinSlash from "pixelfx/fx/melee/spin-slash";
import * as heavyCleave from "pixelfx/fx/melee/heavy-cleave";
import * as clawSwipe from "pixelfx/fx/melee/claw-swipe";
import * as critHit from "pixelfx/fx/impacts/crit-hit";
import * as hitSpark from "pixelfx/fx/impacts/hit-spark";
import * as groundSlam from "pixelfx/fx/impacts/ground-slam";
import * as stunned from "pixelfx/fx/status/stunned";
import * as frozen from "pixelfx/fx/status/frozen";
import * as slowed from "pixelfx/fx/status/slowed";
import * as bleeding from "pixelfx/fx/status/bleeding";
import * as poisoned from "pixelfx/fx/status/poisoned";
import * as burning from "pixelfx/fx/status/burning";
import * as rage from "pixelfx/fx/status/rage";
import * as fireball from "pixelfx/fx/fire/fireball";
import * as meteor from "pixelfx/fx/fire/meteor";
import * as fireRing from "pixelfx/fx/fire/fire-ring";
import * as campfire from "pixelfx/fx/fire/campfire";
import * as brazier from "pixelfx/fx/fire/brazier";
import * as candle from "pixelfx/fx/fire/candle";
import * as iceLance from "pixelfx/fx/ice/ice-lance";
import * as frostNova from "pixelfx/fx/ice/frost-nova";
import * as zapHit from "pixelfx/fx/lightning/zap-hit";
import * as blinkOut from "pixelfx/fx/arcane/blink-out";
import * as blinkIn from "pixelfx/fx/arcane/blink-in";
import * as starFall from "pixelfx/fx/arcane/star-fall";
import * as portal from "pixelfx/fx/arcane/portal";
import * as blackHole from "pixelfx/fx/shadow/black-hole";
import * as shadowTendrils from "pixelfx/fx/shadow/shadow-tendrils";
import * as darkExplosion from "pixelfx/fx/shadow/dark-explosion";
import * as poisonCloud from "pixelfx/fx/nature/poison-cloud";
import * as rootSnare from "pixelfx/fx/nature/root-snare";
import * as divineShield from "pixelfx/fx/holy/divine-shield";
import * as blessing from "pixelfx/fx/holy/blessing";
import * as holyPillar from "pixelfx/fx/holy/holy-pillar";
import * as heal from "pixelfx/fx/holy/heal";
import * as arrow from "pixelfx/fx/projectiles/arrow";
import * as energyDisc from "pixelfx/fx/projectiles/energy-disc";
import * as magicMissile from "pixelfx/fx/projectiles/magic-missile";
import * as smallExplosion from "pixelfx/fx/explosions/small-explosion";
import * as soulRise from "pixelfx/fx/spawn/soul-rise";
import * as summonRise from "pixelfx/fx/spawn/summon-rise";
import * as respawnBeam from "pixelfx/fx/spawn/respawn-beam";

// pixelfx (MIT) by Patch — https://github.com/patch-gg/pixelfx
export const LIB: Record<string, PfxModule> = {
  "melee/sword-slash": swordSlash, "melee/spin-slash": spinSlash, "melee/heavy-cleave": heavyCleave,
  "melee/claw-swipe": clawSwipe, "impacts/crit-hit": critHit, "impacts/hit-spark": hitSpark,
  "impacts/ground-slam": groundSlam, "status/stunned": stunned, "status/frozen": frozen, "status/slowed": slowed,
  "status/bleeding": bleeding, "status/poisoned": poisoned, "status/burning": burning, "status/rage": rage,
  "fire/fireball": fireball, "fire/meteor": meteor, "fire/fire-ring": fireRing, "fire/campfire": campfire,
  "fire/brazier": brazier, "fire/candle": candle, "ice/ice-lance": iceLance, "ice/frost-nova": frostNova,
  "lightning/zap-hit": zapHit, "arcane/blink-out": blinkOut, "arcane/blink-in": blinkIn, "arcane/star-fall": starFall,
  "arcane/portal": portal, "shadow/black-hole": blackHole, "shadow/shadow-tendrils": shadowTendrils,
  "shadow/dark-explosion": darkExplosion, "nature/poison-cloud": poisonCloud, "nature/root-snare": rootSnare,
  "holy/divine-shield": divineShield, "holy/blessing": blessing, "holy/holy-pillar": holyPillar, "holy/heal": heal,
  "projectiles/arrow": arrow, "projectiles/energy-disc": energyDisc, "projectiles/magic-missile": magicMissile,
  "explosions/small-explosion": smallExplosion, "spawn/soul-rise": soulRise, "spawn/summon-rise": summonRise,
  "spawn/respawn-beam": respawnBeam,
};

// Every other effect of the library (244 in all), so skills can use any of them by "category/name".
const ALL_FX = import.meta.glob("/node_modules/pixelfx/src/fx/*/*.js", { eager: true }) as Record<string, PfxModule>;
for (const [path, mod] of Object.entries(ALL_FX)) {
  const m = path.match(/\/fx\/([^/]+)\/([^/]+)\.js$/);
  const impl = mod as { create?: unknown; draw?: unknown; meta?: unknown };
  if (!m || m[2].startsWith("_") || !impl.meta || !(impl.create || impl.draw)) continue;
  const key = `${m[1]}/${m[2]}`;
  if (!LIB[key]) LIB[key] = mod;
}


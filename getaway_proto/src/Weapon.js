// ============================================================
// Weapons.js (NEW FILE)
// - Holds weapon DEFINITIONS (data) and helper classes for
//   creating weapon instances + spawning pickups from Tiled.
// ============================================================

import Phaser from "phaser";

// ============================================================
// WEAPON DEFINITIONS (data-only)
// - Add new weapons here.
// - The Tiled object property "weapon" should match the id.
// ============================================================

export const WEAPON_DEFS = {
  sniper: {
    // This id must match what you put in Tiled: weapon = "sniper"
    id: "sniper",

    // Phaser texture key for the gun sprite (load this in GameScene.preload)
    spriteKey: "gun_sniper",

    // Visual size for the gun in-hand (pixels)
    displayWpx: 120,
    displayHpx: 28,

    // Gameplay stats (you can expand later)
    damage: 80,
    fireRate: 0.9, // shots per second
    clipSize: 3,
    reloadSec: 1.8,

    // Optional audio key (load this in preload if you use it)
    soundKey: "sfx_sniper",
  },
};

// ============================================================
// Small helpers for reading Tiled properties
// (Phaser sometimes gives properties as an array OR as an object.)
// ============================================================

function getTiledProp(obj, propName, defaultValue = undefined) {
  // Tiled often stores properties like: [{ name, type, value }, ...]
  if (Array.isArray(obj.properties)) {
    const found = obj.properties.find((p) => p && p.name === propName);
    return found ? found.value : defaultValue;
  }

  // Sometimes Phaser gives an object: { weapon: "sniper" }
  if (obj.properties && typeof obj.properties === "object") {
    if (propName in obj.properties) return obj.properties[propName];
  }

  // Fallback: direct field on the object
  if (obj && propName in obj) return obj[propName];

  return defaultValue;
}

// ============================================================
// WeaponInstance (runtime state)
// - This is what the player actually holds.
// ============================================================

export class WeaponInstance {
  constructor(def) {
    // The definition (stats, sprite key, etc.)
    this.def = def;

    // Ammo currently loaded in the clip
    this.ammoInClip = def.clipSize;

    // Cooldown timer until we can fire again (seconds)
    this.cooldownSec = 0;

    // Reload timer (seconds). If > 0 we are reloading.
    this.reloadSecLeft = 0;
  }

  // Call this each fixed update to tick timers down.
  tick(dt) {
    this.cooldownSec = Math.max(0, this.cooldownSec - dt);
    this.reloadSecLeft = Math.max(0, this.reloadSecLeft - dt);

    // If we finished reloading, refill the clip.
    if (this.reloadSecLeft === 0 && this.ammoInClip === 0) {
      this.ammoInClip = this.def.clipSize;
    }
  }
}

// ============================================================
// WeaponPickup (world object)
// - A sprite on the ground that can be collected.
// ============================================================

export class WeaponPickup {
  constructor(opts) {
    this.scene = opts.scene;

    // Weapon id like "sniper"
    this.weaponId = opts.weaponId;

    // Definition (so we know which sprite to show, etc.)
    this.def = opts.def;

    // Whether the pickup can be collected right now
    this.active = true;

    // Optional respawn time (seconds). If null/0, it never respawns.
    this.respawnSec = opts.respawnSec ?? 0;

    // Create the visible pickup sprite
    this.sprite = this.scene.add.image(opts.x, opts.y, this.def.spriteKey);

    // Slightly smaller on the ground than in-hand looks nice
    const w = (this.def.displayWpx ?? 90) * 0.75;
    const h = (this.def.displayHpx ?? 30) * 0.75;
    this.sprite.setDisplaySize(w, h);

    // Make it stand out visually
    this.sprite.setRotation(Phaser.Math.DegToRad(-10));

    // Put it above most things
    this.sprite.setDepth(20);
  }

  // Hide + disable the pickup (and optionally schedule respawn).
  consume() {
    if (!this.active) return;

    this.active = false;

    if (this.sprite) {
      this.sprite.setVisible(false);
    }

    // If respawn is enabled, bring it back later.
    if (this.respawnSec > 0) {
      this.scene.time.delayedCall(this.respawnSec * 1000, () => {
        this.respawn();
      });
    } else {
      // Otherwise, we can fully destroy it.
      this.destroy();
    }
  }

  // Bring the pickup back.
  respawn() {
    this.active = true;

    if (this.sprite) {
      this.sprite.setVisible(true);
    }
  }

  // Clean up.
  destroy() {
    this.active = false;

    if (this.sprite) {
      this.sprite.destroy();
      this.sprite = null;
    }
  }
}

// ============================================================
// Weapons (registry + Tiled spawn helper)
// ============================================================

export class Weapons {
  // Get the weapon definition by id.
  static getDef(weaponId) {
    return WEAPON_DEFS[weaponId] ?? null;
  }

  // Create a weapon runtime instance for a given id.
  static createInstance(weaponId) {
    const def = Weapons.getDef(weaponId);
    if (!def) return null;
    return new WeaponInstance(def);
  }

  /**
   * Spawn pickups from a Tiled Object Layer.
   *
   * Requirements in Tiled:
   * - Create an Object Layer named like "WeaponSpawns"
   * - Add POINT objects
   * - Give each point a string property:
   *     weapon = "sniper"
   *
   * Optional properties:
   * - respawnSec = 5 (number)
   */
  static spawnPickupsFromTiled(scene, tilemap, objectLayerName) {
    const results = [];

    // Find the object layer by name.
    const layer = tilemap.getObjectLayer(objectLayerName);

    if (!layer || !layer.objects) {
      console.warn(`No object layer named "${objectLayerName}" found in this map.`);
      return results;
    }

    // For each object in the layer, create a pickup.
    for (const obj of layer.objects) {
      const weaponId = getTiledProp(obj, "weapon", null);
      if (!weaponId) continue;

      const def = Weapons.getDef(weaponId);
      if (!def) {
        console.warn(`Tiled spawn has weapon="${weaponId}" but WEAPON_DEFS has no entry for it.`);
        continue;
      }

      const respawnSec = getTiledProp(obj, "respawnSec", 0);

      // NOTE:
      // For Point objects, Tiled's obj.x/obj.y is the point position.
      // For Rectangle objects, obj.x/obj.y is the top-left.
      const x = obj.x;
      const y = obj.y;

      results.push(
        new WeaponPickup({
          scene,
          x,
          y,
          weaponId,
          def,
          respawnSec,
        })
      );
    }

    return results;
  }
}

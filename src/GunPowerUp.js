// ============================================================
// GunPowerUp.js
// - A gun pickup that extends PowerUp
//
// NEW (sounds) are already here.
//
// NEW (respawn):
// - Gun powerups default to respawn 5 seconds after pickup.
// - You can override per gun with opts.respawnDelaySec.
// ============================================================

import PowerUp from "./PowerUp.js";

export default class GunPowerUp extends PowerUp {
  /**
   * @param {object} opts
   * @param {Phaser.Scene} opts.scene
   * @param {number} opts.x
   * @param {number} opts.y
   *
   * Pickup visuals (on ground)
   * @param {string} opts.pickupImageKey
   * @param {number} [opts.pickupRadiusPx=60]
   * @param {number} [opts.pickupWpx]
   * @param {number} [opts.pickupHpx]
   * @param {number} [opts.pickupScale]
   *
   * Respawn (guns should respawn 5 seconds after pickup)
   * @param {number} [opts.respawnDelaySec=5]
   *
   * Held visuals (in hand)
   * @param {string} opts.heldImageKey
   * @param {number} [opts.heldWpx=110]
   * @param {number} [opts.heldHpx=28]
   * @param {number} [opts.heldDepth=7]
   * @param {number} [opts.heldOriginX=0.2]
   * @param {number} [opts.heldOriginY=0.5]
   * @param {number} [opts.heldAlongArmOffsetPx=0]
   * @param {number} [opts.heldSideOffsetPx=0]
   * @param {number} [opts.heldAngleOffsetRad=0]
   * @param {boolean} [opts.heldFlipWithPlayer=true]
   *
   * Stats
   * @param {string} opts.gunId
   * @param {number} opts.ammo
   * @param {number} opts.damage
   *
   * Sounds (all optional)
   * @param {string|null} [opts.pickupSoundKey=null]
   * @param {number} [opts.pickupSoundVolume=1]
   * @param {number} [opts.pickupSoundRate=1]
   * @param {number} [opts.pickupSoundSpeed]
   *
   * @param {string|null} [opts.fireSoundKey=null]
   * @param {number} [opts.fireSoundVolume=1]
   * @param {number} [opts.fireSoundRate=1]
   * @param {number} [opts.fireSoundSpeed]
   *
   * @param {string|null} [opts.reloadSoundKey=null]
   * @param {number} [opts.reloadSoundVolume=1]
   * @param {number} [opts.reloadSoundRate=1]
   * @param {number} [opts.reloadSoundSpeed]
   *
   * @param {number} [opts.fireToReloadDelaySec=0]
   */
  constructor(opts) {
    // Guns should respawn every 5 seconds by default
    const respawnDelaySec = Number.isFinite(opts.respawnDelaySec) ? opts.respawnDelaySec : 5;

    super({
      // Scene + position
      scene: opts.scene,
      x: opts.x,
      y: opts.y,

      // Pickup sprite + radius
      pickupImageKey: opts.pickupImageKey,
      pickupRadiusPx: opts.pickupRadiusPx ?? 60,

      // Pickup sizing
      pickupWpx: opts.pickupWpx,
      pickupHpx: opts.pickupHpx,
      pickupScale: opts.pickupScale,

      // Render depth
      depth: 20,

      // NEW: respawn delay
      respawnDelaySec: respawnDelaySec,
    });

    // --------------------------
    // Stats
    // --------------------------
    this.gunId = opts.gunId;
    this.ammo = opts.ammo;
    this.damage = opts.damage;

    // --------------------------
    // Sounds (stored on the powerup so Player can copy them on equip)
    // --------------------------
    this.pickupSoundKey = opts.pickupSoundKey ?? null;
    this.pickupSoundVolume = opts.pickupSoundVolume ?? 1;
    this.pickupSoundRate = opts.pickupSoundRate ?? opts.pickupSoundSpeed ?? 1;

    this.fireSoundKey = opts.fireSoundKey ?? null;
    this.fireSoundVolume = opts.fireSoundVolume ?? 1;
    this.fireSoundRate = opts.fireSoundRate ?? opts.fireSoundSpeed ?? 1;

    this.reloadSoundKey = opts.reloadSoundKey ?? null;
    this.reloadSoundVolume = opts.reloadSoundVolume ?? 1;
    this.reloadSoundRate = opts.reloadSoundRate ?? opts.reloadSoundSpeed ?? 1;

    this.fireToReloadDelaySec = opts.fireToReloadDelaySec ?? 0;

    // --------------------------
    // Held sprite visuals
    // --------------------------
    this.heldImageKey = opts.heldImageKey;

    this.heldDepth = opts.heldDepth ?? 7;
    this.heldWpx = opts.heldWpx ?? 110;
    this.heldHpx = opts.heldHpx ?? 28;

    this.heldOriginX = opts.heldOriginX ?? 0.2;
    this.heldOriginY = opts.heldOriginY ?? 0.5;

    this.heldAlongArmOffsetPx = opts.heldAlongArmOffsetPx ?? 0;
    this.heldSideOffsetPx = opts.heldSideOffsetPx ?? 0;
    this.heldAngleOffsetRad = opts.heldAngleOffsetRad ?? 0;

    this.heldFlipWithPlayer = opts.heldFlipWithPlayer ?? true;
  }

  // ----------------------------------------------------------
  // Pickup sound helper (pickup-only here; fire/reload are played by Player)
  // ----------------------------------------------------------
  playPickupSound() {
    // No sound key? Nothing to play.
    if (!this.pickupSoundKey) return;

    // Scene or sound manager missing? Just bail.
    if (!this.scene || !this.scene.sound) return;

    // If audio cache exists, only play if loaded (prevents console spam on bad paths).
    if (
      this.scene.cache &&
      this.scene.cache.audio &&
      !this.scene.cache.audio.exists(this.pickupSoundKey)
    ) {
      return;
    }

    // Clamp volume into [0..1]
    const vol = Math.max(0, Math.min(1, Number(this.pickupSoundVolume ?? 1)));

    // Rate must be > 0
    const rate = Math.max(0.01, Number(this.pickupSoundRate ?? 1));

    // One-shot play
    this.scene.sound.play(this.pickupSoundKey, { volume: vol, rate: rate });
  }

  // ----------------------------------------------------------
  // Collect behavior
  // ----------------------------------------------------------
  onCollect(player) {
    // 1) Pickup sound (immediate)
    this.playPickupSound();

    // 2) Equip the gun on the player
    if (player && typeof player.equipGun === "function") {
      player.equipGun(this);
    }

    // Respawn is handled by PowerUp.tryCollect() via respawnDelaySec.
  }
}

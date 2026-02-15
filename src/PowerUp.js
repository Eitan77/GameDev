// ============================================================
// PowerUp.js
// - Base class for anything the player can pick up
// - Supports pickup sizing via pickupWpx/pickupHpx OR pickupScale
//
// NEW (respawn support):
// - If opts.respawnDelaySec is set (number > 0),
//   then the powerup will re-appear after that many seconds.
// - We keep the PowerUp object in the GameScene list; we only
//   destroy the sprite temporarily and recreate it on respawn.
// ============================================================

class PowerUp {
  /**
   * @param {object} opts
   * @param {Phaser.Scene} opts.scene
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {string} opts.pickupImageKey
   * @param {number} [opts.pickupRadiusPx=60]
   * @param {number} [opts.depth=20]
   *
   * Pickup sizing (optional):
   * @param {number} [opts.pickupWpx]   // exact display width in px
   * @param {number} [opts.pickupHpx]   // exact display height in px
   * @param {number} [opts.pickupScale] // uniform scale (used only if w/h not provided)
   *
   * Respawn (optional):
   * @param {number|null} [opts.respawnDelaySec=null] // seconds; if set -> respawns
   */
  constructor(opts) {
    // Safety: require opts
    if (!opts) {
      throw new Error(
        "PowerUp constructor got no opts. Use: new PowerUp({ scene, x, y, pickupImageKey, ... })"
      );
    }

    // Save scene + position
    this.scene = opts.scene;
    this.x = opts.x;
    this.y = opts.y;

    // Save pickup behavior
    this.pickupRadiusPx = opts.pickupRadiusPx ?? 60;
    this.collected = false;

    // Save sprite setup so we can RECREATE the sprite on respawn
    this.pickupImageKey = opts.pickupImageKey;
    this.depth = opts.depth ?? 20;

    // Save sizing info so respawns match the original size
    this.pickupWpx = opts.pickupWpx;
    this.pickupHpx = opts.pickupHpx;
    this.pickupScale = opts.pickupScale;

    // NEW: respawn support (null/undefined = no respawn)
    this.respawnDelaySec =
      Number.isFinite(opts.respawnDelaySec) ? opts.respawnDelaySec : null;

    // Timer handle so we can cancel/replace if needed
    this.respawnTimer = null;

    // Create the sprite right away (visible at start)
    this.sprite = null;
    this.createPickupSprite();
  }

  // ----------------------------------------------------------
  // Sprite creation helper (used on initial spawn AND respawn)
  // ----------------------------------------------------------
  createPickupSprite() {
    // If a sprite already exists, destroy it first (safety)
    if (this.sprite) {
      this.sprite.destroy();
      this.sprite = null;
    }

    // Create sprite
    this.sprite = this.scene.add.image(this.x, this.y, this.pickupImageKey);

    // Center origin
    this.sprite.setOrigin(0.5, 0.5);

    // Depth so it renders above the map
    this.sprite.setDepth(this.depth);

    // Apply sizing rules (same logic as before)
    const w = this.pickupWpx;
    const h = this.pickupHpx;

    const hasWH =
      Number.isFinite(w) &&
      Number.isFinite(h) &&
      w > 0 &&
      h > 0;

    if (hasWH) {
      // Exact size in pixels
      this.sprite.setDisplaySize(w, h);
    } else if (Number.isFinite(this.pickupScale) && this.pickupScale > 0) {
      // Uniform scale
      this.sprite.setScale(this.pickupScale);
    }
  }

  // ----------------------------------------------------------
  // Optional per-frame behavior
  // ----------------------------------------------------------
  update(_dt) {}

  // ----------------------------------------------------------
  // Respawn scheduling
  // ----------------------------------------------------------
  scheduleRespawnIfEnabled() {
    // No respawn requested? Do nothing.
    if (!Number.isFinite(this.respawnDelaySec) || this.respawnDelaySec <= 0) return;

    // Scene time system is required
    if (!this.scene || !this.scene.time) return;

    // Cancel any existing respawn timer (prevents stacking)
    if (this.respawnTimer) {
      this.respawnTimer.remove(false);
      this.respawnTimer = null;
    }

    // Convert seconds -> ms
    const delayMs = this.respawnDelaySec * 1000;

    // Schedule respawn
    this.respawnTimer = this.scene.time.delayedCall(delayMs, () => {
      // Make the powerup available again
      this.collected = false;

      // Recreate the sprite so it appears again
      this.createPickupSprite();

      // Clear timer handle
      this.respawnTimer = null;
    });
  }

  // ----------------------------------------------------------
  // Try to collect the powerup
  // ----------------------------------------------------------
  tryCollect(player) {
    // If already collected, we can't collect it again yet
    if (this.collected) return false;

    // Must have a player sprite to measure distance
    if (!player || !player.sprite) return false;

    // Must have a pickup sprite currently visible to collect
    if (!this.sprite) return false;

    // Distance check
    const dx = player.sprite.x - this.sprite.x;
    const dy = player.sprite.y - this.sprite.y;
    const r = this.pickupRadiusPx;

    // Outside pickup radius? no collect
    if (dx * dx + dy * dy > r * r) return false;

    // Mark collected
    this.collected = true;

    // Run child behavior (equip gun, play sounds, etc.)
    this.onCollect(player);

    // Remove sprite (so it's gone from the world for now)
    this.sprite.destroy();
    this.sprite = null;

    // NEW: schedule respawn if enabled
    this.scheduleRespawnIfEnabled();

    return true;
  }

  // Override in subclasses
  onCollect(_player) {}

  // ----------------------------------------------------------
  // Permanent destroy (if you ever want to remove it completely)
  // ----------------------------------------------------------
  destroy() {
    // Mark collected so it can't be picked up
    this.collected = true;

    // Cancel respawn timer
    if (this.respawnTimer) {
      this.respawnTimer.remove(false);
      this.respawnTimer = null;
    }

    // Destroy sprite if it exists
    if (this.sprite) {
      this.sprite.destroy();
      this.sprite = null;
    }
  }
}

export default PowerUp;
export { PowerUp };

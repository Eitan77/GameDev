// ============================================================
// SniperGunPowerUp.js (FULL FILE)
// - One subclass per gun
// - Loads images + audio + defines pickup + held settings
// - NEW: includes pickup/fire/reload sounds + timing + volume/speed parameters
// ============================================================

import GunPowerUp from "./GunPowerUp.js";

export default class SniperGunPowerUp extends GunPowerUp {
  // --------------------------
  // Image keys
  // --------------------------
  static PICKUP_KEY = "sniper_pickup";
  static HELD_KEY = "sniper_held";

  // Change these to your real image files
  static PICKUP_PATH = "assets/images/sniper_pickup.png";
  static HELD_PATH = "assets/images/sniper_held.png";

  // --------------------------
  // Sound keys
  // --------------------------
  static PICKUP_SND_KEY = "sniper_pickup_snd";
  static FIRE_SND_KEY = "sniper_fire_snd";
  static RELOAD_SND_KEY = "sniper_reload_snd";

  // Change these to your real audio files (wav/mp3/ogg)
  static PICKUP_SND_PATH = "assets/audio/sniper_pickup.mp3";
  static FIRE_SND_PATH = "assets/audio/sniper_fire.mp3";
  static RELOAD_SND_PATH = "assets/audio/sniper_reload.mp3";

  /**
   * Call in GameScene.preload()
   * @param {Phaser.Scene} scene
   */
  static preload(scene) {
    // --------------------------
    // Images
    // --------------------------
    scene.load.image(SniperGunPowerUp.PICKUP_KEY, SniperGunPowerUp.PICKUP_PATH);
    scene.load.image(SniperGunPowerUp.HELD_KEY, SniperGunPowerUp.HELD_PATH);

    // --------------------------
    // Audio
    // --------------------------
    // If any path is wrong, your GameScene loaderror handler will log it.
    scene.load.audio(SniperGunPowerUp.PICKUP_SND_KEY, SniperGunPowerUp.PICKUP_SND_PATH);
    scene.load.audio(SniperGunPowerUp.FIRE_SND_KEY, SniperGunPowerUp.FIRE_SND_PATH);
    scene.load.audio(SniperGunPowerUp.RELOAD_SND_KEY, SniperGunPowerUp.RELOAD_SND_PATH);
  }

  constructor(opts) {
    // If the image paths are wrong, Phaser won't have the texture.
    // Use a safe fallback so your game doesn't black-screen.
    const pickupKey = opts.scene.textures.exists(SniperGunPowerUp.PICKUP_KEY)
      ? SniperGunPowerUp.PICKUP_KEY
      : "arm";

    const heldKey = opts.scene.textures.exists(SniperGunPowerUp.HELD_KEY)
      ? SniperGunPowerUp.HELD_KEY
      : "arm";

    // If the audio files failed to load, cache.audio.exists(key) will be false.
    // We still pass the keys in; the play helpers will safely skip if missing.
    super({
      scene: opts.scene,
      x: opts.x,
      y: opts.y,

      // --------------------------
      // Pickup sprite (ground)
      // --------------------------
      pickupImageKey: pickupKey,
      pickupWpx: 160,
      pickupHpx: 48,
      pickupRadiusPx: 80,

      // --------------------------
      // Stats
      // --------------------------
      gunId: "sniper",
      ammo: 5,
      damage: 80,

      // --------------------------
      // Sounds (settable per gun)
      // --------------------------
      pickupSoundKey: SniperGunPowerUp.PICKUP_SND_KEY,
      pickupSoundVolume: 0.7,
      pickupSoundRate: 1.0,

      fireSoundKey: SniperGunPowerUp.FIRE_SND_KEY,
      fireSoundVolume: 0.5,
      fireSoundRate: 0.8,

      reloadSoundKey: SniperGunPowerUp.RELOAD_SND_KEY,
      reloadSoundVolume: 0.8,
      reloadSoundRate: 1,

      // Delay between FIRE and RELOAD (seconds)
      fireToReloadDelaySec: 0.5,

      // --------------------------
      // Held sprite (in hand)
      // --------------------------
      heldImageKey: heldKey,
      heldWpx: 160,
      heldHpx: 48,
      heldOriginX: 0.19,
      heldOriginY: 0.8,
      heldDepth: 5,

      // Positioning relative to the arm/hand
      heldAlongArmOffsetPx: -12,
      heldSideOffsetPx: 0,

      // Rotate the art if needed (try 0, Math.PI/2, -Math.PI/2)
      heldAngleOffsetRad: Math.PI / 2,

      // --- Facing behavior ---
      // NOTE: your current Player only supports heldFlipWithPlayer.
      // These extra props are harmless if you aren't using them yet.
      heldFacingBehavior: "flipY",
      heldFacingInvert: false
    });

    // --------------------------
    // Hitscan beam (visual) settings
    // --------------------------
    // These are read by Player.equipGun() and control the beam effect.
    //
    // NOTE: bulletMuzzleNormX/Y are normalized (0..1) on the UNFLIPPED held gun image.
    // If the beam doesn't start exactly at the barrel tip, tweak these numbers.
    this.bulletEnabled = true;

    // Beam thickness (pixels)
    this.bulletWidthPx = 10;

    // How long the wipe lasts (seconds)
    this.bulletLifetimeSec = 0.05;

    // Max distance (pixels)
    this.bulletMaxDistancePx = 2200;

    // Beam color (0xRRGGBB)
    this.bulletColor = 0xffffff;

    // How long the fading tail is behind the wipe (pixels)
    this.bulletTailLengthPx = 200;

    // Where on the gun image the beam starts (normalized 0..1)
    this.bulletMuzzleNormX = 0.98;
    this.bulletMuzzleNormY = 0.5;
  }
}

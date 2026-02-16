// ============================================================
// src/gunCatalog.js
// Client-side gun definitions (must match server).
// Uses SAME keys/paths/values you had in SniperGunPowerUp.
// ============================================================

export const GUN_CATALOG = {
  sniper: {
    id: "sniper",

    // pickup sprite (ground)
    pickupKey: "sniper_pickup",
    pickupPath: "assets/images/sniper_pickup.png",
    pickupWpx: 160,
    pickupHpx: 48,

    // held sprite (hand)
    heldKey: "sniper_held",
    heldPath: "assets/images/sniper_held.png",
    heldWpx: 160,
    heldHpx: 48,
    heldDepth: 7,
    heldOriginX: 0.19,
    heldOriginY: 0.8,
    heldAlongArmOffsetPx: -12,
    heldSideOffsetPx: 0,
    heldAngleOffsetRad: Math.PI / 2,
    heldFlipWithPlayer: true,

    // ammo
    ammo: 5,

    // damage per hit (server authoritative)
    damage: 50,

    // sounds
    pickupSoundKey: "sniper_pickup_snd",
    pickupSoundPath: "assets/audio/sniper_pickup.mp3",
    pickupSoundVolume: 0.7,
    pickupSoundRate: 1.0,

    fireSoundKey: "sniper_fire_snd",
    fireSoundPath: "assets/audio/sniper_fire.mp3",
    fireSoundVolume: 0.5,
    fireSoundRate: 0.8,

    reloadSoundKey: "sniper_reload_snd",
    reloadSoundPath: "assets/audio/sniper_reload.mp3",
    reloadSoundVolume: 0.8,
    reloadSoundRate: 1.0,

    fireToReloadDelaySec: 0.5,

    // hitscan beam visuals (client renders what server tells it, but values match)
    bulletEnabled: true,
    bulletWidthPx: 10,
    bulletLifetimeSec: 0.05,
    bulletMaxDistancePx: 2200,
    bulletColor: 0xffffff,
    bulletTailLengthPx: 200,
    bulletMuzzleNormX: 0.98,
    bulletMuzzleNormY: 0.5,

    // pickup behavior
    pickupRadiusPx: 80,
    respawnSec: 6,
  },
};

export function preloadGuns(scene) {
  for (const g of Object.values(GUN_CATALOG)) {
    scene.load.image(g.pickupKey, g.pickupPath);
    scene.load.image(g.heldKey, g.heldPath);

    // audio
    scene.load.audio(g.pickupSoundKey, g.pickupSoundPath);
    scene.load.audio(g.fireSoundKey, g.fireSoundPath);
    scene.load.audio(g.reloadSoundKey, g.reloadSoundPath);
  }
}

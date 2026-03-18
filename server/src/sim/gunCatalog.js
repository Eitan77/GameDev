// gunCatalog.js
// ============================================================
// src/gunCatalog.js
// Client-side gun definitions (must match server).
// ✅ Added deathKnockbackPxPerSec / deathKnockbackUpPxPerSec
// ✅ Added rifle and shotgun
// ============================================================

export const GUN_CATALOG = {
  sniper: {
    id: "sniper",

    pickupKey: "sniper_pickup",
    pickupPath: "assets/images/sniper_pickup.png",
    pickupWpx: 160,
    pickupHpx: 48,

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

    ammo: 2,

    aimRadiusPx: 900,
    autoAimSpeedDegPerSec: 300,

    damage: 120,

    automatic: false,
    timeBetweenShots: 500,

    deathKnockbackPxPerSec: 2000,
    deathKnockbackUpPxPerSec: 160,

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
    shotsPerReload: 1,

    bulletEnabled: true,
    bulletWidthPx: 10,
    bulletLifetimeSec: 0.05,
    bulletMaxDistancePx: 2200,
    bulletColor: 0xffffff,
    bulletTailLengthPx: 200,
    bulletMuzzleNormX: 0.98,
    bulletMuzzleNormY: 0.5,

    pickupRadiusPx: 100,
    respawnSec: 6,
  },

  rifle: {
    id: "rifle",

    // Reuses sniper images until rifle art is ready
    pickupKey: "rifle_pickup",
    pickupPath: "assets/images/rifle_pickup.png",
    pickupWpx: 140,
    pickupHpx: 48,

    heldKey: "rifle_held",
    heldPath: "assets/images/rifle_held.png",
    heldWpx: 140,
    heldHpx: 48,
    heldDepth: 5,
    heldOriginX: 0.21,
    heldOriginY: 0.8,
    heldAlongArmOffsetPx: -12,
    heldSideOffsetPx: 0,
    heldAngleOffsetRad: Math.PI / 2,
    heldFlipWithPlayer: true,

    ammo: 20,

    aimRadiusPx: 600,
    autoAimSpeedDegPerSec: 300,

    damage: 8,

    automatic: true,
    timeBetweenShots: 140,

    deathKnockbackPxPerSec: 1400,
    deathKnockbackUpPxPerSec: 120,

    pickupSoundKey: "sniper_pickup_snd",
    pickupSoundPath: "assets/audio/sniper_pickup.mp3",
    pickupSoundVolume: 0.7,
    pickupSoundRate: 1.2,

    fireSoundKey: "sniper_fire_snd",
    fireSoundPath: "assets/audio/sniper_fire.mp3",
    fireSoundVolume: 0.4,
    fireSoundRate: 1.4,

    reloadSoundKey: "sniper_reload_snd",
    reloadSoundPath: "assets/audio/sniper_reload.mp3",
    reloadSoundVolume: 0.8,
    reloadSoundRate: 1.1,

    fireToReloadDelaySec: 0.3,
    shotsPerReload: 5,

    bulletEnabled: true,
    bulletWidthPx: 8,
    bulletLifetimeSec: 0.05,
    bulletMaxDistancePx: 1600,
    bulletColor: 0xffdd88,
    bulletTailLengthPx: 140,
    bulletMuzzleNormX: 0.98,
    bulletMuzzleNormY: 0.5,

    pickupRadiusPx: 100,
    respawnSec: 8,
  },

  shotgun: {
    id: "shotgun",

    // Reuses sniper images until shotgun art is ready
    pickupKey: "shotgun_pickup",
    pickupPath: "assets/images/shotgun_pickup.png",
    pickupWpx: 140,
    pickupHpx: 40,

    heldKey: "shotgun_held",
    heldPath: "assets/images/shotgun_held.png",
    heldWpx: 140,
    heldHpx: 40,
    heldDepth: 5,
    heldOriginX: 0.22,
    heldOriginY: 0.8,
    heldAlongArmOffsetPx: -12,
    heldSideOffsetPx: 0,
    heldAngleOffsetRad: Math.PI / 2,
    heldFlipWithPlayer: true,

    ammo: 4,

    aimRadiusPx: 350,
    autoAimSpeedDegPerSec: 300,

    damage: 50,

    automatic: false,
    timeBetweenShots: 700,

    deathKnockbackPxPerSec: 3000,
    deathKnockbackUpPxPerSec: 300,

    pickupSoundKey: "sniper_pickup_snd",
    pickupSoundPath: "assets/audio/sniper_pickup.mp3",
    pickupSoundVolume: 0.8,
    pickupSoundRate: 0.8,

    fireSoundKey: "sniper_fire_snd",
    fireSoundPath: "assets/audio/sniper_fire.mp3",
    fireSoundVolume: 0.5,
    fireSoundRate: 0.5,

    reloadSoundKey: "sniper_reload_snd",
    reloadSoundPath: "assets/audio/sniper_reload.mp3",
    reloadSoundVolume: 0.9,
    reloadSoundRate: 0.8,

    fireToReloadDelaySec: 0.8,
    shotsPerReload: 1,

    bulletEnabled: true,
    bulletWidthPx: 14,
    bulletLifetimeSec: 0.04,
    bulletMaxDistancePx: 800,
    bulletColor: 0xff8800,
    bulletTailLengthPx: 80,
    bulletMuzzleNormX: 0.98,
    bulletMuzzleNormY: 0.5,

    pickupRadiusPx: 100,
    respawnSec: 10,
  },
};

export function preloadGuns(scene) {
  const loadedKeys = new Set();
  for (const g of Object.values(GUN_CATALOG)) {
    if (!loadedKeys.has(g.pickupKey)) {
      scene.load.image(g.pickupKey, g.pickupPath);
      loadedKeys.add(g.pickupKey);
    }
    if (!loadedKeys.has(g.heldKey)) {
      scene.load.image(g.heldKey, g.heldPath);
      loadedKeys.add(g.heldKey);
    }

    scene.load.audio(g.pickupSoundKey, g.pickupSoundPath);
    scene.load.audio(g.fireSoundKey, g.fireSoundPath);
    scene.load.audio(g.reloadSoundKey, g.reloadSoundPath);
  }
}
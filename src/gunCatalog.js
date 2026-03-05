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

    ammo: 50,

    aimRadiusPx: 900,
    autoAimSpeedDegPerSec: 300,

    damage: 5,

    // --------------------
    // Fire behavior
    // --------------------
    // If true: holding the fire button will continuously fire.
    // If false: you must release and re-press (semi-auto behavior).
    automatic: true,

    // Minimum milliseconds between shots (server authoritative).
    timeBetweenShots: 60,

    // ✅ Death-only knockback (ONLY applied if this hit kills)
    deathKnockbackPxPerSec: 2000,     // main push strength
    deathKnockbackUpPxPerSec: 160,    // extra upward pop (optional)

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

    pickupKey: "rifle_pickup",
    pickupPath: "assets/images/rifle_pickup.png",
    pickupWpx: 140,
    pickupHpx: 48,

    heldKey: "rifle_held",
    heldPath: "assets/images/rifle_held.png",
    heldWpx: 140,
    heldHpx: 48,
    heldDepth: 7,
    heldOriginX: 0.19,
    heldOriginY: 0.8,
    heldAlongArmOffsetPx: -12,
    heldSideOffsetPx: 0,
    heldAngleOffsetRad: Math.PI / 2,
    heldFlipWithPlayer: true,

    ammo: 30,

    aimRadiusPx: 600,
    autoAimSpeedDegPerSec: 300,

    damage: 3,

    // Fast automatic fire
    automatic: true,
    timeBetweenShots: 100,

    deathKnockbackPxPerSec: 1400,
    deathKnockbackUpPxPerSec: 120,

    // Reuse sniper sounds
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

    pickupKey: "shotgun_pickup",
    pickupPath: "assets/images/shotgun_pickup.png",
    pickupWpx: 140,
    pickupHpx: 48,

    heldKey: "shotgun_held",
    heldPath: "assets/images/shotgun_held.png",
    heldWpx: 140,
    heldHpx: 48,
    heldDepth: 7,
    heldOriginX: 0.19,
    heldOriginY: 0.8,
    heldAlongArmOffsetPx: -12,
    heldSideOffsetPx: 0,
    heldAngleOffsetRad: Math.PI / 2,
    heldFlipWithPlayer: true,

    ammo: 10,

    aimRadiusPx: 350,
    autoAimSpeedDegPerSec: 300,

    damage: 12,

    // Slow semi-auto: must re-press between shots
    automatic: false,
    timeBetweenShots: 700,

    deathKnockbackPxPerSec: 3000,
    deathKnockbackUpPxPerSec: 300,

    // Reuse sniper sounds (pitched down for a heavier feel)
    pickupSoundKey: "sniper_pickup_snd",
    pickupSoundPath: "assets/audio/sniper_pickup.mp3",
    pickupSoundVolume: 0.8,
    pickupSoundRate: 0.8,

    fireSoundKey: "sniper_fire_snd",
    fireSoundPath: "assets/audio/sniper_fire.mp3",
    fireSoundVolume: 0.9,
    fireSoundRate: 0.5,

    reloadSoundKey: "sniper_reload_snd",
    reloadSoundPath: "assets/audio/sniper_reload.mp3",
    reloadSoundVolume: 0.9,
    reloadSoundRate: 0.8,

    fireToReloadDelaySec: 0.8,

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
  for (const g of Object.values(GUN_CATALOG)) {
    scene.load.image(g.pickupKey, g.pickupPath);
    scene.load.image(g.heldKey, g.heldPath);

    scene.load.audio(g.pickupSoundKey, g.pickupSoundPath);
    scene.load.audio(g.fireSoundKey, g.fireSoundPath);
    scene.load.audio(g.reloadSoundKey, g.reloadSoundPath);
  }
}
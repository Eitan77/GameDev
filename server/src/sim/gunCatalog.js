// ============================================================
// server/src/sim/gunCatalog.js
// Server gun defs MUST match client gunCatalog.js
// ============================================================

export const GUN_CATALOG = {
  sniper: {
    id: "sniper",
    ammo: 5,

    pickupRadiusPx: 80,
    respawnSec: 6,

    fireSoundKey: "sniper_fire_snd",
    fireSoundVolume: 0.5,
    fireSoundRate: 0.8,

    reloadSoundKey: "sniper_reload_snd",
    reloadSoundVolume: 0.8,
    reloadSoundRate: 1.0,

    pickupSoundKey: "sniper_pickup_snd",
    pickupSoundVolume: 0.7,
    pickupSoundRate: 1.0,

    fireToReloadDelaySec: 0.5,

    // Held visuals used for exact muzzle math
    heldWpx: 160,
    heldHpx: 48,
    heldOriginX: 0.19,
    heldOriginY: 0.8,
    heldAlongArmOffsetPx: -12,
    heldSideOffsetPx: 0,
    heldAngleOffsetRad: Math.PI / 2,
    heldFlipWithPlayer: true,

    // Hitscan visuals (sent to client)
    bulletEnabled: true,
    bulletWidthPx: 10,
    bulletLifetimeSec: 0.05,
    bulletMaxDistancePx: 2200,
    bulletColor: 0xffffff,
    bulletTailLengthPx: 200,
    bulletMuzzleNormX: 0.98,
    bulletMuzzleNormY: 0.5,
  },
};

export default GUN_CATALOG;

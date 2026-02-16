// ============================================================
// SniperGunPowerUp.js
// CLIENT: render-only pickup view for the "sniper" gun.
//
// Keeping this as a subclass makes it easy to add per-gun
// special rendering later (glow, idle bobbing, etc.).
// ============================================================

import GunPowerUp from "./GunPowerUp.js";

export default class SniperGunPowerUp extends GunPowerUp {
  constructor(opts) {
    super({
      scene: opts.scene,
      x: opts.x,
      y: opts.y,
      gunId: "sniper",
    });
  }
}

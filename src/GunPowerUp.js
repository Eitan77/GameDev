// ============================================================
// GunPowerUp.js
// CLIENT: render-only view for a gun pickup.
//
// The server decides:
// - when the pickup is active
// - who picked it up
// - when it respawns
// - when sounds should trigger
//// The client just mirrors the server state.
// ============================================================

import PowerUp from "./PowerUp.js";
import { GUN_CATALOG } from "./gunCatalog.js";

export default class GunPowerUp extends PowerUp {
  /**
   * @param {object} opts
   * @param {Phaser.Scene} opts.scene
   * @param {string} opts.gunId
   * @param {number} opts.x
   * @param {number} opts.y
   */
  constructor(opts) {
    const gunId = String(opts?.gunId || "");
    const def = GUN_CATALOG[gunId];
    if (!def) {
      throw new Error(`GunPowerUp: unknown gunId '${gunId}'. Add it to gunCatalog.js`);
    }

    super({
      scene: opts.scene,
      x: opts.x,
      y: opts.y,
      textureKey: def.pickupKey,
      wpx: def.pickupWpx,
      hpx: def.pickupHpx,
      depth: 2,
    });

    this.gunId = gunId;
  }
}

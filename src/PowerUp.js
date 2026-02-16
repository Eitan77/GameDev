// ============================================================
// PowerUp.js
// CLIENT: render-only power-up view.
//
// IMPORTANT:
// - No collision checks.
// - No respawn timers.
// - No game logic.
//
// Server is authoritative for pickup + respawn.
// Client only mirrors server state (x/y/active).
// ============================================================

export default class PowerUp {
  /**
   * @param {object} opts
   * @param {Phaser.Scene} opts.scene
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {string} opts.textureKey
   * @param {number} [opts.wpx]
   * @param {number} [opts.hpx]
   * @param {number} [opts.depth=2]
   */
  constructor(opts) {
    if (!opts?.scene) throw new Error("PowerUp requires { scene, ... }");
    if (!opts?.textureKey) throw new Error("PowerUp requires { textureKey }");

    this.scene = opts.scene;
    this.sprite = this.scene.add.sprite(Number(opts.x) || 0, Number(opts.y) || 0, opts.textureKey);
    this.sprite.setDepth(Number.isFinite(opts.depth) ? opts.depth : 2);

    const w = Number(opts.wpx);
    const h = Number(opts.hpx);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      this.sprite.setDisplaySize(w, h);
    }
  }

  setPosition(x, y) {
    if (!this.sprite) return;
    this.sprite.x = Number(x) || 0;
    this.sprite.y = Number(y) || 0;
  }

  setActive(active) {
    if (!this.sprite) return;
    this.sprite.setVisible(!!active);
  }

  // Sync from a Colyseus PowerUpState (type/x/y/active)
  syncFromState(state) {
    if (!state) return;
    this.setPosition(state.x, state.y);
    this.setActive(state.active);
  }

  // Apply only the changed fields (reduces work when patching)
  applyStateChanges(changes, fullState) {
    if (!this.sprite) return;

    for (const ch of changes || []) {
      const k = ch?.field;
      if (!k) continue;
      const v = ("value" in ch) ? ch.value : fullState?.[k];

      if (k === "x") this.sprite.x = Number(v) || 0;
      else if (k === "y") this.sprite.y = Number(v) || 0;
      else if (k === "active") this.sprite.setVisible(!!v);
    }
  }

  destroy() {
    if (this.sprite) {
      this.sprite.destroy();
      this.sprite = null;
    }
  }
}

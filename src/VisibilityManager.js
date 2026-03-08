// ============================================================
// VisibilityManager.js
//
// Prevents audio/event catch-up when a browser tab is restored.
//
// Problem: while the tab is hidden, the browser queues WebSocket
// messages. When the tab regains focus, all those "sound" and
// "shot" callbacks fire in the same frame, stacking dozens of
// sounds on top of each other.
//
// Solution (Page Visibility API — industry standard):
//   1. On hide  → mute Phaser's sound manager immediately.
//   2. On show  → stopAll() to kill any sounds that fired during
//                 the catch-up burst, then unmute.
//   3. canPlay()→ lets callers opt out of sounds while hidden,
//                 so one-shot sounds don't accumulate at all.
// ============================================================

export default class VisibilityManager {
  /**
   * @param {Phaser.Scene} scene  Any live Phaser scene (needs scene.sound).
   */
  constructor(scene) {
    this._scene   = scene;
    this._hidden  = document.hidden;

    this._handler = () => this._onChange();
    document.addEventListener("visibilitychange", this._handler);

    // If the page started hidden (rare but possible), apply immediately.
    if (this._hidden) this._applyHidden();
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /** Returns true only when the tab is visible and safe to play sounds. */
  canPlay() {
    return !this._hidden;
  }

  /** Undo listeners and release references. Call from scene cleanup(). */
  destroy() {
    document.removeEventListener("visibilitychange", this._handler);
    this._handler = null;
    this._scene   = null;
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  _onChange() {
    const hidden = document.hidden;
    if (hidden === this._hidden) return;
    this._hidden = hidden;

    if (hidden) {
      this._applyHidden();
    } else {
      this._applyVisible();
    }
  }

  _applyHidden() {
    try {
      // Silence everything instantly; sounds keep "playing" but are silent.
      this._scene.sound.setMute(true);
    } catch (_) {}
  }

  _applyVisible() {
    try {
      // Kill every sound that accumulated during the catch-up event burst.
      this._scene.sound.stopAll();
    } catch (_) {}
    try {
      // Now safe to re-enable audio.
      this._scene.sound.setMute(false);
    } catch (_) {}
  }
}

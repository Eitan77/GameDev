// InterimScene.js
// =============================================================
// Shown between MatchmakingScene and GameScene.
//
// Responsibilities:
//   1. Load ALL game assets (so GameScene.preload() is a no-op).
//   2. Display the ranking-board background (InterimScreen.png).
//   3. Place each connected player's head image in the correct
//      gold frame, centred across the four slots.
//   4. Wait at least MIN_DISPLAY_MS, then hand off to GameScene.
// =============================================================

import Phaser from "phaser";
import GameMap  from "./GameMap.js";
import { preloadGuns } from "./gunCatalog.js";

// How long to show the screen (ms). Assets must ALSO be done before
// we move on — whichever takes longer wins.
const MIN_DISPLAY_MS = 3000;

// ── Frame geometry (measured from the 1600×800 InterimScreen.png) ──
// White-rectangle centres and inner size in image-pixels.
// The canvas is also 1600×800, so these are direct screen coords.
const FRAMES = [
  { x: 248,  y: 397 },
  { x: 616,  y: 397 },
  { x: 983,  y: 397 },
  { x: 1351, y: 396 },
];
const FRAME_INNER_W = 227;
const FRAME_INNER_H = 269;

export default class InterimScene extends Phaser.Scene {
  constructor() {
    super("InterimScene");

    this._room        = null;
    this._client      = null;
    this._username    = "Player";
    this._playerCount = 1;

    this._assetsReady  = false;
    this._timerDone    = false;
    this._transitioning = false;
  }

  init(data) {
    this._room        = data?.room     ?? null;
    this._client      = data?.client   ?? null;
    this._username    = data?.username ?? "Player";
    // Clamp to [1, 4]
    this._playerCount = Math.max(1, Math.min(4, Number(data?.playerCount) || 1));
  }

  // -------------------------------------------------------------------
  // preload — load ALL game assets here so GameScene.preload is a no-op
  // -------------------------------------------------------------------
  preload() {
    // Interim-screen assets
    this.load.image("interim_bg",   "assets/images/InterimScreen.png");
    this.load.image("player_head",  "assets/images/PlayerHead.png");

    // GameScene assets
    this.load.image("player",      "assets/images/player.png");
    this.load.image("arm",         "assets/images/arm.png");
    this.load.image("checkpoint",  "assets/images/checkpoint.png");

    GameMap.preload(this);
    preloadGuns(this);

    // Progress bar on the background colour while assets load
    const W = this.scale.width;
    const H = this.scale.height;

    const barBg = this.add.rectangle(W / 2, H - 32, W * 0.5, 12, 0x2d3342).setDepth(10);
    const bar   = this.add.rectangle(W / 2 - (W * 0.25), H - 32, 0, 10, 0x88aaff).setDepth(11).setOrigin(0, 0.5);

    this.load.on("progress", (value) => {
      bar.width = W * 0.5 * value;
    });

    this.load.on("complete", () => {
      barBg.destroy();
      bar.destroy();
      this._assetsReady = true;
      this._tryTransition();
    });
  }

  // -------------------------------------------------------------------
  // create — show the board; start the minimum-display timer
  // -------------------------------------------------------------------
  create() {
    const W = this.scale.width;   // 1600
    const H = this.scale.height;  // 800

    // ── Background ──
    this.add.image(0, 0, "interim_bg").setOrigin(0, 0);

    // ── Player heads, centred across the four frames ──
    // E.g. 2 players → offset = floor((4-2)/2) = 1 → slots 1 and 2
    const offset = Math.floor((4 - this._playerCount) / 2);

    for (let i = 0; i < this._playerCount; i++) {
      const slot  = offset + i;
      const frame = FRAMES[slot];

      const head  = this.add.image(frame.x, frame.y, "player_head");

      // Scale uniformly to fill the white rectangle (no cropping)
      const scale = Math.min(
        FRAME_INNER_W / head.width,
        FRAME_INNER_H / head.height
      );
      head.setScale(scale);
    }

    // ── Minimum-display timer ──
    this.time.delayedCall(MIN_DISPLAY_MS, () => {
      this._timerDone = true;
      this._tryTransition();
    });

    // Edge-case: preload() already finished before create() ran
    // (happens when all assets were already cached by a previous run).
    if (!this.load.isLoading()) {
      this._assetsReady = true;
    }
    this._tryTransition();
  }

  // -------------------------------------------------------------------
  _tryTransition() {
    if (!this._assetsReady || !this._timerDone) return;
    if (this._transitioning) return;
    this._transitioning = true;

    this.scene.start("GameScene", {
      room:     this._room,
      client:   this._client,
      username: this._username,
    });
  }
}
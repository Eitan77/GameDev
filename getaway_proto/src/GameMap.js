// ============================================================
// GameMap.js (FULL FILE)
// - Owns: tilemap + background + ground layer + planck static colliders + walls
// - Goal: keep GameScene small and multiplayer-ready
// ============================================================

import planck from "planck";

const pl = planck;
const Vec2 = pl.Vec2;

// ============================================================
// SMALL HELPERS
// ============================================================

function pxToM(px, ppm) {
  return px / ppm;
}

// ============================================================
// GAME MAP CLASS
// ============================================================

export default class GameMap {
  /**
   * @param {object} opts
   * @param {Phaser.Scene} opts.scene
   * @param {planck.World} opts.world
   * @param {number} opts.ppm
   * @param {string} opts.mapKey - key used in preload for tilemap json
   * @param {string} opts.tilesetNameInTiled - tileset NAME as it appears in Tiled
   * @param {string} opts.tilesetImageKey - Phaser image key used in preload for tileset png
   * @param {string} opts.layerName - tile layer name in Tiled
   * @param {string} opts.bgKey - Phaser image key used in preload for background
   * @param {number} opts.groundFriction
   * @param {boolean} opts.collideWithAnyNonEmptyTile
   * @param {boolean} opts.wallsEnabled
   * @param {number} opts.wallThicknessPx
   * @param {number} opts.wallFriction
   */
  constructor(opts) {
    // Save references
    this.scene = opts.scene;
    this.world = opts.world;
    this.ppm = opts.ppm;

    // Save tilemap info
    this.mapKey = opts.mapKey;
    this.tilesetNameInTiled = opts.tilesetNameInTiled;
    this.tilesetImageKey = opts.tilesetImageKey;
    this.layerName = opts.layerName;

    // Save background key
    this.bgKey = opts.bgKey;

    // Save physics settings
    this.groundFriction = opts.groundFriction;
    this.collideWithAnyNonEmptyTile = opts.collideWithAnyNonEmptyTile;

    // Save walls settings
    this.wallsEnabled = opts.wallsEnabled;
    this.wallThicknessPx = opts.wallThicknessPx;
    this.wallFriction = opts.wallFriction;

    // Public outputs (filled in by build())
    this.map = null;
    this.tileset = null;
    this.groundLayer = null;
    this.bg = null;

    // Planck bodies (filled in by buildColliders())
    this.groundBody = null;
    this.wallBodies = []; // store wall bodies so you could destroy later if needed

    // World size (pixels)
    this.worldWpx = 0;
    this.worldHpx = 0;
  }

  // ==========================================================
  // BUILD VISUALS (tilemap, layer, background)
  // ==========================================================

  buildVisuals() {
    // Create the tilemap from the key
    this.map = this.scene.make.tilemap({ key: this.mapKey });

    // Connect the tileset from Tiled name -> Phaser image key
    this.tileset = this.map.addTilesetImage(this.tilesetNameInTiled, this.tilesetImageKey);

    // If tileset is null, your Tiled tileset name doesn't match
    if (!this.tileset) {
      throw new Error(
        `Tileset not found. In Tiled, tileset name must be "${this.tilesetNameInTiled}".`
      );
    }

    // Save world size in pixels
    this.worldWpx = this.map.widthInPixels;
    this.worldHpx = this.map.heightInPixels;

    // Add background image at top-left
    this.bg = this.scene.add.image(0, 0, this.bgKey).setOrigin(0, 0);

    // Stretch it to map size
    this.bg.setDisplaySize(this.worldWpx, this.worldHpx);

    // Put background behind everything
    this.bg.setDepth(-100);

    // Create the ground layer
    this.groundLayer = this.map.createLayer(this.layerName, this.tileset, 0, 0);

    // If layer is null, your Tiled layer name doesn't match
    if (!this.groundLayer) {
      throw new Error(
        `Layer not found. In Tiled, your layer must be named "${this.layerName}".`
      );
    }

    // Draw ground above background
    this.groundLayer.setDepth(0);
  }

  // ==========================================================
  // BUILD PLANCK COLLIDERS FROM TILE LAYER + WALLS
  // ==========================================================

  buildColliders() {
    // Create one static body for all ground tile fixtures
    this.groundBody = this.world.createBody({ type: "static" });

    // Create one static fixture per collidable tile
    this.groundLayer.forEachTile((tile) => {
      // Skip empty tiles
      if (!tile || tile.index === -1) return;

      // Tiled optional property: tile.properties.collides === true
      const hasCollidesProp = tile.properties && tile.properties.collides === true;

      // Decide if this tile should collide
      const shouldCollide =
        hasCollidesProp || (this.collideWithAnyNonEmptyTile && tile.index !== -1);

      // Skip if not collidable
      if (!shouldCollide) return;

      // Tile dimensions (px)
      const w = tile.width;
      const h = tile.height;

      // Tile center (px)
      const cxPx = tile.pixelX + w / 2;
      const cyPx = tile.pixelY + h / 2;

      // Make a Planck box fixture (meters)
      const fix = this.groundBody.createFixture(
        pl.Box(
          pxToM(w / 2, this.ppm),
          pxToM(h / 2, this.ppm),
          Vec2(pxToM(cxPx, this.ppm), pxToM(cyPx, this.ppm)),
          0
        ),
        { friction: this.groundFriction }
      );

      // IMPORTANT: your Player raycasts look for "ground"
      fix.setUserData("ground");
    });

    // Build border walls if enabled
    if (this.wallsEnabled) {
      this.buildWalls();
    }
  }

  buildWalls() {
    // Clear any previous wall bodies (in case you rebuild)
    this.wallBodies.length = 0;

    // Wall half thickness (meters)
    const wallHalfThickM = pxToM(this.wallThicknessPx / 2, this.ppm);

    // LEFT WALL
    {
      const x = pxToM(this.wallThicknessPx / 2, this.ppm);
      const y = pxToM(this.worldHpx / 2, this.ppm);
      const halfH = pxToM(this.worldHpx / 2, this.ppm);

      const b = this.world.createBody({ type: "static" });

      b.createFixture(pl.Box(wallHalfThickM, halfH, Vec2(x, y), 0), {
        friction: this.wallFriction
      }).setUserData("wall");

      this.wallBodies.push(b);
    }

    // RIGHT WALL
    {
      const x = pxToM(this.worldWpx - this.wallThicknessPx / 2, this.ppm);
      const y = pxToM(this.worldHpx / 2, this.ppm);
      const halfH = pxToM(this.worldHpx / 2, this.ppm);

      const b = this.world.createBody({ type: "static" });

      b.createFixture(pl.Box(wallHalfThickM, halfH, Vec2(x, y), 0), {
        friction: this.wallFriction
      }).setUserData("wall");

      this.wallBodies.push(b);
    }
  }

  // ==========================================================
  // CAMERA BOUNDS HELPER
  // ==========================================================

  /**
   * Returns camera bounds with extra vertical padding
   * @param {number} padYPx
   */
  getCameraBounds(padYPx) {
    return {
      x: 0,
      y: -padYPx,
      w: this.worldWpx,
      h: this.worldHpx + padYPx * 2
    };
  }
}

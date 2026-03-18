// ============================================================
// src/GameMap.js
// CLIENT render-only map.
// - Renders tile layers AND Tiled Image Layers ("imagelayer").
// - Auto-loads images referenced by Image Layers at runtime.
// ============================================================

import Phaser from "phaser";

function flattenTiledLayers(layers, out = []) {
  const arr = Array.isArray(layers) ? layers : [];
  for (const l of arr) {
    if (!l) continue;
    if (l.type === "group" && Array.isArray(l.layers)) {
      flattenTiledLayers(l.layers, out);
    } else {
      out.push(l);
    }
  }
  return out;
}

function dirOf(path) {
  const s = String(path || "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(0, i + 1) : "";
}

function normalizePath(p) {
  const raw = String(p || "").replace(/\\/g, "/");
  const parts = raw.split("/");
  const out = [];
  for (const seg of parts) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

function resolveTiledPath(mapPath, tiledRelPath) {
  const rel = String(tiledRelPath || "").replace(/\\/g, "/");
  if (!rel) return "";

  // absolute URL or absolute-from-root
  if (/^https?:\/\//i.test(rel)) return rel;
  if (rel.startsWith("/")) return rel.slice(1);

  // already looks like a public asset path
  if (rel.startsWith("assets/")) return rel;

  const baseDir = dirOf(mapPath);
  return normalizePath(baseDir + rel);
}

function textureKeyFromPath(p) {
  // stable, safe-ish key based on path
  const s = String(p || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return `tiled_img_${s}`.slice(0, 120);
}

// All map names in the cycle — used to preload all maps at once.
const ALL_MAP_NAMES = ["level1", "level2", "level3"];

export default class GameMap {
  static MAP_KEY = "level1";
  static MAP_PATH = "assets/maps/level1.tmj";

  static TILESET_IMAGE_KEY = "groundTiles";
  static TILESET_IMAGE_PATH = "assets/tiles/ground_tile.png";

  // Preload a specific map, or all maps if mapName is omitted.
  // Image-layer textures are loaded dynamically in create().
  static preload(scene, mapName) {
    if (mapName) {
      scene.load.tilemapTiledJSON(mapName, `assets/maps/${mapName}.tmj`);
    } else {
      for (const name of ALL_MAP_NAMES) {
        scene.load.tilemapTiledJSON(name, `assets/maps/${name}.tmj`);
      }
    }
    scene.load.image(GameMap.TILESET_IMAGE_KEY, GameMap.TILESET_IMAGE_PATH);
  }

  constructor(scene, mapName = "level1") {
    this.scene = scene;
    this.mapKey  = String(mapName || "level1");
    this.mapPath = `assets/maps/${this.mapKey}.tmj`;

    this.map = null;
    this.worldWpx = 0;
    this.worldHpx = 0;

    this._imageLayerSprites = [];
    this._imageLayerDefs = [];
    this._loadingImageLayers = false;
  }

  create() {
    // Build the Phaser tilemap
    this.map = this.scene.make.tilemap({ key: this.mapKey });

    const tilesetNameInMap = this.map.tilesets?.[0]?.name;
    const tileset = tilesetNameInMap
      ? this.map.addTilesetImage(tilesetNameInMap, GameMap.TILESET_IMAGE_KEY)
      : null;

    if (!tileset) {
      console.warn("Tileset not created. Check Tiled tileset name + loaded image key.");
    }

    // World size
    this.worldWpx = this.map.widthInPixels || 0;
    this.worldHpx = this.map.heightInPixels || 0;

    // Render layers in the SAME order as Tiled: image layers + tile layers
    this._renderFromTiledJson(tileset);

    // Camera bounds (same idea as before)
    if (this.worldWpx > 0 && this.worldHpx > 0) {
      this.scene.cameras.main.setBounds(0, 0, this.worldWpx, this.worldHpx);
    }

    return this;
  }

  // ------------------------------------------------------------
  // Renders tile layers AND imagelayers from the raw Tiled JSON
  // ------------------------------------------------------------
  _renderFromTiledJson(tileset) {
    const raw = this.scene.cache.tilemap.get(this.mapKey)?.data;
    const ordered = flattenTiledLayers(raw?.layers || []);

    // clear previous image layers (in case scene restarts)
    for (const s of this._imageLayerSprites) {
      try { s.destroy(); } catch (_) {}
    }
    this._imageLayerSprites = [];
    this._imageLayerDefs = [];

    // First pass:
    // - create tile layers immediately
    // - collect imagelayers (we may need to load textures for them)
    let depth = 0;

    for (const layer of ordered) {
      if (!layer) continue;

      // Respect Tiled visibility
      if (layer.visible === false) {
        depth++;
        continue;
      }

      if (layer.type === "tilelayer") {
        if (tileset) {
          const tl = this.map.createLayer(layer.name, tileset, 0, 0);
          if (tl) {
            tl.setDepth(depth);

            // optional: respect layer opacity
            if (Number.isFinite(layer.opacity)) tl.setAlpha(layer.opacity);
          }
        }
      }

      if (layer.type === "imagelayer") {
        const imgPath = resolveTiledPath(this.mapPath, layer.image);
        const key = textureKeyFromPath(imgPath);

        this._imageLayerDefs.push({
          layer,
          imgPath,
          key,
          depth,
        });
      }

      depth++;
    }

    // Queue-load any imagelayer textures we don't already have
    const toLoad = [];
    for (const d of this._imageLayerDefs) {
      if (!d.imgPath) continue;
      if (!this.scene.textures.exists(d.key)) {
        toLoad.push(d);
      }
    }

    // Spawn any already-loaded image layers now
    this._spawnImageLayers();

    // Load missing textures, then spawn again
    if (toLoad.length > 0 && !this._loadingImageLayers) {
      this._loadingImageLayers = true;

      for (const d of toLoad) {
        this.scene.load.image(d.key, d.imgPath);
      }

      this.scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this._loadingImageLayers = false;
        this._spawnImageLayers();
      });

      this.scene.load.once(Phaser.Loader.Events.LOAD_ERROR, (file) => {
        console.error("Image-layer asset failed to load:", file?.key, file?.src);
      });

      this.scene.load.start();
    }
  }

  // ------------------------------------------------------------
  // Creates Phaser objects for each Tiled imagelayer
  // - uses TileSprite when repeatx/repeaty is enabled
  // ------------------------------------------------------------
  _spawnImageLayers() {
    // Destroy any previously spawned imagelayers
    for (const s of this._imageLayerSprites) {
      try { s.destroy(); } catch (_) {}
    }
    this._imageLayerSprites = [];

    for (const d of this._imageLayerDefs) {
      const l = d.layer;

      if (!this.scene.textures.exists(d.key)) continue;

      const x = (Number(l.x) || 0) + (Number(l.offsetx) || 0);
      const y = (Number(l.y) || 0) + (Number(l.offsety) || 0);

      const alpha = Number.isFinite(l.opacity) ? l.opacity : 1;

      const parX = Number.isFinite(l.parallaxx) ? l.parallaxx : 1;
      const parY = Number.isFinite(l.parallaxy) ? l.parallaxy : 1;

      const repeatX = !!l.repeatx;
      const repeatY = !!l.repeaty;

      let obj = null;

      // If the layer repeats, cover the whole map and offset the tiling
      if (repeatX || repeatY) {
        const w = Math.max(1, this.worldWpx || (Number(l.imagewidth) || 1));
        const h = Math.max(1, this.worldHpx || (Number(l.imageheight) || 1));

        const ts = this.scene.add.tileSprite(0, 0, w, h, d.key);
        ts.setOrigin(0, 0);

        // Anchor tiling so that the texture origin matches the imagelayer's x/y offsets
        ts.tilePositionX = -x;
        ts.tilePositionY = -y;

        obj = ts;
      } else {
        const img = this.scene.add.image(x, y, d.key);
        img.setOrigin(0, 0);
        obj = img;
      }

      obj.setDepth(d.depth);
      obj.setAlpha(alpha);
      obj.setScrollFactor(parX, parY);

      this._imageLayerSprites.push(obj);
    }
  }
}
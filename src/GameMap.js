// ============================================================
// src/GameMap.js
// CLIENT render-only map. Creates ALL tile layers by name.
// ============================================================

export default class GameMap {
  static MAP_KEY = "level1";
  static MAP_PATH = "assets/maps/level1.tmj";

  static TILESET_IMAGE_KEY = "groundTiles";
  static TILESET_IMAGE_PATH = "assets/tiles/ground_tile.png";

  static BG_KEY = "level1_bg";
  static BG_PATH = "assets/images/level1_bg.png";

  static preload(scene) {
    scene.load.tilemapTiledJSON(GameMap.MAP_KEY, GameMap.MAP_PATH);
    scene.load.image(GameMap.TILESET_IMAGE_KEY, GameMap.TILESET_IMAGE_PATH);
    scene.load.image(GameMap.BG_KEY, GameMap.BG_PATH);
  }

  constructor(scene) {
    this.scene = scene;
    this.map = null;
    this.worldWpx = 0;
    this.worldHpx = 0;
  }

  create() {
    const bg = this.scene.add.image(0, 0, GameMap.BG_KEY);
    bg.setOrigin(0, 0);
    bg.setDepth(-100);

    this.map = this.scene.make.tilemap({ key: GameMap.MAP_KEY });

    const tilesetNameInMap = this.map.tilesets?.[0]?.name;
    const tileset = tilesetNameInMap
      ? this.map.addTilesetImage(tilesetNameInMap, GameMap.TILESET_IMAGE_KEY)
      : null;

    if (tileset) {
      const layerNames = (this.map.layers || []).map((l) => l.name).filter(Boolean);
      for (const name of layerNames) {
        const layer = this.map.createLayer(name, tileset, 0, 0);
        if (layer) layer.setDepth(0);
      }
    } else {
      console.warn("Tileset not created. Check Tiled tileset name + loaded image key.");
    }

    this.worldWpx = this.map.widthInPixels || 0;
    this.worldHpx = this.map.heightInPixels || 0;

    if (this.worldWpx > 0 && this.worldHpx > 0) {
      bg.setDisplaySize(this.worldWpx, this.worldHpx);
      this.scene.cameras.main.setBounds(0, 0, this.worldWpx, this.worldHpx);
    }

    return this;
  }
}

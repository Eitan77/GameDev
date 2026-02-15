// ============================================================
// server/src/sim/loadTiledMap.js
// Loads Tiled JSON (.tmj/.json) and builds Planck static colliders
// from a tilelayer using tile property: collides=true
// Also exports helper to read object layer points.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import planck from "planck";

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findExistingPath(pathsToTry) {
  for (const p of pathsToTry) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

function isTileCollidable(tileObj) {
  if (!tileObj || !Array.isArray(tileObj.properties)) return false;
  for (const p of tileObj.properties) {
    const name = String(p.name || "").toLowerCase();
    if (name === "collides" || name === "collide" || name === "collision") return !!p.value;
  }
  return false;
}

function buildCollidableGidSet(mapJson, mapDir) {
  const solid = new Set();
  const tilesets = Array.isArray(mapJson.tilesets) ? mapJson.tilesets : [];

  for (const ts of tilesets) {
    let tsJson = ts;
    const firstgid = Number(ts.firstgid || 1);

    // external tileset file
    if (ts.source) {
      const tsPath = path.join(mapDir, String(ts.source));
      const loaded = safeReadJson(tsPath);
      if (loaded) tsJson = loaded;
    }

    const tiles = Array.isArray(tsJson.tiles) ? tsJson.tiles : [];
    for (const t of tiles) {
      if (!isTileCollidable(t)) continue;
      const id = Number(t.id);
      if (!Number.isFinite(id)) continue;
      solid.add(firstgid + id);
    }
  }

  return solid;
}

function getTileLayer(mapJson, preferredName) {
  const layers = Array.isArray(mapJson.layers) ? mapJson.layers : [];

  if (preferredName) {
    const a = layers.find((l) => l.type === "tilelayer" && l.name === preferredName);
    if (a) return a;
  }

  const common = ["Tile Layer 1", "Ground", "Collision", "Collide", "Platforms"];
  for (const n of common) {
    const b = layers.find((l) => l.type === "tilelayer" && l.name === n);
    if (b) return b;
  }

  return layers.find((l) => l.type === "tilelayer") || null;
}

function getLayerDataAccessor(layer) {
  // finite
  if (Array.isArray(layer.data)) {
    return {
      width: layer.width,
      height: layer.height,
      get: (x, y) => layer.data[y * layer.width + x] || 0,
    };
  }

  // infinite (chunks)
  if (Array.isArray(layer.chunks)) {
    const chunks = layer.chunks;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const c of chunks) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.width);
      maxY = Math.max(maxY, c.y + c.height);
    }

    const width = maxX - minX;
    const height = maxY - minY;

    return {
      width,
      height,
      get: (x, y) => {
        const wx = x + minX;
        const wy = y + minY;

        for (const c of chunks) {
          if (wx >= c.x && wx < c.x + c.width && wy >= c.y && wy < c.y + c.height) {
            const lx = wx - c.x;
            const ly = wy - c.y;
            return c.data[ly * c.width + lx] || 0;
          }
        }
        return 0;
      },
    };
  }

  return null;
}

function mergeSolidTilesToRects(isSolid, width, height) {
  const used = new Uint8Array(width * height);
  const rects = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!isSolid[idx] || used[idx]) continue;

      // expand width
      let rw = 1;
      while (x + rw < width) {
        const i2 = y * width + (x + rw);
        if (!isSolid[i2] || used[i2]) break;
        rw++;
      }

      // expand height
      let rh = 1;
      outer: while (y + rh < height) {
        for (let xx = 0; xx < rw; xx++) {
          const i3 = (y + rh) * width + (x + xx);
          if (!isSolid[i3] || used[i3]) break outer;
        }
        rh++;
      }

      // mark used
      for (let yy = 0; yy < rh; yy++) {
        for (let xx = 0; xx < rw; xx++) {
          used[(y + yy) * width + (x + xx)] = 1;
        }
      }

      rects.push({ x, y, w: rw, h: rh });
    }
  }

  return rects;
}

export function getObjectPoints(mapJson, layerName) {
  const out = [];
  const layers = Array.isArray(mapJson?.layers) ? mapJson.layers : [];
  const objLayer = layers.find((l) => l.type === "objectgroup" && l.name === layerName);
  if (!objLayer || !Array.isArray(objLayer.objects)) return out;

  for (const o of objLayer.objects) {
    const x = Number(o.x);
    const y = Number(o.y);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
  }
  return out;
}

export function loadTiledMapToPlanck({
  world,
  ppm,
  mapFileCandidates,
  tileLayerName = "Tile Layer 1",
  friction = 0.9,
  addBounds = true,
  boundsThicknessPx = 200,
}) {
  const cwd = process.cwd();

  const candidatesAbs = (mapFileCandidates || []).flatMap((p) => {
    if (!p) return [];
    if (path.isAbsolute(p)) return [p];
    return [path.join(cwd, p)];
  });

  const mapPath = findExistingPath(candidatesAbs);
  const mapJson = mapPath ? safeReadJson(mapPath) : null;

  // fallback simple floor if missing
  if (!mapJson) {
    const worldWpx = 4000;
    const worldHpx = 2500;

    const floor = world.createBody({ type: "static" });
    floor.setPosition(planck.Vec2((worldWpx / 2) / ppm, (worldHpx - 60) / ppm));
    const fix = floor.createFixture(planck.Box((worldWpx / ppm) / 2, (80 / ppm) / 2), { friction });
    fix.setUserData("ground");

    return { mapPath: null, mapJson: null, worldWpx, worldHpx };
  }

  const mapDir = path.dirname(mapPath);

  const tileW = Number(mapJson.tilewidth || 32);
  const tileH = Number(mapJson.tileheight || 32);

  const worldWpx = Number(mapJson.width || 0) * tileW;
  const worldHpx = Number(mapJson.height || 0) * tileH;

  const collidable = buildCollidableGidSet(mapJson, mapDir);
  const layer = getTileLayer(mapJson, tileLayerName);

  if (layer) {
    const acc = getLayerDataAccessor(layer);
    if (acc) {
      const { width, height, get } = acc;

      const solid = new Uint8Array(width * height);

      // If collidable set is empty, fall back to "any nonzero tile is solid"
      const useFallbackSolid = collidable.size === 0;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const gid = get(x, y);
          const ok = useFallbackSolid ? (gid !== 0) : collidable.has(gid);
          solid[y * width + x] = ok ? 1 : 0;
        }
      }

      const rects = mergeSolidTilesToRects(solid, width, height);

      for (const r of rects) {
        const cxPx = r.x * tileW + (r.w * tileW) / 2;
        const cyPx = r.y * tileH + (r.h * tileH) / 2;

        const hxM = (r.w * tileW) / (2 * ppm);
        const hyM = (r.h * tileH) / (2 * ppm);

        const body = world.createBody({ type: "static" });
        body.setPosition(planck.Vec2(cxPx / ppm, cyPx / ppm));
        const f = body.createFixture(planck.Box(hxM, hyM), { friction });
        f.setUserData("ground");
      }
    }
  }

  // bounds
  if (addBounds && worldWpx > 0 && worldHpx > 0) {
    const thickM = boundsThicknessPx / ppm;

    const makeWall = (cxPx, cyPx, wPx, hPx, tag) => {
      const b = world.createBody({ type: "static" });
      b.setPosition(planck.Vec2(cxPx / ppm, cyPx / ppm));
      const f = b.createFixture(planck.Box((wPx / ppm) / 2, (hPx / ppm) / 2), { friction });
      f.setUserData(tag);
    };

    // left / right / top / bottom
    makeWall(-boundsThicknessPx / 2, worldHpx / 2, boundsThicknessPx, worldHpx + boundsThicknessPx * 2, "wall");
    makeWall(worldWpx + boundsThicknessPx / 2, worldHpx / 2, boundsThicknessPx, worldHpx + boundsThicknessPx * 2, "wall");
    makeWall(worldWpx / 2, -boundsThicknessPx / 2, worldWpx + boundsThicknessPx * 2, boundsThicknessPx, "wall");
    makeWall(worldWpx / 2, worldHpx + boundsThicknessPx / 2, worldWpx + boundsThicknessPx * 2, boundsThicknessPx, "wall");
  }

  return { mapPath, mapJson, worldWpx, worldHpx };
}

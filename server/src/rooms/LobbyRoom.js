// ============================================================
// server/src/rooms/LobbyRoom.js
// Server-authoritative physics + collisions + guns.
//
// ✅ MOVEMENT-SAFE: does not change PlayerSim movement code
// ✅ Adds: ragdoll for a short time, then respawn
// ✅ Adds: death-only knockback (custom per gun)
// ✅ Adds: server-authoritative 2:00 round timer (state.roundTimeLeftSec)
// ============================================================

import { Room } from "colyseus";
import planck from "planck";
import { performance } from "node:perf_hooks";

import LobbyState from "../state/LobbyState.js";
import PlayerState from "../state/PlayerState.js";
import PowerUpState from "../state/PowerUpState.js";

import PlayerSim, { PPM } from "../sim/PlayerSim.js";
import { GUN_CATALOG } from "../sim/gunCatalog.js";
import { loadTiledMapToPlanck, getObjectPoints } from "../sim/loadTiledMap.js";

// ============================================================
// Checkpoints (Tiled object layers)
//
// You created:
//  - PlayerSpawnHitboxes (rectangles) with string property: id = "cp01b", "cp02b", ...
//  - PlayerSpawnPoints  (points)     with string property: id = "cp01p", "cp02p", ...
//
// This code treats "cp01b" and "cp01p" as the same checkpoint by
// stripping the trailing "b" or "p" and using the base id ("cp01").
// ============================================================

// --------------------
// TUNE THESE
// --------------------
const SERVER_TICK_HZ = 60;
const SERVER_PATCH_HZ = 60;
const SIM_LOOP_HZ = 60;
const MAX_CATCHUP_STEPS = 10;

const FIXED_DT = 1 / SERVER_TICK_HZ;
const FIXED_DT_MS = 1000 / SERVER_TICK_HZ;

const GRAVITY_Y = 40;

// --------------------
// Round timer
// --------------------
// Server-authoritative round countdown (2 minutes)
const ROUND_DURATION_SEC = 120;

// --------------------
// Health / respawn
// --------------------
const DEFAULT_MAX_HEALTH = 100;
const RESPAWN_X = 600;
const RESPAWN_Y = 600;

// ✅ how long they ragdoll before respawn
const DEATH_RAGDOLL_SEC = 2.0;

// Try both “run from /server” and “run from repo root”
const MAP_CANDIDATES = [
  "../public/assets/maps/level1.tmj",
  "../public/assets/maps/level1.json",
  "../../public/assets/maps/level1.tmj",
  "../../public/assets/maps/level1.json",
  "./public/assets/maps/level1.tmj",
  "./public/assets/maps/level1.json",
];

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

// --------------------
// Tiled helpers
// --------------------
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

function getObjectLayer(mapJson, layerName) {
  const all = flattenTiledLayers(mapJson?.layers);
  return all.find((l) => l.type === "objectgroup" && l.name === layerName) || null;
}

function getTiledPropValue(obj, propName) {
  const want = String(propName || "").toLowerCase();
  const props = Array.isArray(obj?.properties) ? obj.properties : [];
  for (const p of props) {
    const n = String(p?.name || "").toLowerCase();
    if (n === want) return p?.value;
  }
  return undefined;
}

function normalizeCheckpointBaseId(rawId) {
  const id = String(rawId || "").trim();
  if (!id) return "";
  const last = id[id.length - 1].toLowerCase();
  if ((last === "b" || last === "p") && id.length > 1) return id.slice(0, -1);
  return id;
}

function checkpointOrderFromBaseId(baseId) {
  const s = String(baseId || "");
  const m = s.match(/\d+/);
  if (!m) return NaN;
  const v = parseInt(m[0], 10);
  return Number.isFinite(v) ? v : NaN;
}

function shouldUpgradeCheckpoint(curBaseId, newBaseId) {
  if (!newBaseId) return false;
  if (!curBaseId) return true;
  if (curBaseId === newBaseId) return false;

  const curOrder = checkpointOrderFromBaseId(curBaseId);
  const newOrder = checkpointOrderFromBaseId(newBaseId);

  if (Number.isFinite(curOrder) && Number.isFinite(newOrder)) {
    return newOrder > curOrder;
  }

  // Fallback: lexical compare if orders aren't numeric
  return String(newBaseId) > String(curBaseId);
}

function pointInRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

function rectsOverlap(a, b) {
  // Inclusive overlap so "touching" counts as contact
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function getBodyAabbPx(body) {
  if (!body) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let f = body.getFixtureList(); f; f = f.getNext()) {
    let aabb = null;
    try {
      aabb = f.getAABB(0);
    } catch (e) {
      aabb = null;
    }

    if (!aabb || !aabb.lowerBound || !aabb.upperBound) continue;

    minX = Math.min(minX, aabb.lowerBound.x * PPM);
    minY = Math.min(minY, aabb.lowerBound.y * PPM);
    maxX = Math.max(maxX, aabb.upperBound.x * PPM);
    maxY = Math.max(maxY, aabb.upperBound.y * PPM);
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export default class LobbyRoom extends Room {
  onCreate() {
    this.setState(new LobbyState());

    // ------------------------------------------------------------
    // Round timer (server authoritative)
    // - Starts when the room is created.
    // - Clients read state.roundTimeLeftSec and render it.
    // ------------------------------------------------------------
    this._roundEndMs = Date.now() + ROUND_DURATION_SEC * 1000;
    this._lastRoundTimeLeftSec = ROUND_DURATION_SEC;
    this.state.roundDurationSec = ROUND_DURATION_SEC;
    this.state.roundTimeLeftSec = ROUND_DURATION_SEC;

    // Patch state 60Hz
    const patchMs = Math.max(1, Math.round(1000 / SERVER_PATCH_HZ));
    if (typeof this.setPatchRate === "function") this.setPatchRate(patchMs);
    else this.patchRate = patchMs;

    // physics world
    this.world = planck.World({ gravity: planck.Vec2(0, GRAVITY_Y) });
    this.mouseGroundBody = this.world.createBody();

    const loaded = loadTiledMapToPlanck({
      world: this.world,
      ppm: PPM,
      mapFileCandidates: MAP_CANDIDATES,
      tileLayerName: "Tile Layer 1",
    });

    this.mapJson = loaded.mapJson;

    // ------------------------------------------------------------
    // KillZones (Tiled object layer)
    // - Object layer name: "KillZones"
    // - Rectangles drawn in the layer
    // - Each rectangle object has bool property: "Kills" = true
    //
    // Implemented like the spawn/checkpoint hitboxes:
    // - Read every rectangle with Kills=true
    // - Each fixed step, if the player's physics body overlaps any of them,
    //   kill the player using the same death flow as being shot.
    // ------------------------------------------------------------
    this.killZoneRects = []; // [{x,y,w,h}]
    if (this.mapJson) {
      const kzLayer = getObjectLayer(this.mapJson, "KillZones");
      const kzObjs = Array.isArray(kzLayer?.objects) ? kzLayer.objects : [];

      // If you ever decide to set Kills=true on the layer itself, this supports that too.
      const layerKillsDefault = !!getTiledPropValue(kzLayer, "Kills") || kzLayer?.name === "KillZones";

      for (const o of kzObjs) {
        const killsProp = getTiledPropValue(o, "Kills");
        const killsEnabled = killsProp === undefined ? layerKillsDefault : !!killsProp;
        if (!killsEnabled) continue;

        const x = Number(o?.x);
        const y = Number(o?.y);
        const w = Number(o?.width);
        const h = Number(o?.height);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) continue;
        if (!(w > 0) || !(h > 0)) continue;

        this.killZoneRects.push({ x, y, w, h });
      }
    }

    // ------------------------------------------------------------
    // Checkpoints: read from Tiled object layers
    // ------------------------------------------------------------
    this.checkpointSpawnsByBaseId = new Map(); // baseId -> {x,y}
    this.checkpointTriggers = []; // [{ baseId, x,y,w,h }]

    // Per-player respawn tracking
    this.playerCheckpointBaseId = new Map(); // sid -> baseId (ex: "cp02")
    this.playerRespawnBySid = new Map(); // sid -> {x,y}
    this.playerInsideCheckpoint = new Map(); // sid -> Set(baseId) for edge-triggered entry

    // Default spawn if no checkpoints exist
    this.defaultRespawn = { x: RESPAWN_X, y: RESPAWN_Y, baseId: "", order: NaN };

    if (this.mapJson) {
      // Spawn points
      const spawnLayer = getObjectLayer(this.mapJson, "PlayerSpawnPoints");
      const spawnObjs = Array.isArray(spawnLayer?.objects) ? spawnLayer.objects : [];

      for (const o of spawnObjs) {
        const idRaw = getTiledPropValue(o, "id");
        const baseId = normalizeCheckpointBaseId(idRaw);
        if (!baseId) continue;

        const x = Number(o?.x);
        const y = Number(o?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        // Tiled point objects are their own "position"
        this.checkpointSpawnsByBaseId.set(baseId, { x: Math.round(x), y: Math.round(y) });
      }

      // Spawn hitboxes
      const hitLayer = getObjectLayer(this.mapJson, "PlayerSpawnHitboxes");
      const hitObjs = Array.isArray(hitLayer?.objects) ? hitLayer.objects : [];

      for (const o of hitObjs) {
        const idRaw = getTiledPropValue(o, "id");
        const baseId = normalizeCheckpointBaseId(idRaw);
        if (!baseId) continue;

        const x = Number(o?.x);
        const y = Number(o?.y);
        const w = Number(o?.width);
        const h = Number(o?.height);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) continue;
        if (!(w > 0) || !(h > 0)) continue;

        this.checkpointTriggers.push({ baseId, x, y, w, h });
      }

      // Sort triggers by checkpoint order so later checkpoints override earlier ones naturally.
      this.checkpointTriggers.sort((a, b) => {
        const ao = checkpointOrderFromBaseId(a.baseId);
        const bo = checkpointOrderFromBaseId(b.baseId);
        if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
        return String(a.baseId).localeCompare(String(b.baseId));
      });

      // Choose a default respawn baseId if we have at least one spawn point.
      if (this.checkpointSpawnsByBaseId.size > 0) {
        const bases = [...this.checkpointSpawnsByBaseId.keys()];

        bases.sort((a, b) => {
          const ao = checkpointOrderFromBaseId(a);
          const bo = checkpointOrderFromBaseId(b);
          if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
          return String(a).localeCompare(String(b));
        });

        const baseId = bases[0];
        const pos = this.checkpointSpawnsByBaseId.get(baseId);
        if (pos) {
          this.defaultRespawn = {
            x: pos.x,
            y: pos.y,
            baseId,
            order: checkpointOrderFromBaseId(baseId),
          };
        }
      }
    }

    // ------------------------------------------------------------
    // Sniper powerup spawns (Tiled object layer)
    //
    // Layer: "PowerUpSpawns"
    // Each point object: bool property "PowerUpSpawn" = true
    //
    // Detected the same way as PlayerSpawnPoints (object layer -> objects -> x/y)
    // ------------------------------------------------------------
    const sniperSpawnPts = [];

    if (this.mapJson) {
      const puLayer = getObjectLayer(this.mapJson, "PowerUpSpawns");
      const puObjs = Array.isArray(puLayer?.objects) ? puLayer.objects : [];

      for (const o of puObjs) {
        const enabled = !!getTiledPropValue(o, "PowerUpSpawn");
        if (!enabled) continue;

        const x = Number(o?.x);
        const y = Number(o?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        sniperSpawnPts.push({ x: Math.round(x), y: Math.round(y) });
      }

      // Back-compat: older maps may still have "SniperSpawns"
      if (sniperSpawnPts.length === 0) {
        const oldPts = getObjectPoints(this.mapJson, "SniperSpawns");
        if (Array.isArray(oldPts)) {
          for (const pt of oldPts) {
            const x = Number(pt?.x);
            const y = Number(pt?.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            sniperSpawnPts.push({ x: Math.round(x), y: Math.round(y) });
          }
        }
      }
    }

    // Fallback if none exist in the map
    if (sniperSpawnPts.length === 0) {
      sniperSpawnPts.push({ x: 900, y: 600 });
    }

    // Spawn a sniper powerup at EACH point
    for (let i = 0; i < sniperSpawnPts.length; i++) {
      const pt = sniperSpawnPts[i];

      const pu = new PowerUpState();
      pu.type = "sniper";
      pu.x = pt.x;
      pu.y = pt.y;
      pu.active = true;

      this.state.powerUps.set(`sniper_${i}`, pu);
    }

    this.playerSims = new Map();
    this.playerInputs = new Map();
    this.powerUpRespawnTimers = new Map();

    // ✅ death timers
    this.deathRespawnTimers = new Map();

    this.onMessage("input", (client, msg) => {
      const raw = msg || {};
      const b = Number(raw.b);

      if (Number.isFinite(b)) {
        const tiltLeft = !!(b & 1);
        const tiltRight = !!(b & 2);
        const dragActive = !!(b & 4);

        this.playerInputs.set(client.sessionId, {
          tiltLeft,
          tiltRight,
          dragActive,
          dragX: dragActive ? Number(raw.x) : undefined,
          dragY: dragActive ? Number(raw.y) : undefined,
          fireSeq: Number(raw.f) | 0,
        });
      } else {
        this.playerInputs.set(client.sessionId, raw);
      }
    });

    // fixed-step loop
    this._accMs = 0;
    this._lastMs = performance.now();

    const loopMs = Math.max(1, Math.round(1000 / SIM_LOOP_HZ));
    this.setSimulationInterval(() => this.simLoop(), loopMs);
  }

  onJoin(client) {
    // ------------------------------------------------------------
    // Spawn at the current default checkpoint (or fallback coords)
    // ------------------------------------------------------------
    const spawnX = Number(this.defaultRespawn?.x) || RESPAWN_X;
    const spawnY = Number(this.defaultRespawn?.y) || RESPAWN_Y;

    const ps = new PlayerState();
    ps.x = spawnX;
    ps.y = spawnY;
    ps.a = 0;
    ps.dir = 1;

    ps.maxHealth = DEFAULT_MAX_HEALTH;
    ps.health = DEFAULT_MAX_HEALTH;

    // ✅ alive on join
    ps.dead = false;

    this.state.players.set(client.sessionId, ps);

    // Initialize this player's checkpoint + respawn
    const sid = client.sessionId;
    const baseId = String(this.defaultRespawn?.baseId || "");
    if (baseId) this.playerCheckpointBaseId.set(sid, baseId);
    this.playerRespawnBySid.set(sid, { x: spawnX, y: spawnY });
    this.playerInsideCheckpoint.set(sid, new Set());

    const sim = new PlayerSim({
      world: this.world,
      mouseGroundBody: this.mouseGroundBody,
      sessionId: client.sessionId,
      gunCatalog: GUN_CATALOG,
      startXpx: spawnX,
      startYpx: spawnY,
    });

    this.playerSims.set(client.sessionId, sim);
    this.playerInputs.set(client.sessionId, {});
  }

  onLeave(client) {
    const sid = client.sessionId;

    // ✅ clear respawn timer
    const t = this.deathRespawnTimers.get(sid);
    if (t) clearTimeout(t);
    this.deathRespawnTimers.delete(sid);

    const sim = this.playerSims.get(sid);
    if (sim) sim.destroy();

    this.playerSims.delete(sid);
    this.playerInputs.delete(sid);
    this.state.players.delete(sid);

    // checkpoints
    this.playerCheckpointBaseId.delete(sid);
    this.playerRespawnBySid.delete(sid);
    this.playerInsideCheckpoint.delete(sid);
  }

  broadcastSound(key, volume = 1, rate = 1) {
    if (!key) return;
    this.broadcast("sound", { k: key, v: volume, r: rate });
  }

  // ------------------------------------------------------------
  // Respawn point (uses last activated checkpoint if available)
  // ------------------------------------------------------------
  getRespawnPoint(sessionId) {
    const sid = String(sessionId || "");

    if (sid) {
      const saved = this.playerRespawnBySid.get(sid);
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        return { x: saved.x, y: saved.y };
      }
    }

    const d = this.defaultRespawn;
    if (d && Number.isFinite(d.x) && Number.isFinite(d.y)) {
      return { x: d.x, y: d.y };
    }

    return { x: RESPAWN_X, y: RESPAWN_Y };
  }

  respawnPlayer(sessionId) {
    // cancel any existing timer
    const old = this.deathRespawnTimers.get(sessionId);
    if (old) clearTimeout(old);
    this.deathRespawnTimers.delete(sessionId);

    const st = this.state.players.get(sessionId);
    const sim = this.playerSims.get(sessionId);
    if (!st || !sim) return;

    const pt = this.getRespawnPoint(sessionId);

    // reset health
    const mh = Number(st.maxHealth) || DEFAULT_MAX_HEALTH;
    st.maxHealth = mh;
    st.health = mh;

    // ✅ revive state
    st.dead = false;

    // reset sim
    sim.respawn(pt.x, pt.y);
  }

  killPlayer(sessionId, damageEvent) {
    const sid = String(sessionId || "");
    const st = this.state.players.get(sid);
    const sim = this.playerSims.get(sid);
    if (!st || !sim) return;

    // already dead?
    if (st.dead) return;

    // mark dead
    st.dead = true;
    st.health = 0;

    // ragdoll in sim
    sim.kill(damageEvent);

    // schedule respawn
    const t = setTimeout(() => {
      this.respawnPlayer(sid);
      this.deathRespawnTimers.delete(sid);
    }, DEATH_RAGDOLL_SEC * 1000);

    this.deathRespawnTimers.set(sid, t);
  }

  updateKillZones() {
    if (!Array.isArray(this.killZoneRects) || this.killZoneRects.length === 0) return;

    for (const [sid, sim] of this.playerSims.entries()) {
      const st = this.state.players.get(sid);
      if (!st) continue;

      // ignore while dead
      if (st.dead) continue;

      const body = sim.getBody?.();
      if (!body) continue;

      const aabb = getBodyAabbPx(body);
      if (!aabb) continue;

      for (const kz of this.killZoneRects) {
        if (rectsOverlap(aabb, kz)) {
          // kill like damage event
          this.killPlayer(sid, { kind: "damage", to: sid, amount: 9999 });
          break;
        }
      }
    }
  }

  updatePlayerCheckpoints() {
    if (!Array.isArray(this.checkpointTriggers) || this.checkpointTriggers.length === 0) return;

    for (const [sid, sim] of this.playerSims.entries()) {
      const st = this.state.players.get(sid);
      if (!st) continue;

      // ignore while dead (ragdoll)
      if (st.dead) continue;

      const body = sim.getBody?.();
      if (!body) continue;

      const aabb = getBodyAabbPx(body);
      if (!aabb) continue;

      const insideSet = this.playerInsideCheckpoint.get(sid) || new Set();
      this.playerInsideCheckpoint.set(sid, insideSet);

      let bestEnteredBaseId = "";

      for (const trg of this.checkpointTriggers) {
        const overlaps = rectsOverlap(aabb, trg);

        if (overlaps) {
          // edge-trigger: only count as "entered" if wasn't inside last step
          if (!insideSet.has(trg.baseId)) {
            insideSet.add(trg.baseId);

            // candidate for upgrade
            if (shouldUpgradeCheckpoint(bestEnteredBaseId, trg.baseId)) {
              bestEnteredBaseId = trg.baseId;
            }
          }
        } else {
          insideSet.delete(trg.baseId);
        }
      }

      if (!bestEnteredBaseId) continue;

      const cur = String(this.playerCheckpointBaseId.get(sid) || "");
      if (!shouldUpgradeCheckpoint(cur, bestEnteredBaseId)) continue;

      const pos = this.checkpointSpawnsByBaseId.get(bestEnteredBaseId);
      if (!pos) continue;

      this.playerCheckpointBaseId.set(sid, bestEnteredBaseId);
      this.playerRespawnBySid.set(sid, { x: pos.x, y: pos.y });
    }
  }

  // ------------------------------------------------------------
  // Round timer update (server authoritative)
  // Writes to state.roundTimeLeftSec only when the displayed second changes.
  // ------------------------------------------------------------
  updateRoundTimer() {
    // If no timer was initialized, do nothing.
    if (!Number.isFinite(this._roundEndMs)) return;

    const remMs = this._roundEndMs - Date.now();
    const secLeftRaw = remMs <= 0 ? 0 : Math.ceil(remMs / 1000);
    const secLeft = Math.max(0, Math.min(ROUND_DURATION_SEC, secLeftRaw | 0));

    // Only update state when it actually changes (saves bandwidth).
    if (this.state.roundTimeLeftSec !== secLeft) {
      this.state.roundTimeLeftSec = secLeft;
    }
  }

  simLoop() {
    const now = performance.now();
    let frameMs = now - this._lastMs;
    this._lastMs = now;

    if (frameMs > 250) frameMs = 250;
    this._accMs += frameMs;

    let steps = 0;
    while (this._accMs >= FIXED_DT_MS && steps < MAX_CATCHUP_STEPS) {
      this._accMs -= FIXED_DT_MS;
      this.fixedStep();
      steps++;
    }

    if (steps === MAX_CATCHUP_STEPS) {
      this._accMs = 0;
    }

    // Update round timer at most once per simLoop tick.
    this.updateRoundTimer();
  }

  fixedStep() {
    // 1) apply inputs
    const allEvents = [];

    for (const [sid, sim] of this.playerSims.entries()) {
      const input = this.playerInputs.get(sid) || {};
      const ev = sim.applyInput(input, FIXED_DT);
      for (const e of ev) allEvents.push(e);
    }

    // 2) physics step
    this.world.step(FIXED_DT);

    // 2.25) kill zones (after physics step)
    this.updateKillZones();

    // 2.5) apply damage events
    for (const e of allEvents) {
      if (!e || e.kind !== "damage") continue;

      const to = String(e.to || "");
      if (!to) continue;

      const st = this.state.players.get(to);
      if (!st) continue;

      // ignore hits while dead (ragdoll period)
      if (st.dead) continue;

      const dmg = Math.max(0, Number(e.amount) || 0);
      const hpNow = Number(st.health) || 0;
      const hpNew = Math.max(0, hpNow - dmg);
      st.health = hpNew;

      if (hpNew <= 0) {
        this.killPlayer(to, e);
      }
    }

    // 2.75) checkpoints (after physics + damage)
    this.updatePlayerCheckpoints();

    // 3) pickups (skip dead players)
    for (const sim of this.playerSims.values()) {
      if (typeof sim.isDead === "function" && sim.isDead()) continue;
      if (sim.hasGun()) continue;

      const snap = sim.getStateSnapshot();
      const px = snap.x;
      const py = snap.y;

      for (const [puId, pu] of this.state.powerUps.entries()) {
        if (!pu.active) continue;

        const def = GUN_CATALOG[pu.type];
        if (!def) continue;

        const r = Number(def.pickupRadiusPx ?? 80);
        if (dist2(px, py, pu.x, pu.y) <= r * r) {
          const ok = sim.giveGun(pu.type);
          if (!ok) continue;

          pu.active = false;

          if (def.pickupSoundKey) {
            this.broadcastSound(def.pickupSoundKey, def.pickupSoundVolume ?? 1, def.pickupSoundRate ?? 1);
          }

          const respawnSec = Number(def.respawnSec ?? 6);
          if (this.powerUpRespawnTimers.has(puId)) {
            clearTimeout(this.powerUpRespawnTimers.get(puId));
          }

          const t = setTimeout(() => {
            const pu2 = this.state.powerUps.get(puId);
            if (pu2) pu2.active = true;
            this.powerUpRespawnTimers.delete(puId);
          }, Math.max(0.1, respawnSec) * 1000);

          this.powerUpRespawnTimers.set(puId, t);
        }
      }
    }

    // 4) push snapshots to state
    for (const [sid, sim] of this.playerSims.entries()) {
      const st = this.state.players.get(sid);
      if (!st) continue;

      const s = sim.getStateSnapshot();

      st.x = s.x;
      st.y = s.y;
      st.a = s.a;

      st.armX = s.armX;
      st.armY = s.armY;
      st.armA = s.armA;

      st.dir = s.dir;

      st.gunId = s.gunId;
      st.ammo = s.ammo;

      st.gunX = s.gunX;
      st.gunY = s.gunY;
      st.gunA = s.gunA;
    }
  }
}
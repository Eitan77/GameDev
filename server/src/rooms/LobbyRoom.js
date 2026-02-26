// ============================================================
// server/src/rooms/LobbyRoom.js
// Server-authoritative physics + collisions + guns.
//
// FIXES INCLUDED:
// ✅ Death zones restored (supports KillZones OR DeathZones; any rectangle kills unless Kills=false)
// ✅ Gunshot sounds restored (server broadcasts "sound" when it sees a "shot")
// ✅ Bullet tracers restored (still broadcasts "shot")
// ✅ Server-authoritative 2:00 round timer in state.roundTimeLeftSec
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
const ROUND_DURATION_SEC = 120;

// --------------------
// Health / respawn
// --------------------
const DEFAULT_MAX_HEALTH = 100;
const RESPAWN_X = 600;
const RESPAWN_Y = 600;

// how long they ragdoll before respawn
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

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export default class LobbyRoom extends Room {
  onCreate() {
    this.setState(new LobbyState());

    // ------------------------------------------------------------
    // Round timer (server authoritative)
    // - Starts when the FIRST player joins
    // - Clients read: state.roundTimeLeftSec
    // ------------------------------------------------------------
    this._roundStarted = false;
    this._roundEndMs = 0;
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
    // Death/Kill zones (Tiled object layers)
    // Supports layer names: KillZones OR DeathZones (plus a couple variants).
    // Any rectangle in that layer kills, unless it has property Kills=false.
    // ------------------------------------------------------------
    this.killZoneRects = [];
    if (this.mapJson) {
      const killLayerNames = ["KillZones", "DeathZones", "DeathZone", "KillZone"];

      for (const layerName of killLayerNames) {
        const kzLayer = getObjectLayer(this.mapJson, layerName);
        const kzObjs = Array.isArray(kzLayer?.objects) ? kzLayer.objects : [];

        for (const o of kzObjs) {
          const killsProp = getTiledPropValue(o, "Kills");
          if (killsProp === false) continue;

          const x = Number(o?.x);
          const y = Number(o?.y);
          const w = Number(o?.width);
          const h = Number(o?.height);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) continue;
          if (!(w > 0) || !(h > 0)) continue;

          this.killZoneRects.push({ x, y, w, h });
        }
      }
    }

    // ------------------------------------------------------------
    // Checkpoints: read from Tiled object layers
    // ------------------------------------------------------------
    this.checkpointSpawnsByBaseId = new Map(); // baseId -> {x,y}
    this.checkpointTriggers = []; // [{ baseId, x,y,w,h }]

    this.playerCheckpointBaseId = new Map(); // sid -> baseId (ex: "cp02")
    this.playerRespawnBySid = new Map(); // sid -> {x,y}
    this.playerInsideCheckpoint = new Map(); // sid -> Set(baseId)

    this.defaultRespawn = { x: RESPAWN_X, y: RESPAWN_Y, baseId: "", order: NaN };

    if (this.mapJson) {
      const spawnLayer = getObjectLayer(this.mapJson, "PlayerSpawnPoints");
      const spawnObjs = Array.isArray(spawnLayer?.objects) ? spawnLayer.objects : [];

      for (const o of spawnObjs) {
        const rawId = getTiledPropValue(o, "id");
        const baseId = normalizeCheckpointBaseId(rawId);
        const x = Number(o?.x);
        const y = Number(o?.y);
        if (!baseId || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        this.checkpointSpawnsByBaseId.set(baseId, { x: Math.round(x), y: Math.round(y) });
      }

      const hitboxLayer = getObjectLayer(this.mapJson, "PlayerSpawnHitboxes");
      const hitboxObjs = Array.isArray(hitboxLayer?.objects) ? hitboxLayer.objects : [];

      for (const o of hitboxObjs) {
        const rawId = getTiledPropValue(o, "id");
        const baseId = normalizeCheckpointBaseId(rawId);

        const x = Number(o?.x);
        const y = Number(o?.y);
        const w = Number(o?.width);
        const h = Number(o?.height);

        if (!baseId || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) continue;
        if (!(w > 0) || !(h > 0)) continue;

        this.checkpointTriggers.push({ baseId, x, y, w, h });
      }

      if (this.checkpointSpawnsByBaseId.size > 0) {
        const bases = Array.from(this.checkpointSpawnsByBaseId.keys());
        bases.sort((a, b) => {
          const ao = checkpointOrderFromBaseId(a);
          const bo = checkpointOrderFromBaseId(b);
          if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
          return String(a).localeCompare(String(b));
        });

        const baseId = bases[0];
        const pos = this.checkpointSpawnsByBaseId.get(baseId);
        if (pos) {
          this.defaultRespawn = { x: pos.x, y: pos.y, baseId, order: checkpointOrderFromBaseId(baseId) };
        }
      }
    }

    // ------------------------------------------------------------
    // Sniper powerup spawns (Tiled object layer)
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

    if (sniperSpawnPts.length === 0) {
      sniperSpawnPts.push({ x: 900, y: 600 });
    }

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

    this._accMs = 0;
    this._lastMs = performance.now();

    const loopMs = Math.max(1, Math.round(1000 / SIM_LOOP_HZ));
    this.setSimulationInterval(() => this.simLoop(), loopMs);
  }

  onJoin(client) {
    // Start round timer when the first player joins.
    if (!this._roundStarted) {
      this._roundStarted = true;
      this._roundEndMs = Date.now() + ROUND_DURATION_SEC * 1000;
      this.state.roundTimeLeftSec = ROUND_DURATION_SEC;
    }

    const spawnX = Number(this.defaultRespawn?.x) || RESPAWN_X;
    const spawnY = Number(this.defaultRespawn?.y) || RESPAWN_Y;

    const ps = new PlayerState();
    ps.x = spawnX;
    ps.y = spawnY;
    ps.a = 0;
    ps.dir = 1;

    ps.maxHealth = DEFAULT_MAX_HEALTH;
    ps.health = DEFAULT_MAX_HEALTH;
    ps.dead = false;

    this.state.players.set(client.sessionId, ps);

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

    const t = this.deathRespawnTimers.get(sid);
    if (t) clearTimeout(t);
    this.deathRespawnTimers.delete(sid);

    const sim = this.playerSims.get(sid);
    if (sim) sim.destroy();

    this.playerSims.delete(sid);
    this.playerInputs.delete(sid);
    this.state.players.delete(sid);

    this.playerCheckpointBaseId.delete(sid);
    this.playerRespawnBySid.delete(sid);
    this.playerInsideCheckpoint.delete(sid);
  }

  broadcastSound(key, volume = 1, rate = 1) {
    if (!key) return;
    this.broadcast("sound", { k: key, v: volume, r: rate });
  }

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
    const old = this.deathRespawnTimers.get(sessionId);
    if (old) clearTimeout(old);
    this.deathRespawnTimers.delete(sessionId);

    const st = this.state.players.get(sessionId);
    const sim = this.playerSims.get(sessionId);
    if (!st || !sim) return;

    const pt = this.getRespawnPoint(sessionId);

    const mh = Number(st.maxHealth) || DEFAULT_MAX_HEALTH;
    st.maxHealth = mh;
    st.health = mh;
    st.dead = false;

    sim.respawnAt(pt.x, pt.y);

    this.playerInsideCheckpoint.set(sessionId, new Set());
    this.playerInputs.set(sessionId, {});
  }

  killPlayer(sessionId, killInfo) {
    const st = this.state.players.get(sessionId);
    const sim = this.playerSims.get(sessionId);
    if (!st || !sim) return;
    if (st.dead) return;

    st.health = 0;
    st.dead = true;

    if (typeof sim.setDead === "function") sim.setDead(true);

    const kx = Number(killInfo?.kx);
    const ky = Number(killInfo?.ky);
    const kb = Number(killInfo?.kb);
    const kbu = Number(killInfo?.kbu);

    if (Number.isFinite(kx) && Number.isFinite(ky) && Number.isFinite(kb) && kb > 0) {
      if (typeof sim.applyDeathKnockback === "function") {
        sim.applyDeathKnockback(kx, ky, kb, Number.isFinite(kbu) ? kbu : 0);
      }
    }

    const t = setTimeout(() => {
      this.deathRespawnTimers.delete(sessionId);
      this.respawnPlayer(sessionId);
    }, Math.max(0.05, DEATH_RAGDOLL_SEC) * 1000);

    this.deathRespawnTimers.set(sessionId, t);
  }

  tryActivateCheckpoint(sessionId, baseId) {
    const sid = String(sessionId || "");
    const b = String(baseId || "");
    if (!sid || !b) return;

    const spawn = this.checkpointSpawnsByBaseId?.get(b);
    if (!spawn) return;

    const cur = this.playerCheckpointBaseId.get(sid) || String(this.defaultRespawn?.baseId || "");
    if (!shouldUpgradeCheckpoint(cur, b)) return;

    this.playerCheckpointBaseId.set(sid, b);
    this.playerRespawnBySid.set(sid, { x: spawn.x, y: spawn.y });

    this.broadcast("checkpoint", { sid, id: b, x: spawn.x, y: spawn.y });
  }

  updateKillZones() {
    if (!Array.isArray(this.killZoneRects) || this.killZoneRects.length === 0) return;

    for (const [sid, sim] of this.playerSims.entries()) {
      const st = this.state.players.get(sid);
      if (!st || st.dead) continue;
      if (!sim || !sim.body) continue;

      const aabbPx = getBodyAabbPx(sim.body);

      if (aabbPx) {
        for (const r of this.killZoneRects) {
          if (!r) continue;
          if (!rectsOverlap(aabbPx, r)) continue;
          this.killPlayer(sid, { source: "killzone" });
          break;
        }
      } else {
        const p = sim.body.getPosition();
        const px = p.x * PPM;
        const py = p.y * PPM;

        for (const r of this.killZoneRects) {
          if (!r) continue;
          if (!pointInRect(px, py, r)) continue;
          this.killPlayer(sid, { source: "killzone" });
          break;
        }
      }
    }
  }

  updatePlayerCheckpoints() {
    if (!Array.isArray(this.checkpointTriggers) || this.checkpointTriggers.length === 0) return;

    for (const [sid, sim] of this.playerSims.entries()) {
      const st = this.state.players.get(sid);
      if (!st || st.dead) continue;
      if (!sim || !sim.body) continue;

      const p = sim.body.getPosition();
      const px = p.x * PPM;
      const py = p.y * PPM;

      const prevInside = this.playerInsideCheckpoint.get(sid) || new Set();
      const nowInside = new Set();

      for (const t of this.checkpointTriggers) {
        if (!t || !t.baseId) continue;
        const inside = pointInRect(px, py, t);
        if (!inside) continue;

        nowInside.add(t.baseId);

        if (!prevInside.has(t.baseId)) {
          this.tryActivateCheckpoint(sid, t.baseId);
        }
      }

      this.playerInsideCheckpoint.set(sid, nowInside);
    }
  }

  // ------------------------------------------------------------
  // Round timer update
  // ------------------------------------------------------------
  updateRoundTimer() {
    if (!this._roundStarted) return;

    const remMs = this._roundEndMs - Date.now();
    const secLeftRaw = remMs <= 0 ? 0 : Math.ceil(remMs / 1000);
    const secLeft = Math.max(0, Math.min(ROUND_DURATION_SEC, secLeftRaw | 0));

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

    // Update round timer (server authoritative)
    this.updateRoundTimer();
  }

  fixedStep() {
    // 1) apply inputs
    const allEvents = [];

    for (const [sid, sim] of this.playerSims.entries()) {
      const input = this.playerInputs.get(sid) || {};

      // Capture gun BEFORE input is applied (applyInput may drop the gun on last shot).
      const gunIdBefore = String(sim?.gunId || "");
      const defBefore = gunIdBefore ? GUN_CATALOG[gunIdBefore] : null;

      const ev = sim.applyInput(input, FIXED_DT);

      let firedThisStep = false;
      for (const e of ev) {
        allEvents.push(e);
        if (e && e.kind === "shot") firedThisStep = true;
      }

      // ✅ Gunshot audio restored (server authoritative)
      if (firedThisStep && defBefore && defBefore.fireSoundKey) {
        allEvents.push({
          kind: "sound",
          k: defBefore.fireSoundKey,
          v: defBefore.fireSoundVolume ?? 1,
          r: defBefore.fireSoundRate ?? 1,
        });

        // Optional reload sound after last shot
        if ((sim?.ammo ?? 0) <= 0 && defBefore.reloadSoundKey) {
          allEvents.push({
            kind: "soundDelayed",
            delaySec: defBefore.fireToReloadDelaySec ?? 0,
            k: defBefore.reloadSoundKey,
            v: defBefore.reloadSoundVolume ?? 1,
            r: defBefore.reloadSoundRate ?? 1,
          });
        }
      }
    }

    // 2) physics step
    this.world.step(FIXED_DT);

    // 2.25) kill zones
    this.updateKillZones();

    // 2.5) apply damage events
    for (const e of allEvents) {
      if (!e || e.kind !== "damage") continue;

      const to = String(e.to || "");
      if (!to) continue;

      const st = this.state.players.get(to);
      if (!st) continue;
      if (st.dead) continue;

      const dmg = Math.max(0, Number(e.amount) || 0);
      const hpNow = Number(st.health) || 0;
      const hpNew = Math.max(0, hpNow - dmg);
      st.health = hpNew;

      if (hpNew <= 0) {
        this.killPlayer(to, e);
      }
    }

    // 2.75) checkpoints
    this.updatePlayerCheckpoints();

    // 3) pickups
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

    // 5) broadcast events
    for (const e of allEvents) {
      if (e.kind === "shot") {
        // Accept both old and new field names on the client.
        if (e.w == null && e.widthPx != null) e.w = e.widthPx;
        if (e.l == null && e.lifeSec != null) e.l = e.lifeSec;
        if (e.t == null && e.tailLenPx != null) e.t = e.tailLenPx;
        if (e.c == null && e.color != null) e.c = e.color;

        this.broadcast("shot", e);

      } else if (e.kind === "sound") {
        const key = e.k ?? e.key;
        const vol = e.v ?? e.volume ?? 1;
        const rate = e.r ?? e.rate ?? 1;
        this.broadcastSound(key, vol, rate);

      } else if (e.kind === "soundDelayed") {
        const delayMs = Math.max(0, Number(e.delaySec ?? 0)) * 1000;

        const key = e.k ?? e.key;
        const vol = e.v ?? e.volume ?? 1;
        const rate = e.r ?? e.rate ?? 1;

        setTimeout(() => this.broadcastSound(key, vol, rate), delayMs);
      }
    }
  }
}
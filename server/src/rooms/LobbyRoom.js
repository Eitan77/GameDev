// ============================================================
// server/src/rooms/LobbyRoom.js
// Server-authoritative physics + collisions + guns.
//
// Change requested:
// ✅ Patch state at 60Hz (60 snapshots/sec) so client can snap without interpolation.
//
// Notes:
// - Physics still runs at 60Hz.
// - Patch rate at 60Hz increases bandwidth (more frequent state updates).
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
const SERVER_TICK_HZ = 60;       // physics tick rate (true sim rate)
const SERVER_PATCH_HZ = 60;      // ✅ 60 snapshots/sec
const SIM_LOOP_HZ = 60;          // wake-up rate (CPU). Physics still fixed at SERVER_TICK_HZ.
const MAX_CATCHUP_STEPS = 10;    // prevent spiral of death if server is very behind

const FIXED_DT = 1 / SERVER_TICK_HZ;
const FIXED_DT_MS = 1000 / SERVER_TICK_HZ;

const GRAVITY_Y = 40;

// --------------------
// Health / respawn
// --------------------
const DEFAULT_MAX_HEALTH = 100;
const RESPAWN_X = 600;
const RESPAWN_Y = 600;

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

export default class LobbyRoom extends Room {
  onCreate() {
    this.setState(new LobbyState());

    // ✅ Patch state 60Hz
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

    // spawn powerups from object layer, fallback if missing
    const spawnPts = this.mapJson ? getObjectPoints(this.mapJson, "SniperSpawns") : [];
    const first = spawnPts[0] || { x: 900, y: 600 };

    const pu = new PowerUpState();
    pu.type = "sniper";
    pu.x = Math.round(first.x);
    pu.y = Math.round(first.y);
    pu.active = true;
    this.state.powerUps.set("sniper_0", pu);

    this.playerSims = new Map();            // sessionId -> PlayerSim
    this.playerInputs = new Map();          // sessionId -> last input
    this.powerUpRespawnTimers = new Map();  // puId -> timeout

    this.onMessage("input", (client, msg) => {
      // Compact input format:
      //   { b: bitmask, f: fireSeq, x?: dragX, y?: dragY }
      //     bit 0 = tiltLeft, bit 1 = tiltRight, bit 2 = dragActive
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
        // Old format (backwards compatibility)
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
    const ps = new PlayerState();
    ps.x = 600;
    ps.y = 600;
    ps.a = 0;
    ps.dir = 1;

    ps.maxHealth = DEFAULT_MAX_HEALTH;
    ps.health = DEFAULT_MAX_HEALTH;

    this.state.players.set(client.sessionId, ps);

    const sim = new PlayerSim({
      world: this.world,
      mouseGroundBody: this.mouseGroundBody,
      sessionId: client.sessionId,
      gunCatalog: GUN_CATALOG,
      startXpx: ps.x,
      startYpx: ps.y,
    });

    this.playerSims.set(client.sessionId, sim);
    this.playerInputs.set(client.sessionId, {});
  }

  onLeave(client) {
    const sim = this.playerSims.get(client.sessionId);
    if (sim) sim.destroy();

    this.playerSims.delete(client.sessionId);
    this.playerInputs.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  broadcastSound(key, volume = 1, rate = 1) {
    if (!key) return;
    // Compact keys for bandwidth
    this.broadcast("sound", {
      k: key,
      v: volume,
      r: rate,
    });
  }

  getRespawnPoint() {
    return { x: RESPAWN_X, y: RESPAWN_Y };
  }

  respawnPlayer(sessionId) {
    const st = this.state.players.get(sessionId);
    const sim = this.playerSims.get(sessionId);
    if (!st || !sim) return;

    const pt = this.getRespawnPoint();

    // reset health
    const mh = Number(st.maxHealth) || DEFAULT_MAX_HEALTH;
    st.maxHealth = mh;
    st.health = mh;

    // drop everything and teleport (movement logic unchanged)
    sim.respawnAt(pt.x, pt.y);

    // clear input so you don't instantly "release jump" etc.
    this.playerInputs.set(sessionId, {});
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

    // 2.5) apply damage events (sniper hitscan)
    // NOTE: This does NOT change physics/movement; it only updates health + respawn.
    const alreadyRespawned = new Set();
    for (const e of allEvents) {
      if (!e || e.kind !== "damage") continue;

      const to = String(e.to || "");
      if (!to) continue;
      if (alreadyRespawned.has(to)) continue;

      const st = this.state.players.get(to);
      if (!st) continue;

      const dmg = Math.max(0, Number(e.amount) || 0);
      const hpNow = Number(st.health) || 0;
      const hpNew = Math.max(0, hpNow - dmg);
      st.health = hpNew;

      if (hpNew <= 0) {
        alreadyRespawned.add(to);
        this.respawnPlayer(to);
      }
    }

    // 3) pickups
    for (const sim of this.playerSims.values()) {
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
        this.broadcast("shot", e);

      } else if (e.kind === "sound") {
        // ✅ Support both formats: compact (k/v/r) and verbose (key/volume/rate)
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

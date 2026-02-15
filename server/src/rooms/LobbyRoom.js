// ============================================================
// server/src/rooms/LobbyRoom.js
// Server-authoritative physics + guns (fixed step).
// FIX: accumulator-based fixed timestep so the sim never runs in slow motion.
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
const SERVER_PATCH_HZ = 60;      // how often state patches are sent to clients
const SIM_LOOP_HZ = 120;         // how often we "wake up" to process time (does NOT change physics rate)
const MAX_CATCHUP_STEPS = 10;     // prevent spiral of death if server is very behind

const FIXED_DT = 1 / SERVER_TICK_HZ;
const FIXED_DT_MS = 1000 / SERVER_TICK_HZ;

const GRAVITY_Y = 40;

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

    // ✅ Higher patch rate = smoother client view (not slow-motion fix, but helps feel)
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
      this.playerInputs.set(client.sessionId, msg || {});
    });

    // ----------------------------
    // ✅ Real-time fixed-step loop
    // ----------------------------
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
    this.broadcast("sound", { key, volume, rate });
  }

  simLoop() {
    const now = performance.now();
    let frameMs = now - this._lastMs;
    this._lastMs = now;

    // prevent insane catch-up if the process pauses (debugger/tab switch/etc.)
    if (frameMs > 250) frameMs = 250;

    this._accMs += frameMs;

    let steps = 0;
    while (this._accMs >= FIXED_DT_MS && steps < MAX_CATCHUP_STEPS) {
      this._accMs -= FIXED_DT_MS;
      this.fixedStep();
      steps++;
    }

    // If we’re *way* behind, drop the remainder instead of staying in slow-mo forever
    if (steps === MAX_CATCHUP_STEPS) {
      this._accMs = 0;
    }
  }

  fixedStep() {
    // 1) apply inputs (forces + shots)
    const allEvents = [];

    for (const [sid, sim] of this.playerSims.entries()) {
      const input = this.playerInputs.get(sid) || {};
      const ev = sim.applyInput(input, FIXED_DT);
      for (const e of ev) allEvents.push(e);
    }

    // 2) physics step
    this.world.step(FIXED_DT);

    // 3) pickups (after movement)
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
        this.broadcastSound(e.key, e.volume, e.rate);
      } else if (e.kind === "soundDelayed") {
        const delayMs = Math.max(0, Number(e.delaySec ?? 0)) * 1000;
        setTimeout(() => this.broadcastSound(e.key, e.volume, e.rate), delayMs);
      }
    }
  }
}

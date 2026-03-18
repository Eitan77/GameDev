// server/src/rooms/GameRoom.js — extends LobbyRoom with synchronized interim gate

import LobbyRoom from "./LobbyRoom.js";

// Minimum time the interim screen is shown — even if all clients are ready
// sooner, the gate won't open until this elapses (from server's perspective).
const INTERIM_MIN_MS   = 3_000;

// Safety valve: after this, the gate opens regardless of who hasn't signalled.
const INTERIM_FORCE_MS = 3_000;

// --------------------
// TUNE THIS: wins required to end the game
// --------------------
const POINTS_TO_WIN = 3;

// --------------------
// Map cycle — order is always level1 → level2 → level3 → level1 …
// The starting position is chosen randomly each game.
// --------------------
const MAP_CYCLE = ["level1", "level2", "level3"];

export default class GameRoom extends LobbyRoom {

  // ── Lifecycle ────────────────────────────────────────────────────

  // Advance to the next map in the cycle and return its name.
  _advanceToNextMap() {
    this._mapIdx = (this._mapIdx + 1) % MAP_CYCLE.length;
    this._currentMapName = MAP_CYCLE[this._mapIdx];
    return this._currentMapName;
  }

  onCreate(options) {
    this.maxClients = 4;

    // Pick a random starting position in the map cycle
    this._mapIdx = Math.floor(Math.random() * MAP_CYCLE.length);
    this._currentMapName = MAP_CYCLE[this._mapIdx];
    console.log(`[GameRoom] Starting map: ${this._currentMapName} (idx ${this._mapIdx})`);

    super.onCreate({ ...options, mapName: this._currentMapName });

    this._expectedPlayers = Math.max(1, Number(options?.matchSize) || this.maxClients || 4);
    this._deferRoundStart = true;  // prevents LobbyRoom.onJoin auto-starting the timer
    this._isFirstRound    = true;

    // Interim gate state
    this._interimActive     = false;
    this._interimEnded      = false;  // true after gate has closed, for late catch-up
    this._interimReadySet   = null;
    this._pendingReadySids  = null;
    this._interimStartMs    = 0;
    this._interimMinTimer   = null;
    this._interimForceTimer = null;

    // Safety: if not all players join in time, open the gate anyway
    this._forceStartMs    = Math.max(1000, Number(options?.forceStartMs) || 15_000);
    this._forceStartTimer = setTimeout(() => {
      try { this._startInterim(); } catch (_) {}
    }, this._forceStartMs);

    // ── Message handlers ─────────────────────────────────────────

    this.onMessage("setName", (client, msg) => {
      const st = this.state?.players?.get(client.sessionId);
      if (!st) return;
      const raw  = typeof msg === "string" ? msg : msg?.name;
      let   name = String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 16);
      if (!name) name = "Player";
      st.name = name;
      // Also accept skinId in the same message
      if (msg?.skinId) {
        let skinId = String(msg.skinId).trim().slice(0, 32);
        if (!skinId) skinId = "default";
        st.skinId = skinId;
      }
    });

    this.onMessage("settings", (client, msg) => {
      const sim = this.playerSims?.get(client.sessionId);
      if (!sim) return;
      const ts = Number(msg?.tiltSensitivity);
      if (Number.isFinite(ts)) sim.tiltSensitivity = Math.max(0, Math.min(1, ts));
    });

    this.onMessage("setSkin", (client, msg) => {
      const st = this.state?.players?.get(client.sessionId);
      if (!st) return;
      const raw = typeof msg === "string" ? msg : msg?.skinId;
      let skinId = String(raw ?? "").trim().slice(0, 32);
      if (!skinId) skinId = "default";
      st.skinId = skinId;
    });

    // Client signals: "I am in InterimScene and my assets are loaded."
    this.onMessage("interimReady", (client) => {
      // Gate already closed (tabbed-out client arriving late) — send
      // "interimEnd" directly to just this client to catch them up.
      if (!this._interimActive && this._interimEnded) {
        client.send("interimEnd", { lateJoin: true });
        return;
      }
      this._onInterimReady(client.sessionId);
    });
  }

  onJoin(client, options) {
    // Temporarily trick LobbyRoom into thinking the round has started so
    // it doesn't auto-start the timer on the first player joining.
    const wasStarted = !!this._roundStarted;
    const prevEndMs  = Number(this._roundEndMs) || 0;

    if (!wasStarted && this._deferRoundStart) this._roundStarted = true;
    super.onJoin(client, options);
    if (!wasStarted && this._deferRoundStart) {
      this._roundStarted      = false;
      this._roundEndMs        = prevEndMs;
      const dur               = Number(this.state?.roundDurationSec) || 120;
      this.state.roundTimeLeftSec = dur;
    }

    this._maybeStartWhenReady();
  }

  onLeave(client, consented) {
    super.onLeave(client, consented);
    // If this player was the last one blocking the gate, re-check now
    if (this._interimActive) this._tryEndInterim(false);
  }

  onDispose() {
    this._clearAllTimers();
  }

  // ── Internal helpers ─────────────────────────────────────────────

  _clearAllTimers() {
    try { clearTimeout(this._forceStartTimer);   } catch (_) {}
    try { clearTimeout(this._interimMinTimer);   } catch (_) {}
    try { clearTimeout(this._interimForceTimer); } catch (_) {}
    this._forceStartTimer   = null;
    this._interimMinTimer   = null;
    this._interimForceTimer = null;
  }

  _maybeStartWhenReady() {
    if (this._roundStarted || this._interimActive) return;
    const count = Number(this.state?.players?.size) || 0;
    if (count >= this._expectedPlayers) this._startInterim();
  }

  // ── Interim gate ─────────────────────────────────────────────────

  /**
   * Open the interim gate. Called for:
   *   - The initial pre-game interim (all players have joined).
   *   - Every subsequent round (via triggerRoundOver override).
   */
  _startInterim(scores = null, winnerName = null) {
    // Cancel the initial force-start fallback
    try { clearTimeout(this._forceStartTimer); } catch (_) {}
    this._forceStartTimer = null;

    // Clean up any timers from a previous interim cycle
    try { clearTimeout(this._interimMinTimer);   } catch (_) {}
    try { clearTimeout(this._interimForceTimer); } catch (_) {}
    this._interimMinTimer   = null;
    this._interimForceTimer = null;

    this._interimActive  = true;
    this._interimEnded   = false;
    this._interimStartMs = Date.now();

    // Absorb any ready signals that arrived before the gate opened
    this._interimReadySet  = new Set(this._pendingReadySids ?? []);
    this._pendingReadySids = null;

    // Safety valve: proceed after INTERIM_FORCE_MS regardless
    this._interimForceTimer = setTimeout(() => {
      try { this._tryEndInterim(true); } catch (_) {}
    }, INTERIM_FORCE_MS);

    // In case pre-buffered signals already satisfy all conditions
    this._tryEndInterim(false);
  }

  _onInterimReady(sid) {
    if (this._interimActive && this._interimReadySet) {
      // Gate is open — record the signal and check if we can proceed
      this._interimReadySet.add(sid);
      this._tryEndInterim(false);
    } else {
      // Gate not open yet — buffer the signal so it isn't lost
      if (!this._pendingReadySids) this._pendingReadySids = new Set();
      this._pendingReadySids.add(sid);
    }
  }

  _tryEndInterim(force) {
    if (!this._interimActive) return;

    const connectedSids = [...(this.state?.players?.keys() ?? [])];
    const allReady      = connectedSids.length > 0 &&
                          connectedSids.every(sid => this._interimReadySet?.has(sid));

    const elapsed = Date.now() - this._interimStartMs;
    const timeOk  = elapsed >= INTERIM_MIN_MS;

    if (!force) {
      if (!timeOk) {
        // Minimum display time not yet elapsed — schedule a re-check
        clearTimeout(this._interimMinTimer);
        this._interimMinTimer = setTimeout(() => {
          try { this._tryEndInterim(false); } catch (_) {}
        }, INTERIM_MIN_MS - elapsed + 10);
        return;
      }
      if (!allReady) return; // still waiting for at least one client
    }

    // ── Gate opens: everyone is ready AND minimum time has passed ────
    try { clearTimeout(this._interimForceTimer); } catch (_) {}
    try { clearTimeout(this._interimMinTimer);   } catch (_) {}
    this._interimForceTimer = null;
    this._interimMinTimer   = null;
    this._interimActive     = false;
    this._interimEnded      = true;
    this._interimReadySet   = null;

    // Determine which map clients should load.
    // For subsequent rounds, advance the cycle BEFORE broadcasting so the
    // message already carries the incoming map name.
    let nextMapName = this._currentMapName;
    if (!this._isFirstRound && !this._isGameOver) {
      nextMapName = this._advanceToNextMap();
    }

    // All clients leave InterimScene simultaneously; include the upcoming map.
    this.broadcast("interimEnd", { mapName: nextMapName });

    if (this._isFirstRound) {
      // Start the round timer for the very first time
      this._isFirstRound          = false;
      const dur                   = Number(this.state?.roundDurationSec) || 120;
      this._roundStarted          = true;
      this._roundEndMs            = Date.now() + dur * 1000;
      this.state.roundTimeLeftSec = dur;
    } else if (this._isGameOver) {
      // Game over: reset all points so the room is clean if reused, don't start a new round
      this._isGameOver = false;
      this.state.players.forEach((st) => { st.points = 0; });
    } else {
      // Load new map physics, then reset physics, respawn players, restart timer
      try { this._loadMap(nextMapName); } catch (_) {}
      try { this.resetRound(); } catch (_) {}
    }
  }

  // ── Override LobbyRoom.triggerRoundOver ──────────────────────────
  //
  // LobbyRoom used setTimeout(resetRound, 1s).
  // We replace that with the synchronized interim gate instead.
  // resetRound() is called inside _tryEndInterim once all clients are ready.

  triggerRoundOver(winnerId) {
    if (this._finishLineTriggered) return;
    this._finishLineTriggered = true;

    // Reset before broadcasting so any "interimReady" that arrives during the
    // 500 ms window (assets are cached → client responds almost instantly) is
    // buffered in _pendingReadySids instead of getting an immediate "interimEnd"
    // via the late-catch-up branch (_interimActive=false && _interimEnded=true).
    this._interimEnded = false;

    const winnerState = this.state.players.get(winnerId);
    if (winnerState) {
      winnerState.points = (Number(winnerState.points) || 0) + 1;
    }

    const scores = [];
    this.state.players.forEach((st, sid) => {
      scores.push({ sid, name: st.name || "Player", points: Number(st.points) || 0, skinId: st.skinId || "default" });
    });

    const winnerName = winnerState?.name || "Player";
    const isGameOver = (Number(winnerState?.points) || 0) >= POINTS_TO_WIN;
    if (isGameOver) this._isGameOver = true;

    this.broadcast("roundOver", { winnerId, winnerName, scores, gameOver: isGameOver });

    // 500ms gives clients time to receive "roundOver", start their InterimScene,
    // and register listeners before the gate opens. Any "interimReady" signals
    // that arrive before that are buffered in _pendingReadySids regardless.
    setTimeout(() => {
      try { this._startInterim(scores, winnerName); } catch (_) {}
    }, 500);
  }
}
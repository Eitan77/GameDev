// ============================================================
// server/src/rooms/GameRoom.js
// Wraps your existing LobbyRoom without modifying it.
// Only enforces maxClients = 4 for each match instance.
// ============================================================

import LobbyRoom from "./LobbyRoom.js";

export default class GameRoom extends LobbyRoom {
  onCreate(options) {
    // ✅ force each game instance to be exactly 4 players max
    this.maxClients = 4;

    // run your original LobbyRoom setup exactly as-is
    super.onCreate(options);

    // ------------------------------------------------------------
    // Match readiness / start gate
    // - LobbyRoom starts the round timer when the FIRST player joins.
    // - In real matchmaking flows, some clients may take longer to consume
    //   their reservation (or be background-throttled), so we delay the round
    //   timer until the match is "full" (or a timeout).
    //
    // This does NOT prevent players from joining/seeing each other; it only
    // ensures the round timer doesn't start early.
    // ------------------------------------------------------------
    this._expectedPlayers = Math.max(1, Number(options?.matchSize) || this.maxClients || 4);
    this._deferRoundStart = true;

    // Safety: if someone never joins, don't stall forever.
    this._forceStartMs = Math.max(1000, Number(options?.forceStartMs) || 15000);
    this._forceStartTimer = setTimeout(() => {
      try {
        this._startRoundIfNeeded("timeout");
      } catch (_) {}
    }, this._forceStartMs);

    // ------------------------------------------------------------
    // Username from client
    // - Client sends: room.send("setName", { name: "..." })
    // - Stored in PlayerState.name and replicated to all clients
    // ------------------------------------------------------------
    this.onMessage("setName", (client, msg) => {
      const st = this.state?.players?.get(client.sessionId);
      if (!st) return;

      const raw = (typeof msg === "string") ? msg : msg?.name;
      let name = String(raw ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 16);

      if (!name) name = "Player";
      st.name = name;
    });
  }

  onJoin(client, options) {
    // Prevent LobbyRoom from auto-starting the round timer on the first join.
    // We still want all the other join/spawn logic from LobbyRoom.
    const wasStarted = !!this._roundStarted;
    const prevEndMs = Number(this._roundEndMs) || 0;

    if (!wasStarted && this._deferRoundStart) {
      // Trick: set _roundStarted=true so LobbyRoom.onJoin skips its timer start.
      this._roundStarted = true;
    }

    super.onJoin(client, options);

    if (!wasStarted && this._deferRoundStart) {
      // Restore "not started" state; timer will start when full (or timeout).
      this._roundStarted = false;
      this._roundEndMs = prevEndMs;

      const dur = Number(this.state?.roundDurationSec) || 120;
      this.state.roundTimeLeftSec = dur;
    }

    this._maybeStartWhenReady();
  }

  onLeave(client, consented) {
    super.onLeave(client, consented);
    // If we haven't started yet, we may still start later when enough players remain
    // (or via timeout). No extra handling needed here.
  }

  onDispose() {
    try {
      if (this._forceStartTimer) clearTimeout(this._forceStartTimer);
    } catch (_) {}
    this._forceStartTimer = null;
  }

  _maybeStartWhenReady() {
    if (!this._deferRoundStart) return;
    if (this._roundStarted) return;

    const count = Number(this.state?.players?.size) || 0;
    if (count >= this._expectedPlayers) {
      this._startRoundIfNeeded("full");
    }
  }

  _startRoundIfNeeded(_reason) {
    if (this._roundStarted) return;

    const dur = Number(this.state?.roundDurationSec) || 120;
    this._roundStarted = true;
    this._roundEndMs = Date.now() + dur * 1000;
    this.state.roundTimeLeftSec = dur;

    try {
      if (this._forceStartTimer) clearTimeout(this._forceStartTimer);
    } catch (_) {}
    this._forceStartTimer = null;
  }
}
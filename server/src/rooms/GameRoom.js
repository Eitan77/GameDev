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
}
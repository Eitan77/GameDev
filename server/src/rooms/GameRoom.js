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
  }
}
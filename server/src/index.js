// ============================================================
// server/src/index.js
// Colyseus server (single server on your PC)
//
// Rooms:
//  - "matchmaking" : one shared queue room
//  - "lobby"       : actual game room instances (4 players each)
// ============================================================

import { defineServer, defineRoom } from "colyseus";
import MatchmakingRoom from "./rooms/MatchmakingRoom.js";
import GameRoom from "./rooms/GameRoom.js";
import PartyRoom from "./rooms/PartyRoom.js";
import { activeParties } from "./rooms/partyLookup.js";

const PORT = Number(process.env.PORT || 2567);

const server = defineServer({
  rooms: {
    // ✅ queue room
    matchmaking: defineRoom(MatchmakingRoom),

    // ✅ actual game instances (each match creates a new one)
    lobby: defineRoom(GameRoom),

    // ✅ party lobby rooms (1 per player, friends join by code)
    party: defineRoom(PartyRoom),
  },

  // ✅ Allow browser to hit colyseus endpoints (CORS)
  express: (app) => {
    app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (req.method === "OPTIONS") return res.sendStatus(204);
      next();
    });

    app.get("/health", (_req, res) => res.json({ ok: true }));

    // Party code lookup: resolve a 6-digit code to a Colyseus roomId
    app.get("/party/lookup", (req, res) => {
      const code = String(req.query.code || "").toUpperCase().trim();
      if (!code || code.length !== 6) {
        return res.status(400).json({ error: "Invalid code" });
      }
      const roomId = activeParties.get(code);
      if (!roomId) {
        return res.status(404).json({ error: "Party not found" });
      }
      res.json({ roomId });
    });
  },
});

server.listen(PORT);

console.log(`[Colyseus] Server running at http://localhost:${PORT}`);
console.log(`[Colyseus] Health check: http://localhost:${PORT}/health`);
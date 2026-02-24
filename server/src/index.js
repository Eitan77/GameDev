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

const PORT = Number(process.env.PORT || 2567);

const server = defineServer({
  rooms: {
    // ✅ queue room
    matchmaking: defineRoom(MatchmakingRoom),

    // ✅ actual game instances (each match creates a new one)
    lobby: defineRoom(GameRoom),
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
  },
});

server.listen(PORT);

console.log(`[Colyseus] Server running at http://localhost:${PORT}`);
console.log(`[Colyseus] Health check: http://localhost:${PORT}/health`);
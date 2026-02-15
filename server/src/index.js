// ============================================================
// index.js (FULL FILE)
// Minimal Colyseus v0.17 server using defineServer/defineRoom
// Adds CORS headers so the browser can call /matchmake properly.
// ============================================================

import { defineServer, defineRoom } from "colyseus";
import LobbyRoom from "./rooms/LobbyRoom.js";

const PORT = Number(process.env.PORT || 2567);

const server = defineServer({
  rooms: {
    lobby: defineRoom(LobbyRoom),
  },

  // Express hook (v0.17) - great place to add CORS + a health endpoint
  express: (app) => {
    // Allow your Vite site (localhost:5173) to call the matchmaker endpoints
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

// ============================================================
// LobbyRoom.js (FULL FILE)
// - Creates a LobbyState
// - Adds/removes players on join/leave
// - Receives "pose" messages from clients and updates state
// ============================================================

import { Room } from "colyseus";
import LobbyState, { PlayerState } from "../state/LobbyState.js";

export default class LobbyRoom extends Room {
  onCreate() {
    // Create the authoritative room state
    this.setState(new LobbyState());

    // Client -> server pose updates (15x/sec from your GameScene)
    this.onMessage("pose", (client, msg) => {
      const ps = this.state.players.get(client.sessionId);
      if (!ps) return;

      // Defensive parsing (so one bad packet doesn't crash the room)
      const x = Number(msg?.x);
      const y = Number(msg?.y);
      const a = Number(msg?.a);
      const dir = Number(msg?.dir);

      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(a)) return;

      ps.x = x;
      ps.y = y;
      ps.a = a;

      // dir is optional but nice to sync
      if (dir === 1 || dir === -1) ps.dir = dir;
    });
  }

  onJoin(client) {
    // Spawn each new player at a slightly different x so you can see both tabs
    const ps = new PlayerState();

    const count = this.state.players.size;
    ps.x = 500 + count * 250; // spread out
    ps.y = 100;
    ps.a = 0;
    ps.dir = 1;

    this.state.players.set(client.sessionId, ps);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
  }
}

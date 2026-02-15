// ============================================================
// LobbyState.js (FULL FILE) - Colyseus v0.17 schema() style
// - Fixes: "@colyseus/schema default export" crash
// - Provides: LobbyState + PlayerState with x/y/a/dir
// ============================================================

import { schema } from "@colyseus/schema";

// A single player that will be replicated to all clients
export class PlayerState extends schema({
  // world position in PIXELS (because your Phaser/Planck scene is using pixels externally)
  x: "number",
  y: "number",

  // angle in RADIANS (Planck uses radians; client converts to degrees for sprite init)
  a: "number",

  // facing direction: -1 (left) or +1 (right)
  dir: "int8",
}) {
  constructor() {
    super();

    // sensible defaults (server will override onJoin)
    this.x = 500;
    this.y = 100;
    this.a = 0;
    this.dir = 1;
  }
}

// The whole room state
export default class LobbyState extends schema({
  // Map of sessionId -> PlayerState
  players: { map: PlayerState, default: new Map() },
}) {
  constructor() {
    super();
  }
}

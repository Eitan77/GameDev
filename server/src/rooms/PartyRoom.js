// ============================================================
// server/src/rooms/PartyRoom.js
//
// Lightweight Colyseus room for party management.
// - Each player auto-creates one on MainMenuScene load.
// - Friends join by entering the 6-digit party code.
// - Leader can start a custom game (skips matchmaking).
// - No Schema state — uses raw message broadcasts.
// ============================================================

import { Room, matchMaker } from "colyseus";
import { activeParties, partyCodesByRoom } from "./partyLookup.js";

const CODE_CHARS = "0123456789";
const CODE_LEN   = 6;
const MAX_RETRIES = 20;

function generateCode() {
  let code = "";
  for (let i = 0; i < CODE_LEN; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function generateUniqueCode() {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const code = generateCode();
    if (!activeParties.has(code)) return code;
  }
  throw new Error("Failed to generate unique party code");
}

export default class PartyRoom extends Room {

  onCreate() {
    this.maxClients = 4;

    this.partyCode = generateUniqueCode();
    this.leaderSid = null;

    /** @type {Map<string, { username: string, slotIndex: number, joinOrder: number }>} */
    this.members = new Map();
    this._nextJoinOrder = 0;

    // Prevent concurrent customStart
    this._locking = false;

    // Register in global lookup
    activeParties.set(this.partyCode, this.roomId);
    partyCodesByRoom.set(this.roomId, this.partyCode);

    // ── Message handlers ──────────────────────────────────────

    this.onMessage("setName", (client, msg) => {
      const entry = this.members.get(client.sessionId);
      if (!entry) return;
      const raw  = typeof msg === "string" ? msg : msg?.name;
      let   name = String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 16);
      if (!name) name = "Player";
      entry.username = name;
      if (msg?.skinId) {
        entry.skinId = String(msg.skinId).trim().slice(0, 32) || "default";
      }
      this._broadcastPartyUpdate();
    });

    this.onMessage("setSkin", (client, msg) => {
      const entry = this.members.get(client.sessionId);
      if (!entry) return;
      const raw = typeof msg === "string" ? msg : msg?.skinId;
      entry.skinId = String(raw ?? "").trim().slice(0, 32) || "default";
      this._broadcastPartyUpdate();
    });

    this.onMessage("customStart", (client) => {
      if (client.sessionId !== this.leaderSid) {
        client.send("error", { message: "Only the party leader can start" });
        return;
      }
      this._startCustomGame().catch((err) => {
        console.error("[PartyRoom] customStart failed:", err);
        client.send("error", { message: "Failed to start game" });
      });
    });

    console.log(`[PartyRoom] Created party ${this.partyCode} (room ${this.roomId})`);
  }

  onJoin(client, options) {
    const rawName = (options && (options.username ?? options.name)) || "";
    const username = String(rawName).trim().slice(0, 16) || "Player";

    // Assign next free slot (0-3)
    const usedSlots = new Set();
    for (const m of this.members.values()) usedSlots.add(m.slotIndex);
    let slotIndex = 0;
    while (usedSlots.has(slotIndex) && slotIndex < 4) slotIndex++;

    const skinId = String(options?.skinId ?? "").trim().slice(0, 32) || "default";
    this.members.set(client.sessionId, {
      username,
      skinId,
      slotIndex,
      joinOrder: this._nextJoinOrder++,
    });

    // First member becomes leader
    if (!this.leaderSid || !this.members.has(this.leaderSid)) {
      this.leaderSid = client.sessionId;
    }

    this._broadcastPartyUpdate();
    console.log(`[PartyRoom] ${username} joined party ${this.partyCode} (${this.members.size}/4)`);
  }

  async onLeave(client, consented) {
    const entry = this.members.get(client.sessionId);
    this.members.delete(client.sessionId);

    // If leader left, promote the earliest joiner
    if (client.sessionId === this.leaderSid) {
      this.leaderSid = null;
      if (this.members.size > 0) {
        let earliest = null;
        for (const [sid, m] of this.members) {
          if (!earliest || m.joinOrder < earliest.order) {
            earliest = { sid, order: m.joinOrder };
          }
        }
        if (earliest) this.leaderSid = earliest.sid;
      }
    }

    if (this.members.size === 0) {
      // Room will auto-dispose when empty
      return;
    }

    this._broadcastPartyUpdate();
    console.log(`[PartyRoom] ${entry?.username ?? "?"} left party ${this.partyCode} (${this.members.size}/4)`);
  }

  onDispose() {
    activeParties.delete(this.partyCode);
    partyCodesByRoom.delete(this.roomId);
    console.log(`[PartyRoom] Disposed party ${this.partyCode}`);
  }

  // ── Broadcast ───────────────────────────────────────────────

  _broadcastPartyUpdate() {
    const members = [];
    for (const [sid, m] of this.members) {
      members.push({
        sessionId: sid,
        username:  m.username,
        skinId:    m.skinId || "default",
        slotIndex: m.slotIndex,
        isLeader:  sid === this.leaderSid,
      });
    }
    // Sort by slotIndex for consistent display
    members.sort((a, b) => a.slotIndex - b.slotIndex);

    this.broadcast("partyUpdate", {
      partyCode: this.partyCode,
      leaderSid: this.leaderSid,
      members,
    });
  }

  // ── Custom game creation ────────────────────────────────────

  async _startCustomGame() {
    if (this._locking) return;
    this._locking = true;

    try {
      const memberCount = this.members.size;
      if (memberCount < 1) return;

      // Create a fresh lobby game instance
      const created = await matchMaker.createRoom("lobby", {
        matchSize: memberCount,
        createdAt: Date.now(),
      });

      const roomId =
        typeof created === "string"
          ? created
          : created && typeof created.roomId === "string"
            ? created.roomId
            : null;

      if (!roomId) throw new Error("matchMaker.createRoom did not return a roomId");

      // Reserve seats and send reservations to each member
      for (const [sid, m] of this.members) {
        const client = this.clients.find((c) => c.sessionId === sid);
        if (!client) continue;

        try {
          let reservation;
          try {
            reservation = await matchMaker.reserveSeatFor(roomId, { username: m.username });
          } catch (_e1) {
            reservation = await matchMaker.reserveSeatFor(created, { username: m.username });
          }
          client.send("matchFound", reservation);
        } catch (err) {
          console.error(`[PartyRoom] reserveSeatFor failed for ${sid}:`, err);
          client.send("error", { message: "Failed to reserve your seat" });
        }
      }
    } finally {
      this._locking = false;
    }
  }
}

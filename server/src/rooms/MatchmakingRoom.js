// ============================================================
// server/src/rooms/MatchmakingRoom.js
//
// One shared queue room.
// - Players join this first.
// - Broadcasts "queue" counts so client can show: In que X/N
// - When N players are waiting, create a NEW "lobby" instance
//   and send seat reservations to those N players.
//
// Match settings:
//   MATCH_SIZE = 4  (standard 4-player lobbies)
// ============================================================

import { Room, matchMaker } from "colyseus";

const MATCH_SIZE = 1;

export default class MatchmakingRoom extends Room {
  onCreate() {
    // Big enough so it can hold lots of waiting players.
    this.maxClients = 1024;

    /** @type {import("colyseus").Client[]} */
    this.waiting = [];

    // sessionId -> username
    this.usernamesBySid = new Map();

    // Prevent two match loops running at once
    this._locking = false;

    // Optional: lets clients cancel queue if you ever add a button
    this.onMessage("cancel", (client) => {
      this._removeClient(client);
      this._broadcastQueue();
    });

    this._broadcastQueue();
  }

  onJoin(client, options) {
    // read username from join options
    const rawName = (options && (options.username ?? options.name)) || "";
    const safeName = String(rawName).trim().slice(0, 16);
    this.usernamesBySid.set(client.sessionId, safeName || "Player");

    this.waiting.push(client);

    // tell everyone how many are waiting
    this._broadcastQueue();

    // see if we can start a match
    this._tryMakeMatch();
  }

  onLeave(client) {
    this._removeClient(client);
    this._broadcastQueue();
  }

  _removeClient(client) {
    const sid = client?.sessionId;
    if (!sid) return;
    this.waiting = this.waiting.filter((c) => c?.sessionId !== sid);

    // cleanup username cache
    this.usernamesBySid.delete(sid);
  }

  _broadcastQueue() {
    // waiting count is ONLY people still waiting (matched players are removed)
    this.broadcast("queue", {
      waiting: this.waiting.length,
      need: MATCH_SIZE,
    });
  }

  async _createLobbyRoom() {
    // create a NEW instance of "lobby"
    const created = await matchMaker.createRoom("lobby", {
      matchSize: MATCH_SIZE,
      createdAt: Date.now(),
    });

    // createRoom can return a roomId string or a room ref with roomId
    const roomId =
      typeof created === "string"
        ? created
        : created && typeof created.roomId === "string"
          ? created.roomId
          : null;

    if (!roomId) throw new Error("matchMaker.createRoom did not return a roomId");

    return { created, roomId };
  }

  async _reserve(roomIdOrRef, roomId, options) {
    // Different Colyseus builds accept different args.
    // We try the safest path first.
    try {
      return await matchMaker.reserveSeatFor(roomId, options);
    } catch (_e1) {
      // fallback
      return await matchMaker.reserveSeatFor(roomIdOrRef, options);
    }
  }

  async _tryMakeMatch() {
    if (this._locking) return;
    this._locking = true;

    try {
      while (this.waiting.length >= MATCH_SIZE) {
        // take the next N players
        const group = this.waiting.splice(0, MATCH_SIZE);

        // if any are missing sessionId, requeue the valid ones and stop
        const live = group.filter((c) => c && c.sessionId);
        if (live.length < MATCH_SIZE) {
          this.waiting = live.concat(this.waiting);
          this._broadcastQueue();
          return;
        }

        // create a fresh lobby game instance
        let createdInfo;
        try {
          createdInfo = await this._createLobbyRoom();
        } catch (err) {
          console.error("[MatchmakingRoom] Failed to create lobby:", err);
          // put them back and stop trying
          this.waiting = live.concat(this.waiting);
          this._broadcastQueue();
          return;
        }

        const { created, roomId } = createdInfo;

        // reserve seats + tell the clients to join
        for (const c of live) {
          try {
            const username = this.usernamesBySid.get(c.sessionId) || "Player";
            const reservation = await this._reserve(created, roomId, { username });
            c.send("matchFound", reservation);
          } catch (err) {
            console.error("[MatchmakingRoom] reserveSeatFor failed:", err);
            // if one fails, put them back in queue
            this.waiting.unshift(c);
          }
        }

        // update queue count for remaining players
        this._broadcastQueue();
      }
    } finally {
      this._locking = false;
    }
  }
}
import Phaser from "phaser";
import { Client } from "@colyseus/sdk";

const COLYSEUS_URL = `${window.location.protocol}//${window.location.hostname}:2567`;

const MATCHMAKING_ROOM = "matchmaking";
const MATCH_SIZE = 4;

export default class MatchmakingScene extends Phaser.Scene {
  constructor() {
    super("MatchmakingScene");

    this.client = null;
    this.mmRoom = null;

    this.titleText = null;
    this.queueText = null;
    this.subText = null;

    this.slots = [];

    this.cancelBtn = null;
    this.cancelText = null;

    this._starting = false;
    this._handedOff = false;
  }

  create() {
    // ✅ FIX: reset every time scene starts
    this._starting = false;
    this._handedOff = false;

    this.cameras.main.setBackgroundColor("#12131a");

    this.titleText = this.add
      .text(0, 0, "MATCHMAKING", {
        fontFamily: "Arial, sans-serif",
        fontSize: "44px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.queueText = this.add
      .text(0, 0, "In que 1/4", {
        fontFamily: "Arial, sans-serif",
        fontSize: "36px",
        color: "#cfd6ff",
      })
      .setOrigin(0.5);

    this.subText = this.add
      .text(0, 0, "Waiting for 3 more players...", {
        fontFamily: "Arial, sans-serif",
        fontSize: "18px",
        color: "#aab3ff",
      })
      .setOrigin(0.5);

    // 4 slot cards
    const slotW = 520;
    const slotH = 56;
    const gap = 16;

    this.slots = [];
    for (let i = 0; i < MATCH_SIZE; i++) {
      const box = this.add.rectangle(0, 0, slotW, slotH, 0x2d3342, 1);
      box.setStrokeStyle(3, 0xffffff, 0.22);

      const label = this.add
        .text(0, 0, `Player ${i + 1}: Searching...`, {
          fontFamily: "Arial, sans-serif",
          fontSize: "22px",
          color: "#ffffff",
        })
        .setOrigin(0.5);

      this.slots.push({ box, text: label });
    }

    // Cancel button
    const btnW = 220;
    const btnH = 64;

    this.cancelBtn = this.add.rectangle(0, 0, btnW, btnH, 0x2d3342, 1);
    this.cancelBtn.setStrokeStyle(3, 0xffffff, 0.3);
    this.cancelBtn.setInteractive({ useHandCursor: true });

    this.cancelText = this.add
      .text(0, 0, "CANCEL", {
        fontFamily: "Arial, sans-serif",
        fontSize: "22px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.cancelBtn.on("pointerover", () => {
      if (this._starting) return;
      this.cancelBtn.setFillStyle(0x3a4256, 1);
      this.cancelBtn.setStrokeStyle(3, 0xffffff, 0.45);
    });

    this.cancelBtn.on("pointerout", () => {
      if (this._starting) return;
      this.cancelBtn.setFillStyle(0x2d3342, 1);
      this.cancelBtn.setStrokeStyle(3, 0xffffff, 0.3);
    });

    this.cancelBtn.on("pointerdown", () => this.cancelMatchmaking());

    this.layout();
    this.scale.on("resize", () => this.layout());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());

    this.connectToMatchmaking().catch((err) => {
      console.error("Matchmaking connection failed:", err);
      this.queueText?.setText("Server offline");
      this.subText?.setText(`Couldn't connect to ${COLYSEUS_URL}`);
      this._setSlots(0);
    });
  }

  layout() {
    const cam = this.cameras.main;
    const cx = cam.centerX;
    const cy = cam.centerY;

    this.titleText?.setPosition(cx, cy - 250);
    this.queueText?.setPosition(cx, cy - 170);
    this.subText?.setPosition(cx, cy - 125);

    const startY = cy - 40;
    const gap = 16;

    for (let i = 0; i < this.slots.length; i++) {
      const y = startY + i * (56 + gap);
      this.slots[i].box.setPosition(cx, y);
      this.slots[i].text.setPosition(cx, y);
    }

    this.cancelBtn?.setPosition(cx, cy + 250);
    this.cancelText?.setPosition(cx, cy + 250);
  }

  _setQueueText(found) {
    const f = Math.max(0, Math.min(MATCH_SIZE, Number(found) || 0));
    const missing = MATCH_SIZE - f;

    this.queueText?.setText(`In que ${f}/${MATCH_SIZE}`);

    if (missing <= 0) this.subText?.setText("Match found! Starting...");
    else if (missing === 1) this.subText?.setText("Waiting for 1 more player...");
    else this.subText?.setText(`Waiting for ${missing} more players...`);
  }

  _setSlots(found) {
    const f = Math.max(0, Math.min(MATCH_SIZE, Number(found) || 0));

    for (let i = 0; i < MATCH_SIZE; i++) {
      const slot = this.slots[i];

      if (i === 0 && f >= 1) {
        slot.text.setText("Player 1: You");
        slot.box.setStrokeStyle(3, 0xffffff, 0.55);
        continue;
      }

      if (i < f) {
        slot.text.setText(`Player ${i + 1}: Found`);
        slot.box.setStrokeStyle(3, 0xffffff, 0.55);
      } else {
        slot.text.setText(`Player ${i + 1}: Searching...`);
        slot.box.setStrokeStyle(3, 0xffffff, 0.22);
      }
    }
  }

  async connectToMatchmaking() {
    this.client = new Client(COLYSEUS_URL);
    this.mmRoom = await this.client.joinOrCreate(MATCHMAKING_ROOM);

    this._setQueueText(1);
    this._setSlots(1);

    this.mmRoom.onMessage("queue", (msg) => {
      if (this._starting) return;

      const waiting = Math.max(0, Number(msg?.waiting) || 0);
      const found = Math.min(waiting, MATCH_SIZE);

      this._setQueueText(found);
      this._setSlots(found);
    });

    this.mmRoom.onMessage("matchFound", async (reservation) => {
      if (this._starting) return;
      this._starting = true;

      this.cancelBtn?.disableInteractive();
      this.cancelBtn?.setFillStyle(0x1f2330, 1);
      this.cancelBtn?.setStrokeStyle(3, 0xffffff, 0.12);
      this.cancelText?.setAlpha(0.5);

      this._setQueueText(MATCH_SIZE);
      this._setSlots(MATCH_SIZE);

      try {
        await this.mmRoom?.leave();
      } catch (_) {}

      this.mmRoom = null;

      // hand off the client + reservation to GameScene
      this._handedOff = true;
      this.scene.start("GameScene", { reservation, client: this.client });
    });
  }

  async cancelMatchmaking() {
    if (this._starting) return;
    this._starting = true;

    try {
      if (this.mmRoom) {
        try {
          this.mmRoom.send("cancel");
        } catch (_) {}

        try {
          await this.mmRoom.leave();
        } catch (_) {}
      }
    } finally {
      this.mmRoom = null;
      this.client = null;
      this.scene.start("MainMenuScene");
    }
  }

  cleanup() {
    // If we handed off to GameScene, DON'T close the client here.
    if (this._handedOff) return;

    try {
      this.mmRoom?.leave();
    } catch (_) {}

    this.mmRoom = null;
    this.client = null;
  }
}
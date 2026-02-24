import Phaser from "phaser";

/**
 * MainMenuScene
 * - Click START -> MatchmakingScene
 *
 * IMPORTANT FIX:
 * - Phaser reuses the same scene instance
 * - So we reset this._starting at the start of create()
 */
export default class MainMenuScene extends Phaser.Scene {
  constructor() {
    super("MainMenuScene");
    this._starting = false;

    this._titleText = null;
    this._buttonContainer = null;
    this._statusText = null;
  }

  create() {
    // ✅ FIX: reset every time scene starts
    this._starting = false;

    this.cameras.main.setBackgroundColor("#1d1f27");

    this._titleText = this.add
      .text(0, 0, "Getaway Shootout (Clone)", {
        fontFamily: "Arial, sans-serif",
        fontSize: "48px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    const btnW = 260;
    const btnH = 90;

    const btnBg = this.add.rectangle(0, 0, btnW, btnH, 0x2d3342, 1);
    btnBg.setStrokeStyle(4, 0xffffff, 0.9);

    const btnText = this.add
      .text(0, 0, "START", {
        fontFamily: "Arial, sans-serif",
        fontSize: "34px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this._buttonContainer = this.add.container(0, 0, [btnBg, btnText]);

    btnBg.setInteractive({ useHandCursor: true });

    btnBg.on("pointerover", () => {
      if (this._starting) return;
      btnBg.setFillStyle(0x3a4256, 1);
      btnBg.setStrokeStyle(4, 0xffffff, 1);
    });

    btnBg.on("pointerout", () => {
      if (this._starting) return;
      btnBg.setFillStyle(0x2d3342, 1);
      btnBg.setStrokeStyle(4, 0xffffff, 0.9);
    });

    btnBg.on("pointerdown", () => this.startGame());

    this._statusText = this.add
      .text(0, 0, "", {
        fontFamily: "Arial, sans-serif",
        fontSize: "18px",
        color: "#cfd6ff",
      })
      .setOrigin(0.5);

    this.layout();
    this.scale.on("resize", () => this.layout());
  }

  layout() {
    const cam = this.cameras && this.cameras.main ? this.cameras.main : null;
    const w = this.scale ? this.scale.width : 0;
    const h = this.scale ? this.scale.height : 0;

    const cx = cam ? cam.centerX : w * 0.5;
    const cy = cam ? cam.centerY : h * 0.5;

    this._titleText?.setPosition(cx, cy - 140);
    this._buttonContainer?.setPosition(cx, cy);
    this._statusText?.setPosition(cx, cy + 110);
  }

  startGame() {
    if (this._starting) return;
    this._starting = true;

    this._statusText?.setText("Entering queue...");
    this.scene.start("MatchmakingScene");
  }
}
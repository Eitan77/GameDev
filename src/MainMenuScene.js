import Phaser from "phaser";

/**
 * MainMenuScene
 * - Type username in the textbox above START
 * - Click START -> MatchmakingScene (passes { username })
 *
 * IMPORTANT:
 * - Phaser reuses the same scene instance
 * - So we reset this._starting at the start of create()
 * - We also cleanup input listeners on shutdown to avoid duplicates
 */
export default class MainMenuScene extends Phaser.Scene {
  constructor() {
    super("MainMenuScene");
    this._starting = false;

    // username typed in the menu (passed into matchmaking -> game)
    this._username = "";

    // username UI
    this._nameLabel = null;
    this._nameBg = null;
    this._nameText = null;
    this._nameFocused = false;
    this._caretVisible = true;
    this._caretTimer = null;
    this._onKeyDown = null;

    // other handlers (so we can remove them on shutdown)
    this._onResize = null;
    this._onGlobalPointerDown = null;

    this._titleText = null;
    this._buttonContainer = null;
    this._btnImg = null;
    this._btnBaseY = 0;
    this._btnPressed = false;
    this._btnPushOffset = 0;
    this._statusText = null;
  }

  preload() {
    this.load.image("btn_unpushed", "assets/images/StartButtonUnpushed.png");
    this.load.image("btn_pushed",   "assets/images/StartButtonPushed.png");
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

    // -------------------------------
    // Username input (simple, Phaser-only)
    // -------------------------------
    this._nameLabel = this.add
      .text(0, 0, "USERNAME", {
        fontFamily: "Arial, sans-serif",
        fontSize: "18px",
        color: "#cfd6ff",
      })
      .setOrigin(0.5);

    const nameW = 360;
    const nameH = 56;

    this._nameBg = this.add.rectangle(0, 0, nameW, nameH, 0x2d3342, 1);
    this._nameBg.setStrokeStyle(3, 0xffffff, 0.28);
    this._nameBg.setInteractive({ useHandCursor: true });

    this._nameText = this.add
      .text(0, 0, "", {
        fontFamily: "Arial, sans-serif",
        fontSize: "24px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    // Clicking the box focuses it
    this._nameBg.on("pointerdown", () => {
      if (this._starting) return;
      this.setNameFocus(true);
    });

    // -------------------------------
    // START button (pixel-art image)
    // -------------------------------
    // Scale 3× so the pixel art is crisp and large enough.
    // Unpushed: 99×35 → 297×105  |  Pushed: 99×33 → 297×99
    // The 2px height difference is the drop-shadow being compressed.
    // On press we switch texture AND nudge Y down by 6px (2px × 3)
    // so the button face stays anchored to the same position.
    const BTN_SCALE = 1;
    const BTN_PUSH_OFFSET_Y = 2 * BTN_SCALE; // pixels to shift down when pressed

    this._btnImg = this.add.image(0, 0, "btn_unpushed");
    this._btnImg.setScale(BTN_SCALE);
    this._btnImg.setOrigin(0.5, 0.5);
    this._btnImg.setInteractive({ useHandCursor: true });
    this._btnPushOffset = BTN_PUSH_OFFSET_Y;
    this._btnPressed = false;

    this._btnImg.on("pointerover", () => {
      // no visual change on hover for pixel-art buttons — feel free to add a tint
    });

    this._btnImg.on("pointerdown", () => {
      if (this._starting) return;
      this._btnPressed = true;
      this._btnImg.setTexture("btn_pushed");
      // shift down so the button face (top of the shadow) stays in place
      this._btnImg.y = this._btnBaseY + this._btnPushOffset;
    });

    const releaseBtn = () => {
      if (!this._btnPressed) return;
      this._btnPressed = false;
      this._btnImg.setTexture("btn_unpushed");
      this._btnImg.y = this._btnBaseY;
    };

    this._btnImg.on("pointerup", () => {
      if (this._starting) return;
      releaseBtn();
      this.startGame();
    });

    this._btnImg.on("pointerout", () => {
      releaseBtn();
    });

    // _buttonContainer kept as a single ref for layout()
    this._buttonContainer = this._btnImg;

    // -------------------------------
    // Status text
    // -------------------------------
    this._statusText = this.add
      .text(0, 0, "", {
        fontFamily: "Arial, sans-serif",
        fontSize: "18px",
        color: "#cfd6ff",
      })
      .setOrigin(0.5);

    // Global click: if you click outside the name box, unfocus it
    this._onGlobalPointerDown = (_pointer, targets) => {
      if (this._starting) return;
      const clickedNameBox = Array.isArray(targets) && targets.includes(this._nameBg);
      if (!clickedNameBox) this.setNameFocus(false);
    };
    this.input.on("pointerdown", this._onGlobalPointerDown);

    // Keyboard input for username
    this._onKeyDown = (ev) => this.handleNameKey(ev);
    this.input.keyboard.on("keydown", this._onKeyDown);

    // Blink caret while focused
    this._caretVisible = true;
    this._caretTimer = this.time.addEvent({
      delay: 450,
      loop: true,
      callback: () => {
        if (!this._nameFocused) return;
        this._caretVisible = !this._caretVisible;
        this.refreshNameField();
      },
    });

    // Clean up listeners when scene ends (prevents duplicate handlers)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());

    // Initial draw
    this.setNameFocus(false);
    this.refreshNameField();

    this.layout();
    this._onResize = () => this.layout();
    this.scale.on("resize", this._onResize);
  }

  layout() {
    const cam = this.cameras && this.cameras.main ? this.cameras.main : null;
    const w = this.scale ? this.scale.width : 0;
    const h = this.scale ? this.scale.height : 0;

    const cx = cam ? cam.centerX : w * 0.5;
    const cy = cam ? cam.centerY : h * 0.5;

    this._titleText?.setPosition(cx, cy - 230);

    // name box above the start button
    this._nameLabel?.setPosition(cx, cy - 150);
    this._nameBg?.setPosition(cx, cy - 105);
    this._nameText?.setPosition(cx, cy - 105);

    // Track base Y separately so the push-down offset stays correct after resize
    this._btnBaseY = cy;
    if (this._btnImg) {
      this._btnImg.x = cx;
      this._btnImg.y = this._btnPressed
        ? this._btnBaseY + this._btnPushOffset
        : this._btnBaseY;
    }

    this._statusText?.setPosition(cx, cy + 120);
  }

  startGame() {
    if (this._starting) return;
    this._starting = true;

    // finalize name from textbox
    const name = String(this._username ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 16);
    this._username = name || "Player";

    this._statusText?.setText(`Entering queue as: ${this._username}`);
    this.scene.start("MatchmakingScene", { username: this._username });
  }

  // -------------------------------
  // Username textbox helpers
  // -------------------------------
  cleanup() {
    try {
      if (this._onResize && this.scale) {
        this.scale.off("resize", this._onResize);
      }
    } catch (_) {}
    this._onResize = null;

    try {
      if (this._onGlobalPointerDown && this.input) {
        this.input.off("pointerdown", this._onGlobalPointerDown);
      }
    } catch (_) {}
    this._onGlobalPointerDown = null;

    try {
      if (this._onKeyDown && this.input?.keyboard) {
        this.input.keyboard.off("keydown", this._onKeyDown);
      }
    } catch (_) {}
    this._onKeyDown = null;

    try {
      this._caretTimer?.remove(false);
    } catch (_) {}
    this._caretTimer = null;
  }

  setNameFocus(focused) {
    this._nameFocused = !!focused;
    this._caretVisible = true;

    // subtle highlight
    if (this._nameBg) {
      if (this._nameFocused) this._nameBg.setStrokeStyle(3, 0xffffff, 0.55);
      else this._nameBg.setStrokeStyle(3, 0xffffff, 0.28);
    }

    this.refreshNameField();
  }

  refreshNameField() {
    if (!this._nameText) return;

    const raw = String(this._username ?? "");
    const trimmed = raw.length ? raw : "";

    // placeholder when empty and not focused
    if (!trimmed && !this._nameFocused) {
      this._nameText.setColor("#aab3ff");
      this._nameText.setText("Enter username...");
      return;
    }

    this._nameText.setColor("#ffffff");

    const caret = this._nameFocused && this._caretVisible ? "|" : "";
    this._nameText.setText(`${trimmed}${caret}`);
  }

  handleNameKey(ev) {
    if (!this._nameFocused) return;
    if (this._starting) return;

    const key = ev?.key;
    if (!key) return;

    // Enter starts the game
    if (key === "Enter") {
      this.startGame();
      return;
    }

    // Escape unfocuses
    if (key === "Escape") {
      this.setNameFocus(false);
      return;
    }

    // Backspace deletes
    if (key === "Backspace") {
      this._username = String(this._username ?? "").slice(0, -1);
      this.refreshNameField();
      return;
    }

    // Ignore modifiers
    if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta" || key === "Tab")
      return;

    // Add character (simple whitelist)
    if (key.length === 1) {
      const allowed = /^[a-zA-Z0-9 _\-]$/.test(key);
      if (!allowed) return;

      const cur = String(this._username ?? "");
      if (cur.length >= 16) return;

      this._username = cur + key;
      this.refreshNameField();
    }
  }
}
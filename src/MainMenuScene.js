import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import { SKIN_CATALOG, SKIN_IDS, loadSkinId, saveSkinId } from "./skinCatalog.js";
import { SettingsOverlay, loadSettings } from "./settings.js";

// ============================================================
// MainMenuScene
//
// - Username textbox + START (solo matchmaking) + CUSTOM (party game)
// - Party system: 4 player slots (left), code input + JOIN (bottom-left),
//   own party code display, leave party button
//
// IMPORTANT:
// - Phaser reuses the same scene instance
// - Reset _starting at start of create()
// - Cleanup input listeners on shutdown to avoid duplicates
// ============================================================

const COLYSEUS_URL = import.meta.env.VITE_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:2567`;

// ============================================================
// UI TUNING CONSTANTS — adjust these to reposition / resize
// ============================================================

// ---- Music ----
const LOBBY_MUSIC_VOLUME  = 0.4;    // default; overridden by saved settings

// ---- Title ----
const TITLE_FONT_SIZE     = "60px";
const TITLE_OFFSET_Y      = -280;       // relative to center Y

// ---- Username input ----
const NAME_LABEL_OFFSET_Y = -180;       // relative to center Y
const NAME_INPUT_W        = 460;
const NAME_INPUT_H        = 86;
const NAME_INPUT_OFFSET_Y = -105;       // relative to center Y
const NAME_FONT_SIZE      = "40px";
const NAME_LABEL_FONT_SIZE = "48px";

// ---- START button ----
const START_BTN_SCALE     = 1;
const START_BTN_OFFSET_Y  = 30;        // relative to center Y

// ---- CUSTOM button ----
const CUSTOM_BTN_W        = 380;
const CUSTOM_BTN_H        = 110;
const CUSTOM_BTN_OFFSET_Y = 200;         // relative to center Y
const CUSTOM_FONT_SIZE    = "60px";
const CUSTOM_BG_COLOR     = 0x0d2e5e;   // dark blue
const CUSTOM_BG_HOVER     = 0x1a4a8a;   // lighter blue on hover
const CUSTOM_TEXT_COLOR   = "#a0cfff";   // light blue text
const CUSTOM_STROKE_COLOR = 0x000000;
const CUSTOM_STROKE_WIDTH = 4;

// ---- Status text ----
const STATUS_OFFSET_Y     = 150;        // relative to center Y
const STATUS_FONT_SIZE    = "18px";

// ---- Party slot boxes (left column) ----
const SLOT_SIZE           = 130;
const SLOT_GAP            = 10;
const SLOT_X              = 100;         // center X of the slot column
const SLOT_START_Y        = 50;          // top edge of first slot
const SLOT_COUNT          = 4;
const SLOT_HEAD_PADDING   = 16;          // inset from slot edge to head image
const SLOT_HEAD_OFFSET_Y  = -8;          // nudge head up within slot
const SLOT_NAME_OFFSET_Y  = -12;         // name text offset from slot bottom
const SLOT_NAME_FONT_SIZE = "12px";
const SLOT_EMPTY_ALPHA    = 0.15;
const SLOT_FILLED_ALPHA   = 0.6;
const SLOT_EMPTY_STROKE   = 0.3;
const SLOT_FILLED_STROKE  = 0.8;

// ---- Code input + JOIN (bottom-left) ----
const CODE_AREA_X         = 100;        // center X of the entire bottom-left code area
const CODE_AREA_OFFSET_Y  = -120;       // from bottom edge of screen
const CODE_LABEL_OFFSET_X = 50;          // horizontal shift of "ENTER CODE TO JOIN" label from CODE_AREA_X
const CODE_LABEL_OFFSET_Y = -35;        // label above code input
const CODE_INPUT_W        = 180;
const CODE_INPUT_H        = 40;
const CODE_INPUT_SHIFT_X  = 20;        // shift code field right of CODE_AREA_X
const CODE_INPUT_SHIFT_Y  = 8;          // shift code field + JOIN button vertically from codeAreaY
const CODE_FONT_SIZE      = "20px";
const CODE_LABEL_FONT_SIZE = "20px";

const JOIN_BTN_W          = 70;
const JOIN_BTN_GAP        = 10;         // gap between code input and JOIN
const JOIN_FONT_SIZE      = "18px";
const JOIN_BG_COLOR       = 0x2a6b2a;   // dark green
const JOIN_BG_HOVER       = 0x3a8f3a;   // lighter green on hover
const JOIN_TEXT_COLOR     = "#e0ffe0";   // light green text

// ---- Own party code display ----
const MY_CODE_LABEL_OFFSET_X = 30;       // horizontal shift of "YOUR PARTY CODE" label from CODE_AREA_X
const MY_CODE_TEXT_OFFSET_X  = 0;       // horizontal shift of the code number from CODE_AREA_X
const MY_CODE_LABEL_OFFSET_Y = 50;      // below code input
const MY_CODE_TEXT_OFFSET_Y  = 82;       // below code input
const MY_CODE_FONT_SIZE      = "28px";
const MY_CODE_LABEL_FONT_SIZE = "20px";
const MY_CODE_COLOR          = "#8b0000";

// ---- Leave party button ----
const LEAVE_BTN_W         = 160;
const LEAVE_BTN_H         = 36;
const LEAVE_BTN_OFFSET_X  = 160;          // horizontal shift of leave button from CODE_AREA_X
const LEAVE_BTN_OFFSET_Y  = 100;        // below code input
const LEAVE_FONT_SIZE     = "14px";
const LEAVE_BG_COLOR      = 0x3a1515;
const LEAVE_BG_HOVER      = 0x4a2020;
const LEAVE_STROKE_COLOR  = 0x8b0000;
const LEAVE_TEXT_COLOR     = "#ff6666";

// ---- SKINS button ----
const SKINS_BTN_W         = 200;
const SKINS_BTN_H         = 50;
const SKINS_BTN_OFFSET_Y  = 310;          // relative to center Y
const SKINS_BG_COLOR      = 0x2e1a4a;
const SKINS_BG_HOVER      = 0x4a2a6a;
const SKINS_TEXT_COLOR     = "#d0aaff";
const SKINS_FONT_SIZE     = "28px";

// ---- Locker panel ----
const LOCKER_PANEL_W      = 900;
const LOCKER_PANEL_H      = 520;
const LOCKER_BG_COLOR     = 0x15152a;
const LOCKER_GRID_COLS    = 5;
const LOCKER_CARD_W       = 140;
const LOCKER_CARD_H       = 170;
const LOCKER_CARD_GAP     = 16;
const LOCKER_TITLE_SIZE   = "32px";
const LOCKER_NAME_SIZE    = "14px";
const LOCKER_EQUIP_W      = 160;
const LOCKER_EQUIP_H      = 44;
const LOCKER_HIGHLIGHT     = 0xd0aaff;

// ---- Settings button (top-right) ----
const SETTINGS_BTN_SIZE = 88;
const SETTINGS_BTN_MARGIN = 18;
const SETTINGS_BTN_COLOR = 0x1a1f2e;
const SETTINGS_BTN_HOVER = 0x2d3342;
const SETTINGS_BTN_STROKE = 0x3a4260;
const SETTINGS_BTN_FONT = { fontFamily: "Arial, sans-serif", fontSize: "44px", color: "#ffffff" };

// ============================================================

export default class MainMenuScene extends Phaser.Scene {
  constructor() {
    super("MainMenuScene");
    this._starting = false;
    this._handedOff = false;

    // Username
    this._username = "";
    this._nameLabel = null;
    this._nameBg = null;
    this._nameText = null;
    this._nameFocused = false;

    // Caret
    this._caretVisible = true;
    this._caretTimer = null;

    // Event handler refs
    this._onKeyDown = null;
    this._onResize = null;
    this._onGlobalPointerDown = null;

    // Title & buttons
    this._titleText = null;
    this._btnImg = null;
    this._btnBaseY = 0;
    this._btnPressed = false;
    this._btnPushOffset = 0;
    this._statusText = null;

    // Custom button
    this._customBtnBg = null;
    this._customBtnText = null;

    // Party state
    this._client = null;
    this._partyRoom = null;
    this._partyCode = "";
    this._partyMembers = [];
    this._isLeader = false;
    this._mySid = null;

    // Party slot UI (array of { bg, head, nameText })
    this._partySlots = [];

    // Code input UI
    this._codeLabel = null;
    this._codeBg = null;
    this._codeText = null;
    this._codeFocused = false;
    this._codeValue = "";
    this._joinBtnBg = null;
    this._joinBtnText = null;

    // Own code display
    this._myCodeLabel = null;
    this._myCodeText = null;

    // Leave party button
    this._leaveBtnBg = null;
    this._leaveBtnText = null;

    // Skin locker
    this._skinId = "default";
    this._skinsBtnBg = null;
    this._skinsBtnText = null;
    this._lockerContainer = null;
    this._lockerOpen = false;
    this._selectedSkinId = "default";

    // Settings
    this._settingsBtnBg = null;
    this._settingsBtnIcon = null;
    this._settingsOverlay = null;

    // Background video
    this._bgVideo = null;
  }

  preload() {
    this.load.image("btn_unpushed", "assets/images/StartButtonUnpushed.png");
    this.load.image("btn_pushed",   "assets/images/StartButtonPushed.png");
    this.load.image("player_head",  "assets/images/PlayerHead.png");
    this.load.audio("click",        "assets/audio/click.mp3");
    if (!this.cache.audio.exists("lobby_music")) {
      this.load.audio("lobby_music", "assets/audio/lobby_music.mp3");
    }
    this.load.video("lobby_bg_video", "assets/videos/lobby_bg.mp4");
  }

  create() {
    this._starting = false;
    this._handedOff = false;

    this.input.on("gameobjectdown", () => this.sound.play("click", { volume: 2 }));

    this.cameras.main.setBackgroundColor("#1d1f27");

    // ---- Background video ----
    this._bgVideo = this.add.video(0, 0, "lobby_bg_video")
      .setOrigin(0.5)
      .setDepth(-1)
      .setMute(true);
    this._bgVideo.play(true); // true = loop
    this._fitBgVideo();

    // ---- Title ----
    this._titleText = this.add
      .text(0, 0, "Game Development Test", {
        fontFamily: "Arial, sans-serif",
        fontSize: TITLE_FONT_SIZE,
        color: "#ffffff",
      })
      .setOrigin(0.5);

    // ---- Username input ----
    this._nameLabel = this.add
      .text(0, 0, "USERNAME", {
        fontFamily: "Arial, sans-serif",
        fontSize: NAME_LABEL_FONT_SIZE,
        color: "#cfd6ff",
      })
      .setOrigin(0.5);

    this._nameBg = this.add.rectangle(0, 0, NAME_INPUT_W, NAME_INPUT_H, 0x2d3342, 1);
    this._nameBg.setStrokeStyle(3, 0xffffff, 0.28);
    this._nameBg.setInteractive({ useHandCursor: true });

    this._nameText = this.add
      .text(0, 0, "", {
        fontFamily: "Arial, sans-serif",
        fontSize: NAME_FONT_SIZE,
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this._nameBg.on("pointerdown", () => {
      if (this._starting) return;
      this._setFocus("name");
    });

    // ---- START button (pixel-art) ----
    const BTN_PUSH_OFFSET_Y = 2 * START_BTN_SCALE;

    this._btnImg = this.add.image(0, 0, "btn_unpushed");
    this._btnImg.setScale(START_BTN_SCALE);
    this._btnImg.setOrigin(0.5, 0.5);
    this._btnImg.setInteractive({ useHandCursor: true });
    this._btnPushOffset = BTN_PUSH_OFFSET_Y;
    this._btnPressed = false;

    this._btnImg.on("pointerdown", () => {
      if (this._starting) return;
      if (this._partyMembers.length > 1) {
        this._statusText?.setText("Use CUSTOM to start with your party");
        return;
      }
      this._btnPressed = true;
      this._btnImg.setTexture("btn_pushed");
      this._btnImg.y = this._btnBaseY + this._btnPushOffset;
    });

    const releaseStartBtn = () => {
      if (!this._btnPressed) return;
      this._btnPressed = false;
      this._btnImg.setTexture("btn_unpushed");
      this._btnImg.y = this._btnBaseY;
    };

    this._btnImg.on("pointerup", () => {
      if (this._starting) return;
      if (!this._btnPressed) return;
      releaseStartBtn();
      this._startMatchmaking();
    });

    this._btnImg.on("pointerout", () => {
      releaseStartBtn();
    });

    // ---- CUSTOM button ----
    this._customBtnBg = this.add.rectangle(0, 0, CUSTOM_BTN_W, CUSTOM_BTN_H, CUSTOM_BG_COLOR, 1);
    this._customBtnBg.setStrokeStyle(CUSTOM_STROKE_WIDTH, CUSTOM_STROKE_COLOR, 1);
    this._customBtnBg.setInteractive({ useHandCursor: true });

    this._customBtnText = this.add
      .text(0, 0, "CUSTOM", {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: CUSTOM_FONT_SIZE,
        color: CUSTOM_TEXT_COLOR,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this._customBtnBg.on("pointerover", () => {
      if (this._starting) return;
      this._customBtnBg.setFillStyle(CUSTOM_BG_HOVER, 1);
    });

    this._customBtnBg.on("pointerout", () => {
      this._customBtnBg.setFillStyle(CUSTOM_BG_COLOR, 1);
    });

    this._customBtnBg.on("pointerdown", () => {
      if (this._starting) return;
      this._startCustomGame();
    });

    // ---- SKINS button ----
    this._skinId = loadSkinId();
    this._selectedSkinId = this._skinId;

    this._skinsBtnBg = this.add.rectangle(0, 0, SKINS_BTN_W, SKINS_BTN_H, SKINS_BG_COLOR, 1);
    this._skinsBtnBg.setStrokeStyle(2, 0x000000, 1);
    this._skinsBtnBg.setInteractive({ useHandCursor: true });

    this._skinsBtnText = this.add
      .text(0, 0, "SKINS", {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: SKINS_FONT_SIZE,
        color: SKINS_TEXT_COLOR,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this._skinsBtnBg.on("pointerover", () => {
      if (this._starting) return;
      this._skinsBtnBg.setFillStyle(SKINS_BG_HOVER, 1);
    });
    this._skinsBtnBg.on("pointerout", () => {
      this._skinsBtnBg.setFillStyle(SKINS_BG_COLOR, 1);
    });
    this._skinsBtnBg.on("pointerdown", () => {
      if (this._starting || this._lockerOpen) return;
      this._openLocker();
    });

    // ---- Settings button (top-right) ----
    this._settingsBtnBg = this.add.rectangle(0, 0, SETTINGS_BTN_SIZE, SETTINGS_BTN_SIZE, SETTINGS_BTN_COLOR, 0.85)
      .setStrokeStyle(2, SETTINGS_BTN_STROKE, 1)
      .setInteractive({ useHandCursor: true });
    this._settingsBtnIcon = this.add.text(0, 0, "\u2699", SETTINGS_BTN_FONT).setOrigin(0.5);

    this._settingsBtnBg.on("pointerover", () => this._settingsBtnBg.setFillStyle(SETTINGS_BTN_HOVER, 1));
    this._settingsBtnBg.on("pointerout", () => this._settingsBtnBg.setFillStyle(SETTINGS_BTN_COLOR, 0.85));
    this._settingsBtnBg.on("pointerdown", () => {
      if (this._settingsOverlay?.isOpen) return;
      if (!this._settingsOverlay) {
        this._settingsOverlay = new SettingsOverlay(this);
        this._settingsOverlay.onMusicVolumeChange = (v) => {
          if (this._lobbyMusic) this._lobbyMusic.setVolume(v);
        };
      }
      this._settingsOverlay.open();
    });

    // ---- Status text ----
    this._statusText = this.add
      .text(0, 0, "", {
        fontFamily: "Arial, sans-serif",
        fontSize: STATUS_FONT_SIZE,
        color: "#cfd6ff",
      })
      .setOrigin(0.5);

    // ---- Party slots (left side, 4 boxes) ----
    this._partySlots = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const bg = this.add.rectangle(0, 0, SLOT_SIZE, SLOT_SIZE, 0x1a1a2e, SLOT_EMPTY_ALPHA);
      bg.setStrokeStyle(3, 0xffffff, SLOT_EMPTY_STROKE);

      const head = this.add.image(0, 0, "player_head");
      const maxDim = SLOT_SIZE - SLOT_HEAD_PADDING * 2;
      const scale = Math.min(maxDim / head.width, maxDim / head.height);
      head.setScale(scale);
      head.setVisible(false);

      const nameText = this.add
        .text(0, 0, "", {
          fontFamily: "Arial, sans-serif",
          fontSize: SLOT_NAME_FONT_SIZE,
          color: "#ffffff",
        })
        .setOrigin(0.5);

      this._partySlots.push({ bg, head, nameText });
    }

    // ---- Code input + JOIN button (bottom-left) ----
    this._codeLabel = this.add
      .text(0, 0, "ENTER CODE TO JOIN", {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: CODE_LABEL_FONT_SIZE,
        color: MY_CODE_COLOR,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this._codeBg = this.add.rectangle(0, 0, CODE_INPUT_W, CODE_INPUT_H, 0x2d3342, 1);
    this._codeBg.setStrokeStyle(3, 0xffffff, 0.28);
    this._codeBg.setInteractive({ useHandCursor: true });

    this._codeText = this.add
      .text(0, 0, "", {
        fontFamily: "Arial, sans-serif",
        fontSize: CODE_FONT_SIZE,
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this._codeBg.on("pointerdown", () => {
      if (this._starting) return;
      this._setFocus("code");
    });

    // JOIN button
    this._joinBtnBg = this.add.rectangle(0, 0, JOIN_BTN_W, CODE_INPUT_H, JOIN_BG_COLOR, 1);
    this._joinBtnBg.setStrokeStyle(3, 0x000000, 1);
    this._joinBtnBg.setInteractive({ useHandCursor: true });

    this._joinBtnText = this.add
      .text(0, 0, "JOIN", {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: JOIN_FONT_SIZE,
        color: JOIN_TEXT_COLOR,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this._joinBtnBg.on("pointerover", () => {
      this._joinBtnBg.setFillStyle(JOIN_BG_HOVER, 1);
    });
    this._joinBtnBg.on("pointerout", () => {
      this._joinBtnBg.setFillStyle(JOIN_BG_COLOR, 1);
    });
    this._joinBtnBg.on("pointerdown", () => {
      if (this._starting) return;
      this._joinPartyByCode();
    });

    // ---- Own party code display ----
    this._myCodeLabel = this.add
      .text(0, 0, "YOUR PARTY CODE", {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: MY_CODE_LABEL_FONT_SIZE,
        color: MY_CODE_COLOR,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this._myCodeText = this.add
      .text(0, 0, "------", {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: MY_CODE_FONT_SIZE,
        color: MY_CODE_COLOR,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    // ---- Leave party button ----
    this._leaveBtnBg = this.add.rectangle(0, 0, LEAVE_BTN_W, LEAVE_BTN_H, LEAVE_BG_COLOR, 1);
    this._leaveBtnBg.setStrokeStyle(2, LEAVE_STROKE_COLOR, 0.6);
    this._leaveBtnBg.setInteractive({ useHandCursor: true });
    this._leaveBtnBg.setVisible(false);

    this._leaveBtnText = this.add
      .text(0, 0, "LEAVE PARTY", {
        fontFamily: "Arial, sans-serif",
        fontSize: LEAVE_FONT_SIZE,
        color: LEAVE_TEXT_COLOR,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this._leaveBtnText.setVisible(false);

    this._leaveBtnBg.on("pointerover", () => {
      this._leaveBtnBg.setFillStyle(LEAVE_BG_HOVER, 1);
    });
    this._leaveBtnBg.on("pointerout", () => {
      this._leaveBtnBg.setFillStyle(LEAVE_BG_COLOR, 1);
    });
    this._leaveBtnBg.on("pointerdown", () => {
      if (this._starting) return;
      this._leaveParty();
    });

    // ---- Global click: unfocus inputs ----
    this._onGlobalPointerDown = (_pointer, targets) => {
      if (this._starting) return;
      const arr = Array.isArray(targets) ? targets : [];
      const clickedName = arr.includes(this._nameBg);
      const clickedCode = arr.includes(this._codeBg);
      if (!clickedName && !clickedCode) {
        this._setFocus(null);
      } else if (clickedName) {
        // name box handler already sets focus
      } else if (clickedCode) {
        // code box handler already sets focus
      }
    };
    this.input.on("pointerdown", this._onGlobalPointerDown);

    // ---- Keyboard input ----
    this._onKeyDown = (ev) => this._handleKey(ev);
    this.input.keyboard.on("keydown", this._onKeyDown);

    // ---- Caret blink ----
    this._caretVisible = true;
    this._caretTimer = this.time.addEvent({
      delay: 450,
      loop: true,
      callback: () => {
        if (!this._nameFocused && !this._codeFocused) return;
        this._caretVisible = !this._caretVisible;
        this._refreshNameField();
        this._refreshCodeField();
      },
    });

    // ---- Cleanup on scene end ----
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this._cleanup());

    // ---- Initial draw ----
    this._setFocus(null);
    this._refreshNameField();
    this._refreshCodeField();
    this._redrawPartySlots();
    this._updateLeaveButtonVisibility();

    this.layout();
    this._onResize = () => this.layout();
    this.scale.on("resize", this._onResize);

    // ---- Lobby music ----
    const _settings = loadSettings();
    this.sound.volume = _settings.volume;
    if (!this.sound.get("lobby_music")?.isPlaying) {
      const musicVol = _settings.musicVolume ?? LOBBY_MUSIC_VOLUME;
      this._lobbyMusic = this.sound.add("lobby_music", { loop: true, volume: musicVol });
      if (this.sound.locked) {
        // Browser autoplay policy: play as soon as first user gesture unlocks audio
        this.sound.once("unlocked", () => {
          if (!this._lobbyMusic?.isPlaying) this._lobbyMusic?.play();
        });
      } else {
        this._lobbyMusic.play();
      }
    }

    // ---- Connect to party room ----
    this._connectToParty();
  }

  // ============================================================
  // Layout
  // ============================================================

  _fitBgVideo() {
    if (!this._bgVideo) return;
    const w = this.scale.width;
    const h = this.scale.height;
    this._bgVideo.setPosition(w / 2, h / 2);
    // Play at native resolution (scale=1), centered — edges crop to fit the canvas
    this._bgVideo.setScale(1);
  }

  layout() {
    const w = this.scale ? this.scale.width : 0;
    const h = this.scale ? this.scale.height : 0;
    const cam = this.cameras?.main;
    const cx = cam ? cam.centerX : w * 0.5;
    const cy = cam ? cam.centerY : h * 0.5;

    this._fitBgVideo();

    // ---- Party slots (left column) ----
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = this._partySlots[i];
      const sx = SLOT_X;
      const sy = SLOT_START_Y + i * (SLOT_SIZE + SLOT_GAP) + SLOT_SIZE / 2;
      slot.bg.setPosition(sx, sy);
      slot.head.setPosition(sx, sy + SLOT_HEAD_OFFSET_Y);
      slot.nameText.setPosition(sx, sy + SLOT_SIZE / 2 + SLOT_NAME_OFFSET_Y);
    }

    // ---- Center column (title, username, START, CUSTOM) ----
    this._titleText?.setPosition(cx, cy + TITLE_OFFSET_Y);
    this._nameLabel?.setPosition(cx, cy + NAME_LABEL_OFFSET_Y);
    this._nameBg?.setPosition(cx, cy + NAME_INPUT_OFFSET_Y);
    this._nameText?.setPosition(cx, cy + NAME_INPUT_OFFSET_Y);

    this._btnBaseY = cy + START_BTN_OFFSET_Y;
    if (this._btnImg) {
      this._btnImg.x = cx;
      this._btnImg.y = this._btnPressed
        ? this._btnBaseY + this._btnPushOffset
        : this._btnBaseY;
    }

    const customY = cy + CUSTOM_BTN_OFFSET_Y;
    this._customBtnBg?.setPosition(cx, customY);
    this._customBtnText?.setPosition(cx, customY);

    this._statusText?.setPosition(cx, cy + STATUS_OFFSET_Y);

    // ---- SKINS button ----
    const skinsY = cy + SKINS_BTN_OFFSET_Y;
    this._skinsBtnBg?.setPosition(cx, skinsY);
    this._skinsBtnText?.setPosition(cx, skinsY);

    // ---- Locker panel (centered) ----
    if (this._lockerContainer) {
      this._lockerContainer.setPosition(cx, cy);
    }

    // ---- Bottom-left: code input area ----
    const codeAreaX = CODE_AREA_X;
    const codeAreaY = h + CODE_AREA_OFFSET_Y;

    this._codeLabel?.setPosition(codeAreaX + CODE_LABEL_OFFSET_X, codeAreaY + CODE_LABEL_OFFSET_Y);

    const codeFieldX = codeAreaX + CODE_INPUT_SHIFT_X;
    const codeFieldY = codeAreaY + CODE_INPUT_SHIFT_Y;
    const joinBtnX   = codeFieldX + CODE_INPUT_W / 2 + JOIN_BTN_W / 2 + JOIN_BTN_GAP;
    this._codeBg?.setPosition(codeFieldX, codeFieldY);
    this._codeText?.setPosition(codeFieldX, codeFieldY);
    this._joinBtnBg?.setPosition(joinBtnX, codeFieldY);
    this._joinBtnText?.setPosition(joinBtnX, codeFieldY);

    this._myCodeLabel?.setPosition(codeAreaX + MY_CODE_LABEL_OFFSET_X, codeAreaY + MY_CODE_LABEL_OFFSET_Y);
    this._myCodeText?.setPosition(codeAreaX + MY_CODE_TEXT_OFFSET_X, codeAreaY + MY_CODE_TEXT_OFFSET_Y);

    this._leaveBtnBg?.setPosition(codeAreaX + LEAVE_BTN_OFFSET_X, codeAreaY + LEAVE_BTN_OFFSET_Y);
    this._leaveBtnText?.setPosition(codeAreaX + LEAVE_BTN_OFFSET_X, codeAreaY + LEAVE_BTN_OFFSET_Y);

    // ---- Settings button (top-right) ----
    const settingsX = w - SETTINGS_BTN_MARGIN - SETTINGS_BTN_SIZE / 2;
    const settingsY = SETTINGS_BTN_MARGIN + SETTINGS_BTN_SIZE / 2;
    this._settingsBtnBg?.setPosition(settingsX, settingsY);
    this._settingsBtnIcon?.setPosition(settingsX, settingsY);
  }

  // ============================================================
  // Party connection
  // ============================================================

  async _connectToParty() {
    try {
      if (!this._client) {
        this._client = new Client(COLYSEUS_URL);
      }
      const name = this._getFinalUsername();

      // IMPORTANT: use create(), NOT joinOrCreate().
      // joinOrCreate would put every player into the same existing room.
      // Each player must get their OWN party room with a unique code.
      this._partyRoom = await this._client.create("party", { username: name, skinId: this._skinId });
      this._mySid = this._partyRoom.sessionId;

      this._setupPartyListeners();
    } catch (err) {
      console.error("[MainMenu] Party connection failed:", err);
      this._statusText?.setText("Could not connect to server");
    }
  }

  _setupPartyListeners() {
    if (!this._partyRoom) return;

    this._partyRoom.onMessage("partyUpdate", (msg) => {
      this._onPartyUpdate(msg);
    });

    this._partyRoom.onMessage("matchFound", (reservation) => {
      this._handleMatchFound(reservation);
    });

    this._partyRoom.onMessage("error", (msg) => {
      this._statusText?.setText(msg?.message || "Error");
    });

    this._partyRoom.onLeave(() => {
      // Only reset state if we didn't intentionally leave for a game
      if (!this._handedOff && !this._starting) {
        this._partyRoom = null;
        this._partyMembers = [];
        this._partyCode = "";
        this._redrawPartySlots();
        this._refreshMyCode();
        this._updateLeaveButtonVisibility();
      }
    });
  }

  _onPartyUpdate(msg) {
    this._partyCode = msg.partyCode || "";
    this._partyMembers = msg.members || [];
    this._isLeader = msg.leaderSid === this._mySid;
    this._redrawPartySlots();
    this._refreshMyCode();
    this._updateLeaveButtonVisibility();
  }

  _redrawPartySlots() {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = this._partySlots[i];
      const member = this._partyMembers[i];

      if (member) {
        slot.head.setVisible(true);
        slot.bg.setStrokeStyle(3, 0xffffff, SLOT_FILLED_STROKE);
        slot.bg.setFillStyle(0x1a1a2e, SLOT_FILLED_ALPHA);
        slot.nameText.setText(member.username || "Player");
        // Apply skin tint to head
        const skinDef = SKIN_CATALOG[member.skinId || "default"];
        if (skinDef?.tint) slot.head.setTint(skinDef.tint);
        else slot.head.clearTint();
      } else {
        slot.head.setVisible(false);
        slot.head.clearTint();
        slot.bg.setStrokeStyle(3, 0xffffff, SLOT_EMPTY_STROKE);
        slot.bg.setFillStyle(0x1a1a2e, SLOT_EMPTY_ALPHA);
        slot.nameText.setText("");
      }
    }
  }

  _refreshMyCode() {
    if (this._myCodeText) {
      this._myCodeText.setText(this._partyCode || "------");
    }
  }

  _updateLeaveButtonVisibility() {
    // Show leave button when in a party with others (whether leader or not)
    const show = this._partyMembers.length > 1;
    this._leaveBtnBg?.setVisible(show);
    this._leaveBtnText?.setVisible(show);
  }

  // ============================================================
  // Actions
  // ============================================================

  _getFinalUsername() {
    const name = String(this._username ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 12);
    return name || "Player";
  }

  _startMatchmaking() {
    if (this._starting) return;
    if (this._partyMembers.length > 1) {
      this._statusText?.setText("Use CUSTOM to start with your party");
      return;
    }

    this._starting = true;
    this._username = this._getFinalUsername();
    this._statusText?.setText(`Entering queue as: ${this._username}`);

    // Leave party room (we're going solo into matchmaking)
    try { this._partyRoom?.leave(); } catch (_) {}
    this._partyRoom = null;

    this._fadeOutMusic(() => {
      this.scene.start("MatchmakingScene", { username: this._username, skinId: this._skinId });
    });
  }

  async _startCustomGame() {
    if (this._starting) return;

    if (!this._partyRoom) {
      this._statusText?.setText("Not connected to party");
      return;
    }

    if (!this._isLeader) {
      this._statusText?.setText("Only the party leader can start");
      return;
    }

    // Update username + skin before starting
    const name = this._getFinalUsername();
    this._username = name;
    try { this._partyRoom.send("setName", { name, skinId: this._skinId }); } catch (_) {}

    this._statusText?.setText("Starting custom game...");
    this._partyRoom.send("customStart");
  }

  async _joinPartyByCode() {
    if (this._starting) return;

    const code = this._codeValue.toUpperCase().trim();
    if (code.length !== 6) {
      this._statusText?.setText("Enter a 6-character party code");
      return;
    }

    // Don't join your own party
    if (code === this._partyCode) {
      this._statusText?.setText("That's your own party code!");
      return;
    }

    this._statusText?.setText("Joining party...");

    try {
      // Look up the room ID via REST
      const resp = await fetch(`${COLYSEUS_URL}/party/lookup?code=${code}`);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        this._statusText?.setText(data.error || "Party not found");
        return;
      }
      const { roomId } = await resp.json();

      // Leave current party room first
      const oldRoom = this._partyRoom;
      this._partyRoom = null;
      try { await oldRoom?.leave(); } catch (_) {}

      // Join the friend's party
      const name = this._getFinalUsername();
      this._username = name;
      this._partyRoom = await this._client.joinById(roomId, { username: name, skinId: this._skinId });
      this._mySid = this._partyRoom.sessionId;

      this._setupPartyListeners();

      this._codeValue = "";
      this._refreshCodeField();
      this._statusText?.setText("Joined party!");
    } catch (err) {
      console.error("[MainMenu] Join party failed:", err);
      this._statusText?.setText("Failed to join party");
      // Reconnect to our own fresh party
      this._connectToParty();
    }
  }

  async _leaveParty() {
    if (this._starting) return;

    const oldRoom = this._partyRoom;
    this._partyRoom = null;
    this._partyMembers = [];
    this._partyCode = "";
    this._redrawPartySlots();
    this._refreshMyCode();
    this._updateLeaveButtonVisibility();
    this._statusText?.setText("Left party");

    try { await oldRoom?.leave(); } catch (_) {}

    // Create a fresh solo party
    this._connectToParty();
  }

  async _handleMatchFound(reservation) {
    if (this._starting) return;
    this._starting = true;
    this._handedOff = true;

    // Save party member count BEFORE leaving the party room,
    // because the onLeave callback would clear _partyMembers.
    const playerCount = Math.max(1, this._partyMembers.length);

    this._statusText?.setText("Starting game...");

    try {
      const gameRoom = await this._client.consumeSeatReservation(reservation);

      // Send name + skin immediately
      const name = this._getFinalUsername();
      this._username = name;
      try { gameRoom.send("setName", { name, skinId: this._skinId }); } catch (_) {}

      // Leave party room (handedOff=true prevents onLeave from resetting state)
      try { await this._partyRoom?.leave(); } catch (_) {}
      this._partyRoom = null;

      this._fadeOutMusic(() => {
        this.scene.start("InterimScene", {
          room:        gameRoom,
          client:      this._client,
          username:    this._username,
          playerCount: playerCount,
          skinId:      this._skinId,
        });
      });
    } catch (err) {
      console.error("[MainMenu] Failed to consume reservation:", err);
      this._starting = false;
      this._handedOff = false;
      this._statusText?.setText("Failed to join game");
    }
  }

  // ============================================================
  // Skin locker panel
  // ============================================================

  _openLocker() {
    if (this._lockerContainer) return;
    this._lockerOpen = true;
    this._selectedSkinId = this._skinId;

    const cam = this.cameras?.main;
    const cx = cam ? cam.centerX : 0;
    const cy = cam ? cam.centerY : 0;

    const children = [];

    // Dark backdrop (full panel)
    const overlay = this.add.rectangle(0, 0, LOCKER_PANEL_W + 40, LOCKER_PANEL_H + 40, 0x000000, 0.7);
    overlay.setInteractive(); // block clicks behind
    children.push(overlay);

    // Panel background
    const panelBg = this.add.rectangle(0, 0, LOCKER_PANEL_W, LOCKER_PANEL_H, LOCKER_BG_COLOR, 1);
    panelBg.setStrokeStyle(3, 0x444466, 1);
    children.push(panelBg);

    // Title
    const title = this.add.text(0, -LOCKER_PANEL_H / 2 + 30, "SKIN LOCKER", {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: LOCKER_TITLE_SIZE,
      color: "#d0aaff",
      fontStyle: "bold",
    }).setOrigin(0.5);
    children.push(title);

    // Close button
    const closeBtn = this.add.text(LOCKER_PANEL_W / 2 - 24, -LOCKER_PANEL_H / 2 + 12, "X", {
      fontFamily: "Arial, sans-serif",
      fontSize: "24px",
      color: "#ff6666",
      fontStyle: "bold",
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeBtn.on("pointerdown", () => this._closeLocker());
    children.push(closeBtn);

    // Grid of skin cards
    const totalW = LOCKER_GRID_COLS * LOCKER_CARD_W + (LOCKER_GRID_COLS - 1) * LOCKER_CARD_GAP;
    const startX = -totalW / 2 + LOCKER_CARD_W / 2;
    const startY = -LOCKER_PANEL_H / 2 + 90;

    this._lockerCards = [];

    SKIN_IDS.forEach((skinId, i) => {
      const col = i % LOCKER_GRID_COLS;
      const row = Math.floor(i / LOCKER_GRID_COLS);
      const cardX = startX + col * (LOCKER_CARD_W + LOCKER_CARD_GAP);
      const cardY = startY + row * (LOCKER_CARD_H + LOCKER_CARD_GAP) + LOCKER_CARD_H / 2;

      const def = SKIN_CATALOG[skinId];

      // Card background
      const cardBg = this.add.rectangle(cardX, cardY, LOCKER_CARD_W, LOCKER_CARD_H, 0x222244, 1);
      const isSelected = skinId === this._selectedSkinId;
      cardBg.setStrokeStyle(3, isSelected ? LOCKER_HIGHLIGHT : 0x444466, isSelected ? 1 : 0.5);
      cardBg.setInteractive({ useHandCursor: true });
      children.push(cardBg);

      // Player head preview with tint
      const head = this.add.image(cardX, cardY - 20, "player_head");
      const maxDim = LOCKER_CARD_W - 40;
      const scale = Math.min(maxDim / head.width, maxDim / head.height);
      head.setScale(scale);
      if (def.tint) head.setTint(def.tint);
      children.push(head);

      // Skin name
      const nameLabel = this.add.text(cardX, cardY + LOCKER_CARD_H / 2 - 24, def.name, {
        fontFamily: "Arial, sans-serif",
        fontSize: LOCKER_NAME_SIZE,
        color: "#cccccc",
      }).setOrigin(0.5);
      children.push(nameLabel);

      // Equipped indicator
      let equippedLabel = null;
      if (skinId === this._skinId) {
        equippedLabel = this.add.text(cardX, cardY - LOCKER_CARD_H / 2 + 14, "EQUIPPED", {
          fontFamily: "Arial, sans-serif",
          fontSize: "10px",
          color: "#88ff88",
          fontStyle: "bold",
        }).setOrigin(0.5);
        children.push(equippedLabel);
      }

      cardBg.on("pointerdown", () => {
        this._selectedSkinId = skinId;
        this._refreshLockerSelection();
      });

      this._lockerCards.push({ skinId, cardBg, equippedLabel });
    });

    // Equip button
    const equipY = LOCKER_PANEL_H / 2 - 40;
    const equipBg = this.add.rectangle(0, equipY, LOCKER_EQUIP_W, LOCKER_EQUIP_H, 0x2a6b2a, 1);
    equipBg.setStrokeStyle(2, 0x000000, 1);
    equipBg.setInteractive({ useHandCursor: true });
    children.push(equipBg);

    const equipText = this.add.text(0, equipY, "EQUIP", {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: "22px",
      color: "#e0ffe0",
      fontStyle: "bold",
    }).setOrigin(0.5);
    children.push(equipText);

    equipBg.on("pointerover", () => equipBg.setFillStyle(0x3a8f3a, 1));
    equipBg.on("pointerout", () => equipBg.setFillStyle(0x2a6b2a, 1));
    equipBg.on("pointerdown", () => {
      this._skinId = this._selectedSkinId;
      saveSkinId(this._skinId);
      if (this._partyRoom) {
        try { this._partyRoom.send("setSkin", { skinId: this._skinId }); } catch (_) {}
      }
      this._closeLocker();
    });

    this._lockerContainer = this.add.container(cx, cy, children);
    this._lockerContainer.setDepth(1000);
  }

  _refreshLockerSelection() {
    if (!this._lockerCards) return;
    for (const card of this._lockerCards) {
      const isSelected = card.skinId === this._selectedSkinId;
      card.cardBg.setStrokeStyle(3, isSelected ? LOCKER_HIGHLIGHT : 0x444466, isSelected ? 1 : 0.5);
    }
  }

  _closeLocker() {
    if (this._lockerContainer) {
      this._lockerContainer.destroy(true);
      this._lockerContainer = null;
    }
    this._lockerCards = null;
    this._lockerOpen = false;
  }

  // ============================================================
  // Input handling (dual text fields)
  // ============================================================

  _setFocus(field) {
    this._nameFocused = field === "name";
    this._codeFocused = field === "code";
    this._caretVisible = true;

    if (this._nameBg) {
      this._nameBg.setStrokeStyle(3, 0xffffff, this._nameFocused ? 0.55 : 0.28);
    }
    if (this._codeBg) {
      this._codeBg.setStrokeStyle(3, 0xffffff, this._codeFocused ? 0.55 : 0.28);
    }

    this._refreshNameField();
    this._refreshCodeField();
  }

  _refreshNameField() {
    if (!this._nameText) return;
    const raw = String(this._username ?? "");
    if (!raw && !this._nameFocused) {
      this._nameText.setColor("#aab3ff");
      this._nameText.setText("Enter username...");
      return;
    }
    this._nameText.setColor("#ffffff");
    const caret = this._nameFocused && this._caretVisible ? "|" : "";
    this._nameText.setText(`${raw}${caret}`);
  }

  _refreshCodeField() {
    if (!this._codeText) return;
    const raw = String(this._codeValue ?? "");
    if (!raw && !this._codeFocused) {
      this._codeText.setColor("#aab3ff");
      this._codeText.setText("");
      return;
    }
    this._codeText.setColor("#ffffff");
    const caret = this._codeFocused && this._caretVisible ? "|" : "";
    this._codeText.setText(`${raw}${caret}`);
  }

  _handleKey(ev) {
    if (this._starting) return;
    const key = ev?.key;
    if (!key) return;

    if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta" || key === "Tab")
      return;

    if (this._nameFocused) {
      this._handleNameKey(key);
    } else if (this._codeFocused) {
      this._handleCodeKey(key);
    }
  }

  _handleNameKey(key) {
    if (key === "Enter") {
      this._startMatchmaking();
      return;
    }
    if (key === "Escape") {
      this._setFocus(null);
      return;
    }
    if (key === "Backspace") {
      this._username = String(this._username ?? "").slice(0, -1);
      this._refreshNameField();
      return;
    }
    if (key.length === 1 && /^[a-zA-Z0-9 _\-]$/.test(key)) {
      const cur = String(this._username ?? "");
      if (cur.length >= 12) return;
      this._username = cur + key;
      this._refreshNameField();
      if (this._partyRoom) {
        try { this._partyRoom.send("setName", { name: this._username }); } catch (_) {}
      }
    }
  }

  _handleCodeKey(key) {
    if (key === "Enter") {
      this._joinPartyByCode();
      return;
    }
    if (key === "Escape") {
      this._setFocus(null);
      return;
    }
    if (key === "Backspace") {
      this._codeValue = String(this._codeValue ?? "").slice(0, -1);
      this._refreshCodeField();
      return;
    }
    if (key.length === 1 && /^[0-9]$/.test(key)) {
      const cur = String(this._codeValue ?? "");
      if (cur.length >= 6) return;
      this._codeValue = cur + key;
      this._refreshCodeField();
    }
  }

  // ============================================================
  // Music helpers
  // ============================================================

  _fadeOutMusic(onDone, duration = 500) {
    if (!this._lobbyMusic?.isPlaying) { onDone?.(); return; }
    this.tweens.add({
      targets: this._lobbyMusic,
      volume: 0,
      duration,
      onComplete: () => {
        try { this._lobbyMusic?.stop(); } catch (_) {}
        onDone?.();
      },
    });
  }

  // ============================================================
  // Cleanup
  // ============================================================

  _cleanup() {
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

    // Close locker if open
    this._closeLocker();

    // Settings overlay
    try { this._settingsOverlay?.destroy(); } catch (_) {}
    this._settingsOverlay = null;

    // Stop lobby music (fade should have already stopped it; this is a safety net)
    try { this._lobbyMusic?.stop(); } catch (_) {}
    this._lobbyMusic = null;

    // Stop background video
    try { this._bgVideo?.stop(); } catch (_) {}
    this._bgVideo = null;

    // Leave party room if we didn't hand off to a game
    if (!this._handedOff) {
      try { this._partyRoom?.leave(); } catch (_) {}
      this._partyRoom = null;
      this._client = null;
    }
  }
}

// ============================================================
// settings.js
// Persistent settings (localStorage) + reusable SettingsOverlay
// that any Phaser scene can instantiate.
// ============================================================

// ---- localStorage keys & defaults ----
const STORAGE_KEY = "getaway_settings";
const DEFAULTS = { volume: 0.5, musicVolume: 0.25, tiltSensitivity: 0.25 };

// ---- Overlay visual constants ----
const PANEL_W = 480;
const PANEL_H = 440;
const PANEL_COLOR = 0x1a1f2e;
const PANEL_ALPHA = 0.97;
const PANEL_RADIUS = 18;
const PANEL_STROKE_COLOR = 0x3a4260;
const PANEL_STROKE_W = 3;

const BACKDROP_COLOR = 0x000000;
const BACKDROP_ALPHA = 0.55;

const TITLE_FONT = { fontFamily: "Arial, sans-serif", fontSize: "32px", color: "#ffffff" };
const LABEL_FONT = { fontFamily: "Arial, sans-serif", fontSize: "20px", color: "#c0c8e0" };
const VALUE_FONT = { fontFamily: "Arial, sans-serif", fontSize: "18px", color: "#ffffff" };
const CLOSE_FONT = { fontFamily: "Arial, sans-serif", fontSize: "28px", color: "#ffffff" };

const TRACK_W = 300;
const TRACK_H = 8;
const TRACK_COLOR = 0x3a4260;
const TRACK_FILL_COLOR = 0x4a90d9;
const KNOB_R = 14;
const KNOB_COLOR = 0xffffff;

const SLIDER_START_Y = 100; // offset from panel top
const SLIDER_GAP_Y = 100;

const DEPTH = 9999;

// ---- Persistence helpers ----

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        volume: clamp01(parsed.volume ?? DEFAULTS.volume),
        musicVolume: clamp01(parsed.musicVolume ?? DEFAULTS.musicVolume),
        tiltSensitivity: clamp01(parsed.tiltSensitivity ?? DEFAULTS.tiltSensitivity),
      };
    }
  } catch (_) {}
  return { ...DEFAULTS };
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (_) {}
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

// ============================================================
// SettingsOverlay — self-contained Phaser settings panel
// ============================================================

export class SettingsOverlay {
  constructor(scene) {
    this._scene = scene;
    this._objects = [];       // all created display objects (for cleanup)
    this._open = false;
    this._settings = loadSettings();
    this._onDrag = null;
    this._onResize = null;
    // Set externally to receive live updates as the music slider moves
    this.onMusicVolumeChange = null;
  }

  get isOpen() {
    return this._open;
  }

  // ---- public API ----

  open() {
    if (this._open) return;
    this._open = true;
    this._settings = loadSettings();
    this._build();
  }

  close() {
    if (!this._open) return;
    this._open = false;
    saveSettings(this._settings);
    this._destroy();
    if (this.onClose) this.onClose(this._settings);
  }

  destroy() {
    this._destroy();
  }

  // ---- internal ----

  _build() {
    const s = this._scene;
    const cx = s.scale.width / 2;
    const cy = s.scale.height / 2;

    // Backdrop
    const backdrop = s.add.rectangle(s.scale.width / 2, s.scale.height / 2,
      s.scale.width, s.scale.height, BACKDROP_COLOR, BACKDROP_ALPHA)
      .setDepth(DEPTH)
      .setInteractive(); // block clicks through
    this._objects.push(backdrop);

    // Panel background
    const panelGfx = s.add.graphics().setDepth(DEPTH + 1);
    panelGfx.fillStyle(PANEL_COLOR, PANEL_ALPHA);
    panelGfx.fillRoundedRect(cx - PANEL_W / 2, cy - PANEL_H / 2, PANEL_W, PANEL_H, PANEL_RADIUS);
    panelGfx.lineStyle(PANEL_STROKE_W, PANEL_STROKE_COLOR, 1);
    panelGfx.strokeRoundedRect(cx - PANEL_W / 2, cy - PANEL_H / 2, PANEL_W, PANEL_H, PANEL_RADIUS);
    this._objects.push(panelGfx);

    // Title
    const title = s.add.text(cx, cy - PANEL_H / 2 + 40, "Settings", TITLE_FONT)
      .setOrigin(0.5).setDepth(DEPTH + 2);
    this._objects.push(title);

    // Close X button
    const closeBtn = s.add.text(cx + PANEL_W / 2 - 30, cy - PANEL_H / 2 + 16, "\u2715", CLOSE_FONT)
      .setOrigin(0.5).setDepth(DEPTH + 2)
      .setInteractive({ useHandCursor: true });
    closeBtn.on("pointerover", () => closeBtn.setColor("#ff6666"));
    closeBtn.on("pointerout", () => closeBtn.setColor("#ffffff"));
    closeBtn.on("pointerdown", () => this.close());
    this._objects.push(closeBtn);

    // Sliders
    const panelTop = cy - PANEL_H / 2;
    this._buildSlider(s, cx, panelTop + SLIDER_START_Y, "Volume",
      this._settings.volume, (v) => { this._settings.volume = v; });
    this._buildSlider(s, cx, panelTop + SLIDER_START_Y + SLIDER_GAP_Y, "Music Volume",
      this._settings.musicVolume, (v) => {
        this._settings.musicVolume = v;
        if (this.onMusicVolumeChange) this.onMusicVolumeChange(v);
      });
    this._buildSlider(s, cx, panelTop + SLIDER_START_Y + SLIDER_GAP_Y * 2, "Tilt Sensitivity",
      this._settings.tiltSensitivity, (v) => { this._settings.tiltSensitivity = v; });

    // Drag handler
    this._onDrag = (_pointer, obj, dragX) => {
      if (!obj.getData("isSettingsKnob")) return;
      const trackLeft = obj.getData("trackLeft");
      const trackRight = obj.getData("trackRight");
      const clamped = Math.max(trackLeft, Math.min(trackRight, dragX));
      obj.x = clamped;
      const pct = (clamped - trackLeft) / (trackRight - trackLeft);
      const cb = obj.getData("onChange");
      if (cb) cb(pct);
      // Update fill bar
      const fill = obj.getData("fill");
      if (fill) {
        fill.clear();
        fill.fillStyle(TRACK_FILL_COLOR, 1);
        fill.fillRoundedRect(trackLeft, obj.y - TRACK_H / 2, clamped - trackLeft, TRACK_H, TRACK_H / 2);
      }
      // Update value label
      const valLabel = obj.getData("valLabel");
      if (valLabel) valLabel.setText(Math.round(pct * 100) + "%");
    };
    s.input.on("drag", this._onDrag);

    // Handle resize
    this._onResize = () => {
      if (this._open) {
        this._destroy();
        this._build();
      }
    };
    s.scale.on("resize", this._onResize);
  }

  _buildSlider(scene, cx, y, label, value, onChange) {
    const trackLeft = cx - TRACK_W / 2;
    const trackRight = cx + TRACK_W / 2;

    // Label
    const lbl = scene.add.text(cx - TRACK_W / 2, y - 28, label, LABEL_FONT)
      .setOrigin(0, 0.5).setDepth(DEPTH + 2);
    this._objects.push(lbl);

    // Value text
    const valLabel = scene.add.text(cx + TRACK_W / 2, y - 28, Math.round(value * 100) + "%", VALUE_FONT)
      .setOrigin(1, 0.5).setDepth(DEPTH + 2);
    this._objects.push(valLabel);

    // Track background
    const trackBg = scene.add.graphics().setDepth(DEPTH + 2);
    trackBg.fillStyle(TRACK_COLOR, 1);
    trackBg.fillRoundedRect(trackLeft, y - TRACK_H / 2, TRACK_W, TRACK_H, TRACK_H / 2);
    this._objects.push(trackBg);

    // Track fill
    const fillW = value * TRACK_W;
    const trackFill = scene.add.graphics().setDepth(DEPTH + 2);
    trackFill.fillStyle(TRACK_FILL_COLOR, 1);
    trackFill.fillRoundedRect(trackLeft, y - TRACK_H / 2, fillW, TRACK_H, TRACK_H / 2);
    this._objects.push(trackFill);

    // Knob
    const knobX = trackLeft + value * TRACK_W;
    const knob = scene.add.circle(knobX, y, KNOB_R, KNOB_COLOR)
      .setDepth(DEPTH + 3)
      .setInteractive({ useHandCursor: true, draggable: true });
    knob.setData("isSettingsKnob", true);
    knob.setData("trackLeft", trackLeft);
    knob.setData("trackRight", trackRight);
    knob.setData("onChange", onChange);
    knob.setData("fill", trackFill);
    knob.setData("valLabel", valLabel);
    this._objects.push(knob);

    // Make knob look interactive on hover
    knob.on("pointerover", () => knob.setScale(1.2));
    knob.on("pointerout", () => knob.setScale(1));
  }

  _destroy() {
    const s = this._scene;
    if (this._onDrag) {
      s.input.off("drag", this._onDrag);
      this._onDrag = null;
    }
    if (this._onResize) {
      s.scale.off("resize", this._onResize);
      this._onResize = null;
    }
    for (const obj of this._objects) {
      try { obj.destroy(); } catch (_) {}
    }
    this._objects = [];
  }
}

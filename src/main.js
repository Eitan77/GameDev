import Phaser from "phaser";
import MainMenuScene from "./MainMenuScene.js";
import GameScene from "./GameScene.js";

// Start in MainMenuScene. GameScene only runs after START is clicked.
new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: 1600,
  height: 800,
  backgroundColor: "#1d1f27",
  scene: [MainMenuScene, GameScene],
});

import Phaser from "phaser";
import GameScene from "./GameScene.js";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: 960,
  height: 540,
  backgroundColor: "#1d1f27",
  scene: [GameScene],
});

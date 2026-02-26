import Phaser from "phaser";
import MainMenuScene from "./MainMenuScene.js";
import MatchmakingScene from "./MatchmakingScene.js";
import GameScene from "./GameScene.js";
import UIScene from "./UIScene.js";

// Start in MainMenuScene.
// START -> MatchmakingScene -> GameScene
// UIScene is an overlay HUD scene (health + timer).
new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: 1600,
  height: 800,
  backgroundColor: "#1d1f27",
  scene: [MainMenuScene, MatchmakingScene, GameScene, UIScene],
});
import Phaser from "phaser";
import MainMenuScene from "./MainMenuScene.js";
import MatchmakingScene from "./MatchmakingScene.js";
import GameScene from "./GameScene.js";

// Start in MainMenuScene.
// START -> MatchmakingScene (queue UI) -> GameScene (actual match)
new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: 1600,
  height: 800,
  backgroundColor: "#1d1f27",
  scene: [MainMenuScene, MatchmakingScene, GameScene],
});
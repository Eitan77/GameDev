# Getaway Proto - Project Guide

## Quick Summary
A multiplayer browser-based top-down shooter game built with **Phaser 3** and **Colyseus** networking. Players compete in arena combat with guns, powerups, and environmental obstacles.

## Tech Stack
- **Framework**: Phaser 3 (game engine)
- **Networking**: Colyseus SDK (multiplayer, server-authoritative)
- **Physics**: Planck.js (server-side physics, client-render only)
- **Build**: Vite 7
- **Maps**: Tiled Editor (imported as JSON)
- **Dependencies**: phaser, @colyseus/sdk, planck

## Project Structure
```
src/
  ├── main.js                  # Entry point, Phaser game config
  ├── MainMenuScene.js         # Initial scene (login/UI)
  ├── MatchmakingScene.js      # Queue system, seat reservation
  ├── InterimScene.js          # Between-round screen (scores, countdown)
  ├── GameScene.js             # Main gameplay (render-only)
  ├── UIScene.js               # HUD overlay (health, timer)
  ├── GameMap.js               # Tiled map loading & setup
  ├── player.js                # Player class (client-side rendering)
  ├── gunCatalog.js            # Gun definitions & preload
  ├── GunPowerUp.js            # Gun pickup entities
  ├── PowerUp.js               # Other powerups
  ├── VisibilityManager.js     # Camera/rendering visibility logic
  └── counter.js               # Score/timer utilities

public/                         # Static assets (images, maps)
server/
  └── src/
      ├── rooms/
      │   ├── LobbyRoom.js         # Main game room: physics, logic, checkpoints, kills, rounds
      │   ├── MatchmakingRoom.js   # Queue management, seat reservation
      │   └── GameRoom.js          # Secondary/alternate game room
      └── index.js                 # Server entry point
package.json
vite.config.js
```

## Feature → File → Function Map
Go here first before searching. This eliminates most grep passes.

| Feature | File | Key Function / Area |
|---|---|---|
| Leaderboard / rankings | `src/GameScene.js` | `getRankedPlayers()` |
| Player state sync (client) | `src/GameScene.js` | `handlePlayerAdded()`, `callbacks.listen()` |
| Checkpoint activation | `server/src/rooms/LobbyRoom.js` | `tryActivateCheckpoint()` |
| Checkpoint collision detection | `server/src/rooms/LobbyRoom.js` | `updatePlayerCheckpoints()` |
| Checkpoint order parsing | `server/src/rooms/LobbyRoom.js` | `checkpointOrderFromBaseId()`, `shouldUpgradeCheckpoint()` |
| Kill zones | `server/src/rooms/LobbyRoom.js` | `updateKillZones()` |
| Player death / respawn | `server/src/rooms/LobbyRoom.js` | `killPlayer()`, `respawnPlayer()` |
| Round reset | `server/src/rooms/LobbyRoom.js` | round reset block (~line 760) |
| Matchmaking queue | `server/src/rooms/MatchmakingRoom.js` | `_tryMakeMatch()` |
| Player rendering / sprites | `src/player.js` | `setTargetFromState()`, `applyStateChanges()` |
| Gun definitions | `src/gunCatalog.js` | `GUN_CATALOG` object, `preloadGuns()` |
| Gun pickup entities | `src/GunPowerUp.js` | — |
| Map loading + spawn points | `src/GameMap.js` | — |
| HUD (health, timer) | `src/UIScene.js` | — |
| Interim / scores screen | `src/InterimScene.js` | — |

## Architecture Principles

### Client-Server Model
- **Server** (Colyseus room): Runs physics engine, collision detection, game logic. Source of truth.
- **Client** (Phaser): Render-only. Displays server state, sends input commands. NO client-side prediction.

### Scene Flow
```
MainMenuScene → MatchmakingScene → InterimScene → GameScene
                                       ↓
                                    UIScene (overlay)
```

### Data Flow
1. Client sends compact input commands to server (`NET_SEND_HZ = 60`)
2. Server updates physics & game state
3. Server broadcasts room state to all clients (Colyseus sync)
4. Client receives updates via `onMessage()` callbacks and updates sprites

### Colyseus Client Patterns (GameScene.js)
```javascript
// Callbacks handle — always obtained this way (NOT `new Callbacks`)
this.callbacks = Callbacks.get(this.room);  // imported from @colyseus/schema

// Collection listeners
this.callbacks.onAdd("players", (playerState, sessionId) => { });
this.callbacks.onRemove("players", (playerState, sessionId) => { });

// Property listener — fires when value changes; receives (newVal, prevVal)
this.callbacks.listen(playerState, "propName", (newVal, prevVal) => { });

// Bulk property listeners via helper
registerStatePropertyListeners(this.callbacks, playerState, handler, ["prop1", "prop2"]);
```

### PlayerState Properties (server-synced, read on client via `room.state.players`)
- **Position/rotation**: `x`, `y`, `a` (angle), `dir`
- **Arm/gun transform**: `armX`, `armY`, `armA`, `gunX`, `gunY`, `gunA`
- **Stats**: `health`, `maxHealth`, `dead`
- **Gun**: `gunId`, `ammo`
- **Progression**: `cpOrder` (numeric checkpoint order, higher = further ahead)
- **Identity**: `name`

## Code Conventions

### Naming
- **Classes**: `PascalCase` (Player, GameScene, GunPowerUp)
- **Constants**: `UPPERCASE_WITH_UNDERSCORES` (PLAYER_W_PX, CAMERA_ZOOM)
- **Variables/Methods**: `camelCase` (isLocal, updatePosition)
- **Private methods**: Use underscore prefix `_privateMethod()`

### File Structure
```javascript
// ============================================================
// File header comment block with divider lines
// ============================================================

import statements

// Constants grouped by feature
const SECTION_NAME = value;
const ANOTHER_CONSTANT = 123;

// Helper functions (if any)
function helperFunc() { }

// Export class
export default class ClassName {
  constructor() { }
  method() { }
}
```

### Comments
- Use `//` for single-line comments
- Use `// ----` divider lines to separate sections
- Add header comments explaining file purpose and key notes
- Add comments to clarify non-obvious logic, NOT on obvious code

### Imports/Exports
```javascript
// Always use ES6 modules
import Phaser from "phaser";
import GameScene from "./GameScene.js";

export default class MyClass { }
export const CONSTANT = 123;
```

## Key Files & What They Do

### main.js
- Creates Phaser game instance with config
- Registers all scenes in order: MainMenu → Matchmaking → Interim → Game → UI (overlay)
- Sets window size (1600×800) and background color

### GameScene.js
- Receives `reservation` and `client` from MatchmakingScene
- Sets up Colyseus room listeners for player/entity updates via `handlePlayerAdded()`
- Renders sprites, handles visual FX (beams, powerup effects)
- `getRankedPlayers()` — sorts players by `cpOrder` for the leaderboard; tie-break uses `cpHitSeq` (who hit the checkpoint first), then `joinOrder`
- `checkpointData` map: `sid → { joinOrder, cpHitSeq }` — tracks arrival order per checkpoint
- `_cpHitSeq` counter increments each time any player's `cpOrder` increases

### player.js (class Player)
- Stores player entity data (position, health, rotation, armed status)
- Manages sprite rendering (body, arm, gun)
- Updates from server snapshots (no interpolation, snap-to-latest)
- Renders health bar above player
- Renders username label above player
- Handles death visuals (tint, fade, hide health bar)

### UIScene.js
- Overlay HUD showing local player health and round timer
- Always on top of GameScene

### InterimScene.js
- Shown between matches
- Displays scores, player rankings
- Countdown to next round
- Syncs with server state

### gunCatalog.js
- Object `GUN_CATALOG` with all gun definitions
- Each gun: sprite, damage, fire rate, spread, etc.
- `preloadGuns()` preloads all gun assets

### GameMap.js
- Loads Tiled map JSON
- Creates collision bodies for walls/obstacles
- Places player spawn points and powerup spots

### VisibilityManager.js
- Manages what's visible to the camera
- Culling/visibility optimizations

### server/src/rooms/LobbyRoom.js
- Authoritative game room: physics step, collision, rounds, scoring
- `tryActivateCheckpoint(sid, baseId)` — upgrades a player's checkpoint if `baseId` is further ahead; updates `st.cpOrder`
- `updatePlayerCheckpoints()` — called each tick; detects player overlap with checkpoint trigger rects
- `checkpointOrderFromBaseId(id)` — extracts numeric order from checkpoint ID string (e.g. `"cp03"` → `3`)
- `shouldUpgradeCheckpoint(cur, new)` — returns true only if new checkpoint is strictly ahead
- `checkpointSpawnsByBaseId` map: `baseId → {x,y}` spawn position
- `checkpointTriggers` array: `[{ baseId, x, y, w, h }]` trigger rects from Tiled
- `playerCheckpointBaseId` map: `sid → baseId` current checkpoint per player

## Critical Constants & Tuning

### Camera Settings (GameScene.js)
```javascript
CAMERA_ZOOM = 1.05
CAMERA_FOLLOW_LERP_X/Y = 1           // Snap follow
CAMERA_DEADZONE_W_PX = 400
CAMERA_DEADZONE_H_PX = 260
MOUSE_GRAB_RADIUS_PX = 140            // Aim reticle distance
```

### Player Dimensions (player.js)
```javascript
PLAYER_W_PX = 60
PLAYER_H_PX = 180
ARM_W_PX = 30
ARM_H_PX = 70
```

### Health Bar & UI (player.js)
```javascript
HEALTH_BAR_W_PX = 70
HEALTH_BAR_H_PX = 10
HEALTH_BAR_OFFSET_FROM_HEAD_PX = 18
HEALTH_BAR_FILL_COLOR = 0x00ff00     // Green
```

### Networking (GameScene.js)
```javascript
COLYSEUS_URL = `${protocol}//${hostname}:2567`
ROOM_NAME = "lobby"
NET_SEND_HZ = 60                     // Input send rate
```

## Common Tasks

### Adding a New Scene
1. Create `src/NewScene.js` extending `Phaser.Scene`
2. Import in `main.js`
3. Add to scene array in game config
4. Use `this.scene.start("SceneName", { data })` to transition

### Updating Player Visual
- Modify player.js where sprites are created/updated
- Check `updateFromServer()` for position/rotation sync
- Remember: physics are server-side, don't modify body physics

### Adding a Gun
1. Add to `GUN_CATALOG` in gunCatalog.js with stats
2. Preload sprite in `preloadGuns()`
3. Gun pickup logic in GunPowerUp.js

### Debugging Multiplayer Issues
- Check Colyseus room state via browser DevTools
- Look for `onMessage()` callbacks in GameScene
- Remember: client only renders, server is authoritative
- Use `console.log()` for debugging (check browser console)

## Git Workflow
- Work directly in `main` branch (no worktrees)
- Commit frequently with clear messages
- Safe to reset to latest commit if needed: `git reset --hard HEAD`

## Build & Run
```bash
npm install          # Install dependencies
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Build for production
npm run preview      # Preview production build
```

## Preferences & Notes
- **No worktrees** — work directly in main directory
- **Server physics** — don't add physics to client, server is source of truth
- **No client prediction** — snap to server state
- **Mobile-ready** — keep responsive design in mind
- **Itch.io ready** — Vite base is set to "./" for export

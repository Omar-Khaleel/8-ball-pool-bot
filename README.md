# Universal Pool Vision Assistant

This fork modernizes the original 8 Ball Pool proof of concept into a reusable browser-based billiards vision assistant.

The original project was tied to an old Miniclip URL, Manifest V2, bundled TensorFlow/OpenCV assets, and game-specific WebGL hooks. The new implementation in [`universal-extension/`](universal-extension/) uses Manifest V3 and active-tab screenshots, so it can be calibrated against many browser billiards games without depending on their internal code.

## Current feature set

- Manual table calibration that is saved per game origin.
- Generic screenshot-based analysis for Canvas, WebGL, video, and DOM-rendered games.
- Felt-color estimation and configurable foreground segmentation.
- Ball-center detection and cue/eight/solid/stripe heuristics.
- Persistent IDs, movement tracking, velocity arrows, and stable-table detection.
- Pocket localization.
- Collision-aware direct-shot ranking with ghost-ball contact points.
- Limited one-cushion bank-shot candidates.
- Manifest V3 popup, local settings, and in-page overlay.
- No automatic input, shot execution, anti-cheat bypass, or remote screenshot upload.

## Install

1. Download this repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the [`universal-extension`](universal-extension/) folder.
6. Open a browser billiards game and use the extension popup to calibrate the table.

See [`universal-extension/README.md`](universal-extension/README.md) for controls, tuning, limitations, architecture, and tests.

## Legacy code

The original `chrome-extension/` and `ball-vision/` directories are preserved for historical reference and comparison. New development should target `universal-extension/`.

![Original projecting-lines demo](misc/cheats.gif)

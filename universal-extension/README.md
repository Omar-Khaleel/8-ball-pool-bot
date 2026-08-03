# Universal Pool Vision Assistant

A Manifest V3 browser extension that turns the original proof of concept into a reusable, manually calibrated computer-vision overlay for browser billiards games.

## What it does

- Captures the **visible active tab** instead of depending on a specific game's DOM, Canvas, WebGL API, or URL.
- Lets the user draw a calibration rectangle around the playable cloth area.
- Estimates the felt/background color on every frame.
- Detects circular foreground components and classifies likely cue, 8, solid, stripe, and unknown balls.
- Tracks ball IDs, velocity, and moving/stable state between frames.
- Locates six pocket regions near calibrated table anchors.
- Calculates collision-safe direct shots and limited one-cushion bank candidates.
- Renders an on-page overlay with detections, motion arrows, ghost-ball contact points, and ranked paths.
- Hides its own overlay before each screenshot so rendered guides do not feed back into detection.
- Stores calibration and settings per website origin.

It intentionally does **not** click, drag, inject game inputs, bypass anti-cheat systems, or automate a shot.

## Install in Chrome or Edge

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the `universal-extension` directory.
6. Open a browser billiards game, click the extension, and select **Calibrate table**.
7. Drag around the inner playable table/cloth, excluding as much UI as possible.
8. Click **Start analysis**.

## Controls

- Popup: start, stop, recalibrate, threshold, capture speed, bank paths, and velocity arrows.
- `Alt+Shift+B`: toggle analysis after the extension has been injected into the page.
- `Alt+Shift+C`: recalibrate.
- Right-click while calibrating: cancel calibration.

## Calibration advice

Select the playable cloth area, preferably from the center of the top-left pocket to the center of the bottom-right pocket. Avoid scoreboards, cue-power controls, avatars, advertisements, and decorative outer rails.

If too many false balls appear, increase **ball separation sensitivity**. If real balls are missed, decrease it. Different table skins and lighting may require different values.

## Browser compatibility and limitations

This design is generic for browser-rendered games because it analyzes a screenshot of the visible tab. It cannot see content hidden behind another tab or window, and it cannot guarantee perfect detection for every skin, camera angle, animation, occlusion, particle effect, or non-rectangular table.

Chrome limits `captureVisibleTab` to two calls per second, so the extension enforces a minimum 520 ms capture interval. Motion arrows therefore show coarse inter-frame movement rather than high-speed physical reconstruction.

Perspective-heavy 3D games need a future homography/perspective-calibration module. Current geometry assumes a mostly top-down rectangular playfield. Spin, cloth friction, rail elasticity, cue elevation, and game-specific physics are not inferred by this first release.

## Development

No external runtime dependency or remote model is required.

Run the core tests with:

```bash
node universal-extension/tests/run-tests.js
```

Key files:

- `service-worker.js`: active-tab injection, capture throttling, and screenshot capture.
- `capture-guard.js`: hides and restores the overlay around each screenshot.
- `content.js`: calibration, capture loop, overlay, and orchestration.
- `vision.js`: felt estimation, segmentation, component detection, classification, pockets, and tracking.
- `geometry.js`: line clearance, ghost-ball geometry, direct shots, and bank-shot candidates.

## Privacy

Frames are processed locally in the browser extension. The extension does not send screenshots or telemetry to a server.

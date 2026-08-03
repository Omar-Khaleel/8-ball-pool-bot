# Universal Pool Vision Assistant

A Manifest V3 browser extension that turns the original proof of concept into a reusable, manually calibrated computer-vision overlay for browser billiards games.

## What it does

- Captures the **visible active tab** instead of depending on a specific game's DOM, Canvas, WebGL API, or URL.
- Lets the user draw a calibration rectangle around the playable cloth area.
- Estimates the felt/background color on every frame.
- Detects circular foreground components and classifies likely cue, 8, solid, stripe, and unknown balls.
- Uses a neutral-bright second pass and long-line cue-stick evidence to distinguish the real cue ball from white areas on striped balls.
- Tracks ball IDs, velocity, and moving/stable state between frames.
- Locates six pocket regions near calibrated table anchors.
- Calculates collision-safe direct shots and limited one-cushion bank candidates.
- Renders detections, motion arrows, a full ghost-ball circle, the exact object-ball contact point, a rear cue-tip impact crosshair, a narrow aiming corridor, and ranked paths.
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

## Precision guide

For the best-ranked shot, the overlay shows:

- **اضرب هنا — مركز بلا سبن**: the rear cue-ball surface point where the cue should align for a center-ball hit.
- **Ghost ball**: the required center position of the cue ball at impact.
- **نقطة التصادم**: the contact point on the object ball.
- **Aiming corridor**: the estimated tolerance around the ideal ghost-ball center.
- **Object-to-pocket path**: the intended route into the selected pocket.

This is a geometric center-ball guide. Spin, cloth friction, rail elasticity, cue elevation, camera perspective, and game-specific hidden physics are not calibrated automatically.

## Browser compatibility and limitations

This design is generic for browser-rendered games because it analyzes a screenshot of the visible tab. It cannot see content hidden behind another tab or window, and it cannot guarantee perfect detection for every skin, camera angle, animation, occlusion, particle effect, or non-rectangular table.

Perspective-heavy 3D games need a future homography/perspective-calibration module. Current geometry assumes a mostly top-down rectangular playfield.

## Development

No external runtime dependency or remote model is required.

Run the core tests with:

```bash
node universal-extension/tests/run-tests.js
node universal-extension/tests/precision-tests.js
```

Key files:

- `service-worker.js`: active-tab injection and screenshot capture.
- `content.js`: calibration, capture loop, overlay, and orchestration.
- `vision.js`: base felt estimation, segmentation, component detection, classification, pockets, and tracking.
- `precision-vision.js`: cue-stick-assisted cue-ball disambiguation and persistent cue tracking.
- `precision-geometry.js`: cue-tip impact, object contact, ghost-ball tolerance, and aiming gates.
- `precision-overlay.js`: the detailed on-table precision guide.
- `geometry.js`: line clearance, ghost-ball geometry, direct shots, and bank-shot candidates.

## Privacy

Frames are processed locally in the browser extension. The extension does not send screenshots or telemetry to a server.

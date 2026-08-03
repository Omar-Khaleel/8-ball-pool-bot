# Gamezer Ray Guider

A deliberately small Gamezer-only billiards guide.

It does not capture the browser tab, does not flash the page, does not enumerate every possible shot, and does not automate input. It reads the game canvas directly and draws only:

- a white line showing the current cue-ball path to the first collision;
- a green/yellow line showing where the contacted ball is expected to travel.

## Install

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this directory.
4. Open or reload Gamezer.
5. Hold **Shift** and left-click the center of the white cue ball once.
6. Aim normally with the mouse.

## Keys

- `G`: hide/show the guide.
- `R`: reverse the aim direction if the game maps the mouse to the opposite side of the cue.
- `Esc`: forget the selected cue ball; Shift-click it again.

## Design

The script runs at `document_start` in the page's MAIN world and requests `preserveDrawingBuffer` for WebGL contexts. It reads the largest visible game canvas directly with `readPixels`, estimates the cloth region from the color around the selected cue ball, scans only the current aim ray for the first ball, and applies equal-ball collision geometry.

No screenshots or network requests are used.

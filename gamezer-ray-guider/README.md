# Gamezer Ray Guider v0.2

A small Gamezer-only billiards guide. It reads the game canvas directly and draws only the cue path and the contacted ball direction.

## Install

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this directory.
4. Close all existing Gamezer tabs and open a new Gamezer tab.
5. Wait for the table to load.
6. Put the mouse cursor over the center of the white cue ball and press **C**. Do not click.
7. Move the mouse normally to aim.

## Keys

- `C`: select the white cue ball under the cursor without clicking it.
- `G`: hide/show the guide.
- `R`: reverse the aim direction.
- `Esc`: clear the cue selection.

A small temporary status label reports whether the extension found and could read the game canvas. It disappears after a successful cue selection.

## Capture modes

The extension first tries WebGL `readPixels`. If Gamezer renders through an existing or worker-owned canvas, it falls back to copying the visible canvas bitmap into a local analysis canvas. It never captures the browser tab and does not hide the page between frames.

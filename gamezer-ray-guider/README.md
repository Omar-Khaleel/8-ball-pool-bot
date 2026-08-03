# Gamezer Snapshot Guider

A minimal two-line Gamezer guide that avoids direct Canvas pixel access.

Gamezer may block `readPixels()` and `getImageData()` on its game Canvas. This version therefore takes **one browser snapshot when you press C**, analyzes the static table once, and then moves the guide locally with the mouse. It does not capture continuously and does not flash the page during aiming.

## Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Open the Gamezer table.
5. Click the extension icon once. The badge becomes `ON`.
6. Hover the exact center of the white cue ball and press `C` without clicking.
7. Aim normally with the mouse.

## Lines

- White: cue-ball path to the first object ball or rail.
- Green: object ball is geometrically aligned with a pocket.
- Yellow: object ball reaches a rail first.

## Keys

- `C`: take a fresh snapshot and select the white ball under the cursor.
- `R`: reverse the aim direction.
- `G`: show/hide the guide.
- `Esc`: clear the current snapshot.

Take a new snapshot with `C` after the balls move. The extension does not click, drag, shoot, or automate input.

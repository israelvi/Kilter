# Screenshots

This directory holds the imagery referenced from the project's main [README.md](../../README.md).

## Files expected

| File | What it should show |
|---|---|
| `boards-screen.png` | The Catalog → Boards grid, with the 22 board configurations rendered as cards. Pick a recovery bundle first so the cards are populated with images and live counts. |
| `climbs-screen.png` | The Catalog → Climbs list for any board (Original 12×14 Bolt Ons is a good choice). Show the filter bar (Climb name + Setter + Grade + Sort) and a few rows of climbs with grade badges + ascensionist counts + quality stars. |
| `climb-detail.png` | The Catalog → Climb detail view for any popular climb (e.g. "Bell of the Wall" — uuid `36E949A6395D4290AF08FDFBCC6010C1`). Show the board image with the colored hold overlay on the left and the metadata panel with per-angle stats + Instagram beta links on the right. |
| `strategies-screen.png` | The Recovery → Strategies screen after running all strategies. Show several strategy cards with status badges, durations, attempted commands, and notes. |
| `diagnostics-screen.png` | The Tools → Diagnostics screen with the live NDJSON log feed scrolling. Filter by `adb` to make it look interesting. |

## How to capture

1. Run the app: `bun run dev`
2. Open the screen you want to capture, set up the state (filters, selected items, etc.)
3. Use Windows **Snipping Tool** (`Win+Shift+S`) or your OS equivalent
4. Save as a PNG into this directory with the filename above
5. The README will pick them up automatically because the paths are relative

## Resolution and aspect

Aim for **1600×1000 to 1920×1200** so they look crisp on README displays without being giant.

## What NOT to capture

- Personal device serials (the app shows them on the Device screen — crop them out or use a fake)
- Real Wi-Fi MAC addresses, Bluetooth identifiers, or any privacy-sensitive metadata
- Real climber usernames if you're going to publish the screenshots widely (the catalog is public so usernames are technically public, but be considerate)

## Tips for nice screenshots

- **Maximize the window** before capturing — gives you more breathing room in the layout
- **Pick a popular board** for Climbs and Climb detail (Original 12×14 Bolt Ons has 34k climbs and lots of variety)
- **Pick a famous climb** for the detail view ("Bell of the Wall" has 108k ascensionists and 20 beta links — looks impressive)
- **Filter the Diagnostics view** so the visible entries are interesting (try filtering by `adb` or `parser`)

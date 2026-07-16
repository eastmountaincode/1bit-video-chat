# Telepathy

A silent low-resolution grayscale video room built with Next.js and PlayHTML.

- Camera frames default to `100 × 75`, quantized to 3-bit grayscale, bit-packed, and sent at up to 15 fps through PlayHTML presence.
- Video presence is ephemeral and disappears when a visitor leaves.
- Global chat uses PlayHTML page data and persists the newest 200 messages.
- Capture settings are local to each participant and only change their outgoing video.
- Room style is shared, persistent raw CSS with URL support, stable `data-room-part` targets, a 20,000-character limit, and a global reset.
- Every decoded video pixel is available to room CSS through `[data-room-part="video-pixel"]`, with `--pixel-x`, `--pixel-y`, `--pixel-index`, `--pixel-level`, and `--pixel-gray` values.
- There is one shared room for the MVP.
- The right column switches among chat, settings, and style. Press `H` to open or close settings.

## Development

```bash
npm install
npm run dev
```

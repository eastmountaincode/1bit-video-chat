# Sesame Chat

A silent low-resolution grayscale video room built with Next.js and PlayHTML.

- Camera frames default to `112 × 84`, quantized to 3-bit grayscale, bit-packed, and sent at up to 12 fps through PlayHTML presence.
- Video presence is ephemeral and disappears when a visitor leaves.
- Global chat uses PlayHTML page data and persists the newest 200 messages.
- There is one shared room for the MVP.
- Press `H` in the room to tune resolution, grayscale levels, and frame rate locally.

## Development

```bash
npm install
npm run dev
```

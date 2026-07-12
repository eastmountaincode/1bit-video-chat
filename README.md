# see you, see me

A silent low-resolution grayscale video room built with Next.js and PlayHTML.

- Camera frames are reduced to `80 × 60`, quantized to 4-bit grayscale, packed two pixels per byte, and sent at up to 15 fps through PlayHTML presence.
- Video presence is ephemeral and disappears when a visitor leaves.
- Global chat uses PlayHTML page data and persists the newest 200 messages.
- There is one shared room for the MVP.

## Development

```bash
npm install
npm run dev
```

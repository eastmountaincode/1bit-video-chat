# Telepathy

A silent low-resolution grayscale video chat built with Next.js and PlayHTML.

- Camera frames default to `100 × 75`, quantized to 3-bit grayscale, bit-packed, and sent at up to 15 fps through a dedicated PlayHTML presence relay.
- Video presence is ephemeral and disappears when a visitor leaves.
- Large or high-resolution rooms automatically constrain outgoing resolution and frame rate before they can overload every participant.
- Global chat uses PlayHTML page data and persists the newest 200 messages.
- Capture settings are local to each participant and only change their outgoing video.
- Room style is shared, persistent raw CSS with URL support, stable `data-room-part` targets, a 20,000-character limit, and a global reset.
- Each viewer can target only their own card with `[data-room-part="video-card"][data-video-side="own"]`.
- Individual pixels can be targeted through `[data-room-part="video-pixel"]`, with stable `--pixel-x`, `--pixel-y`, and `--pixel-index` values. The overlay mounts only when shared CSS uses pixel styling and is capped at 4,000 cells room-wide; styles that need changing pixel values or geometry also enter a guarded lower-resolution live-cell mode.
- The PlayHTML-backed lobby lists public rooms and lets anyone create one.
- Every room has its own isolated video presence, chat, and shared style state.
- The original shared state remains available in the default Main room.
- Entering or leaving a room reloads the document so no prior room transport can leak across the boundary.
- The right column switches among chat, settings, and style. Press `H` to open or close settings.

## Development

```bash
npm install
npm run dev
```

In development, `/benchmark?participants=20&fps=15&style=border&duration=10`
runs the real tile renderer with mock participants and reports long tasks,
animation timing, commit latency, update throughput, memory, and DOM size.
Pixel styles are `default`, `color`, `background`, `border`, and `metadata`;
the last exercises per-frame `--pixel-gray` updates. `width`, `height`, and
`bits` query parameters can test the app's adaptive large-room settings.

The transport benchmark uses a unique live PlayHTML room, changes every mock
camera frame, and fails if delivery, duplication, or reconnect churn crosses
its guardrails:

```bash
# Four clients for four seconds; useful before committing benchmark changes.
npm run benchmark:transport:smoke

# Twenty clients at 10 fps for 30 seconds, including two leave/rejoin cycles.
npm run benchmark:transport

# Twenty clients for 15 minutes, reconnecting one client every minute.
npm run benchmark:transport:soak
```

The JSON result includes latency and delivery percentiles, duplicate frames,
inbound/outbound bytes and message rates, reconnect downtime, relay rate
advisories, process CPU, event-loop delay, and start/peak/end Node memory.
Process memory describes the benchmark harness, not browser memory. Profiles
and individual settings can be overridden, for example
`npm run benchmark:transport -- --duration=600 --churn-interval=45`.
Use `-- --fps=15` for relay saturation or `-- --fps=4 --bits=5` to exercise
the chunked-frame path. The command fails when send cadence falls below 95%,
delivery falls below 98%, duplicates exceed 0.5%, a socket flaps outside
planned churn, a planned reconnect exceeds its configured downtime plus a
three-second connection allowance, p95 latency exceeds 500 ms, p95 event-loop
delay exceeds 100 ms, or harness heap growth exceeds 64 MiB. Unexpected
deliveries fail above 0.5% after a five-frame allowance, so normal in-flight
frames crossing a reconnect do not invalidate a tiny smoke sample. Each
threshold has a matching command-line override for intentional stress tests.

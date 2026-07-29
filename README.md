# Telepathy

A low-resolution grayscale video chat built with Next.js and PlayHTML. Camera
feeds stay silent; the optional Strudel panel can produce local audio.

The room synthesizer embeds
[hydra-synth 1.4.0](https://github.com/hydra-synth/hydra-synth) (AGPL).
The shared pattern editor embeds
[@strudel/web 1.3.0](https://www.npmjs.com/package/@strudel/web) (AGPL).

- Camera frames default to `100 × 75`, quantized to 3-bit grayscale, bit-packed, and sent at up to 15 fps through a dedicated PlayHTML presence relay.
- Video presence is ephemeral and disappears when a visitor leaves.
- Capture controls have fixed limits, including a 15 fps maximum, and never change automatically with room size.
- Global chat uses PlayHTML page data and persists the newest 200 messages.
- Capture settings are local to each participant and only change their outgoing video.
- Room style is shared, persistent raw CSS with URL support, stable `data-room-part` targets, a 20,000-character limit, and a global reset.
- The Hydra editor is a shared character-sequence document, so concurrent edits merge live. Running the current draft stores a separate room-wide snapshot and places an isolated Hydra canvas above the CSS room background and behind the room interface; stopping it reveals the CSS background again.
- The Strudel editor uses the same collaborative character document. Playback runs inside an isolated frame and is opt-in per device, because browsers require each listener to start Web Audio themselves. Standard names such as `bd`, `sd`, and `hh` use Strudel's Dirt Samples map and load their audio files on demand.
- Each viewer can target only their own card with `[data-room-part="video-card"][data-video-side="own"]`.
- The server-backed lobby lists public rooms and lets anyone create one.
- Every room admits at most 20 active participants, with atomic server-side admission and live counts in the directory and camera lobby.
- User-created rooms expire after their last participant leaves, with a two-minute empty-room grace period; Main room remains permanent.
- Every room has its own isolated video presence, chat, and shared style state.
- The original shared state remains available in the default Main room.
- Entering or leaving a room reloads the document so no prior room transport can leak across the boundary.
- The right column switches among chat, settings, CSS, Hydra, and Strudel. Press `H` to open or close settings.

## Development

```bash
npm install
npm run dev
```

The room server uses Upstash Redis through either
`KV_REST_API_URL` / `KV_REST_API_TOKEN` or
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
Set `TELEPATHY_ROOM_REGISTRY_NAMESPACE` to isolate local lifecycle tests.

With the app running, the live room smoke test creates one temporary room,
admits 20 participants concurrently, rejects the twenty-first, frees and
reuses one place, and checks missing-room handling:

```bash
npm run test:rooms:live
```

Add `-- --wait-for-expiry` to also wait for the room to expire and verify that
its list entry and URL stop working.

In development, `/benchmark?participants=20&fps=15&duration=10`
runs the real tile renderer with mock participants and reports long tasks,
animation timing, commit latency, update throughput, memory, and DOM size.
`width`, `height`, and `bits` query parameters can test the fixed capture
boundaries.

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

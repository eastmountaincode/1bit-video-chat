# Telepathy

A low-resolution grayscale video chat built with Next.js and PlayHTML.

The room synthesizer embeds
[hydra-synth 1.4.0](https://github.com/hydra-synth/hydra-synth) (AGPL).

- Camera frames default to `100 × 75`, quantized to 3-bit grayscale, bit-packed, and sent at up to 15 fps through a dedicated PlayHTML presence relay.
- Video presence is ephemeral and disappears when a visitor leaves.
- Capture controls have fixed limits, including a 15 fps maximum, and never change automatically with room size.
- Global chat uses PlayHTML page data and persists the newest 200 messages.
- Chat timestamps show the date and time in each viewer's local timezone.
- Capture settings are local to each participant and only change their outgoing video.
- Room styles use one CSS editor with URL support, stable `data-room-part` targets, a 20,000-character editing limit, and a global reset. General rules are shared; rules using `own` or `other` are stored per writer and rendered consistently for everyone.
- The Hydra editor is a shared character-sequence document, so concurrent edits merge live. Running the current draft stores a separate room-wide snapshot and places an isolated Hydra canvas above the CSS room background and behind the room interface; stopping it reveals the CSS background again.
- New rooms receive a randomly selected starter from 49 self-contained [Hydra homepage examples](https://github.com/hydra-synth/hydra/blob/main/src/stores/examples.json). The choice is saved with the room, and Hydra stays off until someone presses Run. Existing sketches are preserved. Original credits and [CC BY-NC-SA 4.0 terms](src/lib/hydra-examples.LICENSE.md) accompany the examples.
- The default CSS template has 11 examples, including your own video name and data rate, separate own/other messages, chat names, and dates. Custom selectors and declarations can be added freely.
- Randomize in the Hydra panel loads a different starter into the shared draft. Run or Update applies it.
- Use `[data-room-part="video-card"][data-video-side="own"]` to style your card consistently for everyone.
- Video cards, images, names, and rates support `data-video-side="own"` or `"other"`. Chat messages, names, dates, and text support `data-message-side="own"` or `"other"`. `own` targets the writer's stable browser identity on every screen; `other` targets everyone except the writer. Removing the condition makes the rule shared. Chat messages created before author IDs were introduced retain general styling only.
- The server-backed lobby lists public rooms. Creating rooms requires admin access.
- Every room admits at most 20 active participants, with atomic server-side admission and live counts in the directory and camera lobby.
- Automatic empty-room deletion is currently disabled. The two-minute expiry policy and deadline bookkeeping remain in place behind `ROOM_EXPIRY_ENABLED`, so they can be restored with a one-line switch; Main room remains permanent.
- Every room has its own isolated video presence, chat, and shared style state.
- The original shared state remains available in the default Main room.
- Entering or leaving a room reloads the document so no prior room transport can leak across the boundary.
- The right column switches among chat, settings, CSS, and Hydra. Press `H` to open or close settings.

## Room manager

Open `/admin` to see room names, creation times, and current participant counts.
The list refreshes every ten seconds while visible. Open a room to join it normally,
create or rename rooms, reset their CSS, or delete them after confirmation.
Renaming preserves the room URL and shared content. CSS reset restores the commented
defaults without changing chat or Hydra. Main room can be renamed but cannot be deleted.
Deletion removes the room from the directory and blocks its URL; connected clients
leave on their next heartbeat (normally within twenty seconds). It does not erase
the third-party PlayHTML service's stored chat, CSS, or Hydra data.

Set `TELEPATHY_ADMIN_PASSWORD` to a nonempty password (up to 256 characters) in the
server environment (Vercel Production, or an ignored `.env.local` for development).
Without it, admin access is disabled. Sessions last twelve hours in an HttpOnly
cookie, and changing the password invalidates them. Login attempts are limited
through Redis to eight per IP per fifteen minutes.

## Development

```bash
npm install
npm run dev
```

The room server uses Upstash Redis through either
`KV_REST_API_URL` / `KV_REST_API_TOKEN` or
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
Set `TELEPATHY_ROOM_REGISTRY_NAMESPACE` to isolate local lifecycle tests.

With the app running and `TELEPATHY_ADMIN_PASSWORD` set, the live room smoke test
checks admin-only creation, creates and renames one temporary room,
admits 20 participants concurrently, rejects the twenty-first, frees and
reuses one place, and checks missing-room handling:

```bash
npm run test:rooms:live
```

With automatic deletion disabled, add `-- --wait-for-persistence` to verify
that an empty room remains available after the two-minute deadline. If
`ROOM_EXPIRY_ENABLED` is restored to `true`, use `-- --wait-for-expiry`
instead to verify that the room's list entry and URL stop working.
While deletion is disabled, run this smoke test only with an isolated
`TELEPATHY_ROOM_REGISTRY_NAMESPACE`, because its temporary room will persist.

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

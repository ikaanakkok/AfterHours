# WhatsApp Baileys and iPhone–Mac device setup — 2026-10-12

Scope: user revision removes BlackHole and prefers Bluetooth for iPhone–Mac. This delivery does not implement a live-call media/answer adapter.

## Implemented behavior

- Baileys 6.7.22 remains pinned. The installed bundled WhatsApp client version returned disconnect 405 before QR generation. Fetching the current WhatsApp Web version with the SDK helper (5-second timeout, numeric tuple validation, one-hour cache, invalidation on 405) produced a real QR. No QR payloads or credentials were printed or included in screenshots.
- Direct messages support phone JIDs and LIDs without interpreting a LID as a phone number. Disabled/relinked sessions are rechecked before inbound ingestion and outbound delivery. `ready` requires authenticated socket identity and saved encrypted credentials. Uncertain send outcomes remain non-retryable.
- Shutdown awaits encrypted credential writes. A pairing-only process can disable inbound ingestion while shared DB verification keeps the normal worker paused.
- `voice.assess` requires current admin membership, accepts only an empty payload and inspects macOS outside the DB transaction. It returns USB/Bluetooth counts, with unknown on errors; device names, addresses and serials are omitted. Hardware discovery never returns call readiness or AI call-audio access.
- Voice and channel setup explain Baileys text vs. live calls and Apple cellular-call relay. Old WhatsApp Web/BlackHole instructions were removed. Phone setup records Bluetooth preference and unavailable audio adaptation.

## Local verification

- `tests/phone-link.test.ts` and `tests/whatsapp-worker.test.ts`: 10 tests passed, including stale-session blocking, LID routing, excluded audio messages, unknown sends, malformed version rejection and shutdown flush.
- Snapshot all-workspace + tools typecheck, lint and production web build passed. Latest worker additions also passed worker/tools typecheck. Formatting passed for the owned changed files.
- gstack `/browse` against the isolated production snapshot at `http://127.0.0.1:3006/voice`: real `voice.assess` returned Mac detected, Bluetooth on, one known iPhone and zero connected iPhones, USB iPhone not detected. Desktop/mobile/tablet screenshots were inspected.
- Existing `guided-channels.gstack.js` passed all seven controlled assertions: instructions, no JSON/token forms, direct PNG QR, expiry, connected QR hidden, tenant binding and primary-calendar defaults. These controlled QR responses are separate from the real QR check below. Console errors: none for that controlled journey.
- Snapshot: `/private/tmp/afterhours-voice-verify`, dependencies installed offline from the same lockfile. `AFTERHOURS_PROJECT_ROOT` points to the original project; secrets were not copied. Canonical 3000, ngrok and the 3004/3005 previews were preserved.

## Real-account/device evidence and pending work

- Native FaceTime settings were inspected: Calls from iPhone is enabled. The user confirmed Allow Calls on Other Devices, this Mac selected and the same Wi-Fi network. In the requested real-device test, the user reported that an incoming cellular call rang on the Mac, could be answered on the Mac and both sides heard audio. This establishes user-reported Apple call relay and two-way audio; the assistant did not initiate or inspect the call. It does not establish a Bluetooth-only path or AI media access.
- The user scanned the real Baileys QR. The new `WhatsApp iPhone` connection became `ready`, with `realAccountVerified: true`, no last error and the QR cleared. The encrypted auth store was read successfully without exposing its contents. A clean stop/restart reused that stored session and reached `ready` without another QR (last verification `2026-10-12T11:58:16.998Z`). Account linking and session restoration are verified; customer message delivery has not been tested. Safe QR-free screenshot: `whatsapp-phone/whatsapp-linked.png`, visually inspected.
- Pairing-only process was scoped to the newly created `WhatsApp iPhone` connection, with customer replies disabled; no schedules, queues, outbox or inbound ingestion ran in it. After the verified reconnect it was stopped cleanly (exit 0, encrypted-write flush awaited, no remaining pairing-only process), then handed off to the backend owner for the full worker restart.
- The backend owner started the full worker from `/private/tmp/afterhours-plan-verify`. Fresh server read independently confirmed this connection `ready`, `realAccountVerified: true`, no last error, encrypted auth readable and a newer `lastTestAt: 2026-10-12T12:01:35.413Z`. Process inspection found the normal worker and no pairing-only process. The owner confirmed fresh `workerOnline: true` heartbeat and automatic replies disabled. Reboot/login persistence is not established by this running-process check.
- Baileys live-call audio, automated iPhone answering and AI STT/TTS media access remain pending. Bluetooth/USB device discovery is not an executable call adapter; the successful user phone-call test covers manual Apple relay only.
- Backend owner reported final code/TypeScript/security approval, including current protocol version, pairing-only mode and async shutdown. React approved the Voice/channel UI. The owner's current integration snapshot passed 199/199 tests and production build; this is separate from the phone snapshot's scoped verification. Full-worker restart/handoff is verified; integrated canonical web publication remains owned by that chat.

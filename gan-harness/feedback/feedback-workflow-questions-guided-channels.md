# Workflow Questions and guided Front Desk Channels

Delivery checkpoint: 2026-10-12. This is a focused acceptance record for these two features, not a score or whole-product verification.

## Verified in the local test environment

- 29 focused behavioral tests passed across workflow questions, text workflows, approval/execution, channel setup and WhatsApp setup. The additional admin-pause regression passed separately, giving 30 verified cases. A later combined repeat was interrupted while the runner stalled before reporting cases; it is not recorded as a second full pass.
- Final snapshot `pnpm typecheck`, `pnpm lint` and `pnpm build` passed after the pause fix. The pause fix received an independent source review with no material findings. Security and React reviews of the delivered feature files completed; reported issues were corrected.
- Controlled gstack browser journeys passed for question counts changing 2 → 1 → 2, answer persistence, retained drafts, disabled Test/activation and provider-specific setup without JSON/token inputs.
- Guided channel journeys passed on desktop and a 390-pixel mobile viewport. Mobile document width matched the viewport; the inspected screenshot is `.data/qa/guided-setup/channels-mobile.png`.
- WhatsApp UI checks used a clearly artificial PNG fixture, not a real pairing secret. Tests covered PNG preservation, expiration, obsolete attempts, disabled connections, tenant/admin restrictions and serialized socket events.
- OAuth tests covered PKCE, one-use state, initiating administrator, connection revision, granted scopes, encrypted credentials and actual adapter scope requirements. No external account consent occurred.
- Authenticated local workspace reads and `channel.setup.status` returned success before the public-origin switch. Google/Microsoft deployment configuration was reported absent. After ngrok configuration, the local login redirect is expected; this checkpoint does not claim a newly authenticated public browser session.

## Behavior delivered

Workflow and Questions are separate tabs with an unanswered badge. Analysis and answers persist. Missing AI credentials leave analysis pending. Answers and new analysis invalidate older tests/plans; unresolved or stale questions block test, confirmation, activation and execution. An administrator can always pause an otherwise invalidated workflow and its schedule. Each external step checks current authorization and preserves evidence of completed partial work.

Front Desk Channels has a service picker and instructions specific to WhatsApp, email and calendar providers. WhatsApp displays the worker's QR PNG with expiration and attempt checks. Account connection uses provider OAuth, with deployment application configuration kept outside the business user's form. The initial calendar is the account's primary calendar; additional-calendar selection is pending. Unavailable SMS/IVR/voice adapters never become ready.

## Pending real verification

Real OpenCode Go/OpenAI reasoning, phone QR scanning, WhatsApp delivery/recovery, Google/Microsoft account consent and live voice require actual keys/accounts/devices. The worker was paused for concurrent database tests; its backend owner will restart it after their checks. QR generation requires that worker to run.

## Runtime and concurrent work

iCloud blocked native dependency reads in the Documents workspace. The same lockfile was installed offline into `/private/tmp/afterhours-guided-verify`, preserving the original source and secrets. The final production build runs from this fixed snapshot on loopback port 3000. Preserve that directory while it serves the panel.

The separately authorized ngrok runtime uses the HTTPS origin recorded in AGENTS.md. Its origin configuration is preserved. Later backend, theme, MCP and phone work is owned and verified in the corresponding chats; those new changes are not included in this frozen feature checkpoint. A broader copied-suite repeat encountered three email-sync failures from the concurrent schema/source mismatch and was reported to the backend owner; this record does not claim that the entire latest shared repository passes.

Source browser journeys: `apps/web/tests/workflow-questions.gstack.js` and `apps/web/tests/guided-channels.gstack.js`. Additional regression: `tests/workflow-pause.test.ts`.

Final access check: loopback `/login` returned 200. The recorded ngrok endpoint returned ERR_NGROK_3200 (offline) at the final check; do not interpret the earlier tunnel checkpoint as current availability. No tunnel or origin setting was changed by this feature delivery.

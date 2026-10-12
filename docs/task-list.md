# Implementation checkpoint

User revision, 2026-10-12: foundation → WhatsApp/browser flow → Context + text Workflows with schedules → email/calendar/MCP → full management agent → voice. Payments removed.

## Implemented locally

- [x] Tenant PostgreSQL schema/FORCE RLS, authentication, role enforcement, composite tenant relations.
- [x] Shared verified operations, persisted idempotency, approvals, handoff, audit and versioned settings.
- [x] Authenticated panel with English menu names and Turkish body copy.
- [x] Controlled browser request site, read-back verification, duplicate-safe demo reply/outbox.
- [x] Context: persistent text/link/file attachments, PDF/DOCX/PPTX extraction and image input; separate questions tab and count badge; provider-dependent dynamic analysis and persisted answers.
- [x] Text workflows with `>` steps, named systems, concrete approved write plan, verified test + admin confirmation, inactive awaiting-test state.
- [x] Workflow-linked interval schedules, current grants, overlap protection, pause/history and no bulk catch-up.
- [x] Agent Operations: human intervention and agent activity, newest first, confirmation/details/partial evidence.
- [x] Backoffice settings and encrypted credentials; fresh-session login test; failed saved systems remain inactive.
- [x] AI Providers settings, encrypted OpenCode Go/OpenAI keys, fixed endpoints, test/active selection.
- [x] Front Desk Channels settings including SMS/IVR configuration with unavailable-adapter status.
- [x] Payments removed from panel and active execution paths.
- [x] Shared tested tenant AI provider for management, customer, Context and workflow text flows; explicit waiting/error states.
- [x] Persistent Gmail/Outlook seven-day import, paginated/resumable 60-second polling and duplicate-safe reply drafts with separate read/draft/send grants.
- [x] Calendar update/cancel with account/calendar/event revision checks, concrete cancellation approval and provider read-back.
- [x] Versioned mixed browser/calendar/email/MCP workflows, persisted step inputs/results/evidence and partial-write protection.
- [x] Multi-turn management history/context, validated command proposals and atomic dependency rechecks through the existing command services.
- [x] Mobile Agent Operations time and More available in the first table cell.

## External verification / future work

- [ ] User-provided OpenCode Go/OpenAI key: real document reasoning and business workflow planning.
- [ ] Real backoffice application login and multi-system workflow verification.
- [x] Real Baileys QR account linking and encrypted-session restoration after clean restart.
- [ ] Real WhatsApp customer delivery and logged-out/account recovery.
- [ ] Real Gmail/Outlook/Google/Microsoft OAuth and MCP server verification, including live email polling and calendar changes.
- [ ] Management reasoning across real business systems with the owner's tested AI key; local multi-turn/action-plan acceptance passed.
- [ ] SMS/IVR execution adapters (configuration is available now).
- [ ] Executable live-call audio/answer adapters for Baileys WhatsApp calls and iPhone–Mac calls/STT/TTS. BlackHole excluded by user revision; Bluetooth preferred. Device discovery is separate from call-audio verification.

Final check results and browser evidence are recorded in AGENTS.md and gan-harness/feedback. Fixtures and controlled AI responses are kept separate from live account/device claims. No changes have been published.

## Workflow questions + simple channel onboarding delivery — 2026-10-12

- [x] Per-workflow Questions tab and unanswered badge; answers persist and trigger reanalysis.
- [x] Provider-dependent uncertainty analysis; missing provider remains pending.
- [x] Test/activation blocked by unanswered/stale analysis; changes invalidate old tests and pause schedules.
- [x] Fresh analysis generation binds test/confirmation/runtime, with per-step revocation and partial-evidence handling.
- [x] Front Desk service picker, icons and short provider-specific instructions without raw JSON/token forms.
- [x] WhatsApp live pairing request + direct PNG QR display, automatic polling, expiry and attempt/disabled guards.
- [x] Guided Google/Microsoft OAuth with verified scopes/account and encrypted secrets.
- [x] Real WhatsApp phone scan and server-side linked account verification (see phone/WhatsApp checkpoint).
- [ ] Real AI uncertainty reasoning with the owner's key and real OAuth consent.
- [ ] Deploy Google/Microsoft application registration; add friendly selection of additional calendars.

Verification is recorded separately in `gan-harness/feedback/feedback-workflow-questions-guided-channels.md`. The final snapshot predates subsequent mixed-workflow, email-sync, MCP and theme iterations being delivered in parallel chats.

## Frontend and design refresh — 2026-10-12

- [x] Light shared design system, local Plus Jakarta Sans, semantic status labels and consistent primary actions.
- [x] All 13 panel sections plus login/error/not-found refreshed; menus and routes retained.
- [x] Responsive Inbox list/detail, mobile menu focus trap/Escape and accessible tabs/field error interfaces.
- [x] Settings refresh preserves drafts/focus; tenant switch and delayed Inbox reply regressions checked.
- [x] 52 panel layouts, 8 public-page layouts, seven controlled journeys and production frontend build.
- [x] Design decisions and verification evidence recorded in `DESIGN.md` / `gan-harness/feedback/frontend-refresh.md`.
- [x] Full typecheck after copying latest core/test fixes.
- [x] Integrated current-source rerun after backend/MCP/phone integration: 199/199 tests in 23 files, lint, workspace/tools typecheck, production build and formatting passed. The earlier 169/188 copy is superseded by this delivery.

## Backoffice MCP delivery — 2026-10-12

- [x] Web/MCP selection, named MCP setup/edit, HTTP endpoint and optional encrypted Bearer credential.
- [x] Fresh protocol/tool discovery, explicit admin read-only selection, no automatic grants or account-identity claim.
- [x] Endpoint/token rotation safeguards, atomic discovery credential snapshot, stale/disabled test guards and generic-command bypass regression.
- [x] Focused 39/39 behavioral tests, lint, workspace/tools typecheck, scoped formatting, production build and real local API browser journey.
- [ ] Real business MCP endpoint/account and tool semantics verification.
- [ ] MCP OAuth, stdio/SSE transport and friendly write-tool verification configuration UI (outside this HTTP/Bearer delivery).

See `gan-harness/feedback/feedback-mcp-backoffice.md`. Parallel backend and frontend deliveries have independent verification snapshots; this checkpoint is scoped to MCP and related regressions.

## WhatsApp and iPhone–Mac delivery — 2026-10-12

- [x] Real Baileys account paired, QR cleared and saved encrypted session restored without another QR.
- [x] Current WhatsApp protocol version handling, LID routing, disabled/relinked guards and async shutdown flush.
- [x] Privacy-preserving Mac USB/Bluetooth diagnostic and Bluetooth-first iPhone instructions; BlackHole removed from the current setup.
- [x] Native FaceTime Calls from iPhone setting checked; user confirmed phone/Mac selection and same Wi-Fi.
- [x] Ten focused tests, typecheck, lint, scoped format, production build and isolated panel journeys.
- [x] Real iPhone incoming ring/answer and two-way audio on the Mac, confirmed by the user.
- [ ] WhatsApp customer delivery/account recovery and executable AI live-call media adapters.
- [x] Coordinated full-worker handoff; saved WhatsApp auth reconnected in the normal worker with fresh server verification.
- [ ] Canonical current-source web rollout by the integration owner; worker login/reboot persistence.

See `gan-harness/feedback/feedback-whatsapp-phone.md`; real account linking is distinct from customer messaging and automated live-call readiness.

## Remaining software plan delivery — 2026-10-12

- [x] Workflow Questions/guided setup gates retained across new management and mixed-workflow commands.
- [x] Email thread/message metadata, source-linked draft deduplication, token refresh, durable cursors and tenant composite relations migrated without replacing existing data.
- [x] Current endpoint/credential snapshots, guarded token rotation and stale/disabled connection-test protection.
- [x] Management mutations verify frozen configuration/context/connection/workflow dependencies inside the mutation transaction; untrusted customer/documents/MCP data cannot grant authority.
- [x] Controlled calendar slot → real Chromium web record → email draft workflow and partial-failure/no-replay acceptance.
- [x] Final code, TypeScript, React and security reviews approved; 199/199 tests, lint, typecheck, build and format checks passed.
- [x] Eight gstack browser journeys (Management, Email, Calendar, Agent Operations at desktop/mobile sizes), no page overflow or fresh console errors; screenshots inspected.
- [x] Full worker restarted with fresh heartbeat and saved WhatsApp account verification; automatic customer communication remains disabled.
- [x] Current integrated production preview at http://127.0.0.1:3003; canonical3000/public ngrok continue serving the separately managed guided snapshot.
- [ ] Real owner AI/OAuth/email/calendar/business-site/MCP acceptance, canonical deployment update and worker login/reboot persistence remain separate delivery work.

See `gan-harness/feedback/feedback-remaining-plan.md` for consumed source scope, logs, reviews, browser evidence and real-account limits. The independent `/private/tmp/afterhours-plan-verify` runtime uses the same lockfile and preserves the original iCloud workspace; keep it while web/worker are running.

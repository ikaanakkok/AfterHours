# Remaining software plan — 2026-10-12

Status: **PASS / DONE** for the accepted software plan. Real owner AI/OAuth/business account acceptance is a separate stage. No public deployment is included.

## Consumed source and runtime

The accepted six-stage plan integrates Workflow Questions/guided channels, shared tenant AI, incoming email/drafts, calendar mutations, typed mixed workflows and the management agent. The final consumed source includes the frontend refresh, HTTP/Bearer MCP setup and WhatsApp/phone safeguards from the coordinated deliveries. Dependencies were installed offline from the same pnpm lockfile into `/private/tmp/afterhours-plan-verify` because native reads of iCloud dataless Documents dependencies stalled. The original workspace is preserved; changed delivery source is reconciled with that snapshot. New native-English/provider-logo, MCP OAuth and connection soft-delete work requested later in other chats is outside this verified snapshot. The source workspace may include those active deliveries; `remaining-plan/verified-source.sha256` identifies the consumed frozen version.

Production web: <http://127.0.0.1:3003>. Normal worker runs from the same runtime with the original project root. The worker was paused for serial database tests, restarted afterward and reported a fresh heartbeat plus a ready, verified saved WhatsApp account. The isolated pairing service was stopped with its encrypted auth flushed. Automatic customer communication remains disabled. Keep the temporary runtime while web/worker use it. Login/reboot persistence is unverified.

Canonical3000/public ngrok remain on the separately managed guided-channel snapshot. Existing 3004/3005/3006 previews and LaunchAgents are preserved.

## Delivered behavior

- All production text paths use the tested tenant-selected AI provider. Missing/stale providers wait or fail explicitly; fixture/model responses are identified and restricted to controlled tests/demo paths.
- Gmail/Outlook initial seven-day import and 60-second polls persist page progress, leases, tokens and source-linked messages/drafts. Provider thread identity separates different conversations and retains multiple senders in one thread. Restart/repeated-message/token-refresh cases do not duplicate messages or drafts. Draft generation requires explicit channel/customer draft grants and ready AI; email send remains a separate command/user action/approval. Inbox cannot bypass the draft path.
- Calendar update/cancel commands validate tenant grants, actual account/calendar/event and provider revision. Cancellation requires admin approval bound to the concrete record; updates read back and cancellations verify provider state. Conflicts and unknown outcomes stop for review.
- Versioned typed browser/calendar/email/MCP steps persist concrete inputs, verified outputs, approvals and evidence. Prior verified output feeds later steps. Runtime rechecks membership, analysis generation, configuration and grants. Partial failure retains completed writes and stops without replaying them. Legacy browser plans use compatibility conversion.
- Management reads persisted conversation history, Context and current system/workflow/schedule/operation state, asks clarifications and proposes only validated allowed commands. Apply records step results and checks frozen dependencies inside each mutation transaction. Whitelisted plans cannot turn customer/document/MCP text into authority or arbitrary code.
- Connection tests/execution/login capture endpoint and ciphertext coherently. Token refresh is compare-and-swap, cannot revive deleted/rotated secrets, and stale callbacks cannot promote changed/disabled connections. Generic writes cannot forge guided/MCP discovery/grants. Advisory/row-lock order is consistent.
- Additive migrations 0008–0011 preserve existing data; RLS/grants were reapplied, with tenant composite relations for new records.
- Calendar update/cancel grant controls are opt-in, refresh when permissions change and are disabled for staff. Mobile Agent Operations time and More are directly available in the first column. Removed payment actions are excluded from the current management approval display; historical config is retained.

## Final verification

| Check                                     | Result                     | Evidence                                                                                                                                 |
| ----------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` (zero warnings)               | PASS                       | [lint.log](remaining-plan/lint.log)                                                                                                      |
| `pnpm typecheck` (all workspaces + tools) | PASS                       | [typecheck.log](remaining-plan/typecheck.log)                                                                                            |
| `pnpm test`                               | **23 files, 199/199 PASS** | [tests.log](remaining-plan/tests.log)                                                                                                    |
| `pnpm build` (`next build --webpack`)     | PASS                       | [build.log](remaining-plan/build.log)                                                                                                    |
| `pnpm format:check`                       | PASS                       | [format.log](remaining-plan/format.log)                                                                                                  |
| Code review                               | APPROVE                    | Final targeted review of frozen dispatch, connection-test revisions, workflow approvals and runtime snapshots                            |
| TypeScript review                         | APPROVE                    | Full workspace/tools check; callback contracts, account/token types and lock ordering reviewed                                           |
| React review                              | APPROVE                    | New management/email/calendar/Agent Operations UI; current grants, staff controls, payment-display removal and hydration wait reviewed   |
| Security review                           | PASS                       | Tenant authority, stale grants/approvals, credential/config races, source-bound email, provider account and MCP metadata guards reviewed |
| gstack browser acceptance                 | **8/8 PASS**               | [browser.log](remaining-plan/browser.log), source `apps/web/tests/remaining-plan.gstack.js`                                              |

The final behavioral run started at 14:59:55 local time and completed in 57.22 seconds. Earlier copied suites with 142/149 or 169/188 are superseded. The last UI display-only adjustment was followed by lint/build and management browser reruns; backend behavior stayed unchanged.

Behavioral acceptance covers shared provider readiness, multiple import pages/resume/dedup/token refresh, distinct email threads/source-linked drafts, wrong-tenant/missing-grant/stale-calendar approvals/provider conflicts, unknown results, frozen management dependencies, partial workflow failure and completed-write preservation. The mixed calendar-slot → actual Chromium fixture web record → email draft test performs a real local browser write/read-back with controlled provider responses. Tests use random tenants and clean their own records; no customer message was sent.

## Browser evidence

Desktop 1440×900 and mobile 390×844 journeys use authenticated local production pages plus explicitly labelled UI workspace/command fixtures. No external mutations occur. Assertions cover provider waiting and readable proposal apply, email opt-in without send grants, calendar permission changes and staff restrictions, both Agent Operations tabs and time/More access. All pages passed global overflow checks and had no fresh console errors. All eight screenshots were inspected.

| Page                 | Desktop                                                | Mobile                                               |
| -------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| Management Assistant | [desktop](remaining-plan/management-desktop.png)       | [mobile](remaining-plan/management-mobile.png)       |
| Email                | [desktop](remaining-plan/email-desktop.png)            | [mobile](remaining-plan/email-mobile.png)            |
| Calendar             | [desktop](remaining-plan/calendar-desktop.png)         | [mobile](remaining-plan/calendar-mobile.png)         |
| Agent Operations     | [desktop](remaining-plan/agent-operations-desktop.png) | [mobile](remaining-plan/agent-operations-mobile.png) |

## Real verification and remaining scope

Owner AI keys/reasoning, Google/Microsoft app registration and consent, real Gmail/Outlook import/send, calendar mutation, business sites and real MCP semantics/accounts remain pending. Controlled AI/API replies and local browser fixtures are not live-provider evidence. Real WhatsApp linking/clean-session restoration and the user-confirmed iPhone–Mac two-way Apple call relay have their own [scoped evidence](feedback-whatsapp-phone.md); customer delivery/recovery and AI audio access are not established. SMS/IVR adapters and executable AI live-call media are deferred. Additional calendars and the newly requested MCP OAuth delivery are separate work.

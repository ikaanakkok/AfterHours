# AfterHours

Local-Mac AI operations assistant for small businesses. pnpm workspace: Next.js 16 panel/API, Node worker, PostgreSQL (Docker), Drizzle, Better Auth, pg-boss, Playwright. All website navigation and page copy must use natural, native-sounding English.

## Workspace instructions

- Load the `graphify` skill (`~/.claude/skills/graphify/SKILL.md`) for repository/knowledge-graph questions.
- Use gstack `/browse` for web browsing; never use `mcp__claude-in-chrome__*`.
- Do not send external messages or publish changes without user authorization.
- Never commit or print secrets: `.env`, `.data/`, `.data/demo-access.json`, stored connection secrets.

## Layout and entrypoints

- `apps/web` — Next.js 16 panel + admin API. All panel mutations go through `POST /api/command` (`src/app/api/command/route.ts`) → core `runCommand`. Tenant context comes from a verified membership, never the request body.
- `apps/worker` — `src/index.ts` runs Baileys, the pg-boss queues and a 2s tick that drains persisted work.
- `packages/core` — shared Drizzle schema, policy, commands, browser and adapters. Exported via `@afterhours/core` subpaths (`/db`, `/schema`, `/browser`, `/scheduling`, `/integrations`); internal TS imports use the `.js` suffix.
- `scripts` — `setup`, `migrate`, `seed`, `fixture`, `qa-session`. `tests` — vitest behavioral tests. `migrations` — generated + hand-written SQL. `docs/task-list.md` and `gan-harness/` hold scope and evidence.
- Git: branch `main` has **no commits yet**; the whole tree is untracked. Do not assume history or a base branch.

## Commands

Setup (order matters; needs Docker Desktop, Node >=22.12, pnpm 10.23):

```sh
pnpm install --frozen-lockfile
pnpm setup          # writes .env + Mac Keychain master key; preserves existing
pnpm db:up          # Postgres 18, reachable only on 127.0.0.1:55432
pnpm db:migrate
pnpm seed           # additive, demo DB only; keeps existing tenant settings
pnpm exec playwright install chromium
```

Dev, three terminals: `pnpm fixture` (:4001) | `pnpm worker` | `pnpm dev` (:3000). Production web: `pnpm build`, then `pnpm --filter @afterhours/web start`.

Verify:

```sh
pnpm lint         # eslint on apps/web only, zero warnings allowed
pnpm typecheck    # all workspaces, then tsconfig.tools (scripts/tests)
pnpm test         # vitest
pnpm build        # next build --webpack
pnpm format:check
pnpm check        # lint -> typecheck -> test -> build, in that order
```

## Architecture and data rules

- Tenancy is enforced by Postgres RLS. Use `tenantDb(tenantId, fn)` (sets `app.tenant_id` per transaction); the runtime role `afterhours_app` is `NOBYPASSRLS` and tables are `FORCE ROW LEVEL SECURITY`. Tenant relations use composite foreign keys. `audit` is append-only (UPDATE/DELETE revoked).
- `pnpm db:migrate` also (re)applies RLS, policies, grants and the `afterhours_app`/`afterhours_auth` roles for every public table, so re-run it after schema changes.
- `assertLocalDemoDatabase()` in `packages/core/src/env.ts` requires `AFTERHOURS_MODE=demo`, localhost, port 55432, db `/afterhours`, user `afterhours_owner`. Never point setup/seed/tests at another database.
- `.env` is loaded by `packages/core/src/env.ts` and `apps/web/next.config.ts` (`AFTERHOURS_PROJECT_ROOT`).
- Config from chat and panel both go through one versioned configuration service. External writes need permission checks, applicable approvals, persisted idempotency and verification; unknown outcomes are reviewed, not blindly retried.
- Secrets use AES-256-GCM with a Mac Keychain master key; responses mask secrets (`assertPublicConfig`, `redact`). Documents never grant permissions.
- This Next.js is v16 with breaking changes vs. training data; `next.config.ts` uses webpack (`transpilePackages: ['@afterhours/core']`, `.js`→`.ts` `extensionAlias`). Read `apps/web/AGENTS.md` and `apps/web/node_modules/next/dist/docs/` before writing web code.

## Testing notes

- `vitest.config.ts` only includes `tests/**/*.test.ts` and runs serially (1 worker; 45s/60s timeouts).
- DB tests need Docker + migrate + seed: they read the seeded `admin`/`staff` membership, then create and clean up random tenants. Run `pnpm seed` first or they throw.
- Browser tests launch real Chromium and start the fixture server on an ephemeral port (`createFixtureServer`, `testMode`).
- `apps/web/tests/*.gstack.js` are gstack browser journeys, not vitest; run them via gstack `/qa` or `/browse`.

## Product rules (easy to break)

- Payments were removed by the user; payment commands/webhook execution return 410. Do not reintroduce them.
- Workflows are text with `>` between steps and named Backoffice Systems; they activate only after a successful verified test plus explicit admin confirmation. Schedules live inside workflows; cron uses only existing published grants. Legacy recorded workflows keep the three-distinct-trial policy.
- Context is persistent text/file/link analysis with separate Documents and Questions tabs and an unanswered-question badge. An absent or unverified AI provider leaves analysis pending; never present fixtures as a live provider.
- Backoffice login tests must verify the authenticated account, not an HTTP 200 or a disappeared password field.
- Automatic customer communication starts disabled; default timezone is Europe/Istanbul. User revision 2026-10-12: WhatsApp connects through Baileys; BlackHole is excluded. Installed Baileys 6.7.22 supports text, not an executable live-call audio/answer adapter. Phone setup targets iPhone + Mac with Bluetooth preferred; Apple cellular-call relay also requires the documented Apple Account/Wi-Fi and Calls from iPhone settings. USB/Bluetooth discovery does not grant AI call-audio access. SMS/IVR are configuration-only (no adapters). Caller ID is not authentication. Excluded: WhatsApp voice messages, Instagram messaging, live transfer to staff.
- Agent Operations has exactly two tabs (Human intervention / Agent activity), newest first.

## Verification status

- Keep test-environment verification separate from real-account/device verification; never present fixtures or controlled AI responses as live.
- Earlier base checkpoints passed lint, typecheck, behavioral tests and production build. Read the dated checkpoints below and `docs/task-list.md` for the current integration status; parallel source changes are not covered by older snapshots.
- Still pending real verification: OpenCode Go/OpenAI keys, real business sites, WhatsApp customer delivery/recovery, Gmail/Outlook/calendar/MCP and live voice. Real Baileys account linking and saved-session restoration passed in the phone/WhatsApp checkpoint below. Local URLs: panel `http://127.0.0.1:3000`, fixture `http://127.0.0.1:4001`.
- Evidence: `gan-harness/feedback/feedback-context-workflows.md` (PASS 7.5/10).

## Workflow Questions and guided channels checkpoint — 2026-10-12

- Workflows have separate Workflow / Questions tabs, unanswered badges and persistent clarification answers. Save and answers trigger analysis using the tested tenant AI provider. Missing keys leave `awaiting_provider`; controlled fixture reads are explicitly identified.
- Unresolved, stale or failed clarification blocks testing, confirmation, activation and execution. Answers invalidate old tests/plans and pause schedules. Every real analysis has a generation/hash: an older successful test cannot reactivate a newly analyzed workflow.
- Each external workflow system rechecks current membership, workflow/configuration/analysis and system grants; cancelled partial work retains verified evidence. Transient browser errors do not become permanent system-name questions.
- Front Desk Channels uses service selection and provider-specific instructions, not JSON, client IDs or token entry. WhatsApp saves a live pairing request and displays the worker's PNG directly with expiry/attempt checks. Old callbacks cannot revive a disabled/relinked connection; socket state events serialize.
- Google/Microsoft OAuth is a deployment setup concern (`AFTERHOURS_GOOGLE_*`, `AFTERHOURS_MICROSOFT_*` in `.env.example`). Owners only select their account and approve readable uses. PKCE, one-use state, current admin/connection revision and granted account/scopes are verified; tokens stay encrypted. Deployment apps are currently unconfigured.
- Initial guided calendar setup uses the account's primary calendar. Additional-calendar selection is not implemented in this delivery. SMS/IVR/live voice remain unavailable and are never reported ready.
- Focused evidence: `gan-harness/feedback/feedback-workflow-questions-guided-channels.md`; source journeys `apps/web/tests/workflow-questions.gstack.js` and `guided-channels.gstack.js`. Real provider reasoning, phone pairing and OAuth account/device testing remain pending.
- iCloud blocked native reads in Documents/node_modules. Verification dependencies and a fixed source snapshot were installed offline from the same lock into `/private/tmp/afterhours-guided-verify`. The verified production web serves canonical loopback3000 from that snapshot; original source is preserved and later backend/theme/MCP changes are being verified in their owning chats. Do not delete this temporary runtime while it serves the panel. Worker is paused during concurrent database tests; the backend owner will restart it after its checks.

## Frontend design refresh checkpoint — 2026-10-12

- All 13 sections plus login/error/not-found now use the light ClickUp-inspired design system, locally bundled Plus Jakarta Sans and accessible mobile navigation. Routes/menu order/command contracts remain.
- Settings polling retains drafts/focus with explicit reload; Inbox uses per-conversation drafts and mobile list/detail back navigation. Tenant switches reset section state.
- Frontend snapshot production build and lint passed; 52 panel layouts + 8 public-page layouts and 7 controlled browser journeys passed. See `DESIGN.md` and `gan-harness/feedback/frontend-refresh.md` for exact scope and evidence.
- Final accepted integration snapshot supersedes earlier frontend copied-suite failures: 23 files, 199/199 tests plus lint/full typecheck/build/format and reviews PASS, recorded by the backend integration owner in `gan-harness/feedback/feedback-remaining-plan.md`. Frontend chat inspected its report/logs. Production frontend3004 is still the earlier design-only snapshot; integrated preview3003 includes coordinated HTTP/Bearer MCP and WhatsApp/phone changes. Later MCP OAuth is outside that verified snapshot.
- Production frontend preview is `/private/tmp/afterhours-frontend-verify` at loopback3004. Keep it while in use; canonical3000 is separately managed by the guided-channel checkpoint.

## ngrok access checkpoint — 2026-10-12

- User authorized ngrok access. Installed ngrok 3.39.8 uses the existing account configuration; no credentials were printed or changed.
- Public panel: https://tingly-tumble-bubbling.ngrok-free.dev; tunnel target is explicitly http://127.0.0.1:3000. Project `.env` AFTERHOURS_APP_URL matches the HTTPS origin.
- Production web started from the existing `/private/tmp/afterhours-guided-verify` snapshot with AFTERHOURS_PROJECT_ROOT pointing at the source project and the HTTPS APP_URL supplied explicitly. This is the existing verified snapshot, not verification of concurrent source changes.
- External browser verification: `/login` returned 200 and rendered email/password/login controls. Authenticated login, panel mutations, worker operations, real integrations and reboot persistence are not verified in this checkpoint.
- Restart tunnel with `ngrok http http://127.0.0.1:3000`. Mac, web and tunnel must remain running. Free ngrok browser warning may require Visit Site. OAuth deployment callback URLs must use this public origin when configured.

## Guided setup final verification supplement — 2026-10-12

- Final snapshot typecheck, lint and production build passed. 29 focused behavioral cases plus the separately passing admin-pause regression are recorded in the focused feedback file. Pausing an invalidated workflow remains available; reactivation still requires current clarification and a verified test.
- Preserve the later ngrok HTTPS origin configuration. The public-origin switch requires a new browser login; earlier authenticated localhost QA does not establish authenticated public access.

## ngrok persistence repair — 2026-10-12

- ERR_NGROK_3200 followed termination of both turn-bound web/ngrok processes. Replaced them with user LaunchAgents `com.afterhours.web` and `com.afterhours.ngrok` in `~/Library/LaunchAgents`, using RunAtLoad/KeepAlive and 10-second restart throttling. Both were bootstrapped into the user GUI session.
- Web still serves the guided-verify snapshot on loopback3000; ngrok explicitly binds the existing HTTPS hostname and forwards to 127.0.0.1:3000. HTTP inspection is disabled. No account tokens copied into LaunchAgents. Private logs live in `~/Library/Logs/AfterHours`.
- Verified both launchd service PIDs, loopback3000 listener, and public `/login` HTTP 200 with login controls after repair. Actual reboot, sleep/wake, authenticated login and worker operations remain unverified. Login-time startup requires the runtime snapshot to remain available; this does not make the temporary snapshot a permanent deployment directory or start Docker/worker.

## Backoffice MCP checkpoint — 2026-10-12

- Backoffice Systems now adds/edits Web or MCP systems. The MCP form supports Streamable HTTP over HTTPS or local HTTP and an optional encrypted Bearer token. Stdio, legacy SSE and MCP OAuth setup are outside this delivery.
- Dedicated commands: `backoffice.mcp.save`, `.test`, `.authorize`; all go through the existing command entrypoint and verified admin membership. Generic create/secret/update/test cannot inject managed discovery/permission metadata or bypass dedicated setup.
- Tool discovery never grants permissions or proves business account identity. Admin explicitly confirms selected tools as read-only; only selected tools are granted to admin. Write tools retain the existing independent read-back contract and have no new configuration form here.
- Every save invalidates tests and grants. Changing an endpoint removes its old credential; blank token preserves it only for the same endpoint. Discovery captures endpoint/ciphertext atomically, and revision/disabled guards reject stale promotion or grants. Web/MCP names share the uniqueness check.
- Focused regression: 39/39 (10 MCP setup, 23 integrations, 6 text-workflows), lint, workspace plus tools typecheck, scoped format and production build passed in `/private/tmp/afterhours-mcp-verify`. gstack real local command API + controlled MCP protocol server journey passed; real business MCP accounts are still pending. Evidence: `gan-harness/feedback/feedback-mcp-backoffice.md`.
- MCP preview is loopback3005 from its production snapshot. Canonical3000/ngrok are independently owned by the integration chat and initially predate MCP; do not replace either runtime without coordination. No worker restart or broad concurrent DB suite was performed by the MCP owner.

- MCP review handoff: code/TypeScript and security review passed after the shared runtime snapshot fix; React approved the exact setup UI. Whole-source management dispatch hooks/integration checks and canonical3000/ngrok rollout remain owned by the integration chat.

## WhatsApp Baileys and iPhone–Mac checkpoint — 2026-10-12

- User revision excludes BlackHole and prefers Bluetooth for iPhone + Mac. WhatsApp text remains Baileys; no executable WhatsApp/iPhone live-call audio/answer adapter was added. Old BlackHole/WhatsApp Web setup copy was removed from Voice/channel instructions and workspace status.
- Real `WhatsApp iPhone` QR scan succeeded in the authenticated Mavi Atölye tenant. Server reports `ready`, `realAccountVerified: true`, no last error and QR cleared. Encrypted auth was read successfully; clean stop/restart restored the session without another QR. Customer replies remain disabled; no customer message was sent. Linking and stored-session restoration are verified separately from message delivery and account recovery.
- Bundled Baileys 6.7.22 client version returned 405 before pairing. The SDK current-version helper, 5s timeout, validated numeric tuple, one-hour cache and invalidation on 405 restored pairing. No QR payload or secret was logged. Disabled/relinked sessions are checked before inbound/outbound work; LIDs retain their own namespace; shutdown awaits encrypted writes.
- Admin-only `voice.assess` returns privacy-preserving USB/Bluetooth counts and explicit unavailable AI audio status. Actual Mac result: Bluetooth on, one known iPhone, zero connected iPhones; USB iPhone absent. Native FaceTime Calls from iPhone is enabled. User confirmed the phone setting, this Mac selected and same Wi-Fi, then reported a real incoming cellular call rang on the Mac, was answered there and both sides heard audio. Apple call relay is user-verified; this does not establish a Bluetooth-only connection or AI media access.
- Focused pure tests passed 10/10; snapshot lint, workspace/tools typecheck, scoped format and production web build passed. gstack device check and seven controlled guided-channel assertions passed; desktop/mobile/tablet and QR-free linked screenshots inspected. Evidence: `gan-harness/feedback/feedback-whatsapp-phone.md`.
- Isolated phone preview: `/private/tmp/afterhours-voice-verify` at loopback3006. Canonical3000/ngrok and other previews were preserved. The temporary single-connection pairing-only service was stopped cleanly after verified reconnect (exit 0, awaited credential flush); no duplicate socket remains. The backend owner started the full worker from `/private/tmp/afterhours-plan-verify`, reporting fresh heartbeat/workerOnline. Independent server read confirmed `ready`, real account verified, no error and new verification `2026-10-12T12:01:35.413Z`; process inspection found only the normal worker. That chat reported final code/TypeScript/security and React approval plus 199/199 tests and production build in its current integration snapshot. Canonical rollout remains with that chat; this check does not establish worker login/reboot persistence.

## Integrated remaining-software delivery — 2026-10-12

- Management/customer/Context/workflow text flows share the tenant-selected tested AI provider. Missing providers produce explicit waiting/error states; controlled responses are limited to identified tests/demo paths.
- Gmail/Outlook sync persists the initial seven-day window, paginated progress, leases and 60-second polling. Provider threads/source message metadata and unique source-linked drafts prevent duplicate imports/drafts after retries/restarts. Read/draft permissions are opt-in and separate from user-triggered send. Generic Inbox reply cannot bypass email drafts.
- Calendar update/cancel verify account, calendar, event and current provider revision before dispatch; update is read back and cancellation status verified. Cancel requires concrete admin approval; stale or unknown outcomes stop for review.
- Typed version-2 workflows combine browser/calendar/email/MCP steps with persisted resolved inputs, outputs and proof. Per-step grants and exact write approvals are rechecked. Partial failures retain verified completed writes and never blindly replay the whole workflow; Questions/test/confirmation/generation gates remain. Legacy browser plans run through compatibility conversion.
- Management has durable multi-turn history, current Context/system/workflow/schedule/operation state, a validated command allowlist and persisted action-plan step results. Frozen dependencies are checked under transaction locks in the actual command mutation; model content cannot supply tenant/actor authority or arbitrary code.
- Connection execution/login/test capture endpoint and encrypted credential coherently. Guarded refresh never recreates removed secrets; stale/disabled tests cannot revive changed connections. Generic connection writes cannot forge guided/MCP discovery or permission metadata. Domain advisory locks precede dependency row locks.
- Additive migrations 0008–0011 plus reapplied grants/RLS protect new email/management/workflow data with tenant policies/composite relations. Existing data is preserved.
- Final current-source verification: lint PASS; all workspace + tools typecheck PASS; 23 files/199 tests PASS; production webpack build PASS; format PASS. Code/TypeScript/React/security reviews approved. The earlier copied 142/149 and 169/188 backend results are superseded by this integrated run. Eight controlled gstack desktop/mobile journeys passed (Management, Email, Calendar, Agent Operations); screenshots inspected, no global overflow/fresh console errors. Calendar grants refresh correctly and staff cannot change them.
- Final evidence: `gan-harness/feedback/feedback-remaining-plan.md`, logs/screenshots in `gan-harness/feedback/remaining-plan/`, source journey `apps/web/tests/remaining-plan.gstack.js`. Actual Chromium mixed calendar-slot → web-record → email-draft acceptance is covered by behavioral tests; provider responses are controlled.
- iCloud dataless Documents dependencies prevented reliable native reads. Independent same-lockfile offline dependencies/current source in `/private/tmp/afterhours-plan-verify` were used; final consumed source files are reconciled with the original workspace. Current integrated production web is loopback3003 and the full normal worker is running from that runtime with fresh heartbeat/verified saved WhatsApp reconnect. Keep this runtime while in use. The pairing-only service was stopped; customer auto-send remains disabled.
- Canonical3000/public ngrok and their LaunchAgents continue serving the separately managed guided snapshot; this software delivery does not replace them. Other chats' 3004/3005/3006 previews are preserved. Runtime login/reboot persistence is not verified.
- Real owner AI reasoning, OAuth consent/email polling/calendar changes, business sites and MCP tool/account verification remain a separate acceptance stage. Real WhatsApp linking/clean restoration and user-confirmed Apple call relay remain scoped to their checkpoint. SMS/IVR and executable AI live-call media adapters are deferred.

## Front Desk channel removal — 2026-10-12

- Admins can remove a channel from the Front Desk Channels list. Removed channels are disabled and hidden; OAuth/WhatsApp secrets and temporary QR/OAuth state are cleared, while historical conversations and operation records remain linked for audit/history. The worker clears any final WhatsApp auth flush after closing its socket. This source change has not yet been verified with the project checks.

## Post-delivery source ownership supplement — 2026-10-12

- The 199-test/software delivery evidence and loopback3003 describe the frozen `/private/tmp/afterhours-plan-verify` source, recorded by `gan-harness/feedback/remaining-plan/verified-source.sha256`. Subsequent whole-site native-English/provider-logo work, MCP OAuth and connection soft-delete are separate active user tasks; their latest source changes are not covered by those test/build results. Preserve their owners' edits and verify their own migrations/runtime before rollout.
- During reconciliation an older Turkish frontend copy temporarily overwrote part of the newer English copy. The translation owner's literal replacements were recovered to restore English source text; root calendar permission refresh/staff guards and removed-payment display fix remain. The frozen QA runtime/screenshots remain the earlier Turkish version and are labelled by their consumed source.

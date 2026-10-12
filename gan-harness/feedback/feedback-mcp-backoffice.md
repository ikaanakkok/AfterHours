# Backoffice MCP setup — 2026-10-12

Implemented with coordinated ownership across the concurrent backend, frontend, original feature and voice chats. MCP owns `mcp-setup.ts`, the Backoffice portion of `systems.tsx`, `mcp-system-setup.tsx` and its tests. The backend owner owns shared generic-command guards; the frontend owner retains shared styles and UI primitives.

## Delivered behavior

- Backoffice Systems offers Web or MCP setup. MCP accepts a name, purpose, Streamable HTTP endpoint and optional Bearer token, with no raw JSON form.
- Secrets are encrypted with the existing Mac Keychain master key. Tokens remain hidden, survive an unchanged endpoint when the field is empty, can be explicitly removed and are discarded when the endpoint changes.
- A fresh MCP protocol connection discovers tool names using `initialize` and `tools/list`, without invoking a business tool. Discovery grants no permissions and does not attest the business account identity.
- After testing, an admin explicitly confirms the selected tools are read-only. Only selected tools are granted, only to admin. Server annotations do not grant access. Write tools retain the existing independent read-back verification requirements and have no new setup UI here.
- Save invalidates discovery, permissions and test state. Revision checks and row locks prevent stale tests or grants from overwriting a newer save. Endpoint and ciphertext are captured under the same connection lock, so concurrent token rotation cannot send a new token to an old endpoint. Disabled connections cannot be promoted by an in-flight test.
- Named Web/MCP systems share the same case-insensitive uniqueness check. Generic setup/secret/update/test commands cannot inject dedicated discovery metadata or bypass managed MCP setup.

## Verification

Source snapshot `/private/tmp/afterhours-mcp-verify` uses dependencies installed offline from the unchanged frozen lockfile because Documents/node_modules has iCloud I/O stalls. Environment and local data are symlinked, not logged. Other chats continue changing the shared source; this is a scoped verification record.

- `pnpm seed`: passed against the guarded local demo database.
- New MCP setup behavior: 10 tests passed, including encrypted token lifecycle, no automatic grants, unknown tools, unsafe endpoints, cross-kind names, tenant/membership checks, stale discovery, disabled connections, atomic endpoint/credential snapshot under concurrent rotation and dedicated-command guards.
- Existing integration behavior: 23 tests passed; combined MCP/integration count 33/33. With the existing text-workflow suite, final focused regression is 39/39.
- Web lint, all three workspace typechecks, scripts/tests tools typecheck, scoped Prettier check and optimized Next.js production build: passed.
- Real browser via gstack `/browse`, real local authenticated command API plus a controlled local MCP protocol server: passed Web/MCP selection, save, discovery, selected grant and edit invalidation. Journey: `apps/web/tests/mcp-backoffice.gstack.js`; fixture is test-only, not a live business provider.
- Final browser layout checks at 390px and 1440px passed; no horizontal overflow at 390px and no console errors after a fresh final reload. Screenshots: `mcp-backoffice/mobile.png`, `mcp-backoffice/desktop.png`.
- The parallel resolver wording assertion and union-narrowing test fixes were refreshed from their owner; the final text-workflow suite and tools typecheck passed. This record does not assert the concurrently changing entire repository is green.

The backend owner also hardened shared runtime credential capture and stale connection-test promotion after security re-review. Those shared changes were refreshed into the MCP snapshot; workspace/tools typecheck and production build passed again. The 39/39 behavioral result refers to the focused MCP regression run before these shared follow-up edits; their runtime regressions belong to the integration owner.

Preview on `http://127.0.0.1:3005/backoffice-systems` uses the refreshed MCP production snapshot. Canonical `3000` belongs to the original feature chat and initially predates MCP; do not confuse the snapshots.

## Review

The integration chat's code-reviewer/TypeScript review confirmed the atomic runtime fix and withdrew the MCP race finding. React review approved the exact `systems.tsx` / `mcp-system-setup.tsx` scope with no HIGH/CRITICAL finding. The integration chat's security-reviewer re-reviewed the final source and reported PASS with no remaining blocking security finding. This includes atomic runtime and Backoffice credential snapshots, protected setup metadata across generic commands/approvals, and management MCP save/test proposals without model-controlled read-only classification. The reviewer performed static checks; behavioral/build evidence is recorded separately above.

The integration owner is finishing management pre-mutation dispatch hooks and whole-source checks. These broader checks are independent of the focused MCP result and must complete before asserting a joint canonical release.

## Pending live coverage

A real business MCP endpoint/account, its Bearer credential and trustworthy tool semantics have not been verified. Stdio process launch, legacy SSE transport and MCP OAuth are outside this HTTP/Bearer setup delivery. Workflow write-tool configuration continues using the existing verified adapter contract; the new form exposes explicit read-only grants.

Integration handoff update: the final private `beforeMutation` callback and advisory-lock-before-row-lock ordering were preserved in the MCP verification source snapshot. Core typecheck passed after that refresh. The running 3005 compiled preview predates these last management-dispatch hook changes; their final build and integration checks are owned by the canonical integration chat. No shared source, worker or canonical runtime was changed by this handoff.

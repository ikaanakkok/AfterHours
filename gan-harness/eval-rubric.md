# Acceptance rubric — 2026-10-12 revision

Score each area 0–10; pass threshold 7.0. Critical broken behavior or false readiness blocks delivery.

- Context: add/list persistent text and files; Documents/Questions separate; unanswered count reflects replies/new documents; no-provider state honest.
- Workflows: create text steps with `>`, refer to named systems; Test is real; verified result requires confirmation before activation; schedules/history live inside workflow.
- Settings: English Front Desk Channels, Backoffice Systems, AI Providers; useful service icons; save credentials without disclosure; failed login remains saved and inactive; provider selection works.
- Agent Operations: exactly two main tabs, newest-first history, visible confirmation, More request/time/result/partial evidence.
- Security/readiness: tenant/admin enforcement, secret masking, no unauthorized grants/approval bypass; unavailable SMS/IVR and provider/device claims truthful; payment navigation removed.
- UX: keyboard labels, functional forms/loading/errors, responsive layout, no broken route or new console errors.
- Evidence: actual local browser interactions plus typecheck, behavioral tests, production build and review. Live API/device verification stays pending until exercised with real user accounts.


## Clarification and guided-onboarding acceptance checks

- Questions separate from workflow details; unanswered count decreases/increases with current analysis; drafts survive tab/version updates.
- Missing provider and unresolved/stale questions prevent Test and activation. Fresh analysis cannot reuse an older test.
- Service-specific instructions replace JSON/token setup. QR PNG is rendered directly, expires and disappears once connected; requests remain tenant-bound.
- Google/Microsoft app-not-configured state is honest; no owner-facing developer credentials.
- Check mobile 390px layout and actual authenticated command origin separately from controlled UI responses. Live reasoning, phone pairing and OAuth consent require separate real-account evidence.

# AfterHours current implementation contract

Follow the user's 2026-10-12 revision. Context replaces the teaching screen: persistent attachments and separate dynamic questions with unanswered badge. Workflows are text with `>` steps referencing named Backoffice systems, with test + explicit confirmation and schedules inside each workflow. Agent Operations has exactly two primary tabs: intervention and activity, with newest-first rows, confirmation, More details and partial execution evidence. Settings groups Front Desk Channels, Backoffice Systems and AI Providers. Menu names are English; body copy Turkish. Remove Payments. Overview is retained pending user feedback.

All UI data must use authenticated tenant APIs and PostgreSQL. Credentials/keys are encrypted and never displayed. A fresh login failure leaves a saved system inactive. Outside content never grants privileges. Workflow writes require exact frozen plan approval; partial results are retained and never blindly retried. Unverified AI providers, SMS/IVR adapters, external accounts and live calls remain visibly unavailable. Local fixtures and controlled AI responses are not live account verification.

Design: ink/navy sidebar, warm off-white canvas, restrained orange accent, semantic accessible controls and responsive layouts. Functional behavior has veto over appearance.


## Accepted addition: Workflow Questions and guided Front Desk onboarding

Each text workflow exposes a separate Questions tab and unanswered count. Tested tenant AI analyzes uncertainty against current Context and systems; answers persist and can increase/decrease questions. Pending/missing-provider/stale analysis prevents testing and activation. Every analysis generation invalidates old test confirmation. Pending writes revalidate authorization and workflow state before each system.

Channel creation begins with a service-specific icon picker and short instructions. No raw JSON, developer credential or token form is presented. WhatsApp displays the actual pairing PNG and removes expired/connected codes. Google/Microsoft use provider consent through deployment-owned OAuth apps, narrow business grants and verified account/scopes. Unsupported adapters remain explicitly pending.

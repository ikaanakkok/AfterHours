# Evaluation — Context and text Workflows revision

Date: 2026-10-12. Target: http://127.0.0.1:3000, stable production server. Driver: isolated gstack Chromium, with the local QA administrator session. Assessed against the current spec and rubric. `generator-state.md` is absent; live results below establish what was exercised.

## Scores

| Criterion      | Score | Weight | Weighted   |
| -------------- | ----- | ------ | ---------- |
| Design Quality | 8/10  | 0.3    | 2.4        |
| Originality    | 7/10  | 0.2    | 1.4        |
| Craft          | 7/10  | 0.3    | 2.1        |
| Functionality  | 8/10  | 0.2    | 1.6        |
| **TOTAL**      |       |        | **7.5/10** |

## Verdict: PASS for the local panel revision

No critical broken behavior remains in the exercised local flows. This verdict does not establish live AI/provider, external-account or device compatibility. Those remain pending and are visibly described as pending. Unavailable provider keys were not replaced with a fake live provider.

## Verified live interactions

- Context: created a QA text document containing Turkish, emoji and literal `<script>` text. It persisted after reload without executing markup. Uploaded a real TXT file through the file input; both documents appeared in the attachment list with the honest AI-connection-pending state. Removed only these two QA documents afterward and confirmed the empty state returned.
- Context tabs: Documents and Questions contain separate content. ArrowRight on the Documents tab selected Questions. The circular question count was present. With no provider connected, the page correctly showed zero questions and the provider-setup warning. Dynamic question generation was not independently exercised against a real provider. The parent separately reports a controlled browser regression covering count 2 → 1 → 2; that is controlled test evidence only.
- Workflow: created `QA Talep sayacı`, saved text with `>` separators and a ten-minute interval. The embedded schedule stayed disabled before verification. An initial non-fixture request was rejected through Agent Operations; its failed history remained visible. Edited the same QA workflow to the supported controlled example `Talep kayıt sitesi > kayıtları kontrol et > her 10 dakika`.
- Backoffice fixture: reproduced a legacy fixture button failure, reported it, then re-tested the repaired production build. `Bağlantıyı test et` queued a real browser connection test and Agent activity showed it verified. The connection now accurately states that the local test fixture requires no login.
- Workflow test: clicked Test, waited for worker execution, and saw verified evidence containing the actual fixture count `0 kayıt`. Workflow remained inactive until `Test doğru tamamlandı`. Confirmation activated the workflow and its linked schedule. Then Duraklat disabled both. The clearly marked QA workflow and history remain saved and paused; no customer automation settings were changed.
- Agent Operations: exactly two main tabs, Human intervention and Agent activity. More expanded the request, timestamp and approval controls. Rejection was recorded, the pending count became zero, and activity history showed newest first with failed and verified results.
- Settings: English menu names, distinct Front Desk Channels / Backoffice Systems / AI Providers pages, service icons, provider creation form with OpenCode Go / OpenAI and key field, and explicit SMS/IVR adapter-pending labels. No payment navigation item exists. No real credential or key was entered during this evaluation.
- Responsive: Context and Agent Operations at 390 × 844 had document scroll width exactly 390 px, with no page-level horizontal overflow. Context desktop and settings desktop hierarchy were readable. Tables contain their own horizontal overflow on narrow screens.
- Console: after restarting the repaired production server and clearing the console, the entire repaired happy path completed with `(no console errors)`. Earlier captured errors were the initial unauthenticated 401, the reported fixture-button 400 and the deliberate unready-workflow 409, not JavaScript runtime exceptions.

The parent reports lint, typecheck, 65 behavioral tests and production build passing. Those commands were not rerun by this UI evaluator. No database/security conclusion is inferred solely from visual inspection.

## Critical Issues (must fix)

None remaining in the verified local flow. The legacy fixture test-button defect was fixed and re-tested before this verdict.

## Major Issues (should fix)

None remaining in the focused final retest. The initial technical approval preview was replaced with the workflow name and readable requested steps; exact technical evidence remains behind a disclosure.

## Minor Issues (nice to fix)

1. At 390 px, the Agent activity table initially shows system, actor and result; timestamp and More are beyond the table's horizontal viewport. Keep the contained scroll, but add an explicit horizontal-scroll hint or a compact mobile row with timestamp and More always visible. The page itself does not overflow.

## What Improved Since This Evaluation Started

- The legacy local fixture no longer calls the fresh-credential Backoffice login path. Its test button now invokes the appropriate connection test and the displayed login requirements are accurate.
- The successful fixture workflow confirms real browser read evidence before activation; a passed test alone leaves it inactive, and pausing also stops its schedule.
- The final upload preserves the entered title after a page reload.
- The final approval row and More section use a readable workflow name and steps, rather than the internal capability identifier and JSON preview.

## What Regressed Since Last Iteration

No prior scored report was provided for comparison. No regression is asserted without that evidence.

## Specific Suggestions for Next Iteration

1. Make the mobile table's hidden timestamp and More columns discoverable.
2. With the user's real provider key, exercise a contradictory pair of documents, answer one question, add resolving evidence and verify that both the tab and sidebar counts change against the actual API response.
3. Keep real browser/device verification separate from the controlled fixture status, as the current UI does.

## Screenshots

All screenshots were opened and visually inspected before scoring. Paths are relative to the repository and deliberately under ignored local QA storage.

- `.data/qa/evaluator/context-initial.png`: desktop two-column document list and add form.
- `.data/qa/evaluator/context-uploaded.png`: real text/TXT attachment list and explicit missing-provider state.
- `.data/qa/evaluator/context-mobile.png`: separate Questions tab at 390 px and circular zero badge.
- `.data/qa/evaluator/front-desk-desktop.png`: Front Desk Channels, service icon and unavailable SMS/IVR labels.
- `.data/qa/evaluator/operations-more.png`: initial expanded human approval request; historical evidence of the technical-copy issue, now fixed.
- `.data/qa/evaluator/operations-mobile.png`: contained narrow activity table; illustrates discoverability of offscreen More.
- `.data/qa/evaluator/workflow-confirmed.png`: verified and confirmed QA workflow with its active embedded schedule, captured before pausing. Full-page capture moves the fixed sidebar during capture; use viewport captures for presentation.
- `.data/qa/evaluator/context-title-fixed.png`: final TXT upload displays the entered custom title after reload.
- `.data/qa/evaluator/operations-readable-fixed.png`: final approval title and More summary display the workflow name and readable steps.

## Final retest addendum

The last rebuilt production server was tested at 13:29 Europe/Istanbul. Uploaded the same QA TXT file under `QA Özel yükleme başlığı`; reloaded and confirmed that exact title remained in the list, then removed that QA attachment. Opened the existing QA approval and its More control: the title now reads `QA Talep sayacı · Workflow testi onayı`, and the visible summary describes the requested workflow steps without raw IDs or JSON. Both final screenshots were visually inspected. The console again contained no errors. No new open major issues remain; the contained mobile table scroll is the remaining recorded polish issue. The score remains 7.5/10, with the original verification limits unchanged.

## Cleanup

Only the evaluator's Context documents were removed, including the final custom-title retest attachment. The evaluator's QA workflow remains paused with its linked schedule disabled. Existing business configuration, credentials, provider keys and unrelated records were not changed. The fixture's connection verification was performed through its UI test button. No external messages were sent.

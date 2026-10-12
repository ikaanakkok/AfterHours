# AfterHours design system

The interface is a desktop-first operations workspace for small businesses. The ClickUp style reference is adapted to working lists and forms: white surfaces, a quiet gray canvas, black primary actions and restrained violet accents. Menus stay English; body copy stays Turkish. There is one light theme.

## Tokens and typography

- Canvas `#f8f9fa`, surface `#ffffff`, text `#202020`, secondary text `#646464`, borders `#e8e8e8`.
- Brand/focus `#6647f0`, selected surface `#f0ecff`, selected text `#5233c9`. Primary actions use `#202020` with white text.
- Success `#176344` / `#e9f6ef`, warning `#8a4b0f` / `#fff4e5`, error `#a52b37` / `#fff0f2`, informational status `#245b91` / `#edf5ff`. Status labels communicate meaning without color alone.
- Plus Jakarta Sans Variable is bundled through Fontsource, including Latin Extended for Turkish. The browser does not contact a font provider. System sans-serif is the fallback.
- Page headings 28–32px, section headings 18px, regular text/fields 14px, supporting text and status labels at least 12px.
- Four-pixel spacing scale. Cards have 12px corners, fields 9px, buttons and status badges use pill corners. Borders establish structure; overlays alone use pronounced shadows.

## Navigation and screen hierarchy

The existing 13 sections, URLs and WORKSPACE/SETTINGS grouping remain. The light sidebar highlights the current page and pending intervention/question counts. Tenant identity stays visible in the topbar. Overview starts with pending interventions, followed by actual metrics, setup guidance, verified operations, connection status and recent activity.

Inbox uses list/detail columns on desktop and an explicit list-to-conversation/back flow on mobile. Context retains Documents/Questions; Agent Operations retains exactly Human intervention/Agent activity. Workflow step text, questions, test evidence and schedule rules remain intact. Guided channel setup, provider readiness, typed management proposals, email sync and calendar operations from concurrent feature work are preserved.

## Interaction and accessibility

- A single dominant action per action group; secondary and dangerous actions remain distinguishable. Tabs are selection controls with violet active treatment, not black action buttons.
- Focus is visible. Tabs support arrow keys and Home/End. Mobile navigation traps focus, closes on Escape and restores focus to the opener; its background is inert while open.
- Native labelled fields retain hints and caller-supplied descriptions, with optional linked field errors. Failed commands also appear inline on the page.
- Polling retains conversation selection and per-customer replies. Settings keep a captured version and unsaved fields when a newer version arrives; an explicit reload resets the draft. Commands preserve tenant binding and prevent double submission.
- Mobile layouts stack forms and cards. Dense tables scroll horizontally inside named keyboard-focusable regions. Touch controls have a 44px target. Motion is 150–200ms and respects reduced motion.

## Product truth and verification

Fixtures, test environment results and real-account/device verification are explicitly distinct. Unknown provider outcomes are not presented as success. Workflow activation still requires the existing verified test and explicit admin confirmation. No payment feature, additional permission or automatic customer sending is introduced by this redesign.

See `gan-harness/feedback/frontend-refresh.md` for the final verification record and screenshots. New UI regression: `apps/web/tests/frontend-refresh.gstack.js`, run through gstack browse in a local authenticated settings tab. Close that tab afterwards to discard its scoped fixtures.

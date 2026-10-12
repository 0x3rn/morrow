# Coral and presentation refinements

The public homepage now uses the existing #FF8B73 coral for primary actions, decorative step/scope accents and the evidence-card outline. The closing CTA uses #F6E0D5, a soft tint of the same coral. Button labels remain #17201D. Dark panels, cream/sand surfaces, the logo, all public copy and layout measurements are preserved. Links and essential FAQ controls remain readable in ink on light surfaces; healthy/source-evidence indicators retain their green treatment.

The protected layout is retained. Monitoring-scope helper text now sits above a wrapping action row, so “Test selectors” and “Save monitoring scope” fit without splitting words. External competitor icons fall back to the existing name initial if an image fails. Change-detail capture frames show loading and failed-image states while preserving authenticated source URLs, full-capture links and the real images. Image state resets when the source changes and checks images that finish before hydration attaches handlers.

No monitoring actions, queries, screenshot endpoints, account logic, migrations or billing rules changed. Existing dashboard metrics, health categories, schedules, usage facts and activity disclosures are untouched.

## Validation

- All 56 existing Node tests pass, including dashboard information-parity tests.
- `next typegen` followed by `tsc --noEmit` passes.
- ESLint passes with two existing unused-directive warnings in generated `worker-configuration.d.ts`.
- The production Vinext build passes. It reports a duplicate emitted auth CSS filename warning; no auth styles were changed in this work.
- Local Chromium presentation checks pass at 320, 375, 390, 430, 1363 and 1440px. The public homepage's rendered copy and measured section/heading/link geometry match its previous stylesheet at all six widths. Primary/default/hover colours, closing-section colour, green monitoring status, FAQ expansion, mobile-menu opening/dismissal and focus treatment were checked.
- At all six widths, the real scope form/panel retained readable action labels, minimum 44px target heights, helper text above the buttons, selector-preview presentation and Escape dismissal, without page-width overflow. The image components were exercised through loading, success, failure and source changes. Failed decorative images leave a clean name-initial fallback.

Browser checks used the actual presentation components in an isolated fixture, with Next Link/Image adapters and a stubbed read-only selector preview. The fixture used synthetic image responses and submitted no save action. They are component/viewport checks, not a full authenticated production-route test or a physical-phone test. Starting the full local Worker runtime was blocked by an environment `uv_interface_addresses` error. Existing source endpoints and production data were not altered.

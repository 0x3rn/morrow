# Protected workspace layout review

The redesign changes protected-page presentation. It reuses `--morrow-coral: #ff8b73` for primary controls and navigation indicators, preserves the original palette, and keeps the existing decorative strip and semantic status colours.

## Information and behavior

- The dashboard retains four metrics, five health states including zeros, every monitoring record and all three timings, workspace capacity figures and help text, eight complete recent-change entries, and both latest-activity timestamps. Descriptions expand independently inside their rows.
- Desktop navigation uses a 208px sidebar. Mobile uses the account strip and persistent Dashboard, Competitors, and Change history navigation with safe-area padding.
- Competitor lists, profiles, histories, page histories, snapshots, and change details share compact list surfaces. Monitored pages precede the ten-entry competitor activity preview.
- Existing add/manage forms use native modal panels with Escape dismissal, focus restoration, separate scope actions, and scrolling. Removal warnings and actions are retained.
- Search and all existing filters remain available. The original 25-record pagination is preserved. Full hashes, identifiers, evidence text, and source-capture metadata remain available in their corresponding disclosures.
- A source comparison confirms the existing page SQL queries, input names, and server-action bindings are unchanged. The shell adds a read-only query for the account's existing workspace name. Authentication, monitoring, screenshot endpoints, migrations, and public pages were not modified.

## Validation

- Dashboard rendering tests cover complete content, order, independent disclosures, zero counts, empty lists, capacity details, and unhealthy states.
- All 14 authentication tests pass. TypeScript, source lint, and the production Vinext build pass.
- Local browser checks cover 16 populated, empty, detail, and pagination views at 320, 375, 390, 430, 768, 1024, and 1440px: 112 combinations without page errors or horizontal page overflow.
- Interaction checks cover account identity and Sign out, concurrent dashboard expansions, usage help, add/manage panels, labels, mobile input sizes, all five frequency options, scope controls, short-viewport scrolling, filters, both change-result pages, both snapshot pages, and complete source metadata.

Browser checks use disposable synthetic records in a local Worker runtime. No data-changing form was submitted and no production records were changed. These are browser viewport checks, not physical-phone keyboard tests. Local capture fixtures have no screenshot objects; unavailable-capture messages were inspected, and existing image proportions, screenshot URLs, and full-capture links were preserved in source. Production capture images were not opened during this review.
